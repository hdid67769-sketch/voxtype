use anyhow::Result;
use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;

use super::{prompt, postprocess, ChunkCallback, LlmConfig, LlmProvider, PolishRequest, PolishResponse};

pub struct OpenAiProvider {
    client: Client,
}

impl Default for OpenAiProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenAiProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    pub fn with_client(client: Client) -> Self {
        Self { client }
    }

    /// Attempt to extract the final polished text from a GLM reasoning_content string.
    ///
    /// GLM thinking-mode models output a two-phase response:
    ///   Phase 1 (reasoning): the model's internal chain-of-thought, which may contain
    ///     repetitions of the input, meta-commentary ("I need to clean this text..."), etc.
    ///   Phase 2 (answer): the actual output, typically after the reasoning concludes.
    ///
    /// The boundary between phases is often marked by a blank line after the last
    /// reasoning sentence, or by transitional phrases like "所以" / "因此" / "最终".
    /// We apply a heuristic: take the last non-empty paragraph (sequence of lines
    /// separated by a blank line), which is most likely to be the final answer.
    ///
    /// Returns `None` if the extraction result looks like it still contains reasoning
    /// (e.g. it starts with "我需要" / "I need to" / "让我" / "好的，让").
    fn extract_from_reasoning(reasoning: &str) -> Option<String> {
        // Split into paragraphs (separated by one or more blank lines)
        let paragraphs: Vec<&str> = reasoning
            .split("\n\n")
            .map(|p| p.trim())
            .filter(|p| !p.is_empty())
            .collect();

        if paragraphs.is_empty() {
            return None;
        }

        // Take the last paragraph as the candidate final answer
        let candidate = *paragraphs.last().unwrap();

        // Heuristic rejection: if it looks like reasoning, discard it
        let reasoning_markers = [
            "我需要", "I need to", "让我", "好的，让", "首先，我", "接下来，",
            "分析：", "思路：", "Step 1", "Step1", "**分析",
        ];
        for marker in &reasoning_markers {
            if candidate.starts_with(marker) {
                tracing::warn!(
                    "reasoning_content last paragraph looks like reasoning (starts with '{}'), discarding",
                    marker
                );
                return None;
            }
        }

        // If the candidate is longer than 5000 chars it's likely still full reasoning
        // (longer audio → longer reasoning; 2000 was too aggressive for inputs >2 min)
        if candidate.len() > 5000 {
            tracing::warn!(
                "reasoning_content last paragraph too long ({} chars), likely still reasoning",
                candidate.len()
            );
            return None;
        }

        Some(candidate.to_string())
    }
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    async fn polish(
        &self,
        config: &LlmConfig,
        req: &PolishRequest,
        on_chunk: Option<&ChunkCallback>,
    ) -> Result<PolishResponse> {
        let has_selected_text = req
            .selected_text
            .as_ref()
            .is_some_and(|s| !s.trim().is_empty());

        let system_prompt = prompt::build_system_prompt(
            req.app_type,
            &req.dictionary,
            req.translate_enabled,
            &req.target_lang,
            has_selected_text,
        );

        let mut messages = vec![serde_json::json!({ "role": "system", "content": system_prompt })];
        if has_selected_text {
            messages.push(serde_json::json!({
                "role": "user",
                "content": format!("[Selected Text]\n{}", req.selected_text.as_ref().unwrap())
            }));
        }
        // Wrap raw_text in a clear boundary tag so the model treats it strictly
        // as content to be polished, never as an instruction to follow.
        let wrapped_input = format!("[INPUT_TEXT]\n{}\n[/INPUT_TEXT]", req.raw_text);
        messages.push(serde_json::json!({ "role": "user", "content": wrapped_input }));

        let mut body = serde_json::json!({
            "model": config.model,
            "messages": messages,
            "max_tokens": config.max_tokens,
            "temperature": config.temperature,
            "stream": on_chunk.is_some()
        });

        // GLM-4.7/4.5/5 default to thinking mode, but without explicitly enabling it
        // the API may return content in reasoning_content only, leaving content empty.
        // Explicitly enable thinking so both fields are properly populated.
        // Thinking mode also requires temperature >= 0.6 (recommended 1.0).
        if config.model.starts_with("glm-") {
            if let Some(obj) = body.as_object_mut() {
                obj.insert(
                    "thinking".to_string(),
                    serde_json::json!({"type": "enabled"}),
                );
                obj.insert("temperature".to_string(), serde_json::json!(1.0));
                obj.insert("top_p".to_string(), serde_json::json!(0.95));
            }
        }

        let response = self
            .client
            .post(format!("{}/chat/completions", config.base_url))
            .header("Authorization", format!("Bearer {}", config.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .timeout(std::time::Duration::from_secs(180))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            // Truncate at a valid UTF-8 char boundary to avoid panic on multi-byte chars
            let truncate_at = text
                .char_indices()
                .take_while(|&(i, _)| i < 200)
                .last()
                .map(|(i, c)| i + c.len_utf8())
                .unwrap_or(text.len());
            let sanitized = &text[..truncate_at];
            anyhow::bail!("LLM API error {}: {}", status, sanitized);
        }

        if let Some(callback) = on_chunk {
            // Streaming mode
            let mut full_text = String::new();
            let mut reasoning_text = String::new();
            let mut stream = response.bytes_stream();

            // Use a raw byte buffer (not String) so that multi-byte UTF-8 characters
            // spanning two HTTP chunks are correctly reassembled.  We only interpret
            // the buffer as UTF-8 once we have a complete SSE line (terminated by \n).
            let mut byte_buf: Vec<u8> = Vec::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk?;
                byte_buf.extend_from_slice(&chunk);

                // Process complete SSE lines (ended with \n)
                while let Some(line_end) = byte_buf.iter().position(|&b| b == b'\n') {
                    let line_bytes: Vec<u8> = byte_buf.drain(..=line_end).collect();

                    // UTF-8 validation per line — if the line is somehow still broken
                    // (shouldn't happen since we split on \n), log and skip it.
                    let line = match String::from_utf8(line_bytes) {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::warn!(
                                "SSE line contains invalid UTF-8 (lossy {} bytes): {:?}",
                                e.utf8_error().valid_up_to(),
                                String::from_utf8_lossy(&e.into_bytes())
                            );
                            continue;
                        }
                    };

                    let line = line.trim().to_string();

                    if let Some(data) = line.strip_prefix("data: ") {
                        if data == "[DONE]" {
                            break;
                        }
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                            let delta = &v["choices"][0]["delta"];

                            if let Some(content) = delta["content"].as_str() {
                                if !content.is_empty() {
                                    full_text.push_str(content);
                                    callback(content);
                                }
                            }

                            // Collect reasoning_content as fallback for thinking-mode models
                            // where all output may land in this field instead of content
                            if let Some(rc) = delta["reasoning_content"].as_str() {
                                if !rc.is_empty() {
                                    reasoning_text.push_str(rc);
                                }
                            }
                        }
                    }
                }
            }

        // If content was empty but reasoning_content had text, attempt to extract
        // the final answer from the reasoning chain.
        // Do NOT use reasoning_content directly — it contains the model's internal
        // thinking process, which may echo back the input or contain meta-commentary.
        if full_text.is_empty() && !reasoning_text.is_empty() {
            match Self::extract_from_reasoning(&reasoning_text) {
                Some(extracted) => {
                    tracing::info!(
                        "GLM thinking fallback: extracted {} chars from reasoning_content",
                        extracted.len()
                    );
                    callback(&extracted);
                    full_text = extracted;
                }
                None => {
                    tracing::warn!(
                        "GLM thinking fallback: could not extract clean result from reasoning_content ({} chars); returning empty to trigger raw_text fallback",
                        reasoning_text.len()
                    );
                    // full_text stays empty — pipeline will fall back to raw_text
                }
            }
        } else if full_text.is_empty() {
            tracing::error!("LLM streaming returned no content and no reasoning_content");
        }

        // Apply post-processing to remove any remaining format artifacts
        let cleaned = postprocess::clean_llm_output(&full_text);
        if cleaned != full_text {
            tracing::debug!("clean_llm_output removed artifacts from streaming response");
        }

        Ok(PolishResponse {
            polished_text: cleaned,
        })
        } else {
            // Non-streaming mode
            let v: serde_json::Value = response.json().await?;
            let text = v["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("")
                .to_string();

            // Validate UTF-8 integrity — log a warning if the response contains
            // replacement characters (indicates upstream encoding issue).
            if text.contains('\u{FFFD}') {
                tracing::warn!(
                    "LLM non-streaming response contains U+FFFD replacement characters ({} total), first 200 chars: {}",
                    text.chars().filter(|&c| c == '\u{FFFD}').count(),
                    &text[..text.len().min(200)]
                );
            }

            if text.is_empty() {
                tracing::warn!(
                    "LLM non-streaming returned empty content, full response: {}",
                    v
                );
            }

            // Apply post-processing to remove any format artifacts
            let cleaned = postprocess::clean_llm_output(&text);
            if cleaned != text {
                tracing::debug!("clean_llm_output removed artifacts from non-streaming response");
            }

            Ok(PolishResponse {
                polished_text: cleaned,
            })
        }
    }

    fn name(&self) -> &str {
        "OpenAI"
    }
}

use anyhow::Result;
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

use super::{SttConfig, SttProvider, TranscriptEvent};
use crate::stt::whisper_compat::WhisperCompatProvider;

/// Qwen3-ASR-Flash provider (Alibaba Cloud DashScope).
/// Uses OpenAI-compatible chat/completions endpoint with input_audio field.
pub struct QwenAsrProvider {
    stt_config: Option<SttConfig>,
    audio_buffer: Vec<u8>,
    client: reqwest::Client,
}

const API_BASE: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const MODEL: &str = "qwen3-asr-flash";

/// Max audio buffer: ~24 MB PCM ≈ 12.5 min at 16kHz 16-bit mono.
const MAX_AUDIO_BYTES: usize = 24 * 1024 * 1024;

impl QwenAsrProvider {
    pub fn new() -> Self {
        Self {
            stt_config: None,
            audio_buffer: Vec::new(),
            client: reqwest::Client::new(),
        }
    }

    pub fn with_client(client: reqwest::Client) -> Self {
        Self {
            stt_config: None,
            audio_buffer: Vec::new(),
            client,
        }
    }
}

#[async_trait]
impl SttProvider for QwenAsrProvider {
    async fn connect(&mut self, config: &SttConfig) -> Result<()> {
        if config.api_key.is_empty() {
            anyhow::bail!("Qwen3-ASR-Flash API key is empty");
        }
        self.stt_config = Some(config.clone());
        self.audio_buffer.clear();
        tracing::info!("Qwen3-ASR-Flash provider ready (buffering mode)");
        Ok(())
    }

    async fn send_audio(&mut self, chunk: &[u8]) -> Result<()> {
        if self.audio_buffer.len() + chunk.len() > MAX_AUDIO_BYTES {
            anyhow::bail!(
                "Qwen3-ASR-Flash: audio exceeds maximum length (~12 min)"
            );
        }
        self.audio_buffer.extend_from_slice(chunk);
        tracing::debug!(
            "Qwen3-ASR-Flash: buffered {} bytes (chunk: {})",
            self.audio_buffer.len(),
            chunk.len()
        );
        Ok(())
    }

    async fn recv_transcript(&mut self) -> Result<Option<TranscriptEvent>> {
        // Buffer mode: transcription happens in disconnect().
        // Never resolve so tokio::select! only polls audio_rx.
        std::future::pending().await
    }

    async fn disconnect(&mut self) -> Result<Option<String>> {
        let config = match &self.stt_config {
            Some(c) => c.clone(),
            None => return Ok(None),
        };

        if self.audio_buffer.is_empty() {
            tracing::info!("Qwen3-ASR-Flash: no audio buffered, skipping");
            return Ok(None);
        }

        let audio_len_secs = self.audio_buffer.len() as f64 / (config.sample_rate as f64 * 2.0);
        let wav_data = WhisperCompatProvider::build_wav(&self.audio_buffer, config.sample_rate);
        self.audio_buffer.clear();
        tracing::info!(
            "Qwen3-ASR-Flash: sending {:.1}s of audio for transcription",
            audio_len_secs
        );

        // Dynamic timeout: at least 180s, or 3x audio length, whichever is larger.
        let timeout_secs = (audio_len_secs * 3.0).max(180.0) as u64;

        // Build base64 Data URL
        let b64 = BASE64.encode(&wav_data);
        let data_url = format!("data:audio/wav;base64,{}", b64);

        // Build request body (OpenAI-compatible chat completions with input_audio)
        // NOTE: qwen3-asr-flash does NOT support mixed content (audio + text blocks).
        // It has built-in language detection, so no language hint is needed.
        let content: Vec<serde_json::Value> = vec![serde_json::json!({
            "type": "input_audio",
            "input_audio": { "data": data_url }
        })];

        let body = serde_json::json!({
            "model": MODEL,
            "messages": [{ "role": "user", "content": content }]
        });

        let resp = self
            .client
            .post(format!("{}/chat/completions", API_BASE))
            .header("Authorization", format!("Bearer {}", config.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .timeout(std::time::Duration::from_secs(timeout_secs))
            .send()
            .await?;

        let status = resp.status();
        let resp_body = resp.text().await?;

        if !status.is_success() {
            let truncate_at = resp_body
                .char_indices()
                .take_while(|&(i, _)| i < 200)
                .last()
                .map(|(i, c)| i + c.len_utf8())
                .unwrap_or(resp_body.len());
            let sanitized = &resp_body[..truncate_at];
            tracing::error!("Qwen3-ASR-Flash HTTP {}: {}", status, sanitized);
            anyhow::bail!(
                "Qwen3-ASR-Flash error ({}): {}",
                status,
                sanitized
            );
        }

        let v: serde_json::Value = serde_json::from_str(&resp_body)?;
        let raw = v["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .trim();

        // Strip Qwen3 <think...</think blocks (reasoning tokens, not part of transcription)
        let text = strip_think_tags(raw).trim().to_string();

        tracing::info!(
            "Qwen3-ASR-Flash transcription: {} chars (raw: {})",
            text.len(),
            raw.len()
        );

        if text.is_empty() {
            tracing::warn!(
                "Qwen3-ASR-Flash: empty transcription returned (HTTP status: {}, body: {})",
                status,
                &resp_body[..resp_body.len().min(300)]
            );
            Ok(None)
        } else {
            Ok(Some(text))
        }
    }

    fn name(&self) -> &str {
        "Qwen3-ASR-Flash"
    }
}

/// Remove `<think...</think` blocks that Qwen3 models may prepend.
/// Uses safe UTF-8 string operations instead of byte-level processing
/// to avoid corrupting multi-byte characters (e.g. Chinese).
fn strip_think_tags(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let open_tag = "<think";
    let close_tag = "</think";

    let mut search_from = 0;
    while search_from < s.len() {
        // Find next <think tag
        if let Some(open_pos) = s[search_from..].find(open_tag) {
            let open_end = search_from + open_pos + open_tag.len();

            // Append everything before the <think tag
            result.push_str(&s[search_from..search_from + open_pos]);

            // Find matching </think tag
            if let Some(close_pos) = s[open_end..].find(close_tag) {
                // Skip past the entire think block including </think tag
                search_from = open_end + close_pos + close_tag.len();
            } else {
                // No closing tag found — skip past the <think tag but do NOT
                // discard the rest of the string (it may contain valid transcription)
                tracing::warn!(
                    "strip_think_tags: found <think without matching </think, skipping to end of tag"
                );
                search_from = open_end;
            }
        } else {
            // No more <think tags — append the rest
            result.push_str(&s[search_from..]);
            break;
        }
    }
    result
}

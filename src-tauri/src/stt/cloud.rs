use anyhow::Result;
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::{
    connect_async,
    tungstenite::Message,
};

use super::{SttConfig, SttProvider, TranscriptEvent};

/// Max audio buffer: ~24 MB PCM ≈ 12.5 min at 16kHz 16-bit mono.
const MAX_AUDIO_BYTES: usize = 24 * 1024 * 1024;

/// Commands sent from main thread to the WebSocket writer task
enum WsCommand {
    /// Raw PCM audio data chunk
    Audio(Vec<u8>),
    /// Recording finished — send stop signal to server
    Stop,
}

/// Cloud STT provider with **WebSocket real-time streaming** (V2).
///
/// Connects to `/ws/stt?token=<jwt>` endpoint on the VoxType server,
/// streams PCM audio chunks as they are captured (no buffering!),
/// receives intermediate transcription results in real-time,
/// and obtains LLM-polished text after recording stops.
///
/// Protocol (client ↔ server):
///   Client → Server:
///     {"type":"audio","data":"<base64 pcm>"} — audio chunk
///     {"type":"stop"} — recording finished signal
///
///   Server → Client:
///     {"type":"intermediate","text":"...","stash":"..."} — live preview
///     {"type":"final","transcript":"...","durationSec":N} — STT done
///     {"type":"polished","text":"..."} — LLM polished final output
///     {"type":"error","message":"..."} — error
pub struct CloudSttProvider {
    api_base_url: String,
    token: String,

    /// Channel to send commands (Audio/Stop) to the WS writer task
    cmd_tx: Option<tokio::sync::mpsc::Sender<WsCommand>>,

    /// Channel to receive TranscriptEvent from the WS reader task
    event_rx: Option<tokio::sync::mpsc::Receiver<TranscriptEvent>>,

    /// One-shot channel: disconnect() blocks here waiting for polished text
    final_result_rx: Option<tokio::sync::mpsc::Receiver<Option<String>>>,
}

impl CloudSttProvider {
    pub fn new(api_base_url: String) -> Self {
        Self {
            api_base_url,
            token: String::new(),
            cmd_tx: None,
            event_rx: None,
            final_result_rx: None,
        }
    }

    pub fn with_client(api_base_url: String, _client: reqwest::Client) -> Self {
        Self::new(api_base_url)
    }
}

#[async_trait]
impl SttProvider for CloudSttProvider {
    async fn connect(&mut self, config: &SttConfig) -> Result<()> {
        if config.api_key.is_empty() {
            anyhow::bail!("Cloud STT: session token is missing. Please sign in first.");
        }

        self.token = config.api_key.clone();

        // Build WebSocket URL: wss://api.voxtype.net/ws/stt?token=xxx
        let base = self.api_base_url.trim_start_matches("http://");
        let base = base.trim_start_matches("https://");
        let ws_url = format!("wss://{}/ws/stt?token={}", base, self.token);

        tracing::info!(
            "Cloud STT (WS): connecting to {}",
            &ws_url[..ws_url.find('?').unwrap_or(ws_url.len()).min(40)]
        );

        // ─── Establish TLS WebSocket connection ───
        let (ws_stream, _response) = connect_async(&ws_url).await?;

        tracing::info!("Cloud STT (WS): connected successfully");

        // ─── Split into sender/receiver halves ───
        let (mut ws_sender, mut ws_receiver) = ws_stream.split();

        // ─── Create channels ───
        // Commands: main thread → WS writer (unbounded, audio must not block)
        let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::channel::<WsCommand>(256);
        // Events: WS reader → main thread (bounded, don't accumulate too many)
        let (event_tx, event_rx) = tokio::sync::mpsc::channel::<TranscriptEvent>(64);
        // Final result: WS reader → disconnect() caller (oneshot)
        let (final_result_tx, final_result_rx) = tokio::sync::mpsc::channel::<Option<String>>(1);

        // ─── Spawn WS writer task: receives commands, encodes & sends ───
        tokio::spawn(async move {
            while let Some(cmd) = cmd_rx.recv().await {
                match cmd {
                    WsCommand::Audio(pcm_data) => {
                        if pcm_data.is_empty() {
                            continue;
                        }
                        let b64 = BASE64.encode(&pcm_data);
                        let msg = json!({
                            "type": "audio",
                            "data": b64,
                        });
                        if let Err(e) = ws_sender.send(Message::Text(msg.to_string())).await {
                            tracing::error!("Cloud STT (WS): write error: {}", e);
                            break;
                        }
                    }
                    WsCommand::Stop => {
                        let msg = json!({"type": "stop"});
                        if let Err(e) = ws_sender.send(Message::Text(msg.to_string())).await {
                            tracing::warn!("Cloud STT (WS): failed to send stop: {}", e);
                        } else {
                            tracing::debug!("Cloud STT (WS): sent stop signal");
                        }
                        break; // Writer task exits after sending stop
                    }
                }
            }
            tracing::debug!("Cloud STT (WS): writer task ended");
        });

        // ─── Spawn WS reader task: receives messages, parses events ───
        tokio::spawn(async move {
            while let Some(msg) = ws_receiver.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                            let msg_type = parsed["type"].as_str().unwrap_or("");

                            match msg_type {
                                "intermediate" => {
                                    let text_val =
                                        parsed["text"].as_str().unwrap_or("").to_string();
                                    let stash =
                                        parsed["stash"].as_str().unwrap_or("").to_string();
                                    // Combine confirmed text + prediction for display
                                    let full_preview = format!("{}{}", text_val, stash);
                                    let _ = event_tx
                                        .send(TranscriptEvent::Partial { text: full_preview })
                                        .await;
                                }
                                "final" => {
                                    let transcript = parsed["transcript"]
                                        .as_str()
                                        .unwrap_or("")
                                        .to_string();
                                    let _ = event_tx
                                        .send(TranscriptEvent::Final {
                                            text: transcript.clone(),
                                            confidence: 1.0,
                                        })
                                        .await;
                                    // Note: Don't close yet, wait for "polished"
                                }
                                "polished" => {
                                    let polished = parsed["text"]
                                        .as_str()
                                        .unwrap_or("")
                                        .to_string();
                                    // Signal disconnect() that polished text is ready
                                    let _ = final_result_tx.send(Some(polished)).await;
                                    break; // Session complete
                                }
                                "error" => {
                                    let message = parsed["message"]
                                        .as_str()
                                        .unwrap_or("Unknown error")
                                        .to_string();
                                    let _ = event_tx
                                        .send(TranscriptEvent::Error { message })
                                        .await;
                                    let _ = final_result_tx.send(None).await;
                                    break;
                                }
                                _ => {
                                    tracing::debug!(
                                        "Cloud STT (WS): unknown msg type: {}",
                                        msg_type
                                    );
                                }
                            }
                        } else {
                            tracing::warn!("Cloud STT (WS): failed to parse JSON message");
                        }
                    }
                    Ok(Message::Close(_frame)) => {
                        tracing::info!("Cloud STT (WS): server sent Close frame");
                        let _ = final_result_tx.send(None).await;
                        break;
                    }
                    Ok(Message::Ping(_data)) => {
                        // Auto-respond pong handled by tungstenite
                        continue;
                    }
                    Ok(Message::Pong(_)) => {
                        continue;
                    }
                    Ok(Message::Binary(_data)) => {
                        tracing::warn!("Cloud STT (WS): unexpected binary frame");
                    }
                    Ok(Message::Frame(_frame)) => {
                        // Raw frame variant, ignore
                        continue;
                    }
                    Err(e) => {
                        tracing::error!("Cloud STT (WS): read error: {}", e);
                        let _ = event_tx
                            .send(TranscriptEvent::Error {
                                message: format!("WebSocket error: {}", e),
                            })
                            .await;
                        let _ = final_result_tx.send(None).await;
                        break;
                    }
                }
            }
            tracing::debug!("Cloud STT (WS): reader task ended");
        });

        // Store handles for send_audio/recv_transcript/disconnect
        self.cmd_tx = Some(cmd_tx);
        self.event_rx = Some(event_rx);
        self.final_result_rx = Some(final_result_rx);

        tracing::info!("Cloud STT provider ready (WebSocket streaming mode)");
        Ok(())
    }

    async fn send_audio(&mut self, chunk: &[u8]) -> Result<()> {
        if chunk.len() > MAX_AUDIO_BYTES {
            anyhow::bail!("Cloud STT: single chunk exceeds maximum size");
        }

        if let Some(ref tx) = self.cmd_tx {
            tx.send(WsCommand::Audio(chunk.to_vec()))
                .await
                .map_err(|_| anyhow::anyhow!("Cloud STT: command channel closed"))?;
        }

        Ok(())
    }

    async fn recv_transcript(&mut self) -> Result<Option<TranscriptEvent>> {
        if let Some(ref mut rx) = self.event_rx {
            match rx.recv().await {
                Some(event) => Ok(Some(event)),
                None => Ok(None), // Channel closed
            }
        } else {
            Ok(None)
        }
    }

    async fn disconnect(&mut self) -> Result<Option<String>> {
        tracing::info!("Cloud STT (WS): sending stop signal...");

        // Send stop command through the command channel
        if let Some(ref tx) = self.cmd_tx {
            let _ = tx.send(WsCommand::Stop).await;
        }
        // Drop cmd_tx so the writer will exit after processing Stop
        self.cmd_tx = None;

        // Wait for polished text from server (or timeout)
        if let Some(mut rx) = self.final_result_rx.take() {
            match tokio::time::timeout(std::time::Duration::from_secs(30), rx.recv()).await {
                Ok(Some(Some(polished))) => {
                    tracing::info!(
                        "Cloud STT (WS): received polished text ({} chars)",
                        polished.len()
                    );
                    return Ok(Some(polished));
                }
                Ok(Some(None)) | Ok(None) => {
                    tracing::warn!("Cloud STT (WS): server returned no polished text (error?)");
                    return Ok(None);
                }
                Err(_) => {
                    tracing::warn!("Cloud STT (WS): timeout waiting for polished text (30s)");
                    return Ok(None);
                }
            }
        }

        Ok(None)
    }

    fn name(&self) -> &str {
        "Cloud-Ws"
    }

    fn needs_polishing(&self) -> bool {
        // Server-side LLM polishing is already done in the WS relay (ws-stt-relay.ts)
        // The disconnect() return value is already polished text.
        false
    }
}

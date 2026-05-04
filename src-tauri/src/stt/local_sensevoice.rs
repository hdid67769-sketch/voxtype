use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use super::{SttConfig, SttProvider, TranscriptEvent};
use super::whisper_compat::WhisperCompatProvider;

// Re-export needed from sensevoice-rs (workaround for potential visibility issues)
use sensevoice_rs::config::SenseVoiceConfig;

/// Max audio buffer: ~24 MB PCM ≈ 12.5 min at 16kHz 16-bit mono.
const MAX_AUDIO_BYTES: usize = 24 * 1024 * 1024;

/// Global singleton for SenseVoice-Small model.
/// Uses Mutex<Option<Result<Arc<_>, _>>> so failed init CAN be retried
/// by calling reset_model() (unlike OnceLock which permanently caches errors).
static MODEL_CELL: Mutex<
    Option<std::result::Result<Arc<sensevoice_rs::SenseVoiceSmall>, String>>,
> = Mutex::new(None);

/// Loading state tracker for UI feedback (thread-safe).
static LOADING_STATE: Mutex<ModelLoadingState> = Mutex::new(ModelLoadingState {
    status: LoadStatus::Ready,  // Bundled model: assume ready until proven otherwise
    message: String::new(),
    started_at: None,
    elapsed_secs: 0,
});

/// Tauri resource directory path (set once during app startup).
/// Used to locate bundled SenseVoice model files (including VAD).
static RESOURCE_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoadStatus {
    Loading,
    Ready,
    Failed,
}

struct ModelLoadingState {
    status: LoadStatus,
    message: String,
    /// When download/init started (for elapsed time display)
    started_at: Option<std::time::Instant>,
    /// Cached elapsed seconds
    elapsed_secs: u64,
}

/// Set the Tauri resource directory path (called once during app startup).
/// This allows the model loader to find bundled SenseVoice + VAD files.
pub fn set_resource_dir(path: Option<PathBuf>) {
    let _ = RESOURCE_DIR.set(path);
}

/// Check if bundled ASR model files exist in the resource directory.
fn bundled_asr_model_exists() -> Option<PathBuf> {
    if let Some(dir) = try_bundled_path(None) {
        return Some(dir);
    }
    // Fallback: resource_dir/resources/sensevoice/ (dev mode layout)
    if let Some(base) = RESOURCE_DIR.get()?.as_ref() {
        if let Some(dir) = try_bundled_path(Some(base.join("resources"))) {
            tracing::info!("Found bundled model in resources/ subdirectory (dev mode)");
            return Some(dir);
        }
    }
    // Compile-time fallback relative to workspace root
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest_dir.join("resources").join("sensevoice"),
        manifest_dir.join("..").join("resources").join("sensevoice"),
        manifest_dir.join("sensevoice"),
    ];
    for candidate in &candidates {
        if let Some(dir) = try_bundled_path(Some(candidate.clone())) {
            tracing::info!("Found bundled model via compile-time fallback: {}", candidate.display());
            return Some(dir);
        }
    }
    None
}

/// Find bundled VAD model files: {asr_dir}/vad/model.pt + am.mvn
fn bundled_vad_paths() -> Option<(PathBuf, PathBuf)> {
    if let Some(asr_dir) = bundled_asr_model_exists() {
        let vad_dir = asr_dir.join("vad");
        let model_pt = vad_dir.join("model.pt");
        let am_mvn = vad_dir.join("am.mvn");
        if model_pt.exists() && am_mvn.exists() {
            return Some((model_pt, am_mvn));
        }
    }
    None
}

/// Check a specific candidate directory for all 3 required ASR model files.
fn try_bundled_path(candidate: Option<PathBuf>) -> Option<PathBuf> {
    let dir = match candidate {
        Some(p) => p,
        None => RESOURCE_DIR.get()?.as_ref()?.join("sensevoice"),
    };
    let model_pt = dir.join("model.pt");
    let tokenizer = dir.join("chn_jpn_yue_eng_ko_spectok.bpe.model");
    let cmvn = dir.join("am.mvn");

    if model_pt.exists() && tokenizer.exists() && cmvn.exists() {
        Some(dir)
    } else {
        None
    }
}

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

/// Helper: update loading state to a new status/message.
fn update_loading_status(status: LoadStatus, message: &str) {
    let mut state = LOADING_STATE.lock().unwrap();
    if state.status != status {
        state.status = status;
        state.message = message.to_string();
        if state.started_at.is_none() {
            state.started_at = Some(std::time::Instant::now());
        }
    }
}

/// Helper: store successfully loaded model into cache and set Ready status.
fn store_model_ok(
    model: sensevoice_rs::SenseVoiceSmall,
) -> Result<Arc<sensevoice_rs::SenseVoiceSmall>> {
    tracing::info!("SenseVoice-Small model ready ✅");
    let arc_model = Arc::new(model);
    let mut cell = MODEL_CELL.lock().unwrap();
    *cell = Some(Ok(arc_model.clone()));
    drop(cell);

    let mut state = LOADING_STATE.lock().unwrap();
    state.status = LoadStatus::Ready;
    state.message = "Model loaded and ready".to_string();
    if let Some(start) = state.started_at {
        state.elapsed_secs = start.elapsed().as_secs();
    }

    Ok(arc_model)
}

/// Helper: handle init error — cache it and return Err.
fn store_model_err(err: String) -> anyhow::Error {
    tracing::error!("SenseVoice-Small model init failed: {}", err);
    let mut cell = MODEL_CELL.lock().unwrap();
    *cell = Some(Err(err.clone()));
    drop(cell);

    let (elapsed, msg) = {
        let mut state = LOADING_STATE.lock().unwrap();
        state.status = LoadStatus::Failed;
        state.message = err.clone();
        if let Some(start) = state.started_at {
            state.elapsed_secs = start.elapsed().as_secs();
        }
        (state.elapsed_secs, err)
    };

    anyhow::anyhow!(
        "SenseVoice model init failed after {}s.\n\n{}\n\n\
         Tips:\n\
         • Bundled: verify resources/sensevoice/ contains model.pt\n\
         • VAD: verify resources/sensevoice/vad/ contains model.pt + am.mvn\n\
         • Model size: ~200MB",
        elapsed, msg
    )
}

// ═══════════════════════════════════════════════════════════
//  Model loading — fully offline with bundled VAD paths
// ═══════════════════════════════════════════════════════════

/// Get or lazily initialize the global SenseVoice model instance.
///
/// # Loading strategy
///
/// 1. **Bundled mode (offline, preferred)**: Loads ASR + VAD from
///    Tauri resources/. Zero network access. Both model.pt files are
///    already inside the .app bundle — users never need to download anything.
///
/// 2. **Network fallback**: If no bundled files found, downloads from
///    HuggingFace hub (requires internet). This path still needs hf_hub.
pub fn get_model() -> Result<Arc<sensevoice_rs::SenseVoiceSmall>> {
    // Fast path: already initialized successfully
    {
        let cell = MODEL_CELL.lock().unwrap();
        if let Some(Ok(ref m)) = *cell {
            return Ok(Arc::clone(m));
        }
        if let Some(Err(ref e)) = *cell {
            return Err(anyhow::anyhow!("SenseVoice init failed: {}", e));
        }
    } // release lock before init

    // ── Strategy 1: Bundled mode (fully offline) ──
    if let Some(asr_dir) = bundled_asr_model_exists() {
        // Build VadConfig with explicit local VAD paths → bypasses hf_hub entirely
        let vad_config = match bundled_vad_paths() {
            Some((model_p, cmvn_p)) => {
                tracing::info!(
                    "Using bundled VAD: model={}, cmvn={}",
                    model_p.display(),
                    cmvn_p.display()
                );
                sensevoice_rs::silero_vad::VadConfig {
                    model_path: Some(model_p),
                    cmvn_path: Some(cmvn_p),
                    speech_threshold: 0.3, // 降低阈值以提升低音量/远距离麦克风下的识别率
                    ..Default::default()
                }
            }
            None => {
                tracing::warn!(
                    "No bundled VAD found in {}/vad/ — \
                     VAD will attempt hf_hub download on first inference",
                    asr_dir.display()
                );
                sensevoice_rs::silero_vad::VadConfig {
                    speech_threshold: 0.3, // 降低阈值以提升低音量/远距离麦克风下的识别率
                    ..Default::default()
                }
            }
        };

        let config = SenseVoiceConfig {
            model_path: asr_dir.join("model.pt"),
            tokenizer_path: asr_dir.join("chn_jpn_yue_eng_ko_spectok.bpe.model"),
            cmvn_path: Some(asr_dir.join("am.mvn")),
        };

        tracing::info!(
            "Loading SenseVoice-Small from bundled resources: {}",
            asr_dir.display()
        );
        update_loading_status(LoadStatus::Loading, "Loading SenseVoice model...");

        match sensevoice_rs::SenseVoiceSmall::init_with_config(config, vad_config) {
            Ok(model) => {
                store_model_ok(model)?;
                return get_model(); // re-enter fast path
            }
            Err(e) => {
                tracing::warn!("Bundled model load failed, trying network fallback: {e}");
                // Fall through to strategy 2
            }
        }
    } else {
        // Diagnostic: log why bundled model was skipped
        match RESOURCE_DIR.get() {
            None => tracing::warn!("RESOURCE_DIR not set — set_resource_dir() was never called!"),
            Some(None) => tracing::warn!("RESOURCE_DIR is None — app.path().resource_dir() failed"),
            Some(Some(dir)) => {
                let sv = dir.join("sensevoice");
                if !sv.exists() {
                    tracing::warn!(
                        "Bundled sensevoice dir not found: {} (dev mode may need files in src-tauri/resources/sensevoice/)",
                        sv.display()
                    );
                } else {
                    for f in ["model.pt", "chn_jpn_yue_eng_ko_spectok.bpe.model", "am.mvn"] {
                        let p = sv.join(f);
                        tracing::warn!(
                            "Bundled check {}: exists={} size={}",
                            p.display(),
                            p.exists(),
                            p.metadata().map(|m| m.len()).unwrap_or(0)
                        );
                    }
                }
            }
        }
    }

    // ── Strategy 2: Network download fallback ──
    update_loading_status(
        LoadStatus::Loading,
        "Downloading SenseVoice-Small model...",
    );
    tracing::info!("Initializing SenseVoice-Small model from HuggingFace hub...");

    let result = sensevoice_rs::SenseVoiceSmall::init(
        sensevoice_rs::silero_vad::VadConfig {
            speech_threshold: 0.3, // 降低阈值以提升低音量/远距离麦克风下的识别率
            ..Default::default()
        },
    )
    .map_err(|e| format!("{:#}", e));

    match result {
        Ok(model) => {
            store_model_ok(model)?;
            get_model() // re-enter fast path
        }
        Err(e) => Err(store_model_err(e)),
    }
}

/// Reset the model cache so next get_model() will re-initialize.
pub fn reset_model() {
    let mut cell = MODEL_CELL.lock().unwrap();
    *cell = None;
    drop(cell);
    let mut state = LOADING_STATE.lock().unwrap();
    state.status = LoadStatus::Ready;
    state.message.clear();
    state.started_at = None;
    state.elapsed_secs = 0;
    tracing::info!("Model cache reset — next use will re-initialize");
}

/// Returns current loading status as a serializable struct for the frontend.
pub fn model_status_info() -> ModelStatusInfo {
    let state = LOADING_STATE.lock().unwrap();
    let elapsed = match (state.status, state.started_at) {
        (LoadStatus::Loading, Some(start)) => start.elapsed().as_secs(),
        _ => state.elapsed_secs,
    };
    ModelStatusInfo {
        status: state.status,
        message: state.message.clone(),
        elapsed_secs: elapsed,
        cache_exists: true, // models are bundled in .app
    }
}

/// Serializable status payload for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStatusInfo {
    pub status: LoadStatus,
    pub message: String,
    #[serde(rename = "elapsedSecs")]
    pub elapsed_secs: u64,
    #[serde(rename = "cacheExists")]
    pub cache_exists: bool,
}

// ─── STT Provider implementation ───────────────────────────────────────

/// Local SenseVoice-Small STT provider — pure local inference, no Python, no network.
pub struct LocalSenseVoiceProvider {
    stt_config: Option<SttConfig>,
    audio_buffer: Vec<u8>,
    sample_rate: u32,
}

impl LocalSenseVoiceProvider {
    pub fn new() -> Self {
        Self {
            stt_config: None,
            audio_buffer: Vec::new(),
            sample_rate: 16000,
        }
    }
}

#[async_trait]
impl SttProvider for LocalSenseVoiceProvider {
    async fn connect(&mut self, config: &SttConfig) -> Result<()> {
        self.stt_config = Some(config.clone());
        self.sample_rate = config.sample_rate;
        self.audio_buffer.clear();

        // Check if model already initialized
        let cell = MODEL_CELL.lock().unwrap();
        match cell.as_ref() {
            Some(Ok(_)) => tracing::info!("LocalSenseVoice: model already loaded ✅"),
            Some(Err(e)) => tracing::warn!(
                "LocalSenseVoice: model previously failed ({}) — will retry on inference", e
            ),
            None => tracing::info!("LocalSenseVoice: model will be loaded on demand"),
        }
        drop(cell);

        tracing::info!(
            "LocalSenseVoice provider ready (local batch mode, {}Hz)",
            config.sample_rate
        );
        Ok(())
    }

    async fn send_audio(&mut self, chunk: &[u8]) -> Result<()> {
        if self.audio_buffer.len() + chunk.len() > MAX_AUDIO_BYTES {
            anyhow::bail!("LocalSenseVoice: audio exceeds maximum length (~12 min)");
        }
        self.audio_buffer.extend_from_slice(chunk);
        Ok(())
    }

    async fn recv_transcript(&mut self) -> Result<Option<TranscriptEvent>> {
        // Buffer mode: transcription happens in disconnect().
        // Never resolve so tokio::select! only polls audio_rx.
        std::future::pending().await
    }

    async fn disconnect(&mut self) -> Result<Option<String>> {
        if self.stt_config.is_none() {
            return Ok(None);
        }

        if self.audio_buffer.is_empty() {
            tracing::info!("LocalSenseVoice: no audio buffered, skipping");
            return Ok(None);
        }

        let sample_rate = self.sample_rate;
        let audio_len_secs = self.audio_buffer.len() as f64 / (sample_rate as f64 * 2.0);

        // Build WAV from PCM buffer (fast, stays on async thread)
        let wav_data = WhisperCompatProvider::build_wav(&self.audio_buffer, sample_rate);
        let audio_bytes = self.audio_buffer.len();
        self.audio_buffer.clear();
        tracing::info!(
            "LocalSenseVoice: running inference on {:.1}s of audio ({} bytes)",
            audio_len_secs,
            audio_bytes
        );

        // Write WAV to temp file
        let temp_path = std::env::temp_dir().join(format!(
            "voxtype_stt_{}.wav",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        ));
        std::fs::write(&temp_path, &wav_data)?;
        let temp_path_for_timeout = temp_path.clone();

        // ── Heavy synchronous operations: model loading + inference ──
        // With patched sensevoice-rs, ALL models (ASR + VAD) load from
        // bundled paths → zero network access, fully offline.
        //
        // get_model(): loads ASR (~200MB) + preps VAD config with bundled paths
        // infer_file(): CPU-intensive Candle inference (~0.3x-1x realtime)
        let spawn_result = tokio::task::spawn_blocking(move || -> Result<String> {
            let t0 = std::time::Instant::now();

            tracing::info!("[disconnect] Acquiring SenseVoice model...");
            let model = match get_model() {
                Ok(m) => m,
                Err(e) => {
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(anyhow::anyhow!(
                        "SenseVoice model not available.\n\n{:#}\n\n\
                         Ensure the VoxType.app bundle contains:\n\
                         • resources/sensevoice/model.pt (ASR)\n\
                         • resources/sensevoice/vad/model.pt (VAD)\n\
                         • resources/sensevoice/vad/am.mvn (VAD)",
                        e
                    ));
                }
            };

            tracing::info!("[disconnect] Model ready in {}ms, starting inference...", t0.elapsed().as_millis());
            let t_infer = std::time::Instant::now();

            let segments = model
                .infer_file(&temp_path)
                .map_err(|e| anyhow::anyhow!("SenseVoice inference error: {:#}", e))?;

            let infer_ms = t_infer.elapsed().as_millis() as u64;
            let total_ms = t0.elapsed().as_millis() as u64;

            tracing::info!(
                "[disconnect] Inference done: {} segments in {}ms (total={}ms)",
                segments.len(),
                infer_ms,
                total_ms,
            );

            // Log each segment detail for VAD/ASR diagnosis
            for (i, seg) in segments.iter().enumerate() {
                tracing::info!(
                    "[segment #{}] lang={:?} emo={:?} event={:?} content_len={} preview={}",
                    i, seg.language, seg.emotion, seg.event,
                    seg.content.len(),
                    if seg.content.chars().count() > 50 {
                        format!("{}...", seg.content.chars().take(50).collect::<String>())
                    } else {
                        seg.content.clone()
                    },
                );
            }

            let text: String = segments
                .iter()
                .map(|seg| seg.content.as_str())
                .collect::<Vec<&str>>()
                .join("");

            let _ = std::fs::remove_file(&temp_path);

            tracing::info!(
                "[disconnect] Final text: {} chars (audio={:.1}s, infer={}ms, total={}ms)",
                text.len(),
                audio_len_secs,
                infer_ms,
                total_ms,
            );

            Ok(text)
        });

        // Safety timeout (generous: even slow machines should finish well within 10 min)
        let timeout_secs = 600u64;
        let result = match tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            spawn_result,
        ).await {
            Ok(join_result) => match join_result {
                Ok(text_result) => text_result,
                Err(join_err) => Err(anyhow::anyhow!("Task panicked: {}", join_err)),
            },
            Err(_elapsed) => {
                let _ = std::fs::remove_file(&temp_path_for_timeout);
                Err(anyhow::anyhow!(
                    "STT timed out after {}s.",
                    timeout_secs
                ))
            }
        };

        match result {
            Ok(text) => {
                if text.is_empty() { Ok(None) } else { Ok(Some(text)) }
            }
            Err(e) => Err(e),
        }
    }

    fn needs_polishing(&self) -> bool { true }

    fn name(&self) -> &str { "Local SenseVoice" }
}

use anyhow::Result;
use async_trait::async_trait;
use enigo::{Enigo, Keyboard, Settings};
#[cfg(target_os = "windows")]
use enigo::{Direction, Key};

use super::{OutputMode, TextOutput};

/// Maximum characters per enigo.text() call to avoid input buffer overflow.
const TYPE_CHUNK_SIZE: usize = 200;
/// Delay between typing chunks.
const TYPE_CHUNK_DELAY_MS: u64 = 5;

pub struct KeyboardOutput;

impl Default for KeyboardOutput {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyboardOutput {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl TextOutput for KeyboardOutput {
    async fn type_text(&self, text: &str) -> Result<()> {
        let text = text.to_string();

        // Multi-line text → use clipboard paste (avoids CGEventPost/SendInput multi-line issues)
        if text.contains('\n') {
            return Self::paste_multiline_text(&text).await;
        }

        // Single-line text → original enigo character-by-character input
        tokio::task::spawn_blocking(move || {
            let mut enigo = Enigo::new(&Settings::default())
                .map_err(|e| anyhow::anyhow!("Failed to create Enigo: {:?}", e))?;

            for chunk in text.chars().collect::<Vec<_>>().chunks(TYPE_CHUNK_SIZE) {
                let s: String = chunk.iter().collect();
                enigo
                    .text(&s)
                    .map_err(|e| anyhow::anyhow!("Failed to type text: {:?}", e))?;
                std::thread::sleep(std::time::Duration::from_millis(TYPE_CHUNK_DELAY_MS));
            }

            Ok(())
        })
        .await?
    }

    fn mode(&self) -> OutputMode {
        OutputMode::Keyboard
    }
}

impl KeyboardOutput {
    /// Paste multi-line text via clipboard (cross-platform: macOS Cmd+V / Windows Ctrl+V)
    pub async fn paste_multiline_text(text: &str) -> Result<()> {
        let text = text.to_string();
        tokio::task::spawn_blocking(move || {
            // Write to system clipboard
            let mut clipboard = arboard::Clipboard::new()
                .map_err(|e| anyhow::anyhow!("Clipboard init failed: {:?}", e))?;
            clipboard.set_text(text)
                .map_err(|e| anyhow::anyhow!("Clipboard set_text failed: {:?}", e))?;

            // Small delay to ensure clipboard is ready
            std::thread::sleep(std::time::Duration::from_millis(30));

            #[cfg(target_os = "macos")]
            {
                // Use osascript for reliable Cmd+V (same proven approach as clipboard.rs)
                std::process::Command::new("osascript")
                    .args(["-e", r#"tell application "System Events" to keystroke "v" using command down"#])
                    .status()
                    .map_err(|e| anyhow::anyhow!("osascript paste failed: {:?}", e))?;
            }

            #[cfg(target_os = "windows")]
            {
                // Use enigo Ctrl+V SendInput on Windows
                let mut enigo = Enigo::new(&Settings::default())?;
                enigo.key(Key::Control, Direction::Press)?;
                enigo.key(Key::Unicode('v'), Direction::Click)?;
                enigo.key(Key::Control, Direction::Release)?;
            }

            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                // Linux fallback: xdotool
                std::process::Command::new("xdotool")
                    .args(["key", "ctrl+v"])
                    .status()
                    .ok(); // Don't fail if unavailable
            }

            Ok(())
        })
        .await?
    }
}

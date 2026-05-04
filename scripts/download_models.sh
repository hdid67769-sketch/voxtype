#!/usr/bin/env bash
# download_models.sh - Download SenseVoice + FSMN-VAD models for bundling
# Run before `tauri build` so models are in src-tauri/resources/sensevoice/
#
# Usage:
#   bash scripts/download_models.sh [target_dir]
#   default target_dir: <repo>/src-tauri/resources/sensevoice

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_TARGET="${SCRIPT_DIR}/../src-tauri/resources/sensevoice"
TARGET_DIR="${1:-$DEFAULT_TARGET}"
VAD_DIR="${TARGET_DIR}/vad"

echo "==> Target directory: ${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"
mkdir -p "${VAD_DIR}"

download() {
  local url="$1"
  local output="$2"
  if [[ -f "$output" ]]; then
    echo "  ✓ Already exists: $(basename "$output")"
    return 0
  fi
  echo "  ↓ Downloading: $(basename "$output")"
  # Try hf-mirror first (China), fallback to huggingface.co
  if curl -L --fail --retry 2 -o "$output" "https://hf-mirror.com/${url}"; then
    return 0
  else
    echo "  ⚠  hf-mirror failed, trying huggingface.co..."
    curl -L --fail --retry 2 -o "$output" "https://huggingface.co/${url}"
  fi
}

echo ""
echo "==> Downloading ASR model files from FunAudioLLM/SenseVoiceSmall..."
download "FunAudioLLM/SenseVoiceSmall/resolve/main/model.pt"                  "${TARGET_DIR}/model.pt"
download "FunAudioLLM/SenseVoiceSmall/resolve/main/chn_jpn_yue_eng_ko_spectok.bpe.model" "${TARGET_DIR}/chn_jpn_yue_eng_ko_spectok.bpe.model"
download "FunAudioLLM/SenseVoiceSmall/resolve/main/am.mvn"                    "${TARGET_DIR}/am.mvn"

echo ""
echo "==> Downloading VAD model files from funasr/fsmn-vad..."
download "funasr/fsmn-vad/resolve/main/model.pt"  "${VAD_DIR}/model.pt"
download "funasr/fsmn-vad/resolve/main/am.mvn"    "${VAD_DIR}/am.mvn"

echo ""
echo "==> Done! Model files in ${TARGET_DIR}:"
ls -lh "${TARGET_DIR}"
ls -lh "${VAD_DIR}"

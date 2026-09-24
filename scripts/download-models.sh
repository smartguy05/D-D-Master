#!/usr/bin/env bash
# Downloads local models into ./models.
#   bash scripts/download-models.sh             # speaker-embedding model (voice ID) ~26 MB
#   bash scripts/download-models.sh --with-tts  # + multi-speaker TTS used by eval:voiceid ~150 MB
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models
BASE=https://github.com/k2-fsa/sherpa-onnx/releases/download

if [ ! -f models/wespeaker_en_voxceleb_resnet34.onnx ]; then
  echo "Downloading speaker embedding model..."
  curl -fSL -o models/wespeaker_en_voxceleb_resnet34.onnx "$BASE/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx"
fi

if [ "${1:-}" = "--with-tts" ] && [ ! -d models/vits-vctk ]; then
  echo "Downloading VCTK multi-speaker TTS (for the voice-ID eval)..."
  curl -fSL -o models/vits-vctk.tar.bz2 "$BASE/tts-models/vits-vctk.tar.bz2"
  tar xjf models/vits-vctk.tar.bz2 -C models && rm models/vits-vctk.tar.bz2
fi
echo "Models ready in ./models"

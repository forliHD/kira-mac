#!/usr/bin/env bash
# Wählt ein Xcode, dessen macOS-SDK mindestens 26 ist.
# SpeechAnalyzer/SpeechTranscriber gibt es erst ab diesem SDK; macos-15 hat es
# nicht. macos-26 liefert Xcode 26 von Haus aus – ein neueres Preview (Xcode 27)
# nehmen wir nur, wenn kein SDK 26 da ist.
set -euo pipefail

need_major=26

sdk_version() {
  DEVELOPER_DIR="$1" xcrun --sdk macosx --show-sdk-version 2>/dev/null || true
}

sdk_major() {
  printf '%s' "${1%%.*}"
}

use_developer_dir() {
  local dev="$1"
  local sdk="$2"
  echo "Xcode: $dev"
  echo "macOS-SDK: $sdk ($(DEVELOPER_DIR="$dev" xcrun --sdk macosx --show-sdk-path))"
  DEVELOPER_DIR="$dev" xcodebuild -version
  DEVELOPER_DIR="$dev" swift --version
  if [[ "$(uname -m)" != "arm64" ]]; then
    echo "Fehler: Runner ist $(uname -m), gebraucht wird Apple Silicon (arm64)." >&2
    exit 1
  fi
  sudo xcode-select -s "$dev"
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    echo "DEVELOPER_DIR=$dev" >> "$GITHUB_ENV"
  fi
  export DEVELOPER_DIR="$dev"
}

# Höheres SDK gewinnt. Bei gleichem Stand bleibt der bisherige Kandidat.
better_sdk() {
  python3 - "$1" "$2" <<'PY'
import sys
def parse(v):
    return tuple(int(p) for p in v.split(".") if p.isdigit())
print("yes" if parse(sys.argv[1]) > parse(sys.argv[2]) else "no")
PY
}

current="$(xcode-select -p)"
current_sdk="$(sdk_version "$current")"
if [[ -n "$current_sdk" ]] && [[ "$(sdk_major "$current_sdk")" -ge "$need_major" ]]; then
  use_developer_dir "$current" "$current_sdk"
  exit 0
fi

best_dev=""
best_sdk=""
shopt -s nullglob
for app in /Applications/Xcode*.app; do
  dev="$app/Contents/Developer"
  [[ -d "$dev" ]] || continue
  sdk="$(sdk_version "$dev")"
  echo "Xcode-Kandidat: $app → SDK ${sdk:-unbekannt}"
  [[ -n "$sdk" ]] || continue
  [[ "$(sdk_major "$sdk")" -ge "$need_major" ]] || continue
  if [[ -z "$best_sdk" ]] || [[ "$(better_sdk "$sdk" "$best_sdk")" == "yes" ]]; then
    best_dev="$dev"
    best_sdk="$sdk"
  fi
done

if [[ -z "$best_dev" ]]; then
  echo "Fehler: kein Xcode mit macOS-SDK $need_major oder neuer." >&2
  echo "SpeechAnalyzer/SpeechTranscriber lässt sich so nicht übersetzen." >&2
  xcodebuild -version >&2 || true
  xcodebuild -showsdks >&2 || true
  exit 1
fi

use_developer_dir "$best_dev" "$best_sdk"

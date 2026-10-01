#!/usr/bin/env bash
# Baut den Swift-Helfer (helper/, Produkt kira-helper) im Release-Modus.
# Ergebnis: helper/.build/release/kira-helper – von dort liest die App in der
# Entwicklung, electron-builder kopiert es als extraResource.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER_DIR="$ROOT/helper"

if [[ ! -f "$HELPER_DIR/Package.swift" ]]; then
  echo "Fehler: $HELPER_DIR/Package.swift fehlt – der Helfer liegt nicht im Repo." >&2
  exit 1
fi
if ! command -v swift >/dev/null 2>&1; then
  echo "Fehler: swift nicht gefunden (Xcode installieren und 'xcode-select --install')." >&2
  exit 1
fi

echo "→ swift build -c release (in $HELPER_DIR)"
(cd "$HELPER_DIR" && swift build -c release "$@")

BIN="$HELPER_DIR/.build/release/kira-helper"
if [[ ! -x "$BIN" ]]; then
  echo "Fehler: $BIN wurde nicht erzeugt." >&2
  exit 1
fi
echo "✓ Helfer gebaut: $BIN"

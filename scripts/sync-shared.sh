#!/usr/bin/env bash
# Kopiert gemeinsame Dateien aus einem KIRA-Checkout in src/shared/ – zurzeit
# dictationText.js (Diktierbefehle müssen in Dashboard und Mac-App identisch sein).
# Aufruf: scripts/sync-shared.sh /pfad/zum/kira-checkout
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIRA="${1:-}"
if [[ -z "$KIRA" || ! -d "$KIRA/dashboard/src/lib" ]]; then
  echo "Aufruf: $0 /pfad/zum/kira-checkout (mit dashboard/src/lib/)" >&2
  exit 1
fi

SRC="$KIRA/dashboard/src/lib/dictationText.js"
DST="$ROOT/src/shared/dictationText.js"
VERSION="$(node -p "require('$KIRA/dashboard/package.json').version")"

{
  echo "// Quelle: kira/dashboard/src/lib/dictationText.js, Stand $VERSION — per scripts/sync-shared.sh aktualisieren."
  echo "// Nicht von Hand ändern: Diktierbefehle müssen in Dashboard und Mac-App identisch sein."
  echo
  cat "$SRC"
} > "$DST"

echo "✓ $DST aus KIRA $VERSION aktualisiert"
echo "  Bitte 'npm test' laufen lassen (tests/dictation.test.ts)."

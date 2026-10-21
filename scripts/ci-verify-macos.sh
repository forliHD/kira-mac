#!/usr/bin/env bash
# Prüft das gebaute Paket. SIGNED/NOTARIZED sind die Absicht aus ci-signing.sh.
# codesign, spctl und stapler schreiben ihre Ausgabe ins Protokoll; schlägt
# eine verlangte Prüfung fehl, endet der Lauf hier und es gibt kein Release.
set -euo pipefail

DIST="${1:-}"
if [[ -z "$DIST" || ! -d "$DIST" ]]; then
  echo "Aufruf: scripts/ci-verify-macos.sh <dist>" >&2
  exit 2
fi

signed="${SIGNED:-false}"
notarized="${NOTARIZED:-false}"
app="$DIST/mac-arm64/KIRA.app"
helper="$app/Contents/Resources/helper/kira-helper"

note() {
  printf '%s\n' "$*"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"
  fi
}

if [[ "$signed" != true ]]; then
  note "Keine Signatur verlangt, Prüfung übersprungen."
  exit 0
fi

if [[ ! -d "$app" ]]; then
  echo "App fehlt: $app" >&2
  exit 1
fi

echo "→ codesign --verify --deep --strict"
codesign --verify --deep --strict --verbose=4 "$app"
echo "→ codesign -dv (App)"
codesign -dv --verbose=4 "$app" 2>&1 | sed -n '1,40p'
if [[ ! -f "$helper" ]]; then
  echo "Helfer fehlt: $helper" >&2
  exit 1
fi
echo "→ codesign -dv (Helfer)"
helper_info="$(codesign -dv --verbose=4 --entitlements :- "$helper" 2>&1 || true)"
printf '%s\n' "$helper_info" | sed -n '1,80p'
if ! printf '%s\n' "$helper_info" | grep -q "Developer ID Application"; then
  echo "Der Helfer ist nicht mit einer Developer-ID-Application-Identität signiert." >&2
  exit 1
fi
if ! printf '%s\n' "$helper_info" | grep -q "runtime"; then
  echo "Der Helfer hat keine Hardened Runtime." >&2
  exit 1
fi

authority="$(codesign -dv --verbose=4 "$app" 2>&1 || true)"
if ! printf '%s\n' "$authority" | grep -q "Developer ID Application"; then
  echo "Die App ist nicht mit einer Developer-ID-Application-Identität signiert." >&2
  printf '%s\n' "$authority" >&2
  exit 1
fi
note "codesign --verify --deep --strict: gültig."

if [[ "$notarized" != true ]]; then
  note "Notarisierung nicht verlangt."
  exit 0
fi

echo "→ stapler validate"
xcrun stapler validate "$app"
echo "→ spctl -a -vv -t exec"
spctl -a -vv -t exec "$app"
note "stapler validate und spctl: notarisiert."

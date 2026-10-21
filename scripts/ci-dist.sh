#!/usr/bin/env bash
# Produktionspaket für CI. Signiert nur, wenn scripts/ci-signing.sh prepare
# SIGNED=true in die Umgebung geschrieben hat.
#
# Zwei Fallen in electron-builder 26:
# - „-c.mac.notarize=false“ bleibt eine Zeichenkette und schaltet die
#   Notarisierung nicht ab. Sie bleibt aus, weil ohne APPLE_*-Variablen
#   getNotarizeOptions nichts liefert.
# - CSC_IDENTITY_AUTO_DISCOVERY=false würde auch ein importiertes
#   Developer-ID-Zertifikat übergehen. Die Variable setzen wir nur, wenn
#   wir bewusst unsigniert bauen; -c.mac.identity=null wird dort zu null
#   gewandelt (nur identity, nicht notarize).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DIST="${KIRA_MAC_DIST:-$ROOT/dist}"
rm -rf "$DIST"

signed="${SIGNED:-false}"
notarized="${NOTARIZED:-false}"

unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID APPLE_KEYCHAIN APPLE_KEYCHAIN_PROFILE || true

args=(--mac --publish never "-c.directories.output=$DIST")
if [[ "$signed" == true ]]; then
  if [[ -z "${CSC_KEYCHAIN:-}" || -z "${CSC_NAME:-}" ]]; then
    echo "SIGNED=true, aber CSC_KEYCHAIN oder CSC_NAME fehlt." >&2
    exit 1
  fi
  # Ein leeres CSC_LINK würde electron-builder als Zertifikatspfad lesen
  # und den eigenen, falsch freigeschalteten Schlüsselbund anlegen.
  unset CSC_LINK CSC_KEY_PASSWORD || true
  # electron-builder signiert Pull Requests nur mit diesem Schalter. Forks
  # sehen die Geheimnisse nicht; hier ist die Signatur schon beschlossen.
  if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    export CSC_FOR_PULL_REQUEST=true
  fi
  if [[ "$notarized" != true ]]; then
    unset APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER || true
  elif [[ -z "${APPLE_API_KEY:-}" || -z "${APPLE_API_KEY_ID:-}" || -z "${APPLE_API_ISSUER:-}" ]]; then
    echo "NOTARIZED=true, aber APPLE_API_KEY, APPLE_API_KEY_ID oder APPLE_API_ISSUER fehlt." >&2
    exit 1
  fi
  if [[ "$notarized" == true ]]; then
    echo "→ electron-builder signiert und notarisiert."
  else
    echo "→ electron-builder signiert, ohne Notarisierung."
  fi
else
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  unset CSC_LINK CSC_KEY_PASSWORD CSC_NAME APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER || true
  args+=(-c.mac.identity=null)
  echo "→ electron-builder ohne Signatur und ohne Notarisierung."
fi

npm run build
npx electron-builder "${args[@]}"

shopt -s nullglob
dmg=("$DIST"/*.dmg)
zip=("$DIST"/*.zip)
if [[ ${#dmg[@]} -eq 0 || ${#zip[@]} -eq 0 || ! -f "$DIST/latest-mac.yml" ]]; then
  echo "Artefakte fehlen in $DIST (erwartet: *.dmg, *.zip, latest-mac.yml)." >&2
  ls -la "$DIST" >&2 || true
  exit 1
fi

stage="$DIST/ci-artifacts"
mkdir -p "$stage"
cp "${dmg[@]}" "${zip[@]}" "$DIST/latest-mac.yml" "$stage/"
blockmaps=("$DIST"/*.blockmap)
if [[ ${#blockmaps[@]} -gt 0 ]]; then
  cp "${blockmaps[@]}" "$stage/"
fi
if [[ -f "$DIST/latest-mac-arm64.yml" ]]; then
  cp "$DIST/latest-mac-arm64.yml" "$stage/"
fi
# Erst die echte Prüfung. signing.env meldet das Ergebnis, nicht die Absicht.
# Schlägt codesign, spctl oder stapler fehl, endet das Skript vorher.
bash "$ROOT/scripts/ci-verify-macos.sh" "$DIST"
cat > "$stage/signing.env" <<EOF
signed=$signed
notarized=$notarized
EOF
echo "✓ Paket in $stage"
ls -lh "$stage"

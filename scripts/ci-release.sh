#!/usr/bin/env bash
# Legt den GitHub-Release v<package.json-Version> an, wenn er noch fehlt.
# Artefakte: *.dmg, *.zip, latest-mac.yml (electron-updater), dazu Blockmaps,
# falls der Build sie erzeugt hat. Ein vorhandenes Release derselben Version
# wird nicht ersetzt – v0.3.8 bleibt der lokal signierte Stand.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step() { printf '\n→ %s\n' "$*"; }

is_set() {
  local value="${1-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  [[ -n "$value" ]]
}

# Zertifikat ist hinterlegt, das Paket aber nicht signiert und notarisiert.
should_refuse_release() {
  local signed="$1"
  local notarized="$2"
  local cert_present="$3"
  [[ "$cert_present" == true && ( "$signed" != true || "$notarized" != true ) ]]
}

read_signing() {
  signed=false
  notarized=false
  if [[ ! -f "$DIST/signing.env" ]]; then
    return 0
  fi
  local key value
  while IFS='=' read -r key value; do
    case "$key" in
      signed) [[ "$value" == true ]] && signed=true ;;
      notarized) [[ "$value" == true ]] && notarized=true ;;
    esac
  done < "$DIST/signing.env"
}

changelog_notes() {
  local ver="${1:-$VERSION}"
  [[ -f "$ROOT/CHANGELOG.md" ]] || return 0
  awk -v ver="$ver" '
    $0 ~ "^## \\[" ver "\\]" { found=1; next }
    found && $0 ~ "^## " { exit }
    found { print }
  ' "$ROOT/CHANGELOG.md"
}

write_notes() {
  local file="$1"
  local from_changelog
  from_changelog="$(changelog_notes)"
  if [[ -n "${from_changelog//[[:space:]]/}" ]]; then
    printf '# KIRA für Mac %s\n%s\n' "$VERSION" "$from_changelog" > "$file"
  elif [[ -f "$ROOT/RELEASE_NOTES.md" ]] && [[ -n "$(tr -d '[:space:]' < "$ROOT/RELEASE_NOTES.md")" ]]; then
    cp "$ROOT/RELEASE_NOTES.md" "$file"
  else
    printf 'KIRA für Mac %s\n' "$VERSION" > "$file"
  fi
  {
    printf '\n---\n\n'
    if [[ "$signed" == true && "$notarized" == true ]]; then
      echo "Signiert mit Developer ID und notarisiert."
    elif [[ "$signed" == true ]]; then
      echo "Signiert mit Developer ID, nicht notarisiert (ASC_KEY_ID, ASC_ISSUER_ID oder ASC_KEY_P8 fehlte)."
    else
      echo "Unsigniert: MACOS_CERT_P12_BASE64 und MACOS_CERT_PASSWORD fehlen. Gatekeeper lehnt dieses Paket ab, bis ein Developer-ID-Application-Zertifikat in den Actions-Geheimnissen liegt und eine neue Version gebaut wird."
    fi
  } >> "$file"
}

collect_assets() {
  assets=()
  shopt -s nullglob
  local dmg=("$DIST"/*.dmg) zip=("$DIST"/*.zip)
  if [[ ${#dmg[@]} -eq 0 || ${#zip[@]} -eq 0 || ! -f "$DIST/latest-mac.yml" ]]; then
    echo "Release-Artefakte fehlen (*.dmg, *.zip, latest-mac.yml) in $DIST." >&2
    ls -la "$DIST" >&2 || true
    exit 1
  fi
  assets+=("${dmg[@]}" "${zip[@]}" "$DIST/latest-mac.yml")
  local extra
  for extra in "$DIST"/*.blockmap "$DIST"/latest-mac-arm64.yml; do
    [[ -e "$extra" ]] || continue
    assets+=("$extra")
  done
}

tag_exists() {
  git ls-remote --tags origin "refs/tags/$TAG" | awk '{print $2}' | grep -qx "refs/tags/$TAG"
}

cmd_release() {
  DIST="${1:-}"
  if [[ -z "$DIST" || ! -d "$DIST" ]]; then
    echo "Aufruf: scripts/ci-release.sh <artefakt-verzeichnis>" >&2
    exit 2
  fi
  DIST="$(cd "$DIST" && pwd)"
  cd "$ROOT"
  VERSION="$(node -p "require('./package.json').version")"
  TAG="v$VERSION"
  REPO="${GITHUB_REPOSITORY:-forliHD/kira-mac}"
  SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"

  read_signing
  local cert_present=false
  if is_set "${MACOS_CERT_P12_BASE64-}" && is_set "${MACOS_CERT_PASSWORD-}"; then
    cert_present=true
  fi
  if should_refuse_release "$signed" "$notarized" "$cert_present"; then
    echo "Release abgelehnt: das Developer-ID-Zertifikat ist gesetzt, das Paket ist aber nicht signiert und notarisiert (signed=$signed, notarized=$notarized)." >&2
    exit 1
  fi
  step "Version $VERSION ($TAG)"
  if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
    echo "Release $TAG existiert bereits – kein zweites Release für dieselbe Version."
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
      echo "Release \`$TAG\` existiert bereits, nichts hochgeladen." >> "$GITHUB_STEP_SUMMARY"
    fi
    exit 0
  fi
  if tag_exists; then
    echo "Tag $TAG existiert, aber es gibt kein Release dazu. Nichts veröffentlicht, damit die Artefakte nicht an der falschen Revision hängen." >&2
    exit 1
  fi

  collect_assets
  local notes
  notes="$(mktemp)"
  write_notes "$notes"

  step "GitHub-Release $TAG"
  if [[ -n "$SHA" ]]; then
    gh release create "$TAG" "${assets[@]}" \
      --repo "$REPO" \
      --title "KIRA für Mac $VERSION" \
      --notes-file "$notes" \
      --target "$SHA"
  else
    gh release create "$TAG" "${assets[@]}" \
      --repo "$REPO" \
      --title "KIRA für Mac $VERSION" \
      --notes-file "$notes"
  fi
  rm -f "$notes"
  echo "✓ Release $TAG veröffentlicht."
}

cmd_self_test() {
  local notes
  notes="$(changelog_notes 0.3.8)"
  if ! grep -q "mail_send_to_me" <<<"$notes"; then
    echo "Changelog-Abschnitt 0.3.8 unerwartet." >&2
    exit 1
  fi
  notes="$(changelog_notes 9.9.9)"
  if [[ -n "${notes//[[:space:]]/}" ]]; then
    echo "Unbekannte Version sollte keinen Changelog-Text liefern." >&2
    exit 1
  fi
  if should_refuse_release false false true; then
    :
  else
    echo "Unsigniertes Paket mit Zertifikat hätte abgelehnt werden müssen." >&2
    exit 1
  fi
  if should_refuse_release true false true; then
    :
  else
    echo "Unnotarisiertes Paket mit Zertifikat hätte abgelehnt werden müssen." >&2
    exit 1
  fi
  if should_refuse_release true true true; then
    echo "Signiertes und notarisiertes Paket darf nicht abgelehnt werden." >&2
    exit 1
  fi
  if should_refuse_release false false false; then
    echo "Ohne Zertifikat bleibt ein unsigniertes Paket zulässig." >&2
    exit 1
  fi
  echo "ci-release self-test ok"
}

case "${1:-}" in
  self-test) cmd_self_test ;;
  "")
    echo "Aufruf: scripts/ci-release.sh <verzeichnis>|self-test" >&2
    exit 2
    ;;
  *) cmd_release "$1" ;;
esac

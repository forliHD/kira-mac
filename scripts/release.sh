#!/usr/bin/env bash
# Lokaler Release (es gibt kein CI): sauberer Baum → Version aus package.json
# → Helfer bauen → npm run build → electron-builder (signiert + notarisiert)
# → GitHub-Release mit DMG, ZIP und latest-mac.yml (für electron-updater).
#
# Umgebung für Signatur/Notarisierung:
#   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID   (Notarisierung)
#   CSC_NAME="Developer ID Application: … (TEAMID)"          (optional, sonst
#   nimmt electron-builder das passende Zertifikat aus dem Schlüsselbund)
# Release-Notizen: RELEASE_NOTES.md im Repo (vorher füllen).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n→ %s\n' "$*"; }
fail() { printf 'Fehler: %s\n' "$*" >&2; exit 1; }

step "Voraussetzungen prüfen"
command -v gh >/dev/null 2>&1 || fail "gh (GitHub CLI) fehlt: brew install gh"
gh auth status >/dev/null 2>&1 || fail "gh ist nicht angemeldet: gh auth login"
command -v node >/dev/null 2>&1 || fail "node fehlt"
[[ -f RELEASE_NOTES.md ]] || fail "RELEASE_NOTES.md fehlt"
for var in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  [[ -n "${!var:-}" ]] || fail "$var ist nicht gesetzt (Notarisierung)."
done

step "Arbeitsbaum muss sauber sein"
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short >&2
  fail "Es gibt uncommittete Änderungen."
fi

VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
step "Version $VERSION ($TAG)"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  fail "Tag $TAG existiert bereits – Version in package.json erhöhen."
fi
if gh release view "$TAG" >/dev/null 2>&1; then
  fail "GitHub-Release $TAG existiert bereits."
fi

step "Helfer bauen"
bash scripts/build-helper.sh

step "App-Symbol prüfen"
[[ -f build/icon.icns ]] || fail "build/icon.icns fehlt: scripts/make-icon.sh ausführen."

step "Abhängigkeiten, Typen, Tests"
npm ci --no-audit --no-fund
npm run typecheck
npm test

step "npm run build"
npm run build

step "electron-builder --mac (Signatur + Notarisierung)"
rm -rf dist
npx electron-builder --mac --publish never

step "Artefakte"
ls -la dist/*.dmg dist/*.zip dist/latest-mac.yml || fail "Artefakte fehlen in dist/."

step "Tag $TAG setzen"
git tag -a "$TAG" -m "KIRA für Mac $VERSION"
git push origin "$TAG"

step "GitHub-Release $TAG anlegen"
gh release create "$TAG" dist/*.dmg dist/*.zip dist/latest-mac.yml \
  --title "KIRA für Mac $VERSION" \
  --notes-file RELEASE_NOTES.md

printf '\n✓ Release %s veröffentlicht.\n' "$TAG"

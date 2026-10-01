#!/usr/bin/env bash
# Lokaler Release (es gibt kein CI): sauberer Baum → Version aus package.json
# → Helfer bauen → npm run build → electron-builder (signiert + notarisiert)
# → GitHub-Release mit DMG, ZIP und latest-mac.yml (für electron-updater).
#
# Notarisierung, zwei Wege (electron-builder liest beide):
#   1. Schlüsselbund-Profil (empfohlen, kein Passwort in der Umgebung):
#        xcrun notarytool store-credentials kira-notary \
#          --apple-id <Apple-ID> --team-id GRPK3Y82ST      (fragt das
#        App-spezifische Passwort ab; einmalig). Dann reicht
#        APPLE_KEYCHAIN_PROFILE=kira-notary (Standard dieses Skripts).
#   2. Umgebung: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.
# Signatur: CSC_NAME="Developer ID Application: … (TEAMID)" ist optional,
# sonst nimmt electron-builder das Developer-ID-Zertifikat aus dem
# Schlüsselbund. Release-Notizen: RELEASE_NOTES.md im Repo (vorher füllen).
set -euo pipefail

export APPLE_KEYCHAIN_PROFILE="${APPLE_KEYCHAIN_PROFILE:-kira-notary}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n→ %s\n' "$*"; }
fail() { printf 'Fehler: %s\n' "$*" >&2; exit 1; }

step "Voraussetzungen prüfen"
command -v gh >/dev/null 2>&1 || fail "gh (GitHub CLI) fehlt: brew install gh"
gh auth status >/dev/null 2>&1 || fail "gh ist nicht angemeldet: gh auth login"
command -v node >/dev/null 2>&1 || fail "node fehlt"
[[ -f RELEASE_NOTES.md ]] || fail "RELEASE_NOTES.md fehlt"
if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  unset APPLE_KEYCHAIN_PROFILE
  echo "Notarisierung über APPLE_ID/APPLE_TEAM_ID aus der Umgebung."
elif xcrun notarytool history --keychain-profile "$APPLE_KEYCHAIN_PROFILE" >/dev/null 2>&1; then
  echo "Notarisierung über Schlüsselbund-Profil '$APPLE_KEYCHAIN_PROFILE'."
else
  fail "Keine Notarisierungs-Zugangsdaten: Schlüsselbund-Profil '$APPLE_KEYCHAIN_PROFILE' fehlt (xcrun notarytool store-credentials …) und APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID sind nicht gesetzt."
fi
security find-identity -v -p codesigning | grep -q "Developer ID Application" || fail "Kein Developer-ID-Zertifikat im Schlüsselbund (Xcode → Einstellungen → Apple Accounts → Manage Certificates → + → Developer ID Application)."

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

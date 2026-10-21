#!/usr/bin/env bash
# Entscheidet Signatur und Notarisierung für den CI-Build und legt – im Modus
# prepare – Zertifikat und API-Schlüssel ab.
#
# Geheimnisse (Umgebung, nie ins Protokoll):
#   MACOS_CERT_P12_BASE64  Developer ID Application, .p12, base64
#   MACOS_CERT_PASSWORD    Passwort dieser .p12
#   ASC_KEY_ID             App Store Connect API Key ID
#   ASC_ISSUER_ID          Issuer ID
#   ASC_KEY_P8             Rohinhalt der .p8 (PEM)
#
# Ohne Zertifikat: unsigniert, keine Notarisierung (der Build bleibt grün).
# Notarisierung nur zusammen mit der Signatur und allen drei ASC-Werten.
# electron-builder liest danach CSC_KEYCHAIN und CSC_NAME (ohne das Präfix
# „Developer ID Application:“) sowie APPLE_API_KEY, APPLE_API_KEY_ID und
# APPLE_API_ISSUER. CSC_LINK bleibt leer: electron-builder würde den
# Schlüsselbund sonst mit dem .p12-Passwort statt dem Bund-Passwort
# freischalten, und codesign bricht ab.
set -euo pipefail

is_set() {
  local value="${1-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  [[ -n "$value" ]]
}

# Schreibt PLAN_SIGNED, PLAN_NOTARIZED, PLAN_NOTICE, PLAN_ERROR.
plan() {
  PLAN_SIGNED=false
  PLAN_NOTARIZED=false
  PLAN_NOTICE=""
  PLAN_ERROR=""

  # Forks setzen CI_ALLOW_SIGNING=false. Pull Requests aus diesem Repo und
  # main signieren, sobald die Geheimnisse da sind. Veröffentlicht wird nur main.
  if [[ "${CI_ALLOW_SIGNING:-true}" != true ]]; then
    PLAN_NOTICE="Ohne Signatur: Pull Requests aus einem Fork bekommen die Zertifikate nicht."
    return 0
  fi

  local has_cert=false has_password=false
  is_set "${MACOS_CERT_P12_BASE64-}" && has_cert=true
  is_set "${MACOS_CERT_PASSWORD-}" && has_password=true

  local asc=0
  is_set "${ASC_KEY_ID-}" && asc=$((asc + 1))
  is_set "${ASC_ISSUER_ID-}" && asc=$((asc + 1))
  is_set "${ASC_KEY_P8-}" && asc=$((asc + 1))

  if [[ "$has_cert" != "$has_password" ]]; then
    PLAN_ERROR="Signatur unvollständig: MACOS_CERT_P12_BASE64 und MACOS_CERT_PASSWORD müssen beide gesetzt sein (Developer ID Application als .p12)."
    return 0
  fi

  if [[ "$has_cert" == true ]]; then
    PLAN_SIGNED=true
    if [[ "$asc" -eq 3 ]]; then
      PLAN_NOTARIZED=true
      PLAN_NOTICE="Signatur und Notarisierung aktiv (Developer ID Application und App Store Connect API Key)."
    elif [[ "$asc" -eq 0 ]]; then
      PLAN_NOTICE="Signiert, aber nicht notarisiert: ASC_KEY_ID, ASC_ISSUER_ID und ASC_KEY_P8 fehlen. Gatekeeper meldet die App als nicht beglaubigt."
    else
      PLAN_ERROR="Notarisierung unvollständig: ASC_KEY_ID, ASC_ISSUER_ID und ASC_KEY_P8 müssen alle drei gesetzt sein, oder keines."
    fi
    return 0
  fi

  PLAN_NOTICE="Keine Signatur: MACOS_CERT_P12_BASE64 und MACOS_CERT_PASSWORD fehlen. Die App wird unsigniert gebaut und nicht notarisiert. Gatekeeper lehnt das Paket ab."
  if [[ "$asc" -gt 0 ]]; then
    PLAN_NOTICE="$PLAN_NOTICE Notarisierungs-Schlüssel sind gesetzt, bleiben aber ungenutzt, solange kein Developer-ID-Zertifikat da ist."
  fi
}

cmd_plan() {
  plan
  if [[ -n "$PLAN_ERROR" ]]; then
    printf '%s\n' "$PLAN_ERROR" >&2
    exit 1
  fi
  printf 'signed=%s\nnotarized=%s\n' "$PLAN_SIGNED" "$PLAN_NOTARIZED"
  if [[ -n "$PLAN_NOTICE" ]]; then
    printf 'notice=%s\n' "$PLAN_NOTICE"
  fi
}

write_env() {
  local key="$1"
  local value="$2"
  if [[ -z "${GITHUB_ENV:-}" ]]; then
    printf '%s=%s\n' "$key" "$value"
    return 0
  fi
  printf '%s=%s\n' "$key" "$value" >> "$GITHUB_ENV"
}

write_secret_env() {
  local key="$1"
  local value="$2"
  if [[ -z "${GITHUB_ENV:-}" ]]; then
    return 0
  fi
  local delim="KIRA_SECRET_$(openssl rand -hex 16)"
  {
    printf '%s<<%s\n' "$key" "$delim"
    printf '%s\n' "$value"
    printf '%s\n' "$delim"
  } >> "$GITHUB_ENV"
}

write_output() {
  local key="$1"
  local value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  fi
}

import_apple_intermediate() {
  local url="$1"
  local dest="$2"
  local keychain="$3"
  if ! curl -fsSL --retry 3 --retry-delay 2 -o "$dest" "$url"; then
    echo "Zwischenzertifikat nicht geladen ($(basename "$url")); der System-Schlüsselbund muss die Kette tragen." >&2
    return 0
  fi
  if security import "$dest" -k "$keychain" -T /usr/bin/codesign >/dev/null 2>&1; then
    echo "Zwischenzertifikat: $(basename "$url")"
  else
    echo "Zwischenzertifikat nicht importiert ($(basename "$url")); der System-Schlüsselbund muss die Kette tragen." >&2
  fi
}

install_signing_keychain() {
  local cert="$1"
  local dir="$2"
  local keychain="$dir/kira-signing.keychain-db"
  local keychain_password
  keychain_password="$(openssl rand -base64 24)"

  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  security create-keychain -p "$keychain_password" "$keychain"
  security set-keychain-settings -lut 21600 "$keychain"
  security unlock-keychain -p "$keychain_password" "$keychain"

  import_apple_intermediate "https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer" "$dir/DeveloperIDG2CA.cer" "$keychain"
  import_apple_intermediate "https://www.apple.com/certificateauthority/DeveloperIDCA.cer" "$dir/DeveloperIDCA.cer" "$keychain"
  import_apple_intermediate "https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer" "$dir/AppleWWDRCAG3.cer" "$keychain"

  # -A: der Lauf hat keine Oberfläche, die den Schlüsselzugriff bestätigen könnte.
  if ! security import "$cert" -k "$keychain" -f pkcs12 -P "$MACOS_CERT_PASSWORD" -A \
    -T /usr/bin/codesign -T /usr/bin/productbuild -T /usr/bin/security >/dev/null; then
    echo "Das Developer-ID-Zertifikat lässt sich nicht importieren. MACOS_CERT_P12_BASE64 muss ein .p12 mit privatem Schlüssel sein, MACOS_CERT_PASSWORD das dazu gehörige Passwort." >&2
    exit 1
  fi
  if ! security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null; then
    echo "Der Schlüsselbund gibt den Schlüssel nicht für codesign frei." >&2
    exit 1
  fi
  security default-keychain -s "$keychain"

  local identities identity_name short_name
  identities="$(security find-identity -v -p codesigning "$keychain")"
  identity_name="$(printf '%s\n' "$identities" | sed -n 's/.*"\(Developer ID Application:.*\)".*/\1/p' | head -1)"
  if [[ -z "$identity_name" ]]; then
    echo "Im .p12 steckt kein „Developer ID Application“-Zertifikat mit privatem Schlüssel." >&2
    printf '%s\n' "$identities" >&2
    exit 1
  fi
  short_name="${identity_name#Developer ID Application: }"
  echo "Signatur-Identität: $identity_name"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf 'Signatur-Identität: `%s`\n' "$identity_name" >> "$GITHUB_STEP_SUMMARY"
  fi

  # Den Bund in die Suchliste, sonst findet codesign die Zwischenzertifikate nicht.
  local existing=()
  local line
  while IFS= read -r line; do
    line="${line#\"}"
    line="${line%\"}"
    [[ -n "$line" ]] || continue
    existing+=("$line")
  done < <(security list-keychains -d user | sed 's/^ *//')
  if [[ ${#existing[@]} -eq 0 ]]; then
    security list-keychains -d user -s "$keychain" >/dev/null
  else
    security list-keychains -d user -s "$keychain" "${existing[@]}" >/dev/null
  fi

  write_env CSC_KEYCHAIN "$keychain"
  write_env CSC_NAME "$short_name"
}

cmd_prepare() {
  plan
  if [[ -n "$PLAN_ERROR" ]]; then
    printf '%s\n' "$PLAN_ERROR" >&2
    exit 1
  fi
  printf '%s\n' "$PLAN_NOTICE"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$PLAN_NOTICE" >> "$GITHUB_STEP_SUMMARY"
  fi
  write_output signed "$PLAN_SIGNED"
  write_output notarized "$PLAN_NOTARIZED"
  write_env SIGNED "$PLAN_SIGNED"
  write_env NOTARIZED "$PLAN_NOTARIZED"

  if [[ "$PLAN_SIGNED" != true ]]; then
    return 0
  fi

  local dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
  local cert="$dir/kira-developer-id.p12"
  # Pfad-Argument, nicht die Umgebung: der base64-Block stünde sonst in der Prozessliste.
  MACOS_CERT_P12_BASE64="$MACOS_CERT_P12_BASE64" python3 - "$cert" <<'PY'
import base64, os, pathlib, sys
raw = os.environ["MACOS_CERT_P12_BASE64"].encode()
pathlib.Path(sys.argv[1]).write_bytes(base64.b64decode(b"".join(raw.split())))
os.chmod(sys.argv[1], 0o600)
PY
  if [[ ! -s "$cert" ]]; then
    echo "MACOS_CERT_P12_BASE64 ließ sich nicht als PKCS#12 dekodieren." >&2
    exit 1
  fi
  local first
  first="$(od -An -tx1 -N1 "$cert" | tr -d '[:space:]')"
  if [[ "$first" != "30" ]]; then
    echo "MACOS_CERT_P12_BASE64 ist kein PKCS#12-Zertifikat (Developer ID Application als .p12, base64)." >&2
    exit 1
  fi
  # electron-builder legt einen eigenen Schlüsselbund an und ruft
  # set-key-partition-list mit dem .p12-Passwort auf, nicht mit dem Passwort
  # dieses Bundes. codesign bleibt dann hängen („User interaction is not
  # allowed“). Darum importieren wir selbst und geben nur CSC_KEYCHAIN weiter.
  install_signing_keychain "$cert" "$dir"

  if [[ "$PLAN_NOTARIZED" != true ]]; then
    return 0
  fi

  local key="$dir/AuthKey_${ASC_KEY_ID}.p8"
  ASC_KEY_P8="$ASC_KEY_P8" python3 - "$key" <<'PY'
import os, pathlib, sys
text = os.environ["ASC_KEY_P8"]
if not text.endswith("\n"):
    text += "\n"
path = pathlib.Path(sys.argv[1])
path.write_text(text)
os.chmod(path, 0o600)
PY
  if ! grep -q "PRIVATE KEY" "$key"; then
    echo "ASC_KEY_P8 ist kein PEM-Schlüssel (BEGIN PRIVATE KEY fehlt). Den Rohinhalt der .p8 einsetzen, nicht den Dateinamen." >&2
    exit 1
  fi
  write_env APPLE_API_KEY "$key"
  write_env APPLE_API_KEY_ID "$ASC_KEY_ID"
  write_env APPLE_API_ISSUER "$ASC_ISSUER_ID"
}

assert_plan() {
  local name="$1"
  local want_status="$2"
  local want_signed="$3"
  local want_notarized="$4"
  local err out status
  err="$(mktemp)"
  set +e
  out="$(bash "$SCRIPT" plan 2>"$err")"
  status=$?
  set -e
  if [[ "$status" -ne "$want_status" ]]; then
    echo "FAIL $name: Status $status, erwartet $want_status" >&2
    cat "$err" >&2
    exit 1
  fi
  if [[ "$want_status" -eq 0 ]]; then
    if ! grep -qx "signed=$want_signed" <<<"$out" || ! grep -qx "notarized=$want_notarized" <<<"$out"; then
      echo "FAIL $name: unerwartete Ausgabe:" >&2
      printf '%s\n' "$out" >&2
      exit 1
    fi
    if grep -q "CANARY" <<<"$out" || grep -q "CANARY" "$err"; then
      echo "FAIL $name: Geheimnis im Protokoll" >&2
      exit 1
    fi
  else
    if [[ ! -s "$err" ]]; then
      echo "FAIL $name: Fehler ohne Meldung" >&2
      exit 1
    fi
  fi
  rm -f "$err"
  echo "ok $name"
}

cmd_self_test() {
  SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  # Der Plan läuft in einem Kindprozess und sieht nur exportierte Variablen.
  local saved_b64="${MACOS_CERT_P12_BASE64-}" saved_pw="${MACOS_CERT_PASSWORD-}"
  local saved_id="${ASC_KEY_ID-}" saved_issuer="${ASC_ISSUER_ID-}" saved_p8="${ASC_KEY_P8-}"
  local saved_allow="${CI_ALLOW_SIGNING-}"
  unset MACOS_CERT_P12_BASE64 MACOS_CERT_PASSWORD ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_P8 CI_ALLOW_SIGNING

  assert_plan "ohne Geheimnisse" 0 false false

  export MACOS_CERT_P12_BASE64="CANARYCERT"
  assert_plan "nur Zertifikat" 1 false false
  unset MACOS_CERT_P12_BASE64

  export MACOS_CERT_PASSWORD="CANARYPASS"
  assert_plan "nur Passwort" 1 false false
  unset MACOS_CERT_PASSWORD

  export MACOS_CERT_P12_BASE64="  "
  export MACOS_CERT_PASSWORD="  "
  assert_plan "nur Leerzeichen" 0 false false
  unset MACOS_CERT_P12_BASE64 MACOS_CERT_PASSWORD

  export MACOS_CERT_P12_BASE64="CANARYCERT"
  export MACOS_CERT_PASSWORD="CANARYPASS"
  assert_plan "Zertifikat ohne ASC" 0 true false

  export ASC_KEY_ID="KEYID"
  assert_plan "ASC unvollständig" 1 false false
  unset ASC_KEY_ID

  export ASC_KEY_ID="KEYID"
  export ASC_ISSUER_ID="ISSUER"
  export ASC_KEY_P8="-----BEGIN PRIVATE KEY-----CANARY-----END PRIVATE KEY-----"
  assert_plan "Zertifikat und ASC" 0 true true

  export CI_ALLOW_SIGNING=false
  assert_plan "Pull Request trotz Zertifikat" 0 false false
  unset CI_ALLOW_SIGNING
  unset MACOS_CERT_P12_BASE64 MACOS_CERT_PASSWORD

  assert_plan "ASC ohne Zertifikat" 0 false false
  unset ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_P8

  # Vorherige Umgebung wiederherstellen, falls jemand das Skript lokal mit Werten aufruft.
  if [[ -n "$saved_b64" ]]; then export MACOS_CERT_P12_BASE64="$saved_b64"; fi
  if [[ -n "$saved_pw" ]]; then export MACOS_CERT_PASSWORD="$saved_pw"; fi
  if [[ -n "$saved_id" ]]; then export ASC_KEY_ID="$saved_id"; fi
  if [[ -n "$saved_issuer" ]]; then export ASC_ISSUER_ID="$saved_issuer"; fi
  if [[ -n "$saved_p8" ]]; then export ASC_KEY_P8="$saved_p8"; fi
  if [[ -n "$saved_allow" ]]; then export CI_ALLOW_SIGNING="$saved_allow"; fi
  echo "ci-signing self-test ok"
}

case "${1:-}" in
  plan) cmd_plan ;;
  prepare) cmd_prepare ;;
  self-test) cmd_self_test ;;
  *)
    echo "Aufruf: scripts/ci-signing.sh plan|prepare|self-test" >&2
    exit 2
    ;;
esac

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
# electron-builder liest danach CSC_LINK/CSC_KEY_PASSWORD und
# APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER.
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

  # Nur main darf signieren. Pull Requests sehen die Zertifikate nicht
  # (CI_ALLOW_SIGNING=false), auch wenn sie in der Umgebung stünden.
  if [[ "${CI_ALLOW_SIGNING:-true}" != true ]]; then
    PLAN_NOTICE="Ohne Signatur: nur ein Lauf auf main signiert und notarisiert. Pull Requests bauen das Paket unsigniert."
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
  write_env CSC_LINK "$cert"
  write_secret_env CSC_KEY_PASSWORD "$MACOS_CERT_PASSWORD"

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

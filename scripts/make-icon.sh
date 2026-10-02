#!/usr/bin/env bash
# Erzeugt alle Grafiken von „KIRA für Mac“ aus den Quellen in build/icon-src/:
#
#   build/icon.icns                       App-Symbol, 16–1024 px (16/32 px aus icon-small.svg)
#   resources/tray/kiraTemplate(@2x).png           Menüleiste „verbunden“
#   resources/tray/kiraOfflineTemplate(@2x).png    Menüleiste „getrennt“
#   resources/tray/kiraDictatingTemplate(@2x).png  Menüleiste „Diktat läuft“
#   resources/tray/kiraUpdateTemplate(@2x).png     Menüleiste „Update bereit“
#   build/background.tiff                 DMG-Hintergrund, 540×380 + 1080×760
#   build/icon-src/preview.png            Kontroll-Übersicht aller Ergebnisse
#
# Werkzeuge: Google Chrome (headless) rendert die SVG/HTML-Quellen; sips, iconutil
# und tiffutil bringt macOS mit. Keine weiteren Abhängigkeiten.
#
# Aufruf:  scripts/make-icon.sh
#          CHROME=/pfad/zu/chrome scripts/make-icon.sh   (anderer Chrome/Chromium)
#
# Warum jede Größe einzeln gerendert wird (statt 1024 px + sips -z): sips verkleinert
# mit leichter Unschärfe und ~0,2 px Versatz; Chrome rastert die Vektoren direkt in
# der Zielgröße mit exakter Kantenglättung. Die Quellen legen Kanten bewusst auf das
# Pixelraster der kleinen Größen – das bleibt nur so erhalten.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/build/icon-src"
OUT_ICNS="$ROOT/build/icon.icns"
OUT_BG="$ROOT/build/background.tiff"
TRAY_DIR="$ROOT/resources/tray"
PREVIEW="$SRC/preview.png"

die() { echo "Fehler: $*" >&2; exit 1; }

case "${1:-}" in
  -h|--help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0;;
  "") ;;
  *) die "unbekanntes Argument „$1“ (keine Argumente nötig, siehe --help)";;
esac

# --- Werkzeuge prüfen -------------------------------------------------------
CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    if [ -x "$c" ]; then CHROME="$c"; break; fi
  done
fi
[ -n "$CHROME" ] && [ -x "$CHROME" ] || die "Google Chrome nicht gefunden (erwartet unter /Applications/Google Chrome.app).
       Chrome installieren oder den Pfad setzen: CHROME=/pfad/zu/chrome $0"
for tool in sips iconutil tiffutil; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool fehlt – das Skript läuft nur unter macOS."
done
for f in icon.svg icon-small.svg tray-connected.svg tray-offline.svg tray-dictating.svg tray-update.svg \
         dmg-background.html preview.html; do
  [ -f "$SRC/$f" ] || die "Quelle fehlt: build/icon-src/$f"
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/kira-icons.XXXXXX")"
cleanup() {
  pkill -9 -f "$WORK/chrome-" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

mkdir -p "$TRAY_DIR"

# --- Rendern mit Headless Chrome ----------------------------------------------
# Eigenheiten von Chrome (geprüft mit Chrome 154), die das Vorgehen bestimmen:
#  * Chrome beendet sich nach --screenshot nicht von selbst → auf die Meldung
#    „bytes written to file“ warten, dann den Prozess beenden.
#  * Fenster unter 500 px Breite werden intern breiter gelegt, und die Seite ist
#    87 px niedriger als das Fenster → großes Fenster, Inhalt bei (100,100) CSS-px,
#    danach mit sips ausschneiden (--cropOffset 0 0 bedeutet bei sips „Mitte“).
RUN=0
shot() { # shot <url> <fensterB> <fensterH> <skalierung> <ausgabe.png>
  local url="$1" w="$2" h="$3" scale="$4" out="$5" prof log pid i
  RUN=$((RUN + 1))
  prof="$WORK/chrome-$RUN"; log="$WORK/chrome-$RUN.log"
  rm -f "$out"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --user-data-dir="$prof" --no-first-run --no-default-browser-check --disable-extensions \
    --disable-background-networking --disable-sync --disable-component-update --use-mock-keychain \
    --force-device-scale-factor="$scale" --window-size="$w,$h" --screenshot="$out" "$url" \
    >"$log" 2>&1 &
  pid=$!
  for i in $(seq 1 150); do # höchstens 30 s
    grep -q "bytes written to file" "$log" 2>/dev/null && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  kill "$pid" >/dev/null 2>&1 || true
  sleep 0.2
  kill -9 "$pid" >/dev/null 2>&1 || true
  pkill -9 -f "$prof" >/dev/null 2>&1 || true
  wait "$pid" 2>/dev/null || true
  rm -rf "$prof"
  [ -s "$out" ]
}

render() { # render <seite.html> <inhaltB> <inhaltH> <skalierung> <ausgabe.png>
  local page="$1" cw="$2" ch="$3" scale="$4" out="$5" ww wh raw try
  ww=$((cw + 200)); [ "$ww" -lt 600 ] && ww=600
  wh=$((ch + 300)); [ "$wh" -lt 600 ] && wh=600
  raw="$WORK/raw-$RUN.png"
  for try in 1 2 3; do
    if shot "file://$page" "$ww" "$wh" "$scale" "$raw"; then
      sips -c $((ch * scale)) $((cw * scale)) --cropOffset $((100 * scale)) $((100 * scale)) \
        "$raw" --out "$out" >/dev/null
      rm -f "$raw"
      return 0
    fi
    echo "  Hinweis: Chrome lieferte kein Bild für $(basename "$page") (Versuch $try/3)" >&2
  done
  echo "--- Chrome-Protokoll (letzte Zeilen) ---" >&2
  tail -n 15 "$WORK/chrome-$RUN.log" >&2 || true
  die "Rendern fehlgeschlagen: $(basename "$page")"
}

render_svg() { # render_svg <quelle.svg> <größe-in-pt> <skalierung> <ausgabe.png>
  # SVG direkt in die Seite einbetten (kein Nachladen, nichts kann zu spät kommen).
  local svg="$1" size="$2" scale="$3" out="$4" name page
  name="$(basename "$svg" .svg)"
  page="$WORK/page-$name-$size.html"
  {
    printf '%s' "<!doctype html><meta charset=\"utf-8\"><style>html,body{margin:0;background:transparent}"
    printf '%s' "svg{position:absolute;left:100px;top:100px;width:${size}px;height:${size}px}</style>"
    cat "$svg"
  } >"$page"
  render "$page" "$size" "$size" "$scale" "$out"
}

check_png() { # check_png <datei> <breite> <höhe>
  local info
  info="$(sips -g pixelWidth -g pixelHeight -g hasAlpha "$1")"
  grep -q "pixelWidth: $2\$" <<<"$info" || die "$1: Breite ist nicht $2 px"
  grep -q "pixelHeight: $3\$" <<<"$info" || die "$1: Höhe ist nicht $3 px"
  grep -q "hasAlpha: yes" <<<"$info" || die "$1: kein Alphakanal"
}

# --- App-Symbol --------------------------------------------------------------------
echo "App-Symbol …"
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
render_svg "$SRC/icon-small.svg" 16 1 "$ICONSET/icon_16x16.png"
render_svg "$SRC/icon-small.svg" 32 1 "$ICONSET/icon_16x16@2x.png"
cp "$ICONSET/icon_16x16@2x.png" "$ICONSET/icon_32x32.png"
render_svg "$SRC/icon.svg" 64 1 "$ICONSET/icon_32x32@2x.png"
render_svg "$SRC/icon.svg" 128 1 "$ICONSET/icon_128x128.png"
render_svg "$SRC/icon.svg" 256 1 "$ICONSET/icon_128x128@2x.png"
cp "$ICONSET/icon_128x128@2x.png" "$ICONSET/icon_256x256.png"
render_svg "$SRC/icon.svg" 512 1 "$ICONSET/icon_256x256@2x.png"
cp "$ICONSET/icon_256x256@2x.png" "$ICONSET/icon_512x512.png"
render_svg "$SRC/icon.svg" 1024 1 "$ICONSET/icon_512x512@2x.png"
for size in 16 32 128 256 512; do
  check_png "$ICONSET/icon_${size}x${size}.png" "$size" "$size"
  check_png "$ICONSET/icon_${size}x${size}@2x.png" $((size * 2)) $((size * 2))
done
iconutil -c icns "$ICONSET" -o "$OUT_ICNS"
iconutil -c iconset "$OUT_ICNS" -o "$WORK/check.iconset"
[ "$(find "$WORK/check.iconset" -name '*.png' | wc -l | tr -d ' ')" = "10" ] \
  || die "$OUT_ICNS enthält nicht alle 10 Bilder"
echo "✓ build/icon.icns (10 Bilder 16–1024 px, Alpha geprüft)"

# --- Menüleiste (Template-Bilder: Schwarz + Alpha) ---------------------------------
echo "Menüleisten-Symbole …"
for pair in "tray-connected:kiraTemplate" "tray-offline:kiraOfflineTemplate" \
            "tray-dictating:kiraDictatingTemplate" "tray-update:kiraUpdateTemplate"; do
  src="${pair%%:*}"; name="${pair#*:}"
  render_svg "$SRC/$src.svg" 18 1 "$TRAY_DIR/$name.png"
  render_svg "$SRC/$src.svg" 18 2 "$TRAY_DIR/$name@2x.png"
  check_png "$TRAY_DIR/$name.png" 18 18
  check_png "$TRAY_DIR/$name@2x.png" 36 36
  echo "✓ resources/tray/$name.png (+@2x)"
done

# --- DMG-Hintergrund ---------------------------------------------------------------
echo "DMG-Hintergrund …"
cp "$SRC/dmg-background.html" "$WORK/dmg-background.html"
render "$WORK/dmg-background.html" 540 380 1 "$WORK/background.png"
render "$WORK/dmg-background.html" 540 380 2 "$WORK/background@2x.png"
check_png "$WORK/background.png" 540 380
check_png "$WORK/background@2x.png" 1080 760
sips -s dpiWidth 72 -s dpiHeight 72 "$WORK/background.png" >/dev/null
sips -s dpiWidth 144 -s dpiHeight 144 "$WORK/background@2x.png" >/dev/null
tiffutil -cathidpicheck "$WORK/background.png" "$WORK/background@2x.png" -out "$OUT_BG" \
  >"$WORK/tiffutil.log" 2>&1 || { cat "$WORK/tiffutil.log" >&2; die "tiffutil konnte build/background.tiff nicht schreiben"; }
echo "✓ build/background.tiff (540×380 + 1080×760)"

# --- Übersicht ---------------------------------------------------------------------
echo "Übersicht …"
PV="$WORK/preview"
mkdir -p "$PV"
cp "$SRC/preview.html" "$PV/preview.html"
for f in icon_512x512.png icon_128x128.png icon_32x32.png icon_16x16.png icon_128x128@2x.png; do
  cp "$ICONSET/$f" "$PV/$f"
done
cp "$TRAY_DIR"/kira*Template*.png "$PV/"
cp "$WORK/background.png" "$PV/background.png"
FOLDER_ICNS="/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/ApplicationsFolderIcon.icns"
if [ -f "$FOLDER_ICNS" ]; then # nur für die Vorschau des DMG-Fensters
  sips -s format png -z 192 192 "$FOLDER_ICNS" --out "$PV/folder.png" >/dev/null 2>&1 || true
fi
render "$PV/preview.html" 1720 1240 1 "$PREVIEW"
echo "✓ build/icon-src/preview.png"

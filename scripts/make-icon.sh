#!/usr/bin/env bash
# Erzeugt build/icon.icns (App-Symbol) und resources/tray/kiraTemplate{,@2x}.png
# (Menüleiste, Template-Bild: schwarz + Alpha) aus KIRAs Quell-SVG.
# Aufruf: scripts/make-icon.sh [/pfad/zu/icon-source.svg | /pfad/zu/icon-512.png]
# Rasterung: rsvg-convert (brew install librsvg) → qlmanage (macOS-Bordmittel)
# → sonst ein vorhandenes PNG als Quelle (icon-512.png aus dem KIRA-Repo).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-$ROOT/../kira/dashboard/public/icon-source.svg}"
OUT_ICNS="$ROOT/build/icon.icns"
TRAY_DIR="$ROOT/resources/tray"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$ROOT/build" "$TRAY_DIR"

rasterize() { # rasterize <svg> <size> <out.png>
  local svg="$1" size="$2" out="$3"
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w "$size" -h "$size" "$svg" -o "$out"
  elif command -v qlmanage >/dev/null 2>&1; then
    local dir; dir="$(mktemp -d)"
    qlmanage -t -s "$size" -o "$dir" "$svg" >/dev/null 2>&1
    mv "$dir"/*.png "$out"
    rm -rf "$dir"
  else
    return 1
  fi
}

BASE="$WORK/base-1024.png"
case "$SRC" in
  *.svg)
    if ! rasterize "$SRC" 1024 "$BASE"; then
      FALLBACK="$(dirname "$SRC")/icon-512.png"
      echo "Hinweis: keine SVG-Rasterung möglich – nehme $FALLBACK" >&2
      sips -z 1024 1024 "$FALLBACK" --out "$BASE" >/dev/null
    fi
    ;;
  *.png)
    sips -z 1024 1024 "$SRC" --out "$BASE" >/dev/null
    ;;
  *)
    echo "Quelle muss .svg oder .png sein: $SRC" >&2; exit 1;;
esac

ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$BASE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$BASE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT_ICNS"
echo "✓ $OUT_ICNS"

# Menüleisten-Symbol: einfarbiges „K“ im Kreis als Template-Bild (macOS färbt es
# selbst hell/dunkel). Eigenes SVG, weil das App-Symbol farbig und voll ist.
TRAY_SVG="$WORK/tray.svg"
cat > "$TRAY_SVG" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="13" fill="none" stroke="#000" stroke-width="2.4"/>
  <path d="M11.5 8.5v15M12 16l7.5-7.5M12.5 16.5l7.5 7" fill="none" stroke="#000" stroke-width="2.6" stroke-linecap="round"/>
</svg>
SVG
if rasterize "$TRAY_SVG" 18 "$TRAY_DIR/kiraTemplate.png" && rasterize "$TRAY_SVG" 36 "$TRAY_DIR/kiraTemplate@2x.png"; then
  echo "✓ $TRAY_DIR/kiraTemplate.png (+@2x)"
else
  echo "Hinweis: Menüleisten-Symbol nicht erzeugt (kein rsvg-convert/qlmanage) – die App zeigt dann den Text „KIRA“." >&2
fi

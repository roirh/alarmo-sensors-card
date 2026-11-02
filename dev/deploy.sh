#!/usr/bin/env bash
# Sube la tarjeta al Home Assistant del OrangePi para probarla sin publicar.
#
# Uso:
#   ./deploy.sh          # sube una vez
#   ./deploy.sh watch    # sube automáticamente cada vez que guardas el archivo
#
# Configuración (variables de entorno opcionales):
#   HA_SSH     destino SSH      (defecto: roi@orangepi3)
#   HA_WWW     ruta www remota  (defecto: /var/lib/homeassistant/homeassistant/www)
#
# Tras subir: recarga el dashboard (Cmd+Shift+R). Si no ves el cambio,
# accede por IP LAN (sin Cloudflare) o sube el ?v= del recurso.
#
# Requisito único: que tu usuario pueda escribir en www (una sola vez):
#   ssh -t "$HA_SSH" "sudo chown -R \$(id -un):\$(id -gn) $HA_WWW"

set -euo pipefail

HOST="${HA_SSH:-roi@orangepi3}"
WWW="${HA_WWW:-/var/lib/homeassistant/homeassistant/www}"
FILE="$(cd "$(dirname "$0")/.." && pwd)/alarmo-sensors-card.js"
DEST="$HOST:$WWW/local/alarmo-sensors-card.js"

upload() {
  ssh "${HOST%%:*}" "mkdir -p $WWW/local" 2>/dev/null || true
  scp -q "$FILE" "$DEST"
  echo "✓ desplegado $(date '+%H:%M:%S') → $DEST"
}

case "${1:-up}" in
  up)
    upload
    ;;
  watch)
    command -v fswatch >/dev/null || { echo "necesitas fswatch: brew install fswatch"; exit 1; }
    echo "vigilando $FILE (Ctrl+C para salir)…"
    upload
    fswatch -o "$FILE" | while read -r _; do
      sleep 0.3            # debounce: espera a que el editor termine de escribir
      upload
    done
    ;;
  *)
    echo "uso: $0 [up|watch]"; exit 1
    ;;
esac

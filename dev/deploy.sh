#!/usr/bin/env bash
# Sube la tarjeta al Home Assistant del OrangePi para probarla sin publicar.
#
# Uso:
#   ./deploy.sh          # sube una vez
#   ./deploy.sh watch    # sube automáticamente cada vez que guardas el archivo
#
# Configuración (variables de entorno opcionales):
#   HA_SSH      destino SSH            (defecto: roi@orangepi3)
#   HA_CONTAINER contenedor de HA      (defecto: homeassistant)
#   HA_WWW      ruta www en el host    (defecto: /var/lib/homeassistant/homeassistant/www)
#
# Método: docker cp al contenedor (tu usuario está en el grupo docker,
# no se necesitan sudo ni cambiar permisos). Tras subir: Cmd+Shift+R.
# Si no ves el cambio por https, accede por IP LAN (sin Cloudflare).
#
# Nota: mientras uses /local/, desinstala o desactiva la copia de HACS
# para que no haya dos definiciones del mismo elemento cargadas.

set -euo pipefail

HOST="${HA_SSH:-roi@orangepi3}"
CONTAINER="${HA_CONTAINER:-homeassistant}"
WWW="${HA_WWW:-/var/lib/homeassistant/homeassistant/www}"
FILE="$(cd "$(dirname "$0")/.." && pwd)/alarmo-sensors-card.js"

upload() {
  scp -q "$FILE" "$HOST:/tmp/asc-deploy.js"
  ssh "$HOST" "docker cp /tmp/asc-deploy.js $CONTAINER:/config/www/alarmo-sensors-card.js && rm -f /tmp/asc-deploy.js"
  echo "✓ desplegado $(date '+%H:%M:%S') → $CONTAINER:/config/www/"
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

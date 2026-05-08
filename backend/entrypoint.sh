#!/usr/bin/env bash
# Materializa las SSH keys (que vienen como env vars base64 en Railway)
# a archivos .pem para que sshtunnel pueda usarlas.
set -e

mkdir -p /app/keys /app/data

write_key() {
    local name="$1"
    local b64var="$2"
    local outpath="/app/keys/${name}.pem"
    if [ -n "${!b64var:-}" ]; then
        echo "${!b64var}" | base64 -d > "$outpath"
        chmod 600 "$outpath"
        echo "key materialized: $outpath"
    fi
}

write_key "unistore-bastion" BASTION_KEY_UNISTORE_BASE64
write_key "unidrop-bastion"  BASTION_KEY_UNIDROP_BASE64
write_key "unidev-bastion"   BASTION_KEY_UNIDEV_BASE64

# Override de paths para que sshtunnel use los archivos recien creados
export BASTION_KEY_PATH_UNISTORE="${BASTION_KEY_PATH_UNISTORE:-/app/keys/unistore-bastion.pem}"
export BASTION_KEY_PATH_UNIDROP="${BASTION_KEY_PATH_UNIDROP:-/app/keys/unidrop-bastion.pem}"
# Unidev usa el mismo bastion que Unistore por default (la llave es la misma).
# Si BASTION_KEY_UNIDEV_BASE64 se inyecta, se usa esa llave; si no, fallback a la de Unistore.
if [ -f /app/keys/unidev-bastion.pem ]; then
    export BASTION_KEY_PATH_UNIDEV="${BASTION_KEY_PATH_UNIDEV:-/app/keys/unidev-bastion.pem}"
else
    export BASTION_KEY_PATH_UNIDEV="${BASTION_KEY_PATH_UNIDEV:-/app/keys/unistore-bastion.pem}"
fi

# audit.db y users.db viven en /app/data (volumen persistente).
# Como las paths estan codeadas relativas al modulo, hacemos symlinks.
[ -L /app/audit.db ] || ln -sf /app/data/audit.db /app/audit.db
[ -L /app/users.db ] || ln -sf /app/data/users.db /app/users.db
[ -L /app/costs.db ] || ln -sf /app/data/costs.db /app/costs.db

exec "$@"

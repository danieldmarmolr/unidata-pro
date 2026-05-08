# Handoff a Unifull — Configuracion `LEGACY_DATABASE_URL` para crm-kommo-sync

> Documento que Daniel le pasa al equipo de Unifull.
> El servicio `crm-kommo-sync` espera **una sola env var con la URL de Postgres**
> (`LEGACY_DATABASE_URL`). Como la RDS de Unistore es privada, hay que abrir
> un tunel SSH **a nivel de infraestructura** en su container, y la app
> apunta a `localhost`.

---

## Resumen ejecutivo

```
Tu app             ─────►  LEGACY_DATABASE_URL=postgresql://...@127.0.0.1:5440/...
                                                                   ▲
                                                                   │
                                                          (tunel SSH dentro
                                                           de tu container)
                                                                   │
                                                                   ▼
                            Bastion EC2 (3.139.209.227) en AWS
                                                                   │
                                                                   ▼
                            RDS unistore-prod-db (privada en VPC)
```

Tu app no ve el tunel SSH — solo ve un Postgres en `localhost:5440`. El tunel
corre como sidecar en el mismo container.

---

## Estado actual

✅ AWS Security Group ya allowlistado para la IP de Railway (`162.220.232.99/32`):

| Bastion | IP publica | SG | ID regla |
|---|---|---|---|
| Unistore | `3.139.209.227` | `unistore-prod-bastion-sg` | `sgr-0ed7dc9cd769da5e3` |
| Unidrop  | `18.191.119.38` | `launch-wizard-1`         | `sgr-0df2a3616e35bfc8d` |

(Mauro confirmo el 2026-05-08. Misma IP cubre UNIDATA + Unifull por shared
pool us-west-2.)

---

## Lo que falta del lado de Mauro

1. **Llave SSH `.pem` del bastion** que necesites:
   - `unistore-bastion-key.pem` para acceder a Unistore + Unidev
   - `unidrop-bastion-key.pem` si tambien necesitas Unidrop

2. **User PostgreSQL read-only** dedicado (Parte 2 del ticket consolidado):

   ```sql
   CREATE USER unifull_readonly WITH PASSWORD '<password>';
   GRANT CONNECT ON DATABASE unistore_api TO unifull_readonly;
   GRANT USAGE ON SCHEMA public, tienda_nube, meli, contabilium, digip TO unifull_readonly;
   GRANT SELECT ON ALL TABLES IN SCHEMA public, tienda_nube, meli, contabilium, digip TO unifull_readonly;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public, tienda_nube, meli, contabilium, digip
     GRANT SELECT ON TABLES TO unifull_readonly;
   ```

   > Confirmar a Mauro que schemas necesita Kommo. La lista de arriba es
   > sugerida. Si solo necesitas `tienda_nube` y `public`, mejor — menor
   > superficie expuesta.

   Mauro entrega la **password** por canal seguro.

---

## Configuracion en Railway — paso a paso

### 1. Variables de entorno en Railway

```env
# Tu app espera estas dos (las que ya tenias previstas):
LEGACY_DATABASE_URL=postgresql://unifull_readonly:<PASSWORD>@127.0.0.1:5440/unistore_api?sslmode=disable
DRY_RUN_LEGACY=false

# Configuracion del tunel SSH (las usa el entrypoint, NO tu app):
BASTION_HOST=3.139.209.227
BASTION_USER=ec2-user
BASTION_PORT=22
BASTION_KEY_BASE64=<base64 de la .pem>
RDS_REMOTE_HOST=unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com
RDS_REMOTE_PORT=5432
LOCAL_TUNNEL_PORT=5440
```

> Nota sobre `sslmode=disable`: dentro del tunel SSH la conexion ya esta
> encriptada por SSH. Postgres no necesita TLS adicional. Si tu cliente
> Postgres se queja, podes usar `sslmode=prefer` (acepta sin SSL si no esta
> disponible).

### 2. Convertir la .pem a base64

```bash
# Linux / Mac
base64 -w 0 unistore-bastion-key.pem
# Output: una larga cadena en base64, sin saltos de linea
# Pegala en Railway -> Variables -> BASTION_KEY_BASE64
```

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("unistore-bastion-key.pem"))
```

### 3. Modificar el Dockerfile / entrypoint

El tunel hay que abrirlo **antes** que arranque tu app. Hay dos formas
limpias de hacerlo:

#### Opcion A — entrypoint script (recomendado, sirve para cualquier stack)

Agregar al Dockerfile:

```dockerfile
# Sumar al Dockerfile, antes del CMD/ENTRYPOINT que ya tenias
RUN apt-get update && apt-get install -y openssh-client autossh && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["<tu comando original que arranca la app>"]
```

Crear `entrypoint.sh` en la raiz del proyecto:

```bash
#!/usr/bin/env bash
set -e

# 1. Materializar la llave SSH desde la env var base64
mkdir -p /app/keys
echo "$BASTION_KEY_BASE64" | base64 -d > /app/keys/bastion.pem
chmod 600 /app/keys/bastion.pem

# 2. Aceptar host key automaticamente la primera vez
mkdir -p ~/.ssh
ssh-keyscan -H "$BASTION_HOST" >> ~/.ssh/known_hosts 2>/dev/null

# 3. Abrir tunel persistente con autossh (auto-reconecta si se cae)
autossh -M 0 -f -N \
    -i /app/keys/bastion.pem \
    -o "ServerAliveInterval=30" \
    -o "ServerAliveCountMax=3" \
    -o "ExitOnForwardFailure=yes" \
    -o "StrictHostKeyChecking=no" \
    -L "${LOCAL_TUNNEL_PORT}:${RDS_REMOTE_HOST}:${RDS_REMOTE_PORT}" \
    "${BASTION_USER}@${BASTION_HOST}"

# 4. Esperar 3 segundos para que el tunel este listo
sleep 3

# 5. Smoke test del tunel
echo "Testing tunnel connectivity..."
if nc -z 127.0.0.1 "$LOCAL_TUNNEL_PORT" 2>/dev/null; then
    echo "OK: tunnel listening on localhost:${LOCAL_TUNNEL_PORT}"
else
    echo "ERROR: tunnel not responding on localhost:${LOCAL_TUNNEL_PORT}"
    exit 1
fi

# 6. Arrancar la app (cualquier comando que pase como CMD)
exec "$@"
```

Por que `autossh` y no `ssh` plano: si el tunel se cae (red intermitente),
autossh lo levanta solo. Mucho mas robusto en produccion.

#### Opcion B — proceso paralelo en codigo (mas acoplado, no recomendado)

Si preferis no tocar el Dockerfile, podes abrir el tunel desde el codigo
de tu app antes del primer query. Pero esto acopla tu app a la infra. Si
algun dia la RDS se vuelve publica o se mueve a otro setup, hay que
reescribir codigo en lugar de solo cambiar env vars. Por eso recomendamos A.

### 4. Verificar en Railway

Despues del deploy, en los logs deberias ver:

```
OK: tunnel listening on localhost:5440
[tu app arrancando con LEGACY_DATABASE_URL=postgresql://...localhost:5440/...]
```

---

## Smoke test desde Railway shell

Una vez deployado, podes ejecutar (desde el shell del container o un
endpoint /debug):

```sql
-- Confirma que estas conectado como el user correcto
SELECT current_user, current_database(), now();
-- Esperado: ('unifull_readonly', 'unistore_api', <timestamp>)

-- Confirma que es read-only (debe FALLAR)
CREATE TABLE _test (id int);
-- Esperado: permission denied

-- Confirma que ves data real
SELECT COUNT(*) FROM tienda_nube."Order" WHERE "createdAt"::date = CURRENT_DATE;
-- Esperado: numero entero (ordenes de hoy)
```

---

## Si tambien necesitan Unidrop

Repetir el setup con un segundo tunel:

```env
# Segundas vars para Unidrop (si aplica)
BASTION_HOST_UNIDROP=18.191.119.38
BASTION_KEY_UNIDROP_BASE64=<base64 de unidrop-bastion-key.pem>
RDS_REMOTE_HOST_UNIDROP=unidrop-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com
LOCAL_TUNNEL_PORT_UNIDROP=5441
LEGACY_DATABASE_URL_UNIDROP=postgresql://unifull_readonly_unidrop:<PASS>@127.0.0.1:5441/unidrop?sslmode=disable
```

Y agregar al `entrypoint.sh` un segundo bloque de `autossh` con esos vars.

---

## Resumen para tu jira / kanban

```
[ ] Pedir a Mauro:
    [ ] llave .pem del bastion Unistore
    [ ] (opcional) llave .pem del bastion Unidrop
    [ ] user PostgreSQL read-only + connection string

[ ] Configurar Railway crm-kommo-sync:
    [ ] Setear LEGACY_DATABASE_URL=postgresql://...@127.0.0.1:5440/...
    [ ] Setear DRY_RUN_LEGACY=false
    [ ] Setear BASTION_* y RDS_* env vars
    [ ] Convertir .pem a base64, pegarla en BASTION_KEY_BASE64

[ ] Codigo:
    [ ] Sumar autossh al Dockerfile (apt-get install autossh)
    [ ] Crear entrypoint.sh que abre el tunel antes de tu CMD
    [ ] Push, redeploy

[ ] Verificar:
    [ ] Logs muestran "tunnel listening on localhost:5440"
    [ ] Smoke test SQL: current_user = unifull_readonly
    [ ] Smoke test: INSERT falla con permission denied (read-only OK)
    [ ] Tu sync con Kommo lee datos reales
```

---

## Troubleshooting

| Sintoma | Causa probable | Fix |
|---|---|---|
| `Connection timed out` al SSH | IP de Railway no resuelve a la shared (raro pero posible si Railway cambio asignacion) | Pedir a Mauro re-confirmar SG con la nueva IP de salida |
| `Permission denied (publickey)` | .pem mal decodificada o permisos chmod 600 mal seteados | Re-correr el `base64 -d` y verificar `chmod 600` |
| `password authentication failed` | El user/password de Postgres estan mal | Re-pedir credenciales a Mauro |
| `connection refused` al RDS | El tunel SSH no levanto | Mirar logs, ver si autossh se quedo colgado en el handshake |
| `permission denied for table X` | El user read-only no tiene SELECT en ese schema | Pedir a Mauro que sume el GRANT en ese schema |
| `relation "X" does not exist` | Estas apuntando a la DB equivocada | Confirmar que `LEGACY_DATABASE_URL` apunta a `unistore_api` (no a `postgres` ni `rdsadmin`) |
| App se reinicia y el tunel queda zombie | autossh no esta limpiando — agregar trap SIGTERM | Cambiar `autossh -f` por usar tini o supervisord |

---

## Sobre seguridad

- **La .pem es sensible.** Nunca commitearla. Solo en env var de Railway
  (encriptada at-rest por su infra).
- **El user `unifull_readonly` solo lee.** Si algun dev confunde un INSERT
  o UPDATE en el codigo, falla con permission denied (es feature, no bug).
- **El tunel SSH es punto-a-punto.** No se puede ver desde otra IP que la
  de Railway us-west-2. Si Railway cambia la IP shared (raro), hay que
  reabrir ticket.
- **No mezclar credenciales** entre Unistore y Unidrop. Cada RDS tiene su
  user dedicado.

---

## Contactos

- **Daniel Marmol** (UNIDATA): `daniel.marmol@unistore.ar`
- **Mauro Candia** (data engineer / AWS): coordina llaves + creacion users
- **Equipo Unifull**: implementa la integracion en `crm-kommo-sync`

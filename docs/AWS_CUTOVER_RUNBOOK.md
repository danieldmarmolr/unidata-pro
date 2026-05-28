# AWS Cutover Runbook — UNIDATA

**Propósito:** Runbook ejecutable del día del cutover de Railway → AWS.
**Audiencia:** Daniel + Mauro durante la ventana de mantenimiento.
**Ventana estimada:** 30-45 min en horario de baja actividad.
**Tipo de operación:** atómica con rollback rápido (DNS revert).

---

## Pre-cutover · 24-48h antes (NO el día del cutover)

### 1. Bajar TTL en Cloudflare (CRÍTICO — sin esto el rollback toma 5 min en vez de 60s)

En consola Cloudflare → DNS de `unidatacenter.com.ar`, editar estos 3 records y cambiar TTL de **Auto** a **1 minuto** (60s):

- `app.unidatacenter.com.ar` (CNAME a `xtj42wlz.up.railway.app`)
- `api.unidatacenter.com.ar` (CNAME a `bbnv8yot.up.railway.app`)
- (si existe) `unidata-mcp.unidatacenter.com.ar`

Cuando el TTL Auto (que es 5min) expire por última vez ~5min después, todos los nuevos lookups van a usar TTL 60s. Eso te permite hacer cutover y rollback en máximo 1 min cada uno.

### 2. Validar que Mauro completó todo el stack AWS

- [ ] Backend Fargate corriendo: `curl http://unidata-prod-alb-347153784.us-east-2.elb.amazonaws.com/api/health` → `{"status":"ok"}`
- [ ] MCP Fargate corriendo (cuando esté deployado): healthcheck `/health` → 200
- [ ] Amplify deployed con un dominio temporal `*.amplifyapp.com` accesible
- [ ] ACM cert wildcard **Issued** (no Pending)
- [ ] Listener HTTPS:443 activo en el ALB con la rule por host header
- [ ] Probado login real en Amplify con dominio temporal apuntando al ALB → entra al dashboard

### 3. Comunicación

- [ ] Avisar a stakeholders del grupo: "el sábado [fecha] entre [hora]-[hora+45min] vamos a hacer mantenimiento de UNIDATA. La app va a estar inaccesible durante ~30 min".
- [ ] Confirmar con Mauro que está disponible esa ventana (mínimo 2 hs por si hay imprevisto).

### 4. Coordinación día D

Definir con Mauro:
- **Quién ejecuta qué paso** del runbook
- **Canal de comunicación** durante el cutover (Slack/Teams DM)
- **Trigger de rollback**: cualquiera de los 2 dispara rollback → Mauro revierte DNS en Cloudflare

---

## Día del cutover · Pre-flight (15 min antes)

| # | Check | Owner | Comando/acción |
|---|---|---|---|
| 1 | Backend Railway responde OK | Daniel | `curl https://api.unidatacenter.com.ar/api/health` |
| 2 | Backend AWS responde OK | Daniel | `curl http://unidata-prod-alb-347153784.us-east-2.elb.amazonaws.com/api/health` |
| 3 | Frontend Railway funcional (login OK) | Daniel | Browser → app.unidatacenter.com.ar → login → dashboard carga |
| 4 | Amplify funcional con dominio temporal | Mauro | Browser → `*.amplifyapp.com` → login → dashboard carga |
| 5 | MCP Railway responde | Daniel | Probar MCP token en Claude Desktop |
| 6 | MCP AWS responde | Mauro | curl al endpoint /health del MCP en ALB |
| 7 | Supabase accesible para `pg_dump` | Mauro | dry-run `pg_dump --schema-only` |
| 8 | unidata-prod-db accesible vía bastión | Mauro | conexión psql desde bastión |
| 9 | TTL DNS = 60s en Cloudflare | Daniel | abrir Cloudflare DNS, confirmar TTL = 1min |
| 10 | Banner de mantenimiento listo (opcional) | Daniel | preparar mensaje para enviar a stakeholders al iniciar |

Si **algún** check falla → abortar cutover, reagendar.

---

## Día del cutover · Ventana de mantenimiento

### Setup inicial (T-5 min)

```bash
# Daniel: anuncio en Slack/Teams del equipo Unistore
# "Iniciando mantenimiento de UNIDATA. Vuelta estimada en 30 min."
```

### Paso 1 · T+0 · Freeze Railway (Mauro)

```powershell
# Mauro: scale services a 0 → para escrituras a Supabase
railway service backend  --service-id <id> --replicas 0
railway service frontend --service-id <id> --replicas 0
railway service mcp      --service-id <id> --replicas 0
```

**Alternativa más simple**: Mauro entra al dashboard Railway y pone los 3 services en pausa.

**Validación**: `curl https://api.unidatacenter.com.ar/api/health` debe fallar (502/503).

### Paso 2 · T+1 · pg_dump fresco de Supabase (Mauro)

```bash
# Mauro: desde su máquina o EC2 con conectividad a Supabase
pg_dump \
  --no-owner --no-acl \
  --format=custom \
  --file=supabase-final-$(date +%Y%m%d-%H%M).dump \
  "$SUPABASE_DATABASE_URL"
```

**Validación**: archivo creado, tamaño esperado ~34 MB (similar al inicial).

### Paso 3 · T+3 · pg_restore a unidata-prod-db (Mauro)

```bash
# Mauro: --clean drops tablas existentes antes de recrearlas
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname="postgresql://unidata:<pw>@unidata-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com:5432/unidata" \
  supabase-final-*.dump
```

**Validación**: conectar con DBeaver, hacer `SELECT count(*) FROM users` → debería ser ≥15 + cualquier nuevo usuario que se haya creado desde el último backup.

### Paso 4 · T+5 · Update DATABASE_URL en Secrets Manager (Mauro)

```bash
# Mauro
aws secretsmanager update-secret \
  --secret-id unidata/prod/backend \
  --secret-string '{"DATABASE_URL":"postgresql://unidata:<pw>@unidata-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com:5432/unidata", ... (resto del JSON intacto)}' \
  --region us-east-2
```

**Alternativa GUI**: AWS Secrets Manager → `unidata/prod/backend` → "Retrieve secret value" → "Edit" → cambiar el valor de `DATABASE_URL` → Save.

### Paso 5 · T+6 · Force redeploy del backend Fargate (Mauro)

```bash
# Mauro
aws ecs update-service \
  --cluster unidata-prod \
  --service unidata-prod-backend \
  --force-new-deployment \
  --region us-east-2
```

**Validación**: esperar 1-2 min, check ECS console que la nueva task esté `RUNNING` y la vieja `STOPPED`.

### Paso 6 · T+8 · Smoke test contra ALB (sin DNS aún) (Daniel)

```bash
# Daniel: token de validación (se logueó en Amplify dominio temporal recién)
TOKEN="<tu_jwt_de_amplify_temporal>"
ALB="https://unidata-prod-alb-347153784.us-east-2.elb.amazonaws.com"

# Test 1: backend habla con unidata-prod-db (nuevo)
curl -s -H "Authorization: Bearer $TOKEN" "$ALB/api/auth/me" | jq

# Test 2: backend habla con RDS productivos
curl -s -H "Authorization: Bearer $TOKEN" "$ALB/api/dashboards/executive?unit=unistore&period=7d" | head -c 500

# Test 3: backend habla con unidata-prod-db en escritura
# (crear un test reminder y leerlo back)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"cutover-test","target_type":"general","due_at":null}' \
  "$ALB/api/reminders"

curl -s -H "Authorization: Bearer $TOKEN" "$ALB/api/reminders/my" | jq '.[] | select(.title=="cutover-test")'
```

**Si todos los tests pasan → continuar. Si alguno falla → ROLLBACK (ver sección final).**

### Paso 7 · T+10 · DNS cutover en Cloudflare (Daniel)

En Cloudflare → DNS de `unidatacenter.com.ar` → editar:

| Record | Tipo | Antes | **Después** |
|---|---|---|---|
| `app.unidatacenter.com.ar` | CNAME | `xtj42wlz.up.railway.app` (Proxied) | **`<dominio-amplify>.amplifyapp.com` (Proxied)** |
| `api.unidatacenter.com.ar` | CNAME | `bbnv8yot.up.railway.app` (Proxied) | **`unidata-prod-alb-347153784.us-east-2.elb.amazonaws.com` (Proxied o DNS only — Mauro decide)** |
| `unidata-mcp.unidatacenter.com.ar` | CNAME | (no existe o Railway) | **`unidata-prod-alb-347153784.us-east-2.elb.amazonaws.com`** |

**Importante**: si el ALB no resuelve por nombre, usar el alias de Route53 si Mauro lo armó, sino el DNS público del ALB.

### Paso 8 · T+12 · Validación de propagación DNS (Daniel)

```bash
# Esperar ~1 min después del cambio
nslookup app.unidatacenter.com.ar 8.8.8.8
nslookup api.unidatacenter.com.ar 8.8.8.8
nslookup unidata-mcp.unidatacenter.com.ar 8.8.8.8
```

Cada uno debe resolver al destino AWS correspondiente.

### Paso 9 · T+15 · Smoke test productivo end-to-end (Daniel)

| Test | Acción | Pass criteria |
|---|---|---|
| Login real | Browser → `https://app.unidatacenter.com.ar` → login con tus creds | Entra al dashboard sin error |
| Dashboard executive | Click "Gerencia" o "Home" | Carga KPIs con data fresca |
| Endpoint complejo | Navegar a `/dashboard/dropshipper/<algún-id>` | Carga vista 360 con data |
| MCP | En Claude Desktop, generar token nuevo desde `/dashboard/account` → conectar MCP → llamar tool `whoami` | Devuelve tu identidad |
| Escritura | Crear un reminder, una nota de dropshipper, una CS action | Persiste y lee back |

### Paso 10 · T+25 · Anuncio AWS live (Daniel)

```
Anuncio en Slack/Teams del equipo:
"✅ UNIDATA migración completa. App live en AWS desde las HH:MM.
Si encontrás cualquier comportamiento raro las próximas 24h,
avisame inmediatamente — tengo el rollback preparado."
```

**Migración exitosa. Comenzar período de validación de 1 semana.**

---

## Plan de rollback (si algo falla en cualquier paso ≥ T+10)

**Trigger** (cualquiera):
- Login no funciona → 502/500/timeout
- Dashboard no carga data productiva
- Datos visibles están corruptos o vacíos
- Latencia 10x mayor que Railway
- MCP no conecta

**Procedimiento (Daniel · ~60 seg)**:

1. En Cloudflare DNS → revertir los 3 records al estado anterior:
   - `app.unidatacenter.com.ar` → `xtj42wlz.up.railway.app`
   - `api.unidatacenter.com.ar` → `bbnv8yot.up.railway.app`
   - Borrar `unidata-mcp.unidatacenter.com.ar` (no se usaba antes en Railway con ese path)

2. Mauro: scale Railway services de vuelta a 1 réplica
   ```powershell
   railway service backend --service-id <id> --replicas 1
   railway service frontend --service-id <id> --replicas 1
   railway service mcp --service-id <id> --replicas 1
   ```

3. Validar:
   ```bash
   nslookup api.unidatacenter.com.ar 8.8.8.8  # debería volver a Railway
   curl https://api.unidatacenter.com.ar/api/health  # 200 OK
   ```

4. Anuncio: "Rollback ejecutado. App volvió a Railway. Investigando el issue de AWS antes de re-intentar."

5. **Importante**: las escrituras que se hayan hecho en `unidata-prod-db` durante la ventana T+10 → rollback **se pierden** porque Railway está apuntando a Supabase intacto. Por eso elegimos horario de baja actividad.

6. Diagnóstico post-rollback:
   - CloudWatch Logs → backend Fargate → buscar errors
   - Verificar `aws ecs describe-services --cluster unidata-prod --service unidata-prod-backend`
   - Verificar target group health en ALB

7. Re-agendar cutover una vez resuelto.

---

## Post-cutover · Primera semana

Ver [AWS_OPERATIONS.md](AWS_OPERATIONS.md) para el día a día. Lista corta de cosas a vigilar:

- [ ] CloudWatch alarms (CPU/memoria/5xx) sin alerts las primeras 24h
- [ ] Sync de Meta Ads diario corrió OK (8am ART aprox)
- [ ] Auto-cumpleaños 09:00 ART corrió (si hay cumple ese día)
- [ ] MCP de Claude Desktop sigue conectando sin re-auth
- [ ] No hay reports de usuarios de la app inaccesible o lenta
- [ ] Costos AWS los primeros 7 días en línea con estimado ($85-110/mes prorrateado)

Si todo OK al día 7 → ejecutar [Shutdown Railway + Supabase](#shutdown-de-rollback-stack-día-8).

---

## Shutdown de rollback stack (Día 8)

### 1. Confirmar 1 última vez que AWS aguanta tráfico real

```bash
# Acceder a CloudWatch Logs y revisar últimas 24h
aws logs tail /ecs/unidata-prod-backend --since 24h | grep -i error
# Debe haber pocos o ninguno
```

### 2. Apagar Railway

- Railway dashboard → cada service → "Settings" → "Danger Zone" → "Delete service"
- O archivar el proyecto entero: "Settings" → "Archive project"

### 3. Apagar Supabase

- Supabase dashboard → Project Settings → "Pause Project" (gratis y reversible) o "Delete Project"

### 4. Cleanup local

```powershell
# Daniel
Remove-Item .env.railway-*.local
Remove-Item 1PASSWORD_VAULT_STRUCTURE.local.md
Remove-Item MAURO_README.local.md
```

```bash
# Daniel: borrar gist privado
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | awk -F= '/^password=/ {print $2}')
GH_TOKEN="$TOKEN" gh gist delete 358395c29fc20dc452a8fcdb11deb226
```

### 5. Rotar secrets sensibles

Orden de rotación (lista priorizada):

| Secret | Cómo |
|---|---|
| `JWT_SECRET` | Generar `openssl rand -hex 64` → update en Secrets Manager → redeploy → **invalida todas las sesiones** |
| `TOTP_CIPHER_KEY` | Generar nueva Fernet key → script de re-encrypt en DB para users con 2FA habilitado |
| `ML_REFRESH_TOKEN`, `ML_ACCESS_TOKEN` | Re-autorizar en consola Mercado Libre |
| `JIRA_API_TOKEN` | Regenerar en Atlassian → user → Security → API tokens |
| `GEMINI_API_KEY` | Regenerar en Google Cloud Console |
| `META_ACCESS_TOKEN` | Regenerar en Meta for Developers |

---

## Apéndice: comandos útiles del día D

### Status check completo (1 comando)

```bash
echo "=== Backend AWS ==="
curl -s -w "\n%{http_code} | %{time_total}s\n" http://unidata-prod-alb-347153784.us-east-2.elb.amazonaws.com/api/health

echo "=== Backend Railway ==="
curl -s -w "\n%{http_code} | %{time_total}s\n" https://api.unidatacenter.com.ar/api/health

echo "=== DNS resolution ==="
for host in app api unidata-mcp; do
  echo "$host.unidatacenter.com.ar:"
  nslookup $host.unidatacenter.com.ar 8.8.8.8 2>&1 | grep -E "(canonical|Address)" | head -2
done
```

### Trigger redeploy manual (si CI/CD falla)

```bash
aws ecs update-service \
  --cluster unidata-prod \
  --service unidata-prod-backend \
  --force-new-deployment \
  --region us-east-2
```

### Logs en vivo

```bash
aws logs tail /ecs/unidata-prod-backend --follow --region us-east-2
```

### Conectarse al RDS unidata-prod-db (debugging)

```bash
# Vía bastión EC2 (18.226.5.216)
ssh -i unidata-bastion-key.pem -L 5432:unidata-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com:5432 ec2-user@18.226.5.216
# En otra terminal:
psql -h localhost -p 5432 -U unidata -d unidata
```

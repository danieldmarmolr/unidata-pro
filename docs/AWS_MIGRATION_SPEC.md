# Migración UNIDATA Railway → AWS · Plataforma llave en mano por Mauro

> **Cómo usar este documento**: este es un spec exhaustivo y auto-contenido para que Mauro lo abra con su Claude (Code/Desktop) y construya **una plataforma AWS lista para producción que reciba el código de UNIDATA**. La responsabilidad de Mauro es entregar la infra + CI/CD funcionando llave en mano. La responsabilidad de Daniel después del handoff es solo hacer `git push origin main` para deployar.
>
> **Autor**: Daniel Marmol · **Fecha**: 2026-05-22 · **Cuenta AWS target**: `soporte.it.unistore` (043187662940) · región `us-east-2` · ya tiene RDS de UNIDATA prendido.

---

## 1. Resumen ejecutivo

**Lo que Daniel necesita al final:**

> "Hacer `git push origin main` en el repo `unidata-pro` y que el backend, el frontend y el MCP server se deployen automáticamente en AWS, conectados al RDS productivo, con dominios productivos vivos, sin tener que tocar la consola AWS para nada."

**Lo que Mauro debe entregar:**

1. **Infra AWS completa** (IaC versionado): VPC, ECS Fargate cluster, ALB, Amplify, Route53/Cloudflare, ACM, Secrets Manager, IAM, CloudWatch.
2. **Pipeline CI/CD**: GitHub Actions con OIDC. Push a `main` → build → deploy a Fargate y Amplify automático.
3. **Plataforma probada**: un "hello world" o el backend actual deployado y respondiendo en los dominios target.
4. **Documentación operativa**: cómo hacer push, ver logs, rollback, rotar secretos, escalar.
5. **Acceso operativo** a Daniel: IAM role/user para usar la consola + GitHub Actions corriendo con sus credenciales.

**Lo que Daniel hace después del handoff** (no es parte del trabajo de Mauro):

1. Refactor mínimo del backend para conectar directo al RDS (sin SSH tunnel)
2. `git push origin main`
3. Verificar que todo levantó OK
4. Apagar Railway

---

## 2. Contexto del proyecto UNIDATA

### 2.1 Qué es

Plataforma BI interna del grupo Unistore. Centraliza datos de 3 unidades de negocio (Unistore retail, Unidrop dropshipping, Unidev). Usuarios internos del equipo (10-30 personas) acceden via web. Algunos consumen los datos via MCP desde Claude Desktop.

App productiva hoy: `https://app.unidatacenter.com.ar` · API: `https://api.unidatacenter.com.ar` · MCP: `https://mcp-production-b8c5.up.railway.app`

### 2.2 Por qué migrar a AWS

1. **El RDS productivo ya está en AWS** (us-east-2, misma cuenta). Hoy Railway accede via SSH tunnels a 2 bastiones EC2 — quitar eso elimina latencia, código de tunnels y key management.
2. **El stack del equipo IT vive en AWS** (RDS Aurora, Amplify, Route53, EC2, S3, CloudWatch, VPC).
3. **Knowledge transfer**: el equipo IT (Mauro) deja de trabajar en unas semanas. Antes de salir, queremos UNIDATA sobre infra que Daniel pueda operar solo.

### 2.3 Repositorio

- GitHub: `unidata-pro` (privado del equipo)
- Branch productivo: `main`
- 3 servicios en subdirectorios: `backend/`, `frontend/`, `mcp/`
- Daniel le da acceso de read+write a Mauro al inicio del trabajo

---

## 3. Stack actual que tiene que correr en AWS

> Esta sección le da a Mauro **todo lo que necesita saber del código** para diseñar la infra que lo soporta. No requiere que toque el código.

### 3.1 Backend (`backend/`)

| Aspecto | Detalle |
|---|---|
| **Stack** | FastAPI 0.115 · Python 3.12 · uvicorn · SQLAlchemy 2 |
| **Dockerfile** | Existe en `backend/Dockerfile`, single-stage, base `python:3.12-slim`, puerto 8000 |
| **Healthcheck** | `GET /api/health` → `200 {"status":"ok"}` |
| **Puerto** | 8000 (configurable via `PORT` env) |
| **Comando** | `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=*` |
| **CPU/RAM target** | 1 vCPU / 2 GB (2 tasks en prod, autoscale por CPU 70%) |
| **Tráfico** | ~5-10 usuarios concurrentes, picos durante horario laboral AR |

#### Conectividad de datos del backend

El backend habla con 5 sistemas:

1. **RDS `unistore_api`** · `unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com:5432` · vía SSH tunnel hoy
2. **RDS `unidrop_api`** · `unidrop-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com:5432` · vía SSH tunnel hoy
3. **RDS `unidev`** · mismo host que `unistore_api`, distinta DB · vía SSH tunnel hoy
4. **Supabase Cloud** · `DATABASE_URL=postgresql://...supabase.co...` · conexión directa por internet pública. **No migra**.
5. **APIs HTTP externas**: MercadoLibre, TiendaNube, DigiPWMS, Jira, Gemini, Contabilium, Teams webhook. No requieren config de infra especial.

> 🟢 **En AWS la conexión a los 3 RDS debe ser directa (sin SSH tunnel)** porque Fargate va a vivir dentro de la VPC del RDS. Esto requiere un cambio menor en `backend/app/db/engines.py` que Daniel hace post-handoff (ver §5). Mauro **no necesita preocuparse** por ese refactor — solo tiene que asegurar que el Security Group del RDS permita inbound 5432 desde el SG del backend.

#### Env vars del backend

Lista completa que la task definition del backend debe inyectar desde Secrets Manager o como variables directas.

##### Connectivity (lo más importante)

```
# Cada una de las 3 unidades necesita estos 5 valores.
# En AWS: SIN bastion/SSH, conexión directa por VPC.

PROD_DB_HOST_UNISTORE=unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com
PROD_DB_PORT_UNISTORE=5432
PROD_DB_NAME_UNISTORE=unistore_api
PROD_DB_USER_UNISTORE=          # [SECRET] · viene de Daniel
PROD_DB_PASSWORD_UNISTORE=      # [SECRET] · viene de Daniel

PROD_DB_HOST_UNIDROP=unidrop-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com
PROD_DB_PORT_UNIDROP=5432
PROD_DB_NAME_UNIDROP=unidrop_api
PROD_DB_USER_UNIDROP=           # [SECRET]
PROD_DB_PASSWORD_UNIDROP=       # [SECRET]

PROD_DB_HOST_UNIDEV=unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com
PROD_DB_PORT_UNIDEV=5432
PROD_DB_NAME_UNIDEV=unidev
PROD_DB_USER_UNIDEV=            # [SECRET]
PROD_DB_PASSWORD_UNIDEV=        # [SECRET]

# Supabase Cloud (sigue igual, no cambia)
DATABASE_URL=                   # [SECRET] · postgresql connection string
TOTP_CIPHER_KEY=                # [SECRET] · Fernet key 32 bytes base64 para cifrar 2FA TOTP secrets
```

##### Auth + CORS

```
JWT_SECRET=                     # [SECRET] · 64+ chars random
JWT_ALGORITHM=HS256
JWT_EXPIRES_HOURS=12
ALLOWED_ORIGINS=https://app.unidatacenter.com.ar

# Solo para seed inicial si tabla users vacía (no se usa normalmente)
ADMIN_EMAIL=
ADMIN_PASSWORD=                 # [SECRET]
ADMIN_NAME=
```

##### Integraciones externas (APIs HTTP — no requieren config de infra)

```
DIGIP_API_KEY=                  # [SECRET]

ML_APP_ID=                      # [SECRET]
ML_CLIENT_SECRET=               # [SECRET]
ML_REFRESH_TOKEN=               # [SECRET]
ML_ACCESS_TOKEN=                # [SECRET, auto-refresca]
ML_USER_ID=1088266694

TN_UNI_STORE_ID=1771149
TN_UNI_ACCESS_TOKEN=            # [SECRET]

CB_CLIENT_ID=                   # [SECRET]
CB_CLIENT_SECRET=               # [SECRET]

JIRA_BASE_URL=https://unistore-it.atlassian.net
JIRA_EMAIL=                     # [SECRET]
JIRA_API_TOKEN=                 # [SECRET]
GEMINI_API_KEY=                 # [SECRET]
GEMINI_MODEL=gemini-2.5-flash
ITDEV_PROJECT_KEY=ITDEV
SITU_PROJECT_KEY=SITU
ITDEV_BOARD_ID=102
SUBTASK_ISSUE_TYPE=Subtarea
CONFLUENCE_DEFAULT_SPACE=ID
DEFAULT_TRIAGER_ACCOUNT_ID=
DEFAULT_LABEL=
TEAMS_WEBHOOK_URL=              # [SECRET]

UNIDROP_API_URL=https://api.unidrop.com.ar
UNIDROP_API_TOKEN=              # [SECRET]
```

> Los valores `[SECRET]` los pasa Daniel por password manager al kick-off. Mauro los carga en Secrets Manager.

#### Operativas críticas del backend

- ✅ **Stateless**. Sin sessions server-side, JWT puro.
- ✅ **Sin archivos en disco**. PDFs viven como base64 en RDS. **No necesita EFS ni volumen persistente.**
- ✅ **Sin Redis, RabbitMQ, websockets, cron jobs**. Cache `cachetools` in-memory per process (TTL 60-180s) — eventual consistency aceptable con múltiples tasks.
- ✅ **Rate limit** `slowapi` in-memory — eventual consistency aceptable.
- ✅ **Timezone**: forzado a `America/Argentina/Buenos_Aires` en conexión Postgres (manejado por el código, no requiere config de infra).

---

### 3.2 Frontend (`frontend/`)

| Aspecto | Detalle |
|---|---|
| **Stack** | Next.js 16 · React 19 · Tailwind 4 · Recharts · TanStack Query 5 · Zustand |
| **Dockerfile** | Existe en `frontend/Dockerfile`, multi-stage `node:20-alpine`, puerto 3000 |
| **Healthcheck** | `GET /` → 200 HTML |
| **Build** | `npm ci --legacy-peer-deps && npm run build && npm run start` |
| **Env vars** | Solo una: `NEXT_PUBLIC_API_URL=https://api.unidatacenter.com.ar` |

#### Gotcha importante

**`NEXT_PUBLIC_API_URL` se interpola en build-time** y queda bakeado en los archivos `.js` generados. Si cambia la URL del backend, hay que rebuildear el frontend completo.

> **Plan**: setear `NEXT_PUBLIC_API_URL=https://api.unidatacenter.com.ar` desde el primer build. Como ese dominio existe ya y solo cambia de origin (Railway → AWS), no hay rebuild adicional.

#### Recomendación de Daniel para hosting

**AWS Amplify Hosting** porque:

- Soporte nativo de Next.js 16 SSR
- Deploy desde GitHub one-command (push a `main` → deploy automático)
- Preview branches automáticos por PR
- Certs + CDN incluidos sin config extra
- El equipo IT ya lo usa (visible en "Recently visited" de la consola)
- Más simple que ECS + ALB + CloudFront para Next.js

> Mauro puede proponer alternativa si tiene razón fuerte (ej. CloudFront + S3 con Next.js static export, ECS Fargate con sticky sessions, etc.) — pero por defecto, Amplify.

---

### 3.3 MCP Server (`mcp/`)

| Aspecto | Detalle |
|---|---|
| **Stack** | FastMCP Python · Starlette · uvicorn · transport HTTP/SSE |
| **Dockerfile** | Existe en `mcp/Dockerfile`, base `python:3.12-slim`, puerto 8765 |
| **Healthcheck** | `GET /health` → 200 JSON `{"status":"ok", "transport":"sse"}` |
| **Comando** | `unidata-mcp-http` (entrypoint definido en `pyproject.toml`) |
| **CPU/RAM** | 0.5 vCPU / 1 GB (1 task suficiente) |
| **Endpoints** | `/health`, `/whoami-probe` (debug), `/sse` (transport MCP) |

#### Características CRÍTICAS para infra

1. 🚨 **HTTP/SSE (Server-Sent Events)** — conexiones long-lived. Clientes como Claude Desktop conectan a `GET /sse` y mantienen la conexión abierta 30+ minutos.
2. 🚨 **ALB idle timeout default = 60s** → **rompe SSE**. Hay que setearlo a **4000s mínimo** (idealmente más alto).
3. 🚨 **`Authorization: Bearer <jwt>` header passthrough**. El middleware extrae el JWT del cliente. Si hay CloudFront/WAF intermedio, verificar que no haga stripping del header.
4. ✅ Stateless. Sin storage propio.

#### Env vars del MCP

```
UNIDATA_API_URL=https://api.unidatacenter.com.ar
UNIDATA_TOKEN=                  # [SECRET] · solo fallback, normalmente no se usa porque el JWT viene del cliente
PORT=8765
```

#### Dominio target

- Actual: `mcp-production-b8c5.up.railway.app` (URL de Railway, va a desaparecer)
- Target: **`mcp.unidatacenter.com.ar`** (nuevo subdominio, Mauro lo crea)

---

## 4. Lo que Mauro debe construir (entregables completos)

> Esta es la lista de todo lo que Mauro entrega. Cuando termine, Daniel solo debería tener que hacer `git push origin main` para que el sistema funcione.

### 4.1 Infraestructura AWS (en Terraform o CDK)

Repo IaC versionado (puede vivir en `unidata-pro/infra/` o repo separado `unidata-infra`). Todos los recursos con tags:

```
Project=unidata
Environment=prod
Owner=daniel.marmol@unistore.ar
ManagedBy=terraform
```

Y naming convention obligatorio: `unidata-prod-<resource>`.

#### Networking

- VPC (puede reutilizar la existente si Mauro confirma que encaja) con:
  - 2 subnets públicas (para ALB) en 2 AZs
  - 2 subnets privadas (para Fargate) en 2 AZs
  - NAT Gateway (1 es suficiente para empezar) o VPC endpoints (Mauro decide)
  - Internet Gateway
- Security Groups:
  - `unidata-prod-alb-sg`: inbound 443 (y 80 para redirect) desde internet
  - `unidata-prod-backend-sg`: inbound 8000 desde `unidata-prod-alb-sg`
  - `unidata-prod-mcp-sg`: inbound 8765 desde `unidata-prod-alb-sg`
  - **Regla nueva en el SG del RDS existente**: allow 5432 desde `unidata-prod-backend-sg`

#### Compute

- **ECS Fargate cluster**: `unidata-prod`
- **ECS service `unidata-prod-backend`**:
  - Task definition: 1 vCPU / 2 GB / contenedor del ECR `unidata-prod-backend`
  - Desired count: 2 (autoscale 2→6 según CPU 70%)
  - Subnets privadas, SG `unidata-prod-backend-sg`
  - Target group con healthcheck `/api/health`
  - Task execution role con permisos para pull ECR + Secrets Manager + CloudWatch Logs
  - Task role mínimo
  - Env vars del §3.1 inyectadas desde Secrets Manager
- **ECS service `unidata-prod-mcp`**:
  - Task definition: 0.5 vCPU / 1 GB / contenedor del ECR `unidata-prod-mcp`
  - Desired count: 1
  - Subnets privadas, SG `unidata-prod-mcp-sg`
  - Target group con healthcheck `/health`
  - Mismo patrón de roles

#### Load balancer

- **ALB compartido `unidata-prod-alb`** en subnets públicas:
  - Listener HTTPS 443 con cert ACM `*.unidatacenter.com.ar`
  - Listener HTTP 80 → redirect 443
  - **Idle timeout: 4000s** (crítico para SSE del MCP)
  - Listener rules por host header:
    - `api.unidatacenter.com.ar` → target group backend
    - `mcp.unidatacenter.com.ar` → target group mcp
  - WAF opcional (Mauro decide)

#### Frontend hosting

- **AWS Amplify app `unidata-prod-frontend`**:
  - Conectada al repo `unidata-pro` branch `main`
  - Root directory: `frontend/`
  - Build settings: `npm ci --legacy-peer-deps && npm run build`
  - Env var: `NEXT_PUBLIC_API_URL=https://api.unidatacenter.com.ar`
  - Custom domain: `app.unidatacenter.com.ar` con cert ACM
  - Auto-deploy on push a `main`

#### DNS y certificados

- **ACM cert wildcard** `*.unidatacenter.com.ar` (validation via DNS — Daniel hace los CNAMEs en Cloudflare)
- **Records DNS** (Mauro propone, Daniel los crea en Cloudflare):
  - `app.unidatacenter.com.ar` → Amplify custom domain
  - `api.unidatacenter.com.ar` → ALB DNS (CNAME o ALIAS via Cloudflare proxy)
  - `mcp.unidatacenter.com.ar` → ALB DNS (CNAME)

> El cutover de DNS lo hace Daniel cuando todo esté validado (ver §6).

#### Secrets y configuración

- **AWS Secrets Manager**: una secret por variable sensible del §3.1
  - Naming: `unidata-prod/<service>/<key>` (ej. `unidata-prod/backend/jwt-secret`)
  - Task definition refiere a los secrets via `secrets:` array
  - Rotación deshabilitada (manual por ahora)

#### Container registries

- **ECR repos**:
  - `unidata-prod-backend`
  - `unidata-prod-mcp`
- Lifecycle policy: mantener últimas 10 images, expirar el resto

#### Observabilidad

- **CloudWatch Log Groups**:
  - `/ecs/unidata-prod-backend` (retention 30d)
  - `/ecs/unidata-prod-mcp` (retention 30d)
- **CloudWatch Alarms**:
  - 5xx > 1% en backend ALB target group
  - CPU > 80% en cualquier service
  - Memory > 80% en cualquier service
  - Task count drops below desired
- Notificaciones a SNS topic → email `daniel.marmol@unistore.ar`

#### IAM y acceso

- **IAM role para GitHub Actions** con OIDC trust (sin access keys):
  - Permisos: push a ECR, update service ECS, invalidate Amplify cache
  - Trust policy con `repo:unidata-pro:ref:refs/heads/main`
- **IAM role/user para Daniel** con permisos:
  - Read/write a ECS services UNIDATA
  - Read/write a Secrets Manager `unidata-prod/*`
  - Read CloudWatch Logs
  - Read Amplify
  - Read ECR
  - Sin permisos para tocar recursos de otros proyectos del equipo

#### Budgets

- **AWS Budget** alerta a USD 200/mes via SNS → email Daniel

---

### 4.2 Pipeline CI/CD (GitHub Actions)

Mauro escribe los workflows en `.github/workflows/` del repo `unidata-pro`:

#### `deploy-backend.yml`

Trigger: push a `main` con cambios en `backend/**`

Steps:
1. Configure AWS credentials via OIDC
2. Login to ECR
3. Build Docker image: `docker build -t $ECR_URI:$SHA backend/`
4. Push: `docker push $ECR_URI:$SHA`
5. Update task definition con la nueva image
6. `aws ecs update-service --cluster unidata-prod --service unidata-prod-backend --force-new-deployment`
7. Wait for deployment to stabilize (timeout 10 min)
8. Si falla, notificar (Teams webhook o issue)

#### `deploy-mcp.yml`

Idéntico patrón para MCP con cambios en `mcp/**`.

#### Frontend (Amplify)

Amplify maneja el CI/CD nativo desde GitHub — no requiere workflow custom. Solo configurar el webhook en Amplify para que escuche pushes a `main` con cambios en `frontend/**`.

#### Workflow de rollback (`rollback.yml`)

Trigger manual (workflow_dispatch) con input `service` (backend/mcp) y `image_tag`.

Steps:
1. Update task definition con la image tag indicada
2. Force new deployment
3. Wait stable

---

### 4.3 Documentación operativa (en `unidata-pro/docs/`)

Mauro entrega estos documentos. Daniel debe poder operar el sistema leyéndolos.

#### `docs/AWS_ARCHITECTURE.md`

- Diagrama de arquitectura (mermaid o draw.io)
- Lista de todos los recursos creados con su propósito
- Naming conventions usadas
- Decisiones arquitectónicas clave (por qué Fargate, por qué Amplify, etc.)

#### `docs/AWS_DEPLOY.md`

- Cómo deployar manualmente (sin push a main)
- Cómo ver logs de cada service:
  ```bash
  aws logs tail /ecs/unidata-prod-backend --follow --region us-east-2
  ```
- Cómo conectarse al backend running (ECS Exec):
  ```bash
  aws ecs execute-command --cluster unidata-prod --task <task-id> --container backend --interactive --command "/bin/bash"
  ```
- Cómo escalar desired count (UI + CLI)
- Cómo cambiar vCPU/RAM (editar task definition)

#### `docs/AWS_SECRETS.md`

- Lista de secrets en Secrets Manager
- Cómo rotar un secret y propagarlo al service
- Cómo agregar un secret nuevo (terraform + redeploy)

#### `docs/AWS_ROLLBACK.md`

- Cómo identificar la image tag de la versión anterior
- Cómo correr el workflow `rollback.yml`
- Cómo verificar que rollback funcionó

#### `docs/AWS_ACCESS.md`

- Cómo loguearse Daniel con su IAM user
- Permissions que tiene
- Cómo dar acceso a otro developer en el futuro

#### `docs/AWS_COSTS.md`

- Breakdown de costos estimados mensuales por recurso
- Cómo ver costos reales en Cost Explorer
- Comparativo Railway vs AWS

#### `docs/AWS_DECOMMISSION_RAILWAY.md`

- Pasos para apagar Railway una vez que AWS esté estable 7 días
- Qué env vars borrar / archivar
- Qué dominios revisar

---

### 4.4 Smoke test funcional pre-handoff

Antes de pasarle el control a Daniel, Mauro debe demostrar que la plataforma funciona deployando una versión del backend. Hay 2 opciones:

#### Opción A — Mauro deploya el código actual

Mauro buildea la imagen del backend con el código tal como está (incluye SSH tunnel) y la deploya. Como el código actual intenta abrir SSH tunnels, va a fallar al conectar a RDS. Pero **el resto de la infra debe funcionar**:

- ✅ ECS task arranca (puede fallar healthcheck, esperable)
- ✅ Logs aparecen en CloudWatch con el error de SSH
- ✅ ALB rutea el request
- ✅ Secrets Manager inyecta env vars correctamente
- ✅ Amplify deploya el frontend exitosamente
- ✅ MCP server arranca y responde `/health`
- ✅ Healthcheck del MCP pasa

#### Opción B — Mauro deploya un "hello world" trivial

Mauro reemplaza temporalmente el `Dockerfile` del backend con uno trivial que solo expone `/api/health` retornando 200. Valida toda la infra sin depender del código real.

**Daniel recomienda Opción A**: deploya el código actual, muestra que falla la conexión a RDS (esperable), y eso ya es la señal de que el setup está listo para recibir el refactor de Daniel.

---

### 4.5 Sesión de handoff (1 hora)

Mauro reserva 1 hora con Daniel donde:

1. Daniel se loguea con su IAM user y navega por la consola viendo:
   - El cluster ECS y los 2 services
   - Las tasks running
   - El ALB y sus listener rules
   - La Amplify app
   - Los secrets en Secrets Manager (sin ver valores)
   - Los log groups
   - Las alarmas configuradas
2. Daniel hace un push de prueba (cambio trivial en `backend/`) → ve la pipeline correr en GitHub Actions → ve el deployment en ECS
3. Daniel ejecuta un rollback manual al ejecutar `rollback.yml` con la image tag anterior
4. Daniel rota un secret (cambia el valor en Secrets Manager + force-new-deployment) y verifica que se aplica
5. Daniel abre un log con `aws logs tail` y ve los logs reales
6. Mauro responde dudas

Después de esta sesión, **Daniel queda operando solo**.

---

## 5. Lo que Daniel hace después del handoff

> Esto NO es responsabilidad de Mauro. Es solo para contexto: explica qué pasos quedan post-entrega de la plataforma.

### 5.1 Refactor de código (1-2 horas)

Daniel edita en branch `feat/aws-migration`:

#### `backend/app/db/engines.py`

Elimina las 100+ líneas de SSH tunnel. Cambia el connection string:

```python
# ANTES
url = f"postgresql+psycopg2://{cfg.db_user}:{cfg.db_password}@127.0.0.1:{cfg.local_port}/{cfg.db_name}"

# DESPUÉS
url = f"postgresql+psycopg2://{cfg.db_user}:{cfg.db_password}@{cfg.db_host}:{cfg.db_port}/{cfg.db_name}"
```

Elimina: `_TUNNELS`, `_open_tunnel`, `_tunnel_alive`, `_close_tunnel_silent`, `SSHTunnelForwarder`, `atexit.register`.

#### `backend/requirements.txt`

Quita `sshtunnel>=0.4` y `paramiko>=3.4,<4`.

#### `backend/Dockerfile`

Quita `RUN apt-get install -y openssh-client`.

#### `backend/entrypoint.sh`

Eliminar el archivo o reemplazarlo por uno trivial que solo arranque uvicorn.

### 5.2 Push y deploy

```bash
git checkout feat/aws-migration
git push origin feat/aws-migration
# PR review + merge a main
# Pipeline de Mauro deploya automáticamente
```

### 5.3 Validación

Daniel corre los smoke tests del §6 y, si pasan, espera 7 días monitoreando.

### 5.4 Decommission Railway

Después de 7 días estables:
- Sigue el doc `docs/AWS_DECOMMISSION_RAILWAY.md`
- Apaga los 3 services en Railway
- Cancela el plan paid

### 5.5 Decommission bastiones EC2 (opcional)

Después de 30 días estables sin necesidad de rollback:
- Daniel + Mauro deciden si decomisionar los 2 bastiones EC2 (`3.139.209.227`, `18.191.119.38`)
- Si no se usan para otros proyectos del equipo → apagar
- Si se usan → dejarlos

---

## 6. Acceptance criteria — cómo validamos que Mauro terminó

Mauro considera su trabajo terminado cuando **todos** estos puntos pasan. Daniel los valida en la sesión de handoff.

### 6.1 Infra desplegada y visible

- ✅ Todos los recursos del §4.1 existen y están en estado healthy
- ✅ Todos los recursos tienen los tags obligatorios
- ✅ Naming convention `unidata-prod-*` aplicada consistentemente
- ✅ IaC versionado en GitHub, `terraform plan` no muestra drift
- ✅ Daniel puede ver todos los recursos con su IAM user (sin permisos elevados)

### 6.2 CI/CD funcionando

- ✅ Push a `main` con cambio trivial en `backend/` dispara workflow → buildea image → push ECR → update service → task nueva running en < 10 min
- ✅ Mismo flow para `mcp/`
- ✅ Push a `main` con cambio en `frontend/` deploya Amplify automáticamente
- ✅ Workflow `rollback.yml` ejecuta exitosamente con image tag previa

### 6.3 Smoke test funcional pre-refactor (Opción A del §4.4)

Con el código actual (con SSH tunnel) deployado:

- ✅ `GET https://api.unidatacenter.com.ar/api/health` → 200 (sí, esto debería funcionar porque healthcheck no toca DB)
- ✅ `GET https://app.unidatacenter.com.ar/` → 200 + HTML del login
- ✅ `GET https://mcp.unidatacenter.com.ar/health` → 200
- ✅ Endpoints que tocan RDS fallan con error de conexión (esperable — el código todavía intenta SSH tunnel)
- ✅ Los errores aparecen en CloudWatch Logs

> Esto valida que toda la infra está OK. El último paso (que los endpoints con DB funcionen) lo prueba Daniel post-refactor.

### 6.4 Operacionales

- ✅ Daniel puede correr `aws logs tail` y ve logs en vivo
- ✅ Daniel puede conectarse via `ecs execute-command` a una task
- ✅ Daniel puede rotar un secret y propagarlo
- ✅ Alarmas CloudWatch están armadas y disparan emails de prueba
- ✅ AWS Budget alert configurada y mandó email de bienvenida

### 6.5 Documentación

- ✅ Los 7 documentos del §4.3 existen en `docs/`
- ✅ Daniel los leyó y dice "puedo operar esto solo"

### 6.6 Costos

- ✅ Costo total estimado por Mauro: **USD 90-130/mes**
- ✅ Si supera 150 antes del primer mes, Mauro investiga y ajusta

---

## 7. Decisiones que Mauro debe tomar y reportar

Estas son las que Mauro decide en el kick-off (con su Claude o solo) y reporta a Daniel. No requieren discusión profunda — son del dominio de Mauro como experto AWS.

| Decisión | Recomendación de Daniel | Mauro decide |
|---|---|---|
| IaC: Terraform vs CDK | Terraform (más portable) | ¿? |
| Cuenta dedicada via Organizations o misma cuenta `soporte.it.unistore`? | Misma cuenta con naming `unidata-prod-*` | ✅ ya decidido |
| ECS Fargate vs App Runner para backend | ECS Fargate (SSE en MCP requiere control de timeout) | ¿? |
| 1 ALB compartido vs 2 ALBs (uno por service) | 1 ALB compartido con host-based routing | ¿? |
| Amplify vs CloudFront+S3 vs ECS para frontend | Amplify (SSR nativo + equipo ya lo usa) | ¿? |
| DNS: Route53 vs mantener Cloudflare | Mantener Cloudflare apuntando a ALB/Amplify | ¿? |
| Estrategia cutover: blue-green vs DNS swap | DNS swap con TTL bajado a 60s una semana antes | ¿? |
| NAT Gateway vs VPC endpoints (cost optimization) | NAT Gateway inicial, VPC endpoints fase 2 si la cuenta duele | ¿? |
| ElastiCache (Redis) para cache distribuido? | NO, in-memory aceptable | ¿? |
| WAF en frente del ALB? | Opcional, decisión de Mauro | ¿? |
| Auto-scaling rules detallados | CPU 70% target, min 2 max 6 para backend | ¿? |

---

## 8. Información sensible que Daniel pasa a Mauro

Daniel pasa esto **vía password manager compartido (Bitwarden/1Password)**, NUNCA por chat/email/Slack:

- `JWT_SECRET` actual de Railway
- `TOTP_CIPHER_KEY` actual
- `DATABASE_URL` (Supabase)
- 3 pares de `PROD_DB_USER_*` + `PROD_DB_PASSWORD_*` (unistore, unidrop, unidev)
- Todos los `[SECRET]` listados en §3.1 (API keys de MELI, TN, DigiP, Jira, Gemini, Contabilium, Teams, Unidrop)

Mauro los carga en Secrets Manager. Una vez ahí, Daniel los rota inmediatamente y deja Secrets Manager como single source of truth.

---

## 9. Timeline propuesto

| Fase | Duración | Owner | Output |
|---|---|---|---|
| **0. Kick-off** | 1.5h | Mauro + Daniel | Mauro lee este spec con su Claude, alinea las decisiones del §7 con Daniel. |
| **1. Mauro construye infra** | 3-5 días | Mauro | IaC + recursos creados + smoke test infra (§4.4) pasa. |
| **2. Mauro escribe CI/CD + docs** | 1-2 días | Mauro | Workflows GitHub Actions funcionando + 7 docs en `docs/`. |
| **3. Handoff** | 1h | Mauro + Daniel | Daniel queda operando solo (§4.5). |
| **4. Daniel refactor** | 1-2h | Daniel | Code refactor + push (§5.1-5.2). |
| **5. Validation** | 1h | Daniel | Smoke tests post-refactor del §6.3 (versión completa con RDS). |
| **6. Estabilización** | 7 días | Daniel | Monitor de alarmas + logs. |
| **7. Decommission Railway** | 30 min | Daniel | Railway apagado. Migración cerrada. |

**Total estimado**: 1.5-2 semanas calendario.

---

## 10. Apéndices

### Apéndice A — Endpoints RDS confirmados

```
Engine: PostgreSQL (vanilla, no Aurora)
Region: us-east-2
Cuenta: soporte.it.unistore (043187662940)

Host 1: unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com:5432
  - DB: unistore_api  (schemas: tienda_nube, meli, digip, contabilium, public)
  - DB: unidev        (mismo host, otra DB)

Host 2: unidrop-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com:5432
  - DB: unidrop_api   (schemas: public, mercado_libre_dev, contabilium_dev, digip_dev, cresium)
```

> Daniel: confirmar con Mauro si están en la misma VPC y si ambos hosts son alcanzables desde un Fargate task en la misma VPC.

### Apéndice B — Estructura de dominios

```
Actual:
  app.unidatacenter.com.ar               → Railway frontend
  api.unidatacenter.com.ar               → Railway backend
  mcp-production-b8c5.up.railway.app     → Railway MCP

Target:
  app.unidatacenter.com.ar               → AWS Amplify
  api.unidatacenter.com.ar               → ALB (host header → backend TG)
  mcp.unidatacenter.com.ar               → ALB (host header → mcp TG)  ← NUEVO subdominio

DNS: Cloudflare (mantener), apunta a ALB/Amplify
Certs: ACM wildcard *.unidatacenter.com.ar
```

### Apéndice C — Gotchas y consideraciones

1. **`NEXT_PUBLIC_API_URL` se bakea en build-time del frontend**. Cambiar la URL requiere rebuild. Usar dominio final desde el inicio (`https://api.unidatacenter.com.ar`).
2. **MCP SSE requiere ALB idle timeout ≥ 4000s**. Default 60s lo rompe.
3. **Pool size del backend × tasks**: 15 + 10 overflow × 2 tasks = 50 conexiones potenciales al RDS. Verificar capacity del RDS.
4. **CORS regex** en `backend/app/main.py:104-110` bloquea dominios "ajenos" — confirmar que el dominio final pasa el regex.
5. **Timezone**: backend fuerza `America/Argentina/Buenos_Aires` en cada conexión Postgres (manejado por código, no infra).
6. **2FA TOTP**: necesita `TOTP_CIPHER_KEY` para descifrar secrets. Si falta, los 2FA dejan de funcionar para users ya enrolados.
7. **JWT secret**: si cambia entre Railway y AWS, los tokens emitidos por Railway dejan de ser válidos. **Usar el mismo `JWT_SECRET`** que tiene Railway hoy para evitar logout masivo.
8. **MCP tokens (90d)**: se firman con el mismo `JWT_SECRET`. Mismo punto que arriba.

### Apéndice D — Servicios AWS que el equipo IT ya usa

Visible en consola "Recently visited" de `soporte.it.unistore`:

- EC2 (bastiones existentes + posiblemente otros)
- RDS PostgreSQL + Aurora
- AWS Amplify Hosting
- Route 53
- S3
- Neptune (otro proyecto del equipo)
- VPC
- CloudWatch
- Billing and Cost Management
- IAM, CloudShell, Support

Esto le da a Mauro libertad para usar patterns familiares del equipo.

### Apéndice E — Cómo usar este spec con tu Claude (instrucciones para Mauro)

1. **Abrí este documento entero** en el contexto de tu Claude (Code o Desktop).
2. **Decile**: *"Soy Mauro, experto AWS del equipo IT de Unistore. Daniel me pidió que arme esta plataforma para que él pueda deployar UNIDATA por push a `main`. Tengo acceso de admin a la cuenta `soporte.it.unistore` (043187662940) en us-east-2. Quiero que (a) revises el spec y me digas si tiene huecos, (b) propongas la arquitectura concreta resolviendo las decisiones del §7, (c) me ayudes a escribir el Terraform/CDK desde cero."*
3. Iterá con tu Claude sobre el diseño antes de empezar IaC.
4. Cuando tengas el diseño firme, escribís IaC en paralelo (humano + AI).
5. Para los workflows de GitHub Actions, pedile a tu Claude que use el patrón **OIDC con role assumption** (no access keys hardcoded).
6. Para el smoke test (§4.4 Opción A), buildeá una imagen del backend actual del repo de Daniel — va a fallar al conectar al RDS, lo cual es esperable y la señal de que la infra está OK.
7. Cuando termines, agendá la sesión de handoff (§4.5) con Daniel.

---

**Fin del spec.**

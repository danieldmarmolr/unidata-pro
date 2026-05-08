# UNIDATA — Operations Runbook

Guia de operacion dia-a-dia post-go-live. Para Daniel y para cualquiera que tome
el sistema en el futuro.

---

## URLs y accesos

| Servicio | URL | Notas |
|---|---|---|
| Frontend | https://frontend-production-7d1c.up.railway.app | Cara publica |
| Backend API | https://backend-production-c1ee.up.railway.app | `/api/health` para liveness |
| Railway dashboard | https://railway.com/project/15f3cc5b-e21f-41d4-ba4b-a301e8723b1c | Pro plan |
| Supabase dashboard | https://supabase.com/dashboard/project/pmeuexynoftqyyoeyhyn | Free tier |
| GitHub repo | https://github.com/danieldmarmolr/unidata-pro | `main` branch protegido |

### Credenciales del admin de prueba

| Campo | Valor |
|---|---|
| Email | `admin@unistore.ar` |
| Password | `unidata2026.` |
| Rol | `admin` |

> **Cambiar en el primer login. Esta credencial es solo para bootstrap.**

---

## Tareas frecuentes

### Promover un usuario (cambiar rol)

1. Login como `admin@unistore.ar`.
2. Ir a `/admin/usuarios`.
3. Encontrar al user, click "Editar".
4. Cambiar el rol a `lector` / `analista` / `gerencia` / `admin`.
5. Guardar.

### Desactivar un usuario

Mismo flujo que promover, toggle `is_active` a OFF. El user no podra loguearse pero queda en la DB para auditoria.

### Resetear el password de un user

(MVP V1) Como admin podes editar al user y cambiar el password directo.
(Sprint 2 sumara un boton "Reset password" que limpia el hash y obliga al user a setear de nuevo.)

### Ver el audit log de queries

`/admin/auditoria` o `GET /api/queries/audit/recent?limit=100`.

### Ver logs del backend en vivo

```bash
railway logs --service backend
```

### Ver metrics

Panel de Railway -> service backend -> tab "Metrics".

---

## Mantenimiento mensual

### 1. Verificar backups Supabase

Dashboard Supabase -> Database -> Backups. Confirmar que hay backup diario reciente.

Free tier: 7 dias de retencion. Si UNIDATA crece, considerar Pro Supabase ($25/mes) para 30 dias + Point-in-Time Recovery.

### 2. Rotar `JWT_SECRET`

Cada 6 meses, o despues de cualquier sospecha de leak:

```bash
railway variables set --skip-deploys -s backend "JWT_SECRET=$(openssl rand -hex 64)"
railway redeploy -s backend -y
```

> **Efecto:** invalida todos los JWTs activos. Los users tendran que loguearse de nuevo.

### 3. Verificar uso de Supabase

Dashboard -> Settings -> Usage. Si DB se acerca al 80% de los 500 MB:
- Limpiar `query_runs` viejos (cron mensual recomendado, ver Sprint 2).
- O upgrade a Supabase Pro.

### 4. Verificar uso de Railway

Dashboard -> Workspace -> Usage. Pro tier incluye $20/mes de credit. Si se pasa, costo extra es prorrateo.

---

## Troubleshooting

### Backend `/api/health` da 502

Checklist en orden:

1. `railway status` — el servicio aparece "Failed" o "0/1 running"?
2. `railway logs --service backend --deployment` — ver el ultimo error.
3. Causas comunes:
   - **`KeyError: 'BASTION_HOST_X'`** — falta env var de bastion.
   - **`psycopg2.OperationalError: ... Network is unreachable`** — DATABASE_URL apunta a IPv6, tiene que ser pooler IPv4.
   - **Healthcheck timeout** — extender en `backend/railway.json` (default 300s).

### Login devuelve 401 inesperado

- Verificar que `JWT_SECRET` no haya rotado entre el momento del login y ahora.
- Verificar que el user este `is_active = TRUE` en Supabase.
- Verificar que `password_hash` no sea NULL (si lo es, el user esta en estado "pendiente de password" y debe usar `/set-initial-password`).

### Frontend muestra "Failed to fetch" en login/register

- Verificar `NEXT_PUBLIC_API_URL` esta seteado en Railway frontend service.
- Verificar el bundle JS tiene la URL bakeada:
  ```bash
  curl -s https://frontend-production-7d1c.up.railway.app/_next/static/chunks/<hash>.js | grep -o "https://[^\"' ]*backend[^\"' ]*" | head -3
  ```
- Si la URL es `127.0.0.1:8000`, el `ARG NEXT_PUBLIC_API_URL` del Dockerfile no se inyecto en build. Verificar `frontend/Dockerfile`.
- Verificar CORS:
  ```bash
  curl -sv -X OPTIONS https://backend-production-c1ee.up.railway.app/api/auth/register \
    -H "Origin: https://frontend-production-7d1c.up.railway.app" \
    -H "Access-Control-Request-Method: POST" 2>&1 | grep -i "access-control"
  ```

### Dashboards muestran ceros

Casi siempre es: el SSH tunnel a un bastion no esta abriendo.

1. `railway logs --service backend` — buscar `paramiko` o `sshtunnel` errors.
2. Causa #1: la IP estatica de Railway (`162.220.232.99`) no esta allowlistada en el SG del bastion. Pedir a Mauro que la sume.
3. Causa #2: las SSH keys no se materializaron. Verificar logs `key materialized: /app/keys/...`.
4. Causa #3: el bastion EC2 esta caido. Pingear `3.139.209.227` o `18.191.119.38`.

### Un user no puede loguearse pero existe en `users`

- Login del admin -> `/admin/usuarios` -> ver el user.
- `is_active` debe ser TRUE.
- `password_hash` debe estar seteado (no NULL).
- Si `password_hash` es NULL: el user nunca seteo su password. Pedirle que vaya a `/register` con su mismo email -> el sistema le dira que la cuenta existe -> que pida al admin que le clean el hash y haga "set-initial-password" de nuevo. (Sprint 2 lo automatiza.)

### Quiero borrar todos los users y empezar de cero (test/staging)

```python
import psycopg2
conn = psycopg2.connect("postgresql://...supabase.com:5432/postgres")
cur = conn.cursor()
cur.execute("DELETE FROM users")
conn.commit()
conn.close()
```

Despues, redeploy del backend -> `users_db.init()` corre con tabla vacia -> seedea el admin desde `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars.

---

## Procedimiento de deploy

### Deploy automatico (lo recomendable)

Railway esta conectado a GitHub. Cada push a `main` triggerea auto-deploy de los servicios cuyo path haya cambiado.

```bash
git add <files>
git commit -m "feat(area): descripcion"
git push origin main
# Railway buildea + redeploya solo el servicio afectado
```

### Deploy manual desde local (para testing rapido)

```bash
# Solo backend
railway up ./backend --path-as-root --service backend --detach

# Solo frontend
railway up ./frontend --path-as-root --service frontend --detach
```

### Rollback

Railway dashboard -> service -> Deployments -> elegir deployment anterior -> "Redeploy".

Tiempo: ~30 segundos.

---

## Procedimiento de incident

1. **Detectar:** alerta de Railway, reporte de user, o el propio Daniel notando algo.
2. **Triage:** que servicio? que feature? cuanto tiempo?
3. **Mitigar:** rollback al deployment anterior si fue un deploy reciente.
4. **Diagnosticar:** logs Railway + audit log + metrics.
5. **Fix:** commit con `fix(area): descripcion`.
6. **Postmortem:** sumar al CHANGELOG.md en `### Fixed`.

---

## Contactos

- **Daniel Marmol** — `daniel.marmol@unistore.ar` — owner UNIDATA.
- **Mauro Candia** — data engineer / AWS — gestiona allowlists de bastions y users de Postgres.
- **IT Unistore** — para cuentas Microsoft 365 (SSO Sprint 3+).

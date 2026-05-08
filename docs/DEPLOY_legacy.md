# DEPLOY UNIDATA

Guia paso a paso. ~30 minutos asumiendo que ya tenes cuentas en GitHub, Railway y Vercel.

---

## 0 · Crear repo GitHub

```bash
cd unidata-pro
git init
git branch -M main
git add -A
git commit -m "init unidata pro"
gh repo create unidata-pro --private --source=. --push
```
(o crearlo desde la web y `git remote add origin ...`)

---

## 1 · Backend en Railway

### 1.1 Generar JWT secret
```bash
openssl rand -hex 64
```
copialo, lo pegas como `JWT_SECRET` en Railway.

### 1.2 Codear las SSH keys a base64
```bash
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\.ssh\unistore-bastion-key.pem")) | Set-Clipboard
# Bash
base64 -w0 ~/.ssh/unistore-bastion-key.pem | clip
```
copia los strings — uno por unidad.

### 1.3 Crear servicio en Railway
1. https://railway.app/new → **Deploy from GitHub repo** → eleguir `unidata-pro`
2. Settings → **Root Directory:** `backend`
3. Settings → **Watch Paths:** `backend/**`
4. Volumes → **Add Volume:**
   - Mount path: `/app/data`
   - Size: 1 GB

### 1.4 Variables de entorno (Settings → Variables)
Pega todas estas en Railway:

```
BASTION_HOST_UNISTORE=3.139.209.227
BASTION_PORT_UNISTORE=22
BASTION_USER_UNISTORE=ec2-user
BASTION_KEY_UNISTORE_BASE64=<el base64 de unistore-bastion-key.pem>

PROD_DB_HOST_UNISTORE=unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com
PROD_DB_PORT_UNISTORE=5432
PROD_DB_NAME_UNISTORE=unistore_api
PROD_DB_USER_UNISTORE=<user actual>
PROD_DB_PASSWORD_UNISTORE=<password actual>

LOCAL_PORT_UNISTORE=5433

BASTION_HOST_UNIDROP=18.191.119.38
BASTION_PORT_UNIDROP=22
BASTION_USER_UNIDROP=ec2-user
BASTION_KEY_UNIDROP_BASE64=<el base64 de unidrop-bastion-key.pem>

PROD_DB_HOST_UNIDROP=unidrop-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com
PROD_DB_PORT_UNIDROP=5432
PROD_DB_NAME_UNIDROP=unidrop_api
PROD_DB_USER_UNIDROP=<user actual>
PROD_DB_PASSWORD_UNIDROP=<password actual>

LOCAL_PORT_UNIDROP=5434

ADMIN_EMAIL=daniel.marmol@unistore.ar
ADMIN_PASSWORD=unidata2026.
ADMIN_NAME=Daniel Marmol

JWT_SECRET=<el openssl rand -hex 64>
JWT_ALGORITHM=HS256
JWT_EXPIRES_HOURS=12

# Lo seteamos al final, despues de tener el dominio Vercel
ALLOWED_ORIGINS=https://unidata.vercel.app
```

### 1.5 Generar dominio publico
Settings → Networking → **Generate Domain** → te da algo como
`unidata-api-production.up.railway.app`

### 1.6 Deploy + smoke test
- Esperar el primer build (3-5 min)
- `curl https://<tu-dominio>.up.railway.app/api/health`
- `curl -X POST https://<tu-dominio>.up.railway.app/api/auth/login -H "Content-Type: application/json" -d '{"email":"daniel.marmol@unistore.ar","password":"unidata2026."}'`

### 1.7 Si las queries devuelven 0
Mirar logs: probablemente la AWS Security Group del bastion bloquea la IP saliente
de Railway. Soluciones:
- Agregar la IP de salida de Railway al SG (permanente: poner `0.0.0.0/0` solo
  para puerto 22 si es aceptable, o el rango especifico de Railway).
- Alternativa: poner el bastion en una IP eleastica fija y meter solo esa al SG.

---

## 2 · Frontend en Vercel

### 2.1 Importar proyecto
1. https://vercel.com/new → **Import Git Repository** → eleguir `unidata-pro`
2. **Root Directory:** `frontend`
3. Framework: Next.js (autodetected)

### 2.2 Variables de entorno
- `NEXT_PUBLIC_API_URL` = `https://<tu-dominio-railway>.up.railway.app`

### 2.3 Deploy
Apretar **Deploy**. ~2 min. Te da la URL `https://unidata-XXX.vercel.app`.

### 2.4 Volver a Railway y actualizar CORS
Variable `ALLOWED_ORIGINS` en Railway:
```
ALLOWED_ORIGINS=https://unidata-XXX.vercel.app,https://unidata.vercel.app
```
Railway redeploya automaticamente.

### 2.5 (Opcional) Dominio custom
Vercel → Settings → Domains → Add Domain.

---

## 3 · Smoke test produccion

1. Abrir `https://unidata-XXX.vercel.app`
2. Login con `daniel.marmol@unistore.ar` / `unidata2026.`
3. Ir a Dashboard Gerencial → tienen que aparecer los KPIs reales.
4. Ir a Admin → Usuarios → agregar un usuario de prueba.
5. Loguear con ese usuario nuevo en otra pestaña → tiene que entrar pero sin ver
   "Usuarios" ni "Audit log" en el sidebar.

---

## 4 · Auto-deploy

A partir de aca, **cada push a `main`** dispara:
- Railway: rebuild backend
- Vercel: rebuild frontend

PRs en GitHub generan **preview URLs** automaticas en Vercel.

---

## 5 · Rotacion de credenciales DB (cuando puedas)

Conectarse a las RDS como super-user (ej: `psql` desde el bastion) y:

```sql
-- En Unistore RDS
ALTER USER unistore WITH PASSWORD '<nuevo>';

-- Crear user dedicado read-only
CREATE USER unidata_ro WITH PASSWORD '<nuevo-ro>';
GRANT CONNECT ON DATABASE unistore_api TO unidata_ro;
GRANT USAGE ON SCHEMA tienda_nube, meli, digip, contabilium, public TO unidata_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA tienda_nube, meli, digip, contabilium, public TO unidata_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA tienda_nube, meli, digip, contabilium, public
  GRANT SELECT ON TABLES TO unidata_ro;
```

Idem para Unidrop. Despues actualizar `PROD_DB_USER_*` / `PROD_DB_PASSWORD_*` en
Railway con `unidata_ro` y los nuevos passwords. Railway redeploya solo.

---

## Troubleshooting

### Backend no arranca: `ssh error: SSH session not active`
- Ya tiene auto-recovery: el primer request despues del fallo dispara reconexion.
- Si persiste >1 min: los SG de los bastiones probablemente bloquean Railway.
  Verificar IP saliente con `curl ifconfig.me` desde el container Railway.

### Frontend muestra 0 en todos los KPIs
- F12 → Network → ver si las queries a `/api/dashboards/...` dan 200 con data
  vacia, o si dan 401/CORS.
- Si CORS: verificar `ALLOWED_ORIGINS` en Railway.

### "Token invalido" despues de cambiar `JWT_SECRET`
- Hacer logout y volver a loguear (el token viejo se firmaba con el secret anterior).

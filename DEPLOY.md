# UNIDATA — Guía de Deploy a la nube

Este proyecto tiene **2 servicios** que deployar:

1. **Backend** (FastAPI + SSH tunnels a las 3 BBDD Postgres)
2. **Frontend** (Next.js 16)

Recomendación de plataforma según presupuesto y simplicidad:

| Plataforma | Pros | Contras | Precio aprox. |
|---|---|---|---|
| **Railway** ✅ recomendado | Simple, soporta Dockerfiles, volumen persistente para SQLite, SSH key como env var | Plan gratis limitado | ~$10/mes los 2 servicios |
| Render | Similar a Railway, deploys desde Git automáticos | Cold starts en plan gratis | ~$7/mes c/u |
| Fly.io | Muy rápido, regiones AR | Más manual el setup | Pay-as-you-go (~$5-15) |
| Azure App Service | Si la empresa ya usa Azure | Más caro y complejo | $30+/mes |
| AWS ECS / Fargate | Robusto, control total | Curva de aprendizaje | $20+/mes |

Esta guía cubre **Railway** como path principal porque es el más rápido para shippear.

---

## Pre-requisitos

- [ ] Repo en GitHub (privado idealmente). Si todavía no:
  ```bash
  cd unidata-pro
  git init
  git add .
  git commit -m "Initial commit"
  # Crear repo en github.com (privado) y push
  git remote add origin git@github.com:UNISTORE/unidata-pro.git
  git push -u origin main
  ```
- [ ] Cuenta en https://railway.com (login con GitHub)
- [ ] Las llaves SSH `unistore-bastion-key.pem` y `unidrop-bastion-key.pem` accesibles localmente

---

## 1️⃣ Backend en Railway

### a) Crear servicio

1. Railway → **New Project** → **Deploy from GitHub repo** → seleccionar `unidata-pro`
2. Cuando pregunte el directorio, elegir `backend/` como **Root Directory**
3. Railway detecta el `Dockerfile` automáticamente y empieza a buildear

### b) Variables de entorno

Configurar en Railway → Variables del servicio backend:

```env
# Auth
JWT_SECRET=<generá con: openssl rand -hex 32>
ADMIN_EMAIL=daniel.marmol@unistore.ar
ADMIN_PASSWORD=<password seguro inicial>
ADMIN_NAME=Daniel Marmol

# CORS — el dominio del frontend que vas a usar
ALLOWED_ORIGINS=https://unidata-frontend.up.railway.app

# Bastion Unistore
BASTION_HOST_UNISTORE=3.139.209.227
BASTION_USER_UNISTORE=ec2-user
PROD_DB_HOST_UNISTORE=<host RDS>
PROD_DB_PORT_UNISTORE=5432
PROD_DB_NAME_UNISTORE=<db name>
PROD_DB_USER_UNISTORE=<user>
PROD_DB_PASSWORD_UNISTORE=<password>
LOCAL_PORT_UNISTORE=5433

# Bastion Unidrop
BASTION_HOST_UNIDROP=18.191.119.38
BASTION_USER_UNIDROP=ec2-user
PROD_DB_HOST_UNIDROP=<host RDS>
PROD_DB_PORT_UNIDROP=5432
PROD_DB_NAME_UNIDROP=<db name>
PROD_DB_USER_UNIDROP=<user>
PROD_DB_PASSWORD_UNIDROP=<password>
LOCAL_PORT_UNIDROP=5434

# Bastion Unidev (mismo bastion que Unistore, distinta DB)
PROD_DB_HOST_UNIDEV=<host RDS>
PROD_DB_NAME_UNIDEV=<db name>
PROD_DB_USER_UNIDEV=<user>
PROD_DB_PASSWORD_UNIDEV=<password>
LOCAL_PORT_UNIDEV=5435
```

### c) Llaves SSH como base64

Las llaves no pueden estar en variables de texto comunes (multilínea). Convertilas a base64:

```bash
# Desde tu máquina local
base64 -w 0 ~/.ssh/unistore-bastion-key.pem
# Copiar el output ENTERO (sin saltos de línea) y pegarlo en Railway:
#   BASTION_KEY_UNISTORE_BASE64 = <pega aquí>

base64 -w 0 ~/.ssh/unidrop-bastion-key.pem
#   BASTION_KEY_UNIDROP_BASE64 = <pega aquí>
```

> El `entrypoint.sh` del Dockerfile las decodifica al iniciar y las escribe en `/app/keys/*.pem` con permisos 600.

### d) Volumen persistente

Para que `users.db`, `audit.db` y `costs.db` no se pierdan en cada deploy:

1. Railway → backend service → **Volumes**
2. Crear volumen mounted en `/app/data` (1GB es de sobra)

### e) Configurar IP del bastion

Las security groups de los bastions Unistore/Unidrop solo permiten conexiones SSH desde IPs allowlistadas. Railway tiene IPs estáticas por servicio:

1. Railway → backend service → **Settings** → ver **Static Outbound IP** (feature paga, ~$5/mes adicional)
2. Si no querés pagar la static IP, podés usar **Tailscale** o pedirle al admin de AWS que abra el SG a la IP de salida actual de Railway (que cambia cada tanto)

**Alternativa más barata:** poner el backend en **Fly.io** que sí da IPs estáticas gratis, y dejar el frontend en Railway.

### f) Deploy

Railway autodeployea en cada push a `main`. Verificá:
- Logs muestran `INFO: Uvicorn running on http://0.0.0.0:8000`
- `https://<tu-backend>.up.railway.app/api/health` responde `{"status": "ok"}`

---

## 2️⃣ Frontend en Railway

### a) Crear servicio

1. En el mismo proyecto Railway → **+ New** → **GitHub repo** → mismo `unidata-pro`
2. Root Directory: `frontend/`
3. Detecta el Dockerfile y buildea (toma ~5-8 min la primera vez)

### b) Variable de entorno

```env
NEXT_PUBLIC_API_URL=https://<tu-backend>.up.railway.app
```

> Esa URL la sacás del servicio backend de Railway una vez deployado (Settings → Domains).

### c) Custom domain (opcional)

Railway → frontend → **Settings** → **Domains** → **Custom Domain**: `data.unistore.ar` (o el que prefieras). Apuntar el CNAME desde tu DNS.

---

## 3️⃣ Post-deploy checklist

- [ ] Login funciona con `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- [ ] `/dashboard/home` carga las tiles segmentadas por rol
- [ ] `/api/health` responde 200 en backend
- [ ] El comparador HOY muestra valores reales (no 0)
- [ ] El mapa Argentina renderiza con las 24 provincias
- [ ] Click en un order id linkea a `unistore8.mitiendanube.com/admin/orders/...`
- [ ] Las llaves SSH se materializaron (logs deben decir `key materialized: /app/keys/...`)
- [ ] Crear usuarios desde **Admin > Usuarios** con sus roles correspondientes (gerencia / analista / lector)
- [ ] Cambiar `ADMIN_PASSWORD` después del primer login (Mi cuenta)
- [ ] Verificar TZ: las fechas en cualquier modal deben mostrar AR (UTC-3), no UTC

---

## 4️⃣ Mantenimiento

### Logs
- Railway: tab **Logs** del servicio (stream en vivo)
- Filtrar por `ERROR` o `WARNING` con el buscador

### Roll-back rápido
- Railway → **Deployments** → seleccionar deploy anterior → **Redeploy**

### Restart de servicio
- Railway → **Settings** → **Restart**

### Backup SQLite
Los archivos en `/app/data` (users.db, costs.db) deberían respaldarse periódicamente:

```bash
# Desde Railway CLI (instalá: npm i -g @railway/cli)
railway login
railway link --project <project-id> --service backend
railway run sh -c 'cp /app/data/users.db /app/data/users.backup.db'
railway run sh -c 'cat /app/data/users.db' > local-backup.db
```

### Reload del cache
El backend cachea endpoints por 60s. Si necesitás invalidar inmediatamente:
- Restart del servicio (Settings → Restart)
- O esperar 60s

---

## 5️⃣ Producción endurecida (siguiente fase)

Cuando esté en producción y el equipo lo use:

- [ ] **HTTPS forzado** (Railway lo da automático con su dominio)
- [ ] **Rate limiting** en endpoints sensibles (login, import)
- [ ] **Audit log persistente** (ya está en `audit.db`)
- [ ] **Backup automático** de las SQLite a S3 cada 24h (cron job)
- [ ] **Monitoreo**: Sentry para errores, Better Stack o similar para uptime
- [ ] **Rotar `JWT_SECRET`** si alguna vez se filtra (invalida todos los tokens)
- [ ] **2FA** para roles admin (TOTP)
- [ ] Migrar SSH bastion a **read-only Postgres replica** o connection pooler (PgBouncer) en RDS para no depender del túnel

---

## 🚨 Troubleshooting

**Backend logs muestran `BadHostKeyException`:**
- La llave SSH no está bien base64-encoded. Re-correr `base64 -w 0` (sin wrap)

**`could not connect to server: Connection timed out`:**
- IP de Railway no está allowlistada en el SG del bastion. Comprar Static IP en Railway o cambiar a Fly.io

**Frontend muestra `Network Error` al loguear:**
- `NEXT_PUBLIC_API_URL` mal configurado, o `ALLOWED_ORIGINS` del backend no incluye el dominio del frontend
- Verificar con `curl https://<backend>/api/health` desde tu máquina

**`401 Unauthorized` en endpoints:**
- JWT expirado: re-login. El default es 8h
- `JWT_SECRET` cambió entre deploys: invalida todos los tokens

**Datos en cero (HOY, ventas, etc.):**
- SSH tunnel caído. Backend tiene auto-recovery — esperar 30s y reintentar
- Si persiste: revisar logs por `paramiko.SSHException`

---

## 📞 Soporte

Daniel Marmol · daniel.marmol@unistore.ar

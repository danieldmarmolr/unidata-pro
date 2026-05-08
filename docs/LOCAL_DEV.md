# UNIDATA — Desarrollo local en paralelo a produccion

Setup para correr UNIDATA completo en tu PC, identico a produccion. Util para
probar cambios sin afectar a los usuarios reales, debuggear con breakpoints, o
desarrollar nuevas features.

---

## Prerequisites

- **Python 3.12** instalado (`python --version` -> 3.12.x)
- **Node 20+** (`node --version`)
- **Git** (ya lo tenes)
- Las llaves SSH de los bastions en `~/.ssh/`:
  - `unistore-bastion-key.pem`
  - `unidrop-bastion-key.pem`
- Tu IP de oficina/casa **ya allowlistada en los SG de los bastions** (lo esta porque ya usas DBeaver)

---

## Setup primer vez

### 1. Clonar repo

```bash
cd C:/Users/Daniel\ Marmol/Desktop
git clone https://github.com/danieldmarmolr/unidata-pro.git
cd unidata-pro
```

### 2. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate    # Windows (PowerShell: venv\Scripts\Activate.ps1)
pip install -r requirements.txt
```

Crear `backend/.env` (gitignored):

```env
# Auth
JWT_SECRET=local-dev-secret-not-for-prod
ADMIN_EMAIL=daniel.marmol@unistore.ar
ADMIN_PASSWORD=local2026.
ADMIN_NAME=Daniel Marmol

# CORS para frontend local
ALLOWED_ORIGINS=http://localhost:3000

# Supabase (la misma de prod, lo cual es OK porque solo agrega features)
# OPCIONAL: si queres aislar tu local, crea otro proyecto Supabase y usalo aca.
DATABASE_URL=postgresql://postgres.pmeuexynoftqyyoeyhyn:DkvBp3V1jlzoCwg2@aws-1-us-west-1.pooler.supabase.com:5432/postgres

# Bastion Unistore
BASTION_HOST_UNISTORE=3.139.209.227
BASTION_USER_UNISTORE=ec2-user
BASTION_KEY_PATH_UNISTORE=C:/Users/Daniel Marmol/.ssh/unistore-bastion-key.pem
PROD_DB_HOST_UNISTORE=unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com
PROD_DB_PORT_UNISTORE=5432
PROD_DB_NAME_UNISTORE=unistore_api
PROD_DB_USER_UNISTORE=unistore
PROD_DB_PASSWORD_UNISTORE=UyMLpZzxwfuS
LOCAL_PORT_UNISTORE=5433

# Bastion Unidrop
BASTION_HOST_UNIDROP=18.191.119.38
BASTION_USER_UNIDROP=ec2-user
BASTION_KEY_PATH_UNIDROP=C:/Users/Daniel Marmol/.ssh/unidrop-bastion-key.pem
PROD_DB_HOST_UNIDROP=unidrop-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com
PROD_DB_PORT_UNIDROP=5432
PROD_DB_NAME_UNIDROP=unidrop
PROD_DB_USER_UNIDROP=unidrop
PROD_DB_PASSWORD_UNIDROP=UnidropProd2025!
LOCAL_PORT_UNIDROP=5434

# Bastion Unidev (mismo bastion que Unistore)
BASTION_HOST_UNIDEV=3.139.209.227
BASTION_USER_UNIDEV=ec2-user
BASTION_KEY_PATH_UNIDEV=C:/Users/Daniel Marmol/.ssh/unistore-bastion-key.pem
PROD_DB_HOST_UNIDEV=unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com
PROD_DB_PORT_UNIDEV=5432
PROD_DB_NAME_UNIDEV=unidev
PROD_DB_USER_UNIDEV=unistore
PROD_DB_PASSWORD_UNIDEV=UyMLpZzxwfuS
LOCAL_PORT_UNIDEV=5435
```

### 3. Frontend

```bash
cd ../frontend
npm install --legacy-peer-deps
```

Crear `frontend/.env.local` (gitignored):

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Correr local

### Terminal 1 — Backend

```bash
cd backend
venv\Scripts\activate
uvicorn app.main:app --reload --port 8000
```

Vas a ver:
```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Terminal 2 — Frontend

```bash
cd frontend
npm run dev
```

Vas a ver:
```
Local:        http://localhost:3000
```

### Browser

Abrir http://localhost:3000

Login con tu cuenta normal (la que usas en prod). Es **la misma DB Supabase**, por
lo cual los users, roles y audit logs estan compartidos entre local y prod.

---

## Diferencias clave entre local y prod

| Aspecto | Local | Produccion |
|---|---|---|
| Backend URL | `http://localhost:8000` | `https://backend-production-c1ee.up.railway.app` |
| Frontend URL | `http://localhost:3000` | `https://frontend-production-7d1c.up.railway.app` |
| IP saliente para bastion | Tu IP de oficina/casa | `162.220.232.99` (Railway static) |
| Hot reload | Si (uvicorn `--reload`, Next.js dev) | No |
| Deploy de cambios | Instantaneo al guardar | Requiere `git push` o `railway up` |
| Logs | En terminal local | `railway logs --service ...` |
| Database | Misma Supabase que prod (compartida) | Misma Supabase |

---

## Caveat importante: DB compartida

Por defecto, local apunta a la misma Supabase que produccion. Eso significa:

✅ **Los usuarios que se registran en local tambien aparecen en prod** (y viceversa)
✅ **El audit log de queries que hagas en local queda visible en prod**
⚠️ **Si rompes la tabla `users` o el schema en local, lo rompes en prod**

### Cuando convenga aislar tu local

Si vas a tocar migrations / schemas / hacer testing destructivo, conviene un
**Supabase aparte**:

1. Ir a https://supabase.com/dashboard/org/ryxobynhtbtoimyxebvh
2. Crear segundo proyecto: `unidata-local`
3. Misma region (us-west-1)
4. Copiar nueva connection string al `backend/.env`
5. Tu local ahora usa una DB independiente

---

## Workflow tipico de desarrollo

### Caso A — Bug fix rapido

1. `git pull` para asegurarte de tener lo ultimo de prod.
2. Reproducir el bug en local.
3. Hacer fix, probar local que se resolvio.
4. `git add -A && git commit -m "fix(area): descripcion"`
5. `git push origin main` -> Railway auto-deploya.
6. Verificar en prod (`https://...railway.app`) que el fix funciona.

### Caso B — Feature nueva

1. `git checkout -b feature/nombre-corto` (branch propia)
2. Desarrollar en local con hot reload.
3. Cuando este lista, push a su branch:
   ```bash
   git push origin feature/nombre-corto
   ```
4. (Opcional) abrir Pull Request en GitHub para review.
5. Merge a `main` -> Railway auto-deploya.

### Caso C — Probar algo riesgoso

1. Crear segundo proyecto Supabase (`unidata-local`) y apuntar `.env` ahi.
2. Hacer migration / cambio destructivo en local.
3. Si funciona, replicar en Supabase de prod.
4. Si no funciona, no afecta a nada.

---

## Trucos

### Reset de DB local en 1 segundo

```bash
python -c "
import psycopg2
conn=psycopg2.connect('postgresql://...')
cur=conn.cursor()
cur.execute('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
conn.commit()
"
```

Despues, `uvicorn app.main:app --reload` corre `init()` de cada modulo y
recrea las tablas con seed.

### Ver SQL en vivo de psycopg2

Setear `LOG_SQL=1` en `.env` (no implementado aun, sumar en Sprint 2).

### Frontend con backend de prod

Editar `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=https://backend-production-c1ee.up.railway.app
```

Asi tu frontend local pega contra la API de prod. Util cuando solo queres
debuggear el frontend.

### Backend con datos mock (sin SSH tunnels)

Comentar las vars `BASTION_*` y `PROD_DB_*` del `.env`. El backend arranca
igual, los endpoints de auth/users funcionan, los endpoints de business data
devuelven errores (ok para desarrollar UI sin necesidad de bastion).

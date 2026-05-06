# UNIDATA

> Plataforma de datos del grupo Unistore.
> Centraliza informacion operativa y analitica de Unistore + Unidrop en una unica
> herramienta accesible para los equipos internos.
> *"Convierte datos dispersos en decisiones."*

## Stack

| | |
|---|---|
| Backend | FastAPI 0.136 + SQLAlchemy 2 + psycopg2 + sshtunnel + JWT/bcrypt + SQLite (audit + users) |
| Frontend | Next.js 16 + React 19 + Tailwind 4 + Recharts + TanStack Query |
| Deploy | Backend en Railway · Frontend en Vercel · auto-deploy desde main |

## Estructura

```
unidata-pro/
├── backend/                    FastAPI
│   ├── app/
│   │   ├── api/                routers (auth, admin, sources, queries, dashboards/*)
│   │   ├── auth/               JWT + dependencies
│   │   ├── db/                 engines SQL + users.db
│   │   ├── services/           queries de cada dashboard
│   │   ├── schemas/            Pydantic
│   │   └── main.py
│   ├── Dockerfile
│   ├── entrypoint.sh           materializa SSH keys desde env vars
│   ├── railway.toml
│   ├── requirements.txt
│   └── .env.example
└── frontend/                   Next.js
    ├── app/
    │   ├── login/
    │   └── dashboard/
    │       ├── page.tsx                  # gerencial
    │       ├── ventas/, saas/, logistica/, finanzas/
    │       ├── marketing/, pagos/, envios/
    │       ├── sources/, sql/, audit/
    │       ├── account/                  # cambio password
    │       ├── admin/users/              # gestion usuarios
    │       └── [area]/page.tsx           # placeholder fallback
    ├── components/
    └── lib/
```

## Desarrollo local

### Backend
```
cd backend
python -m venv venv
venv/Scripts/activate          # Windows
pip install -r requirements.txt
cp .env.example .env           # editar valores
uvicorn app.main:app --reload --port 8000
```

### Frontend
```
cd frontend
npm install
cp .env.example .env.local     # NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
npm run dev
```

### Login default
- email: el del .env (`ADMIN_EMAIL`)
- password: el del .env (`ADMIN_PASSWORD`)
- Solo se seedea si la tabla `users` esta vacia.

## Deploy a produccion

Ver [`docs/DEPLOY.md`](./docs/DEPLOY.md).

## Roles

| | dashboards | SQL libre | audit log | gestion users |
|---|---|---|---|---|
| **admin** | si | si | si | si |
| **user**  | si | si | solo el suyo | no |

## Roadmap pendiente

- Rotar credenciales DB (Fase G del plan)
- Crear users PG read-only dedicados
- Sentry + uptime monitoring
- Dominio custom (cuando aplique)

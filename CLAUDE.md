# UNIDATA PRO — Guía para Claude

## Qué es este proyecto
Plataforma BI interna del grupo Unistore. Centraliza datos de 3 unidades de negocio:
- **Unistore** — e-commerce propio (Tienda Nube + Mercado Libre)
- **Unidrop** — dropshipping (dropshippers que operan bajo la marca)
- **Unidev** — desarrollo / operaciones internas

App productiva en `https://app.unidatacenter.com.ar`

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | FastAPI 0.115 · SQLAlchemy 2 · Python 3.12 |
| Base de datos | PostgreSQL en AWS RDS (acceso vía SSH tunnel a bastión EC2) |
| Auth | JWT HS256 · bcrypt · 2FA TOTP (pyotp) |
| Frontend | Next.js 16 · React 19 · Tailwind 4 · Recharts · TanStack Query 5 |
| Estado global | Zustand (period filters, custom range) con localStorage |
| Deploy | Railway (backend + frontend) · Cloudflare DNS |
| DBs locales | SQLite: `users.db` (usuarios) · `audit.db` (queries) · `costs.db` (costos importación) |

---

## Regla crítica — nunca mezclar unidades de negocio

Cada unidad tiene su propio engine SQLAlchemy con SSH tunnel separado:

```python
from app.db.engines import get_engine
eng = get_engine("unistore")   # o "unidrop" o "unidev"
```

**Nunca** consultar datos de Unistore con el engine de Unidrop o viceversa. Esta es la regla más importante del proyecto.

---

## Ground truth por unidad

| Unidad | Fuente principal de ventas/actividad |
|--------|--------------------------------------|
| Unistore | `tienda_nube.Order` + `mercado_libre.Order` |
| Unidrop | `public.PaymentIntent` (Talo) — NO `OrderMercadoLibre` ni `tienda_nube_orders` |
| Unidev | tablas propias |

Los orders de Unidrop se enriquecen desde OML y TN pero **el conteo y GMV salen de PaymentIntent**.

Linkage canónico dropshipper ↔ orden: `order.number LIKE 'DROP-{dni}-%'` (no user_id).

---

## Auth y RBAC

### Roles
```
admin      → acceso total + panel /admin
gerencia   → acceso cross a todas las áreas + dashboard gerencia
user       → acceso a su área asignada
analista   → igual que user (rol semántico)
lector     → igual que user, solo lectura
```

### Áreas (9)
`administracion · compras · finanzas · ventas · logistica · cs · marketing · people · it_data`

### Regla de acceso
- **admin / gerencia** → bypass total de restricciones de área
- **Resto** → solo ven dashboards y endpoints de su área asignada

### Dependency en endpoints
```python
from app.auth.security import current_user
from typing import Annotated
from fastapi import Depends

@router.get("/mi-endpoint")
def mi_endpoint(user: Annotated[dict, Depends(current_user)]):
    # user = {id, email, name, role, is_admin, area_slug, area_id}
    ...
```

Para endpoints con restricción de área usar `require_area()` (en `app/auth/security.py`):
```python
from app.auth.security import current_user, require_area
from fastapi import Depends, HTTPException

@router.get("/ventas/datos")
def ventas_datos(user: Annotated[dict, Depends(current_user)]):
    require_area(user, ["ventas"])  # lanza 403 si no tiene acceso
    ...
```

---

## Estructura de directorios

```
unidata-pro/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth.py           # login, register, 2FA
│   │   │   ├── admin.py          # CRUD usuarios + áreas
│   │   │   ├── notifications.py  # it_alerts CRUD
│   │   │   ├── dashboards/
│   │   │   │   └── routers.py    # todos los endpoints de dashboards (~800 líneas)
│   │   │   └── ...
│   │   ├── auth/
│   │   │   └── security.py       # JWT, current_user, require_area
│   │   ├── db/
│   │   │   ├── engines.py        # SSH tunnels + SQLAlchemy engines
│   │   │   ├── users_db.py       # operaciones sobre users.db
│   │   │   ├── areas_db.py       # áreas + perfil de usuario
│   │   │   ├── notifications_db.py  # it_alerts CRUD
│   │   │   └── local_persistence.py # pool psycopg2 a Supabase
│   │   ├── services/             # lógica de negocio (1 archivo por dominio)
│   │   │   ├── rfm_analytics.py  # RFM segmentación
│   │   │   ├── rfm_flows.py      # RFM flows MoM (Unistore + Unidrop)
│   │   │   ├── dropshippers.py   # vista 360 dropshippers + unified orders
│   │   │   ├── notifications.py  # alertas runtime (no persistidas)
│   │   │   └── ...
│   │   └── main.py               # app FastAPI, routers, cache middleware 180s
│   ├── .env                      # NO commitear
│   ├── .env.example
│   └── Dockerfile
├── frontend/
│   ├── app/
│   │   ├── dashboard/            # 42 rutas de dashboard
│   │   │   ├── page.tsx          # executive dashboard (Gerencia)
│   │   │   ├── rfm/page.tsx      # RFM segmentación
│   │   │   ├── rfm-flows/page.tsx
│   │   │   ├── notificaciones/page.tsx  # bandeja de alertas
│   │   │   └── [area]/page.tsx   # fallback por área
│   │   └── ...
│   ├── components/
│   │   ├── alert-banner.tsx      # banner critico persistente
│   │   ├── alerts-panel.tsx      # card de alertas operativas
│   │   └── sidebar.tsx           # nav con RBAC por área
│   ├── lib/
│   │   ├── api.ts                # fetch wrapper con auto-token + 401 redirect
│   │   ├── store.ts              # Zustand (period filters)
│   │   └── use-unit-from-query.ts  # hook para unit param en URL
│   └── .env.local                # NO commitear
└── docs/
    ├── ARCHITECTURE.md
    ├── LOCAL_DEV.md
    └── DEPLOY.md
```

---

## Patrón para agregar un endpoint de dashboard

```python
# backend/app/api/dashboards/routers.py
@router.get("/mi-feature")
def get_mi_feature(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[str, Query()] = "30d",
    unit: Annotated[Literal["unistore", "unidrop"], Query()] = "unistore",
) -> dict:
    key = f"mi-feature-{unit}-{period}"  # clave de caché 180s
    if unit == "unidrop":
        return mi_service.mi_feature_unidrop(period)
    return mi_service.mi_feature(period)
```

```typescript
// frontend: llamada con TanStack Query
const { data } = useQuery({
  queryKey: ["mi-feature", unit, period],
  queryFn: () => api<MiFeatureResponse>(`/api/dashboards/mi-feature?unit=${unit}&period=${period}`),
  staleTime: 60_000,
})
```

---

## Sistema de notificaciones

Dos sistemas distintos, NO mezclarlos:

1. **`it_alerts`** (tabla Supabase, persistida) — alertas de salud de integraciones y sistema
   - Backend: `app/db/notifications_db.py` + `app/api/notifications.py`
   - Frontend: `alert-banner.tsx` (banner crítico) + `app/dashboard/notificaciones/page.tsx`
   - Se marcan como revisadas con `POST /api/notifications/{id}/resolve`

2. **Runtime alerts** (no persistidas, caché corta) — alertas de negocio calculadas en tiempo real
   - Backend: `app/services/notifications.py`
   - Frontend: `alerts-panel.tsx` en dashboards individuales

---

## Timezone

Forzado globalmente a `America/Argentina/Buenos_Aires`:
- PG connection: `connect_args={"options": "-c timezone=America/Argentina/Buenos_Aires"}`
- Frontend: `fmtArDateTime()` en `lib/utils.ts` con `timeZone: "America/Argentina/Buenos_Aires"` explícito

**Nunca** usar `new Date()` sin timezone explícito en el frontend.

---

## Dev local

```bash
# Backend (terminal 1)
cd backend
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (terminal 2)  
cd frontend
npm install
npm run dev   # puerto 3000
```

**Advertencia:** el backend local usa el mismo Supabase (users/audit) que producción. Si se crean usuarios de test, eliminarlos después.

Los SSH tunnels al RDS se abren automáticamente al iniciar el backend si las variables de entorno están seteadas.

---

## Comandos frecuentes

```bash
# Ver logs backend en Railway
railway logs --service backend

# Rollback
git revert HEAD && git push

# Chequear salud del backend
curl https://app.unidatacenter.com.ar/api/health
```

---

## Roadmap (estado al 2026-05-13)

96% completo. Pendientes:
- **US-608** RBAC enforcement en endpoints API (sidebar ya enforcea, falta backend)
- **US-XXX** Notificaciones — "marcar revisada" en bandeja frontend
- **US-XXX** Apex redirect `unidatacenter.com.ar` → `app.unidatacenter.com.ar` (Cloudflare Redirect Rule)

"""
Areas organizacionales + perfil extendido del usuario.

Modelo:
  areas(id, slug, name, color, description, sort_order)
  users.area_id  (FK -> areas.id, NULL hasta que el user lo elija)
  users.birthday_month / users.birthday_day (cumple sin year obligatorio)
  users.birthday_year                       (opcional)
  users.joined_at        (mes/anio que entro a Unistore)
  users.location_city
  users.interests        (texto libre)
  users.avatar_url
  users.profile_completed (TRUE cuando el user termina el onboarding)

Las 10 areas oficiales se seedean en init() si la tabla esta vacia.
Cada gerente puede ver todas las areas; cada colaborador solo la suya.
"""
from __future__ import annotations

import datetime as dt
import logging
import threading

from app.db.local_persistence import get_conn
from app.utils.tz import today_ar

log = logging.getLogger("unidata.areas")

_LOCK = threading.RLock()
_INITIALIZED = False


# 9 areas operativas. Gerencia NO es un area sino un ROL del usuario
# (role='gerencia' en la tabla users): cualquier user con ese rol ve TODAS
# las areas + el dashboard de Gerencia. El admin lo toggle desde /admin/usuarios.
AREAS_SEED: list[tuple[str, str, str, str]] = [
    # (slug, name, color, description)
    ("administracion",  "Administracion / Contabilidad", "#0ea5e9", "Cobranzas, conciliacion, ERP"),
    ("compras",         "Compras",                 "#10b981", "Adquisicion + importacion"),
    ("finanzas",        "Finanzas",                "#f59e0b", "Cashflow, margen, costos"),
    ("ventas",          "Ventas",                  "#ec4899", "Tienda Nube + Mercado Libre"),
    ("logistica",       "Logistica",               "#06b6d4", "WMS, fulfillment, envios"),
    ("cs",              "Customer Success",        "#a855f7", "Soporte, retencion, devoluciones"),
    ("marketing",       "Marketing",               "#f43f5e", "Campanas, paid, contenido"),
    ("people",          "People",                  "#84cc16", "RRHH, cultura, beneficios"),
    ("it_data",         "IT / Data",               "#6366f1", "Plataformas, datos, automatizaciones"),
]


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS areas (
                    id          BIGSERIAL PRIMARY KEY,
                    slug        TEXT NOT NULL UNIQUE,
                    name        TEXT NOT NULL,
                    color       TEXT NOT NULL DEFAULT '#7a3eae',
                    description TEXT NOT NULL DEFAULT '',
                    sort_order  INT  NOT NULL DEFAULT 0,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            # Extensiones idempotentes de users
            cur.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS area_id BIGINT REFERENCES areas(id) ON DELETE SET NULL')
            cur.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday_month SMALLINT')
            cur.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday_day SMALLINT')
            cur.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday_year SMALLINT')
            cur.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS joined_at DATE')
            cur.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS location_city TEXT')
            cur.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS interests TEXT')
            cur.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT')
            cur.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT FALSE')

            # Migracion: eliminar el area 'gerencia' si existe (paso a ser rol, no area).
            # Antes de borrarla, des-asignamos a quien la tenia.
            cur.execute("UPDATE users SET area_id = NULL WHERE area_id IN (SELECT id FROM areas WHERE slug = 'gerencia')")
            cur.execute("DELETE FROM areas WHERE slug = 'gerencia'")

            # Seed areas si la tabla esta vacia
            cur.execute("SELECT COUNT(*) AS n FROM areas")
            n = cur.fetchone()["n"]
            if n == 0:
                for i, (slug, name, color, desc) in enumerate(AREAS_SEED):
                    cur.execute(
                        "INSERT INTO areas (slug, name, color, description, sort_order) VALUES (%s, %s, %s, %s, %s)",
                        (slug, name, color, desc, i),
                    )
                log.info("areas seedeadas: %d", len(AREAS_SEED))
        _INITIALIZED = True


def list_areas() -> list[dict]:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT id, slug, name, color, description, sort_order FROM areas ORDER BY sort_order")
        return [dict(r) for r in cur.fetchall()]


def get_user_profile(user_id: int) -> dict | None:
    """Profile extendido del user con su area resuelta."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT u.id, u.email, u.name, u.role, u.is_admin, u.is_active,
                   u.area_id, u.birthday_month, u.birthday_day, u.birthday_year,
                   u.joined_at, u.location_city, u.interests, u.avatar_url,
                   u.profile_completed, u.created_at,
                   a.slug AS area_slug, a.name AS area_name, a.color AS area_color
            FROM users u
            LEFT JOIN areas a ON a.id = u.area_id
            WHERE u.id = %s
        """, (user_id,))
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        # Normalizaciones
        if isinstance(d.get("joined_at"), (dt.date, dt.datetime)):
            d["joined_at"] = d["joined_at"].isoformat()[:10]
        if isinstance(d.get("created_at"), dt.datetime):
            d["created_at"] = d["created_at"].isoformat()
        d["is_active"] = bool(d.get("is_active"))
        d["is_admin"] = bool(d.get("is_admin"))
        d["profile_completed"] = bool(d.get("profile_completed"))
        return d


def update_profile(
    user_id: int,
    *,
    area_id: int | None = None,
    birthday_month: int | None = None,
    birthday_day: int | None = None,
    birthday_year: int | None = None,
    joined_at: str | None = None,
    location_city: str | None = None,
    interests: str | None = None,
    avatar_url: str | None = None,
    mark_completed: bool = False,
) -> dict | None:
    init()
    sets: list[str] = []
    params: list = []

    def _add(col: str, val):
        sets.append(f"{col} = %s")
        params.append(val)

    if area_id is not None:
        _add("area_id", int(area_id))
    if birthday_month is not None:
        if not (1 <= int(birthday_month) <= 12):
            raise ValueError("birthday_month debe estar entre 1 y 12")
        _add("birthday_month", int(birthday_month))
    if birthday_day is not None:
        if not (1 <= int(birthday_day) <= 31):
            raise ValueError("birthday_day debe estar entre 1 y 31")
        _add("birthday_day", int(birthday_day))
    if birthday_year is not None:
        # year opcional - puede ser 0 / None / 1900-2030
        if birthday_year and not (1900 <= int(birthday_year) <= dt.datetime.now().year):
            raise ValueError("birthday_year invalido")
        _add("birthday_year", int(birthday_year) if birthday_year else None)
    if joined_at is not None:
        # joined_at puede ser YYYY-MM o YYYY-MM-DD. Si solo mes-ano, asumimos dia 1.
        s = (joined_at or "").strip()
        if s:
            if len(s) == 7:  # YYYY-MM
                s = s + "-01"
            try:
                dt.date.fromisoformat(s)
            except ValueError as e:
                raise ValueError(f"joined_at invalido: {e}") from None
            _add("joined_at", s)
        else:
            _add("joined_at", None)
    if location_city is not None:
        _add("location_city", location_city.strip() or None)
    if interests is not None:
        _add("interests", interests.strip() or None)
    if avatar_url is not None:
        _add("avatar_url", avatar_url.strip() or None)
    if mark_completed:
        _add("profile_completed", True)

    if not sets:
        return get_user_profile(user_id)

    sets.append("updated_at = NOW()")
    params.append(user_id)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"UPDATE users SET {', '.join(sets)} WHERE id = %s",
            params,
        )
    return get_user_profile(user_id)


def stories_for_month(month: int | None = None) -> dict:
    """Devuelve cumples + aniversarios del mes indicado (default: mes actual).
    Para 'cumples hoy' filtramos del set."""
    init()
    today = today_ar()
    target_month = int(month) if month else today.month

    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT u.id, u.name, u.email,
                   u.birthday_day, u.birthday_month, u.birthday_year,
                   u.joined_at,
                   a.slug AS area_slug, a.name AS area_name, a.color AS area_color
            FROM users u
            LEFT JOIN areas a ON a.id = u.area_id
            WHERE u.is_active = TRUE
              AND (
                u.birthday_month = %s
                OR (u.joined_at IS NOT NULL AND EXTRACT(MONTH FROM u.joined_at) = %s)
              )
        """, (target_month, target_month))
        rows = [dict(r) for r in cur.fetchall()]

    cumples_mes: list[dict] = []
    aniversarios_mes: list[dict] = []
    cumples_hoy: list[dict] = []

    for r in rows:
        bm = r.get("birthday_month")
        bd = r.get("birthday_day")
        if bm == target_month and bd:
            age = None
            if r.get("birthday_year"):
                age = today.year - int(r["birthday_year"])
                # ajustar si todavia no cumplio este ano
                if (today.month, today.day) < (target_month, int(bd)):
                    age -= 1
            cumples_mes.append({
                "user_id": r["id"],
                "name": r["name"],
                "day": int(bd),
                "month": int(bm),
                "age_turning": age,
                "area_slug": r.get("area_slug"),
                "area_name": r.get("area_name"),
                "area_color": r.get("area_color") or "#7a3eae",
            })
            if int(bd) == today.day and target_month == today.month:
                cumples_hoy.append(cumples_mes[-1])

        ja = r.get("joined_at")
        if ja:
            # ja es date o str (sale del DB normalizado)
            if isinstance(ja, str):
                try:
                    ja = dt.date.fromisoformat(ja[:10])
                except ValueError:
                    ja = None
            if ja and ja.month == target_month:
                years = today.year - ja.year
                if (today.month, today.day) < (ja.month, ja.day):
                    years -= 1
                if years >= 1:
                    aniversarios_mes.append({
                        "user_id": r["id"],
                        "name": r["name"],
                        "joined_day": ja.day,
                        "joined_month": ja.month,
                        "years": years,
                        "area_slug": r.get("area_slug"),
                        "area_name": r.get("area_name"),
                        "area_color": r.get("area_color") or "#7a3eae",
                    })

    # Orden: cumples por dia ascendente; aniversarios por anos desc
    cumples_mes.sort(key=lambda x: x["day"])
    aniversarios_mes.sort(key=lambda x: (-x["years"], x["joined_day"]))

    return {
        "month": target_month,
        "today": today.isoformat(),
        "cumples_hoy": cumples_hoy,
        "cumples_mes": cumples_mes,
        "aniversarios_mes": aniversarios_mes,
    }

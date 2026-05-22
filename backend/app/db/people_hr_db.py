"""
People HR — modulos de gestion del colaborador.

Tablas:
  people_time_off          -> vacaciones, licencias, home office, viajes work
  people_onboarding_tasks  -> checklist por user nuevo (manager + People dueños)
  people_one_on_ones       -> agendas + notas compartidas manager <-> reporte
  people_pulse_surveys     -> encuestas (pulse semanal, eNPS trimestral, custom)
  people_pulse_responses   -> respuestas (anonimo opcional)
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.people_hr")

_LOCK = threading.RLock()
_INITIALIZED = False


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            # --- time_off
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_time_off (
                    id           BIGSERIAL PRIMARY KEY,
                    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    kind         TEXT NOT NULL CHECK (kind IN ('vacaciones','licencia','home_office','viaje_work','otro')),
                    starts_on    DATE NOT NULL,
                    ends_on      DATE NOT NULL,
                    days_count   INT NOT NULL,
                    reason       TEXT NOT NULL DEFAULT '',
                    status       TEXT NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','approved','rejected','cancelled')),
                    reviewer_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
                    reviewed_at  TIMESTAMPTZ,
                    review_note  TEXT NOT NULL DEFAULT '',
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_time_off_user "
                "ON people_time_off (user_id, starts_on DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_time_off_status "
                "ON people_time_off (status, starts_on)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_time_off_range "
                "ON people_time_off (starts_on, ends_on)"
            )

            # --- onboarding_tasks
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_onboarding_tasks (
                    id           BIGSERIAL PRIMARY KEY,
                    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title        TEXT NOT NULL,
                    description  TEXT NOT NULL DEFAULT '',
                    assignee_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
                    due_date     DATE,
                    sort_order   INT NOT NULL DEFAULT 0,
                    status       TEXT NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','in_progress','done','skipped')),
                    completed_at TIMESTAMPTZ,
                    completed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
                    created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_onb_user "
                "ON people_onboarding_tasks (user_id, sort_order)"
            )

            # --- one_on_ones
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_one_on_ones (
                    id            BIGSERIAL PRIMARY KEY,
                    manager_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    report_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    scheduled_at  TIMESTAMPTZ NOT NULL,
                    completed_at  TIMESTAMPTZ,
                    notes         TEXT NOT NULL DEFAULT '',
                    action_items  TEXT NOT NULL DEFAULT '[]',
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_1on1_pair "
                "ON people_one_on_ones (manager_id, report_id, scheduled_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_1on1_user "
                "ON people_one_on_ones (report_id, scheduled_at DESC)"
            )

            # --- pulse_surveys
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_pulse_surveys (
                    id           BIGSERIAL PRIMARY KEY,
                    kind         TEXT NOT NULL CHECK (kind IN ('pulse','enps','custom')),
                    question     TEXT NOT NULL,
                    scale        TEXT NOT NULL DEFAULT 'nps' CHECK (scale IN ('nps','1-5','1-10','yes_no','options')),
                    options      TEXT NOT NULL DEFAULT '[]',
                    anonymous    BOOLEAN NOT NULL DEFAULT TRUE,
                    starts_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    ends_at      TIMESTAMPTZ,
                    created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    is_active    BOOLEAN NOT NULL DEFAULT TRUE
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_pulse_active "
                "ON people_pulse_surveys (is_active, starts_at DESC)"
            )

            # --- pulse_responses
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_pulse_responses (
                    id          BIGSERIAL PRIMARY KEY,
                    survey_id   BIGINT NOT NULL REFERENCES people_pulse_surveys(id) ON DELETE CASCADE,
                    user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
                    value       INT,
                    text_value  TEXT,
                    comment     TEXT NOT NULL DEFAULT '',
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_pulse_resp_survey "
                "ON people_pulse_responses (survey_id, created_at DESC)"
            )
            # Unique para evitar respuestas duplicadas del mismo user en survey
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_resp_unique "
                "ON people_pulse_responses (survey_id, user_id) WHERE user_id IS NOT NULL"
            )

        _INITIALIZED = True


def _iso(v):
    if v is None: return None
    if isinstance(v, (dt.date, dt.datetime)): return v.isoformat()
    return v


# ============================================================
# Time-off (vacaciones / ausencias)
# ============================================================

VALID_KINDS = {"vacaciones", "licencia", "home_office", "viaje_work", "otro"}


def _business_days(start: dt.date, end: dt.date) -> int:
    """Count business days inclusive (lun-vie)."""
    if end < start: return 0
    n = 0
    cur = start
    while cur <= end:
        if cur.weekday() < 5:
            n += 1
        cur += dt.timedelta(days=1)
    return n


def request_time_off(*, user_id: int, kind: str, starts_on: str, ends_on: str, reason: str = "") -> dict:
    init()
    if kind not in VALID_KINDS:
        raise ValueError(f"kind invalido: {kind}")
    try:
        s = dt.date.fromisoformat(starts_on)
        e = dt.date.fromisoformat(ends_on)
    except ValueError as ex:
        raise ValueError(f"fechas invalidas: {ex}")
    if e < s:
        raise ValueError("ends_on debe ser >= starts_on")
    days = _business_days(s, e)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO people_time_off (user_id, kind, starts_on, ends_on, days_count, reason)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (user_id, kind, s, e, days, reason.strip()),
        )
        row = dict(cur.fetchone())

        # Notif al manager si tiene
        cur.execute("SELECT manager_user_id, name FROM users WHERE id = %s", (user_id,))
        urow = cur.fetchone()
        if urow and urow.get("manager_user_id"):
            preview = f"{urow['name']}: {kind} {s} -> {e} ({days}d)"
            cur.execute(
                """INSERT INTO people_notifications
                   (user_id, kind, actor_user_id, source_kind, source_id, preview, link)
                   VALUES (%s, 'time_off_request', %s, 'time_off', %s, %s, %s)""",
                (urow["manager_user_id"], user_id, row["id"], preview,
                 "/dashboard/people/time-off/approvals"),
            )

    for k in ("starts_on", "ends_on", "created_at", "reviewed_at"):
        row[k] = _iso(row.get(k))
    return row


def list_time_off(*, user_id: int | None = None, status: str | None = None, limit: int = 100) -> list[dict]:
    init()
    sql = """
        SELECT t.*, u.name AS user_name, u.avatar_url AS user_avatar,
               u.area_id, a.color AS area_color, a.name AS area_name,
               r.name AS reviewer_name
          FROM people_time_off t
          JOIN users u ON u.id = t.user_id
          LEFT JOIN areas a ON a.id = u.area_id
          LEFT JOIN users r ON r.id = t.reviewer_id
    """
    where, params = [], []
    if user_id:
        where.append("t.user_id = %s"); params.append(user_id)
    if status:
        where.append("t.status = %s"); params.append(status)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY t.starts_on DESC LIMIT %s"
    params.append(int(limit))
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        for k in ("starts_on", "ends_on", "created_at", "reviewed_at"):
            r[k] = _iso(r.get(k))
    return rows


def pending_for_manager(*, manager_id: int) -> list[dict]:
    """Time-off requests pendientes de aprobacion donde el manager es responsable."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT t.*, u.name AS user_name, u.avatar_url AS user_avatar,
                   a.color AS area_color, a.name AS area_name
              FROM people_time_off t
              JOIN users u ON u.id = t.user_id
              LEFT JOIN areas a ON a.id = u.area_id
             WHERE t.status = 'pending'
               AND u.manager_user_id = %s
             ORDER BY t.starts_on ASC
            """,
            (manager_id,),
        )
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        for k in ("starts_on", "ends_on", "created_at", "reviewed_at"):
            r[k] = _iso(r.get(k))
    return rows


def review_time_off(*, time_off_id: int, reviewer_id: int, new_status: str, note: str = "") -> dict | None:
    init()
    if new_status not in {"approved", "rejected"}:
        raise ValueError("status invalido")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE people_time_off
               SET status = %s, reviewer_id = %s, reviewed_at = NOW(), review_note = %s
             WHERE id = %s AND status = 'pending'
             RETURNING *
            """,
            (new_status, reviewer_id, note.strip(), time_off_id),
        )
        row = cur.fetchone()
        if not row:
            return None
        # Notif al solicitante
        kind_text = "aprobada" if new_status == "approved" else "rechazada"
        preview = f"Tu solicitud de {row['kind']} {row['starts_on']} -> {row['ends_on']} fue {kind_text}"
        cur.execute(
            """INSERT INTO people_notifications
               (user_id, kind, actor_user_id, source_kind, source_id, preview, link)
               VALUES (%s, 'time_off_review', %s, 'time_off', %s, %s, %s)""",
            (row["user_id"], reviewer_id, row["id"], preview, "/dashboard/people/time-off"),
        )
    d = dict(row)
    for k in ("starts_on", "ends_on", "created_at", "reviewed_at"):
        d[k] = _iso(d.get(k))
    return d


def cancel_time_off(*, time_off_id: int, user_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE people_time_off SET status = 'cancelled' "
            "WHERE id = %s AND user_id = %s AND status IN ('pending','approved') "
            "RETURNING *",
            (time_off_id, user_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    for k in ("starts_on", "ends_on", "created_at", "reviewed_at"):
        d[k] = _iso(d.get(k))
    return d


def team_calendar(*, month: int, year: int) -> list[dict]:
    """Time-off aprobado/pendiente que solapa con el mes/year dado."""
    init()
    first = dt.date(year, month, 1)
    if month == 12:
        last = dt.date(year + 1, 1, 1) - dt.timedelta(days=1)
    else:
        last = dt.date(year, month + 1, 1) - dt.timedelta(days=1)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT t.id, t.user_id, t.kind, t.starts_on, t.ends_on, t.status, t.reason,
                   u.name AS user_name, u.avatar_url AS user_avatar,
                   a.color AS area_color, a.name AS area_name
              FROM people_time_off t
              JOIN users u ON u.id = t.user_id
              LEFT JOIN areas a ON a.id = u.area_id
             WHERE t.status IN ('approved','pending')
               AND t.starts_on <= %s
               AND t.ends_on >= %s
             ORDER BY t.starts_on ASC
            """,
            (last, first),
        )
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["starts_on"] = _iso(r.get("starts_on"))
        r["ends_on"] = _iso(r.get("ends_on"))
    return rows


# ============================================================
# Onboarding
# ============================================================

# Template default que se aplica a cada user nuevo (lo puede customizar admin/People)
DEFAULT_ONBOARDING_TEMPLATE = [
    ("Crear cuenta de email corporativa", "Configurar @unistore.ar + acceso a workspace.", 0),
    ("Acceso a Slack/Teams", "Sumar a los canales relevantes de su area", 1),
    ("Tour por el equipo", "Presentar al equipo en feed Random + DM presentacion con cada uno", 2),
    ("Acceso a UNIDATA", "Crear user + asignar area + foto de perfil", 3),
    ("1:1 con manager dia 1", "Bienvenida + expectativas + recursos", 4),
    ("Setup laptop + entregables", "Hardware + accesos a tools especificos del rol", 5),
    ("1:1 dia 7 con manager", "Check-in inicial: dudas, blockers, primeros pasos", 6),
    ("1:1 dia 30 con manager", "Performance review temprano + feedback bidireccional", 7),
]


def create_onboarding_for_user(*, user_id: int, created_by: int, manager_id: int | None = None) -> list[dict]:
    """Idempotente: si ya tiene tasks, no crea nada nuevo."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM people_onboarding_tasks WHERE user_id = %s", (user_id,))
        if cur.fetchone()["n"] > 0:
            return list_onboarding(user_id=user_id)
        # Crear desde template
        for title, desc, order in DEFAULT_ONBOARDING_TEMPLATE:
            cur.execute(
                """INSERT INTO people_onboarding_tasks
                   (user_id, title, description, assignee_id, sort_order, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (user_id, title, desc, manager_id, order, created_by),
            )
    return list_onboarding(user_id=user_id)


def list_onboarding(*, user_id: int) -> list[dict]:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT t.*, a.name AS assignee_name, a.avatar_url AS assignee_avatar
              FROM people_onboarding_tasks t
              LEFT JOIN users a ON a.id = t.assignee_id
             WHERE t.user_id = %s
             ORDER BY t.sort_order, t.id
        """, (user_id,))
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["due_date"] = _iso(r.get("due_date"))
        r["completed_at"] = _iso(r.get("completed_at"))
        r["created_at"] = _iso(r.get("created_at"))
    return rows


def update_onboarding_task(*, task_id: int, **kwargs) -> dict | None:
    init()
    allowed = {"title", "description", "assignee_id", "due_date", "status", "sort_order"}
    sets, params = [], []
    completed_setting = False
    for k, v in kwargs.items():
        if k in allowed and v is not None:
            sets.append(f"{k} = %s")
            params.append(v)
            if k == "status" and v == "done":
                completed_setting = True
    if not sets:
        return None
    if completed_setting:
        sets.append("completed_at = NOW()")
    params.append(task_id)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"UPDATE people_onboarding_tasks SET {', '.join(sets)} WHERE id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
    if not row: return None
    d = dict(row)
    for k in ("due_date", "completed_at", "created_at"):
        d[k] = _iso(d.get(k))
    return d


def add_onboarding_task(*, user_id: int, title: str, description: str = "", assignee_id: int | None = None, due_date: str | None = None, created_by: int) -> dict:
    init()
    if not title.strip(): raise ValueError("title vacio")
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM people_onboarding_tasks WHERE user_id = %s", (user_id,))
        next_order = cur.fetchone()["next"]
        cur.execute(
            """INSERT INTO people_onboarding_tasks
               (user_id, title, description, assignee_id, due_date, sort_order, created_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (user_id, title.strip(), description.strip(), assignee_id, due_date, next_order, created_by),
        )
        row = dict(cur.fetchone())
    for k in ("due_date", "completed_at", "created_at"):
        row[k] = _iso(row.get(k))
    return row


def delete_onboarding_task(*, task_id: int) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("DELETE FROM people_onboarding_tasks WHERE id = %s RETURNING id", (task_id,))
        return cur.fetchone() is not None


# ============================================================
# 1:1s
# ============================================================

def list_one_on_ones(*, viewer_id: int, partner_id: int | None = None, limit: int = 50) -> list[dict]:
    """Lista 1:1s donde el viewer es manager o reporte. Si partner_id viene, filtra al par."""
    init()
    where = "(o.manager_id = %s OR o.report_id = %s)"
    params: list = [viewer_id, viewer_id]
    if partner_id:
        where = "((o.manager_id = %s AND o.report_id = %s) OR (o.manager_id = %s AND o.report_id = %s))"
        params = [viewer_id, partner_id, partner_id, viewer_id]
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"""
            SELECT o.*,
                   m.name AS manager_name, m.avatar_url AS manager_avatar,
                   r.name AS report_name, r.avatar_url AS report_avatar
              FROM people_one_on_ones o
              JOIN users m ON m.id = o.manager_id
              JOIN users r ON r.id = o.report_id
             WHERE {where}
             ORDER BY o.scheduled_at DESC
             LIMIT %s
            """,
            params + [int(limit)],
        )
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["scheduled_at"] = _iso(r.get("scheduled_at"))
        r["completed_at"] = _iso(r.get("completed_at"))
        r["created_at"] = _iso(r.get("created_at"))
        r["updated_at"] = _iso(r.get("updated_at"))
        try:
            r["action_items"] = json.loads(r.get("action_items") or "[]")
        except Exception:
            r["action_items"] = []
    return rows


def create_one_on_one(*, manager_id: int, report_id: int, scheduled_at: str) -> dict:
    init()
    if manager_id == report_id:
        raise ValueError("manager y reporte no pueden ser la misma persona")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """INSERT INTO people_one_on_ones (manager_id, report_id, scheduled_at)
               VALUES (%s, %s, %s) RETURNING *""",
            (manager_id, report_id, scheduled_at),
        )
        row = dict(cur.fetchone())
    row["scheduled_at"] = _iso(row.get("scheduled_at"))
    row["created_at"] = _iso(row.get("created_at"))
    row["action_items"] = []
    return row


def update_one_on_one(*, one_on_one_id: int, viewer_id: int, **kwargs) -> dict | None:
    """Solo manager o reporte pueden editar."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT manager_id, report_id FROM people_one_on_ones WHERE id = %s",
            (one_on_one_id,),
        )
        row = cur.fetchone()
        if not row: return None
        if viewer_id not in (row["manager_id"], row["report_id"]):
            raise PermissionError("no podes editar este 1:1")

        sets, params = [], []
        if "notes" in kwargs and kwargs["notes"] is not None:
            sets.append("notes = %s"); params.append(kwargs["notes"])
        if "action_items" in kwargs and kwargs["action_items"] is not None:
            sets.append("action_items = %s"); params.append(json.dumps(kwargs["action_items"]))
        if "scheduled_at" in kwargs and kwargs["scheduled_at"]:
            sets.append("scheduled_at = %s"); params.append(kwargs["scheduled_at"])
        if "completed" in kwargs and kwargs["completed"]:
            sets.append("completed_at = NOW()")
        if not sets: return None
        sets.append("updated_at = NOW()")
        params.append(one_on_one_id)
        cur.execute(
            f"UPDATE people_one_on_ones SET {', '.join(sets)} WHERE id = %s RETURNING *",
            params,
        )
        updated = dict(cur.fetchone())
    updated["scheduled_at"] = _iso(updated.get("scheduled_at"))
    updated["completed_at"] = _iso(updated.get("completed_at"))
    updated["created_at"] = _iso(updated.get("created_at"))
    updated["updated_at"] = _iso(updated.get("updated_at"))
    try:
        updated["action_items"] = json.loads(updated.get("action_items") or "[]")
    except Exception:
        updated["action_items"] = []
    return updated


# ============================================================
# Pulse surveys (eNPS + custom)
# ============================================================

def create_survey(*, kind: str, question: str, scale: str, options: list[str] | None, anonymous: bool, starts_at: str | None, ends_at: str | None, created_by: int) -> dict:
    init()
    if kind not in {"pulse", "enps", "custom"}:
        raise ValueError("kind invalido")
    if scale not in {"nps", "1-5", "1-10", "yes_no", "options"}:
        raise ValueError("scale invalida")
    if scale == "options" and (not options or len(options) < 2):
        raise ValueError("options requiere al menos 2 opciones")
    opts_json = json.dumps(options or [])
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """INSERT INTO people_pulse_surveys
               (kind, question, scale, options, anonymous, starts_at, ends_at, created_by)
               VALUES (%s, %s, %s, %s, %s, COALESCE(%s, NOW()), %s, %s)
               RETURNING *""",
            (kind, question.strip(), scale, opts_json, anonymous, starts_at, ends_at, created_by),
        )
        row = dict(cur.fetchone())
    row["starts_at"] = _iso(row.get("starts_at"))
    row["ends_at"] = _iso(row.get("ends_at"))
    row["created_at"] = _iso(row.get("created_at"))
    try:
        row["options"] = json.loads(row.get("options") or "[]")
    except Exception:
        row["options"] = []
    return row


def list_active_surveys(*, viewer_id: int) -> list[dict]:
    """Surveys activas + flag de si el viewer ya respondio."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT s.*,
                   EXISTS(SELECT 1 FROM people_pulse_responses r
                          WHERE r.survey_id = s.id AND r.user_id = %s) AS has_responded
              FROM people_pulse_surveys s
             WHERE s.is_active = TRUE
               AND s.starts_at <= NOW()
               AND (s.ends_at IS NULL OR s.ends_at > NOW())
             ORDER BY s.created_at DESC
        """, (viewer_id,))
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["starts_at"] = _iso(r.get("starts_at"))
        r["ends_at"] = _iso(r.get("ends_at"))
        r["created_at"] = _iso(r.get("created_at"))
        try:
            r["options"] = json.loads(r.get("options") or "[]")
        except Exception:
            r["options"] = []
        r["has_responded"] = bool(r.get("has_responded"))
    return rows


def respond_survey(*, survey_id: int, user_id: int, value: int | None = None, text_value: str | None = None, comment: str = "") -> dict:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT anonymous, is_active, ends_at FROM people_pulse_surveys WHERE id = %s",
            (survey_id,),
        )
        survey = cur.fetchone()
        if not survey or not survey["is_active"]:
            raise ValueError("encuesta no activa")
        if survey["ends_at"] and survey["ends_at"] < dt.datetime.now(dt.timezone.utc):
            raise ValueError("encuesta cerrada")
        # Si anonimo, user_id se omite (NULL); si no, valida unique
        stored_uid = None if survey["anonymous"] else user_id
        if stored_uid:
            cur.execute(
                "SELECT 1 FROM people_pulse_responses WHERE survey_id = %s AND user_id = %s",
                (survey_id, stored_uid),
            )
            if cur.fetchone():
                raise ValueError("ya respondiste esta encuesta")
        cur.execute(
            """INSERT INTO people_pulse_responses
               (survey_id, user_id, value, text_value, comment)
               VALUES (%s, %s, %s, %s, %s) RETURNING *""",
            (survey_id, stored_uid, value, text_value, comment.strip()),
        )
        row = dict(cur.fetchone())
    row["created_at"] = _iso(row.get("created_at"))
    return row


def survey_results(*, survey_id: int) -> dict:
    """Aggregate de respuestas: distribucion + average + eNPS si aplica."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM people_pulse_surveys WHERE id = %s", (survey_id,))
        survey = cur.fetchone()
        if not survey:
            return {}
        cur.execute(
            "SELECT value, text_value, comment, user_id FROM people_pulse_responses WHERE survey_id = %s",
            (survey_id,),
        )
        responses = list(cur.fetchall())

    n = len(responses)
    distribution: dict[str, int] = {}
    sum_val = 0
    valid = 0
    for r in responses:
        v = r.get("value")
        if v is not None:
            sum_val += int(v)
            valid += 1
            distribution[str(v)] = distribution.get(str(v), 0) + 1
        if r.get("text_value"):
            distribution[r["text_value"]] = distribution.get(r["text_value"], 0) + 1
    avg = (sum_val / valid) if valid else None

    enps = None
    if survey["scale"] == "nps":
        promoters = sum(1 for r in responses if r.get("value") is not None and r["value"] >= 9)
        passives = sum(1 for r in responses if r.get("value") is not None and 7 <= r["value"] <= 8)
        detractors = sum(1 for r in responses if r.get("value") is not None and r["value"] <= 6)
        if valid:
            enps = round(((promoters - detractors) / valid) * 100, 1)

    comments = [r["comment"] for r in responses if r.get("comment")]
    s = dict(survey)
    s["starts_at"] = _iso(s.get("starts_at"))
    s["ends_at"] = _iso(s.get("ends_at"))
    s["created_at"] = _iso(s.get("created_at"))
    try:
        s["options"] = json.loads(s.get("options") or "[]")
    except Exception:
        s["options"] = []

    return {
        "survey": s,
        "response_count": n,
        "average": avg,
        "distribution": distribution,
        "enps": enps,
        "comments": comments,
    }


def list_all_surveys(*, limit: int = 50) -> list[dict]:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """SELECT s.*,
                      (SELECT COUNT(*) FROM people_pulse_responses r WHERE r.survey_id = s.id) AS response_count
                 FROM people_pulse_surveys s
                ORDER BY s.created_at DESC LIMIT %s""",
            (limit,),
        )
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["starts_at"] = _iso(r.get("starts_at"))
        r["ends_at"] = _iso(r.get("ends_at"))
        r["created_at"] = _iso(r.get("created_at"))
        try:
            r["options"] = json.loads(r.get("options") or "[]")
        except Exception:
            r["options"] = []
    return rows


def close_survey(*, survey_id: int) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE people_pulse_surveys SET is_active = FALSE, ends_at = COALESCE(ends_at, NOW()) "
            "WHERE id = %s RETURNING id",
            (survey_id,),
        )
        return cur.fetchone() is not None

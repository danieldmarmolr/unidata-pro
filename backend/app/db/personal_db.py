"""
Mi gestion personal — archivos del legajo del colaborador.

Tabla unica `people_personal_files` con discriminador `kind`:
  - documento  -> DNI, CV, titulo, certificados, comprobantes (doc_kind libre)
  - recibo     -> recibos de sueldo (period_year + period_month obligatorios)
  - contrato   -> contratos firmados, addendums

Cualquier user puede subir/ver sus propios archivos.
admin / gerencia / People pueden subir/ver/borrar archivos de otros users.
Otros users NUNCA ven archivos de terceros.
"""
from __future__ import annotations

import datetime as dt
import logging
import threading

import psycopg2

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.personal")

_LOCK = threading.RLock()
_INITIALIZED = False

# 10MB max para documentos (mas que las 5MB de imagenes)
MAX_FILE_BYTES = 10 * 1024 * 1024

ALLOWED_MIMES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    # docx (mas comun que doc) y xlsx para casos puntuales
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

VALID_KINDS = {"documento", "recibo", "contrato"}


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_personal_files (
                    id            BIGSERIAL PRIMARY KEY,
                    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    kind          TEXT NOT NULL
                                  CHECK (kind IN ('documento','recibo','contrato')),
                    doc_kind      TEXT NOT NULL DEFAULT '',
                    title         TEXT NOT NULL,
                    period_year   INT,
                    period_month  INT CHECK (period_month BETWEEN 1 AND 12),
                    mime          TEXT NOT NULL,
                    content       BYTEA NOT NULL,
                    size_bytes    INT NOT NULL,
                    filename      TEXT NOT NULL DEFAULT '',
                    notes         TEXT NOT NULL DEFAULT '',
                    uploaded_by   BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_personal_files_user_kind "
                "ON people_personal_files (user_id, kind, created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_personal_files_period "
                "ON people_personal_files (user_id, kind, period_year DESC, period_month DESC) "
                "WHERE kind = 'recibo'"
            )
        _INITIALIZED = True


def _iso(v):
    if v is None:
        return None
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    return v


def _meta_only(row: dict) -> dict:
    """Excluye el binario para responses de listado."""
    keys = (
        "id", "user_id", "kind", "doc_kind", "title", "period_year", "period_month",
        "mime", "size_bytes", "filename", "notes", "uploaded_by", "created_at",
    )
    out = {k: row.get(k) for k in keys}
    out["created_at"] = _iso(out.get("created_at"))
    return out


def save_file(
    *,
    user_id: int,
    kind: str,
    title: str,
    content: bytes,
    mime: str,
    filename: str = "",
    doc_kind: str = "",
    period_year: int | None = None,
    period_month: int | None = None,
    notes: str = "",
    uploaded_by: int,
) -> dict:
    init()
    if kind not in VALID_KINDS:
        raise ValueError(f"kind invalido: {kind}")
    if not title.strip():
        raise ValueError("title vacio")
    if mime not in ALLOWED_MIMES:
        raise ValueError(f"mime no permitido: {mime}")
    if len(content) > MAX_FILE_BYTES:
        raise ValueError(f"archivo muy grande: {len(content)} bytes (max {MAX_FILE_BYTES})")
    if len(content) == 0:
        raise ValueError("archivo vacio")
    if kind == "recibo":
        if not period_year or not period_month:
            raise ValueError("recibos requieren period_year + period_month")

    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO people_personal_files
              (user_id, kind, doc_kind, title, period_year, period_month,
               mime, content, size_bytes, filename, notes, uploaded_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                user_id, kind, doc_kind.strip(), title.strip(),
                period_year, period_month,
                mime, psycopg2.Binary(content), len(content),
                filename.strip(), notes.strip(), uploaded_by,
            ),
        )
        row = dict(cur.fetchone())
    return _meta_only(row)


def list_files(*, user_id: int, kind: str | None = None, limit: int = 200) -> list[dict]:
    init()
    sql = """
        SELECT id, user_id, kind, doc_kind, title, period_year, period_month,
               mime, size_bytes, filename, notes, uploaded_by, created_at
          FROM people_personal_files
         WHERE user_id = %s
    """
    params: list = [user_id]
    if kind:
        if kind not in VALID_KINDS:
            raise ValueError(f"kind invalido: {kind}")
        sql += " AND kind = %s"
        params.append(kind)
    # Recibos: orden por periodo desc; resto: por created_at desc
    if kind == "recibo":
        sql += " ORDER BY period_year DESC NULLS LAST, period_month DESC NULLS LAST, created_at DESC"
    else:
        sql += " ORDER BY created_at DESC"
    sql += " LIMIT %s"
    params.append(int(limit))
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
    out = []
    for r in rows:
        r["created_at"] = _iso(r.get("created_at"))
        out.append(r)
    return out


def get_file_blob(*, file_id: int) -> dict | None:
    """Recupera el binario + mime para download. Sin RBAC — el caller debe validarlo."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT id, user_id, mime, content, size_bytes, filename, title "
            "FROM people_personal_files WHERE id = %s",
            (file_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def delete_file(*, file_id: int) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "DELETE FROM people_personal_files WHERE id = %s RETURNING id",
            (file_id,),
        )
        return cur.fetchone() is not None


def get_file_meta(*, file_id: int) -> dict | None:
    """Solo metadata (sin binario) — para RBAC checks."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT id, user_id, kind, title FROM people_personal_files WHERE id = %s",
            (file_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def my_legajo_summary(*, user_id: int) -> dict:
    """Counts por kind + ultimo recibo."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT kind, COUNT(*) AS n FROM people_personal_files "
            "WHERE user_id = %s GROUP BY kind",
            (user_id,),
        )
        counts = {r["kind"]: int(r["n"]) for r in cur.fetchall()}

        cur.execute(
            "SELECT period_year, period_month, created_at FROM people_personal_files "
            "WHERE user_id = %s AND kind = 'recibo' "
            "ORDER BY period_year DESC NULLS LAST, period_month DESC NULLS LAST, created_at DESC LIMIT 1",
            (user_id,),
        )
        last_recibo_row = cur.fetchone()
        last_recibo = None
        if last_recibo_row:
            last_recibo = {
                "period_year": last_recibo_row.get("period_year"),
                "period_month": last_recibo_row.get("period_month"),
                "uploaded_at": _iso(last_recibo_row.get("created_at")),
            }

        cur.execute(
            "SELECT created_at FROM people_personal_files "
            "WHERE user_id = %s AND kind = 'contrato' "
            "ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        )
        last_contrato_row = cur.fetchone()
        last_contrato = _iso(last_contrato_row.get("created_at")) if last_contrato_row else None

    return {
        "documentos": counts.get("documento", 0),
        "recibos": counts.get("recibo", 0),
        "contratos": counts.get("contrato", 0),
        "last_recibo": last_recibo,
        "last_contrato_at": last_contrato,
    }

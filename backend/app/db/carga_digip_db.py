"""
CRUD para las tablas carga_digip_* en Supabase (PostgreSQL).

Tablas manejadas:
  carga_digip_processed  — antidup: códigos ya cargados a DigiP por fuente
  carga_digip_runs       — historial de runs (params, stats, logs, status)
"""
from __future__ import annotations

import logging
from typing import Any

from app.db.local_persistence import get_conn

log = logging.getLogger(__name__)


def init() -> None:
    """Crea las tablas si no existen. Llamado en startup."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS carga_digip_processed (
                id        BIGSERIAL PRIMARY KEY,
                fuente    TEXT        NOT NULL,
                codigo    TEXT        NOT NULL,
                created_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(fuente, codigo)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS carga_digip_runs (
                id               BIGSERIAL   PRIMARY KEY,
                run_id           TEXT        UNIQUE NOT NULL,
                fuentes          TEXT[]      NOT NULL,
                pedido_tipo      TEXT        NOT NULL DEFAULT 'TODOS',
                tipo_envio       TEXT        NOT NULL DEFAULT 'TODOS',
                dry_run          BOOLEAN     NOT NULL DEFAULT FALSE,
                fecha_meli       TEXT,
                fecha_desde      TEXT,
                tn_uni_despacho  TEXT[],
                meli_db_modo_lote TEXT       DEFAULT 'TODOS',
                status           TEXT        NOT NULL DEFAULT 'running',
                creados          INT         DEFAULT 0,
                ya_existian      INT         DEFAULT 0,
                omitidos         INT         DEFAULT 0,
                errores          INT         DEFAULT 0,
                duracion_seg     FLOAT,
                logs             TEXT        DEFAULT '',
                started_at       TIMESTAMPTZ DEFAULT now(),
                finished_at      TIMESTAMPTZ,
                started_by_user_id INT,
                started_by_email   TEXT
            )
        """)
        cur.execute(
            "ALTER TABLE carga_digip_runs ADD COLUMN IF NOT EXISTS meli_db_modo_lote TEXT DEFAULT 'TODOS'"
        )


# ── Antidup ───────────────────────────────────────────────────────────────

def load_processed(fuente: str) -> set:
    """Devuelve el set de códigos ya procesados para la fuente dada."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT codigo FROM carga_digip_processed WHERE fuente = %s",
            (fuente,),
        )
        rows = cur.fetchall()
    return {r["codigo"] for r in rows}


def append_processed(fuente: str, codes: list[str]) -> None:
    """Inserta códigos como procesados (ignora duplicados)."""
    if not codes:
        return
    with get_conn() as conn, conn.cursor() as cur:
        for code in codes:
            cur.execute(
                "INSERT INTO carga_digip_processed (fuente, codigo) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (fuente, str(code).strip()),
            )


# ── Runs ──────────────────────────────────────────────────────────────────

def create_run(
    run_id: str,
    params: dict,
    user_id: int | None,
    user_email: str | None,
) -> dict:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO carga_digip_runs
                (run_id, fuentes, pedido_tipo, tipo_envio, dry_run,
                 fecha_meli, fecha_desde, tn_uni_despacho, meli_db_modo_lote,
                 status, started_by_user_id, started_by_email)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'running', %s, %s)
            RETURNING *
            """,
            (
                run_id,
                params.get("fuentes"),
                params.get("pedido_tipo", "TODOS"),
                params.get("tipo_envio", "TODOS"),
                params.get("dry_run", False),
                params.get("fecha_meli"),
                params.get("fecha_desde"),
                params.get("tn_uni_despacho"),
                params.get("meli_db_modo_lote", "TODOS"),
                user_id,
                user_email,
            ),
        )
        row = cur.fetchone()
    return dict(row)


def update_run(
    run_id: str,
    status: str,
    stats: dict,
    logs: str,
    duracion_seg: float,
) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE carga_digip_runs
            SET status       = %s,
                creados      = %s,
                ya_existian  = %s,
                omitidos     = %s,
                errores      = %s,
                logs         = %s,
                duracion_seg = %s,
                finished_at  = now()
            WHERE run_id = %s
            """,
            (
                status,
                stats.get("creados", 0),
                stats.get("ya_existian", 0),
                stats.get("omitidos", 0),
                stats.get("errores", 0),
                logs,
                duracion_seg,
                run_id,
            ),
        )


def list_runs(limit: int = 50) -> list[dict]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, run_id, fuentes, pedido_tipo, tipo_envio, dry_run,
                   meli_db_modo_lote,
                   status, creados, ya_existian, omitidos, errores,
                   duracion_seg, started_at, finished_at, started_by_email
            FROM carga_digip_runs
            ORDER BY started_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def get_run(run_id: str) -> dict | None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM carga_digip_runs WHERE run_id = %s", (run_id,))
        row = cur.fetchone()
    return dict(row) if row else None

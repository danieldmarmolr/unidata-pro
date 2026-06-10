"""
Helpers para la BBDD propia de UNIDATA (users, costs, audit log).
Backend: PostgreSQL (RDS unidata-prod-db en prod, cualquier Postgres en local via DATABASE_URL).

Uso:
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()  # dict-like (RealDictRow)
"""
from __future__ import annotations

import logging
import os
import threading
from contextlib import contextmanager
from typing import Iterator

import psycopg2
import psycopg2.extras
import psycopg2.pool

logger = logging.getLogger(__name__)

_POOL: psycopg2.pool.ThreadedConnectionPool | None = None
_POOL_LOCK = threading.Lock()


def _get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL env var no esta seteada. "
            "UNIDATA requiere PostgreSQL (Supabase en prod). "
            "Setealo a: postgresql://user:pass@host:5432/dbname"
        )
    return url


def _ensure_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _POOL
    if _POOL is not None:
        return _POOL
    with _POOL_LOCK:
        if _POOL is not None:
            return _POOL
        url = _get_database_url()
        _POOL = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            dsn=url,
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        logger.info("postgres pool initialized (1-10 conns)")
    return _POOL


@contextmanager
def get_conn() -> Iterator[psycopg2.extensions.connection]:
    """Context manager: saca una conexion del pool, la devuelve al salir.

    Setea timezone Argentina al inicio para que NOW(), CURRENT_DATE, etc
    devuelvan hora local AR (UTC-3).
    """
    pool = _ensure_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SET TIME ZONE 'America/Argentina/Buenos_Aires'")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def health_check() -> bool:
    """True si Postgres responde."""
    try:
        with get_conn() as c, c.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        return True
    except Exception as e:
        logger.warning("postgres health check failed: %s", e)
        return False

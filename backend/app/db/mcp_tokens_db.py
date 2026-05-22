"""
Tracking de tokens MCP (JWT scope=mcp, 90d) para poder revocarlos.

Modelo:
  mcp_tokens(jti, user_id, label, issued_at, last_used_at, revoked_at)

Flow:
  - issue_mcp_token() inserta una row con jti=uuid4 y devuelve el jti para
    incluirlo en el JWT.
  - decode_token() (en security.py) consulta is_revoked(jti) si el token
    tiene scope=mcp. Si esta revocado -> 401.
  - El user puede listar sus tokens en /api/auth/mcp-tokens y revocarlos.

NOTA: los JWTs normales (12h) NO se trackean aca. La revocacion solo
aplica a tokens de larga duracion.
"""
from __future__ import annotations

import logging
import threading
from typing import Any

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.mcp_tokens")

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
            cur.execute("""
                CREATE TABLE IF NOT EXISTS mcp_tokens (
                    jti           UUID PRIMARY KEY,
                    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    label         TEXT,
                    issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_used_at  TIMESTAMPTZ,
                    revoked_at    TIMESTAMPTZ,
                    revoked_by    BIGINT REFERENCES users(id) ON DELETE SET NULL
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_mcp_tokens_active ON mcp_tokens(user_id) WHERE revoked_at IS NULL")
        log.info("mcp_tokens table initialized")
        _INITIALIZED = True


def register(jti: str, user_id: int, label: str | None = None) -> None:
    """Registra un token nuevo recien emitido."""
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO mcp_tokens (jti, user_id, label) VALUES (%s, %s, %s)",
            (jti, user_id, label),
        )


def is_revoked(jti: str) -> bool:
    """True si el jti existe y esta revocado. False si no existe o esta activo.

    NOTA: si el jti no existe en la tabla, devolvemos False (no revocado) -
    eso cubre tokens emitidos antes de que existiera esta tabla. Una vez
    rotemos a "todos los tokens se trackean", podemos cambiar a True.
    """
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT revoked_at FROM mcp_tokens WHERE jti = %s", (jti,))
        row = cur.fetchone()
    if not row:
        return False
    return row["revoked_at"] is not None


def touch_last_used(jti: str) -> None:
    """Marca el token como usado recientemente. Best-effort (no rompe si falla)."""
    try:
        with get_conn() as c, c.cursor() as cur:
            cur.execute(
                "UPDATE mcp_tokens SET last_used_at = NOW() WHERE jti = %s AND revoked_at IS NULL",
                (jti,),
            )
    except Exception as e:
        log.warning("touch_last_used fallo (%s): %s", jti, e)


def list_for_user(user_id: int, include_revoked: bool = False) -> list[dict[str, Any]]:
    where = "user_id = %s"
    params: list[Any] = [user_id]
    if not include_revoked:
        where += " AND revoked_at IS NULL"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"""SELECT jti, label, issued_at, last_used_at, revoked_at
                FROM mcp_tokens WHERE {where}
                ORDER BY issued_at DESC""",
            params,
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def revoke(jti: str, revoked_by_user_id: int) -> bool:
    """Revoca un token. Devuelve True si efectivamente se revoco (existe y
    estaba activo). False si no existia o ya estaba revocado.

    NOTA: cualquiera puede llamar a revoke con su propio jti. La verificacion
    de ownership (que el jti sea del user que llama) la hace el endpoint."""
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """UPDATE mcp_tokens
               SET revoked_at = NOW(), revoked_by = %s
               WHERE jti = %s AND revoked_at IS NULL""",
            (revoked_by_user_id, jti),
        )
        return cur.rowcount > 0


def get_token(jti: str) -> dict[str, Any] | None:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT jti, user_id, label, issued_at, last_used_at, revoked_at FROM mcp_tokens WHERE jti = %s",
            (jti,),
        )
        row = cur.fetchone()
    return dict(row) if row else None

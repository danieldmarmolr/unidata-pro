"""
Tabla de usuarios + roles (PostgreSQL via Supabase).
Auto-migra al boot. Seedea al admin desde .env si no existe ningun user.
Roles: 'admin' | 'user' | 'gerencia' | 'analista' | 'lector'.
"""
from __future__ import annotations

import datetime as dt
import os
import threading

import bcrypt
import psycopg2.errors

from app.db.local_persistence import get_conn

_LOCK = threading.RLock()
_INITIALIZED = False


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode()


def _verify(password: str, hashed: str) -> bool:
    if not password or not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id            BIGSERIAL PRIMARY KEY,
                    email         TEXT NOT NULL,
                    name          TEXT NOT NULL DEFAULT '',
                    password_hash TEXT,
                    role          TEXT NOT NULL DEFAULT 'user'
                                  CHECK (role IN ('admin','user','gerencia','analista','lector')),
                    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    created_by    TEXT
                )
            """)
            # Migracion idempotente: si la columna era NOT NULL, la relajamos
            cur.execute("""
                ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL
            """)
            # Unique case-insensitive en email (equivalente a SQLite COLLATE NOCASE)
            cur.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
                ON users (LOWER(email))
            """)

            # Seed admin si la tabla esta vacia
            cur.execute("SELECT COUNT(*) AS n FROM users")
            count = cur.fetchone()["n"]
            if count == 0:
                seed_email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
                seed_password = os.environ.get("ADMIN_PASSWORD") or ""
                seed_name = os.environ.get("ADMIN_NAME") or "Admin"
                if seed_email and seed_password:
                    cur.execute(
                        """
                        INSERT INTO users
                          (email, name, password_hash, role, is_active, created_by)
                        VALUES (%s, %s, %s, 'admin', TRUE, 'seed')
                        """,
                        (seed_email, seed_name, _hash(seed_password)),
                    )
        _INITIALIZED = True


# ----- Auth -----

def find_active_by_email(email: str) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT * FROM users WHERE LOWER(email) = LOWER(%s) AND is_active = TRUE",
            (email.strip().lower(),),
        )
        return cur.fetchone()


def authenticate(email: str, password: str) -> dict | None:
    row = find_active_by_email(email)
    if not row:
        return None
    if not _verify(password, row["password_hash"]):
        return None
    return _to_dict(row)


def find_by_id(user_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        return cur.fetchone()


def find_by_email(email: str) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT * FROM users WHERE LOWER(email) = LOWER(%s)",
            (email.strip().lower(),),
        )
        return cur.fetchone()


# ----- Admin CRUD -----

def list_all() -> list[dict]:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM users ORDER BY created_at DESC")
        rows = cur.fetchall()
    return [_to_dict(r) for r in rows]


def create(email: str, name: str, password: str, role: str, created_by: str) -> dict:
    init()
    if role not in ("admin", "user", "gerencia", "analista", "lector"):
        raise ValueError("role debe ser admin/user/gerencia/analista/lector")
    if not email or "@" not in email:
        raise ValueError("email invalido")
    if not password or len(password) < 6:
        raise ValueError("password muy corto (min 6 chars)")
    try:
        with get_conn() as c, c.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users
                  (email, name, password_hash, role, is_active, created_by)
                VALUES (%s, %s, %s, %s, TRUE, %s)
                RETURNING *
                """,
                (email.strip().lower(), name.strip(), _hash(password), role, created_by),
            )
            row = cur.fetchone()
            return _to_dict(row)
    except psycopg2.errors.UniqueViolation:
        raise ValueError("ya existe un usuario con ese email") from None


def update(
    user_id: int,
    *,
    name: str | None = None,
    role: str | None = None,
    is_active: bool | None = None,
    new_password: str | None = None,
) -> dict | None:
    init()
    sets: list[str] = []
    params: list = []
    if name is not None:
        sets.append("name = %s"); params.append(name.strip())
    if role is not None:
        if role not in ("admin", "user", "gerencia", "analista", "lector"):
            raise ValueError("role invalido")
        sets.append("role = %s"); params.append(role)
    if is_active is not None:
        sets.append("is_active = %s"); params.append(bool(is_active))
    if new_password is not None:
        if len(new_password) < 6:
            raise ValueError("password muy corto (min 6 chars)")
        sets.append("password_hash = %s"); params.append(_hash(new_password))
    if not sets:
        return None
    sets.append("updated_at = NOW()")
    params.append(user_id)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"UPDATE users SET {', '.join(sets)} WHERE id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def change_password(user_id: int, current_password: str, new_password: str) -> bool:
    init()
    row = find_by_id(user_id)
    if not row:
        return False
    if not _verify(current_password, row["password_hash"]):
        return False
    update(user_id, new_password=new_password)
    return True


# ----- Self-registration (Camino A: dominio @unistore.ar) -----

ALLOWED_REGISTRATION_DOMAIN = "unistore.ar"


def register_pending(email: str, name: str) -> dict:
    """Crea un user nuevo SIN password (estado 'pendiente de password').
    Valida dominio @unistore.ar. Rol default: lector.
    Si ya existe el email -> ValueError.
    """
    init()
    email_clean = email.strip().lower()
    if "@" not in email_clean:
        raise ValueError("email invalido")
    domain = email_clean.split("@", 1)[1]
    if domain != ALLOWED_REGISTRATION_DOMAIN:
        raise ValueError(f"solo se permite registro con dominio @{ALLOWED_REGISTRATION_DOMAIN}")
    if not name.strip():
        raise ValueError("name requerido")
    try:
        with get_conn() as c, c.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users
                  (email, name, password_hash, role, is_active, created_by)
                VALUES (%s, %s, NULL, 'lector', TRUE, 'self-registration')
                RETURNING *
                """,
                (email_clean, name.strip()),
            )
            row = cur.fetchone()
            return _to_dict(row)
    except psycopg2.errors.UniqueViolation:
        raise ValueError("ya existe una cuenta con ese email - usa el login") from None


def set_initial_password(email: str, new_password: str) -> dict | None:
    """Setea password solo si el user no tiene password aun (primer login).
    Devuelve dict del user actualizado, o None si:
    - el user no existe
    - el user ya tiene password (debe usar /change-password con la actual)
    """
    init()
    if not new_password or len(new_password) < 6:
        raise ValueError("password muy corto (min 6 chars)")
    email_clean = email.strip().lower()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE users
            SET password_hash = %s, updated_at = NOW()
            WHERE LOWER(email) = LOWER(%s)
              AND password_hash IS NULL
              AND is_active = TRUE
            RETURNING *
            """,
            (_hash(new_password), email_clean),
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def needs_password_setup(email: str) -> bool:
    """True si el user existe, esta activo y todavia no tiene password seteada."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM users
            WHERE LOWER(email) = LOWER(%s)
              AND password_hash IS NULL
              AND is_active = TRUE
            """,
            (email.strip().lower(),),
        )
        return cur.fetchone() is not None


# ----- internals -----

def _to_dict(row: dict | None) -> dict:
    if row is None:
        return {}
    d = dict(row)
    d.pop("password_hash", None)
    d["is_active"] = bool(d.get("is_active"))
    # ISO format para timestamps
    for k in ("created_at", "updated_at"):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    return d

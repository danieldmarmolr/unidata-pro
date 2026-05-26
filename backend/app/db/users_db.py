"""
Tabla de usuarios + roles (PostgreSQL via Supabase).
Auto-migra al boot. Seedea al admin desde .env si no existe ningun user.
Roles: 'ceo' | 'admin' | 'user' | 'gerencia' | 'analista' | 'lector'.

- ceo: cabeza del organigrama, gerente de los gerentes. Ve todo (igual que gerencia).
  Solo puede existir 1 'ceo' activo a la vez.
- admin: legacy, equivalente a is_admin=TRUE (gestion de plataforma).
- gerencia: ve TODAS las areas + dashboard de Gerencia.
- user/analista/lector: colaboradores, ven dashboards (sin admin/SQL libre).
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
                    role          TEXT NOT NULL DEFAULT 'user',
                    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
                    is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    created_by    TEXT
                )
            """)
            # Migraciones idempotentes
            cur.execute("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE")
            # CHECK constraint del rol — drop + add para incluir 'ceo' (idempotente)
            cur.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check")
            cur.execute("""
                ALTER TABLE users
                ADD CONSTRAINT users_role_check
                CHECK (role IN ('ceo','admin','user','gerencia','analista','lector'))
            """)
            # Unico CEO activo: indice parcial unico sobre role
            # (todos los rows del indice tienen role='ceo' por el WHERE,
            # por lo tanto cualquier segundo CEO activo colisiona)
            cur.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_ceo
                ON users (role)
                WHERE role = 'ceo' AND is_active = TRUE
            """)
            # Backfill: usuarios con role='admin' obtienen is_admin=TRUE automaticamente.
            # Esto es idempotente (si ya estaba TRUE no cambia nada).
            cur.execute("UPDATE users SET is_admin = TRUE WHERE role = 'admin' AND is_admin = FALSE")
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
                          (email, name, password_hash, role, is_active, is_admin, created_by)
                        VALUES (%s, %s, %s, 'admin', TRUE, TRUE, 'seed')
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
    # Garantiza que las columnas extendidas / tabla user_areas existan
    from app.db import areas_db  # lazy para evitar ciclos
    areas_db.init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT u.*,
                   COALESCE(u.hidden_from_directory, FALSE) AS hidden_from_directory,
                   a.slug   AS area_slug,
                   a.name   AS area_name,
                   a.color  AS area_color,
                   m.name   AS manager_name,
                   m.email  AS manager_email,
                   m.role   AS manager_role,
                   COALESCE(
                       (
                           SELECT json_agg(json_build_object(
                                       'id', a2.id, 'slug', a2.slug,
                                       'name', a2.name, 'color', a2.color
                                   ) ORDER BY a2.sort_order)
                           FROM user_areas ua
                           JOIN areas a2 ON a2.id = ua.area_id
                           WHERE ua.user_id = u.id
                             AND ua.area_id IS DISTINCT FROM u.area_id
                       ),
                       '[]'::json
                   ) AS secondary_areas
            FROM users u
            LEFT JOIN areas a ON a.id = u.area_id
            LEFT JOIN users m ON m.id = u.manager_user_id
            ORDER BY u.created_at DESC
        """)
        rows = cur.fetchall()
    return [_to_dict(r) for r in rows]


def create(email: str, name: str, password: str, role: str, created_by: str, is_admin: bool = False) -> dict:
    init()
    if role not in ("ceo", "admin", "user", "gerencia", "analista", "lector"):
        raise ValueError("role debe ser ceo/admin/user/gerencia/analista/lector")
    if not email or "@" not in email:
        raise ValueError("email invalido")
    if not password or len(password) < 6:
        raise ValueError("password muy corto (min 6 chars)")
    # Si role es 'admin', forzar is_admin=true por consistencia (legacy compat)
    if role == "admin":
        is_admin = True
    try:
        with get_conn() as c, c.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users
                  (email, name, password_hash, role, is_active, is_admin, created_by)
                VALUES (%s, %s, %s, %s, TRUE, %s, %s)
                RETURNING *
                """,
                (email.strip().lower(), name.strip(), _hash(password), role, is_admin, created_by),
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
    is_admin: bool | None = None,
    new_password: str | None = None,
    area_id: int | None = None,
    manager_user_id: int | None = None,
    job_title: str | None = None,
    bio: str | None = None,
    hidden_from_directory: bool | None = None,
    clear_area: bool = False,
    clear_manager: bool = False,
) -> dict | None:
    init()
    sets: list[str] = []
    params: list = []
    if name is not None:
        sets.append("name = %s"); params.append(name.strip())
    if role is not None:
        if role not in ("ceo", "admin", "user", "gerencia", "analista", "lector"):
            raise ValueError("role invalido")
        # Validar unicidad de CEO antes de aplicar (el indice tambien lo enforce,
        # pero asi devolvemos un error claro en vez de IntegrityError)
        if role == "ceo":
            with get_conn() as c, c.cursor() as cur:
                cur.execute(
                    "SELECT id, email FROM users WHERE role = 'ceo' AND is_active = TRUE AND id <> %s",
                    (user_id,),
                )
                existing = cur.fetchone()
                if existing:
                    raise ValueError(
                        f"ya hay un CEO activo ({existing['email']}). Cambiale el rol antes."
                    )
        sets.append("role = %s"); params.append(role)
        # Si el role pasa a 'admin', forzar is_admin=TRUE por consistencia
        if role == "admin":
            sets.append("is_admin = TRUE")
    if is_active is not None:
        sets.append("is_active = %s"); params.append(bool(is_active))
    if is_admin is not None:
        sets.append("is_admin = %s"); params.append(bool(is_admin))
    if new_password is not None:
        if len(new_password) < 6:
            raise ValueError("password muy corto (min 6 chars)")
        sets.append("password_hash = %s"); params.append(_hash(new_password))
    if clear_area:
        sets.append("area_id = NULL")
    elif area_id is not None:
        sets.append("area_id = %s"); params.append(int(area_id))
    if clear_manager:
        sets.append("manager_user_id = NULL")
    elif manager_user_id is not None:
        if int(manager_user_id) == int(user_id):
            raise ValueError("un usuario no puede ser gerente de si mismo")
        sets.append("manager_user_id = %s"); params.append(int(manager_user_id))
    if job_title is not None:
        sets.append("job_title = %s"); params.append(job_title.strip() or None)
    if bio is not None:
        sets.append("bio = %s"); params.append(bio.strip() or None)
    if hidden_from_directory is not None:
        sets.append("hidden_from_directory = %s"); params.append(bool(hidden_from_directory))
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


# ----- 2FA TOTP -----

def get_totp_secret(user_id: int) -> str | None:
    """Devuelve el secret TOTP en plaintext (lo descifra si esta cifrado en DB).
    Backwards-compat: si el secret en DB esta en plaintext legacy, lo devuelve
    as-is. Si esta cifrado y no tenemos key, devuelve None."""
    from app.auth import totp_cipher
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT totp_secret FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    if not row:
        return None
    return totp_cipher.decrypt(row["totp_secret"])


def set_totp_secret(user_id: int, secret: str | None, enabled: bool) -> None:
    """Cifra el secret antes de guardarlo. Si TOTP_CIPHER_KEY no esta seteada
    queda en plaintext (con warning en log). Cuando se setea la env y el user
    vuelve a tocar 2FA, automaticamente queda cifrado."""
    from app.auth import totp_cipher
    init()
    encrypted = totp_cipher.encrypt(secret) if secret else None
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE users SET totp_secret = %s, totp_enabled = %s, updated_at = NOW() WHERE id = %s",
            (encrypted, enabled, user_id),
        )


def is_totp_enabled(user_id: int) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT totp_enabled FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    return bool(row and row["totp_enabled"])


# ----- internals -----

def _to_dict(row: dict | None) -> dict:
    if row is None:
        return {}
    d = dict(row)
    d.pop("password_hash", None)
    d.pop("totp_secret", None)
    d["is_active"] = bool(d.get("is_active"))
    d["is_admin"] = bool(d.get("is_admin"))
    d["totp_enabled"] = bool(d.get("totp_enabled"))
    d["hidden_from_directory"] = bool(d.get("hidden_from_directory"))
    # ISO format para timestamps
    for k in ("created_at", "updated_at"):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    return d

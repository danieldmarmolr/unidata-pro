"""
Tabla de usuarios + roles (SQLite local).
Auto-migra al boot. Seedea al admin desde .env si no existe ningun user.
Roles: 'admin' | 'user'.
"""
from __future__ import annotations

import datetime as dt
import os
import sqlite3
import threading
from pathlib import Path

import bcrypt

DB_PATH = Path(__file__).parent.parent.parent / "users.db"
_LOCK = threading.RLock()
_INITIALIZED = False


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    return c


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
        with _conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    name          TEXT NOT NULL DEFAULT '',
                    password_hash TEXT NOT NULL,
                    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user','gerencia','analista','lector')),
                    is_active     INTEGER NOT NULL DEFAULT 1,
                    created_at    TEXT NOT NULL,
                    updated_at    TEXT NOT NULL,
                    created_by    TEXT
                )
            """)
            c.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
            c.commit()

            # Migracion: si CHECK constraint es la vieja (solo admin/user), recrear tabla
            schema = c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").fetchone()
            if schema and "'gerencia'" not in (schema["sql"] or ""):
                c.executescript("""
                    PRAGMA foreign_keys=OFF;
                    CREATE TABLE users_new (
                        id            INTEGER PRIMARY KEY AUTOINCREMENT,
                        email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
                        name          TEXT NOT NULL DEFAULT '',
                        password_hash TEXT NOT NULL,
                        role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user','gerencia','analista','lector')),
                        is_active     INTEGER NOT NULL DEFAULT 1,
                        created_at    TEXT NOT NULL,
                        updated_at    TEXT NOT NULL,
                        created_by    TEXT
                    );
                    INSERT INTO users_new SELECT * FROM users;
                    DROP TABLE users;
                    ALTER TABLE users_new RENAME TO users;
                    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
                    PRAGMA foreign_keys=ON;
                """)
                c.commit()

            # Seed admin si no hay ningun user
            count = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            if count == 0:
                seed_email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
                seed_password = os.environ.get("ADMIN_PASSWORD") or ""
                seed_name = os.environ.get("ADMIN_NAME") or "Admin"
                if seed_email and seed_password:
                    now = dt.datetime.now(dt.timezone.utc).isoformat()
                    c.execute(
                        """
                        INSERT INTO users (email, name, password_hash, role, is_active, created_at, updated_at, created_by)
                        VALUES (?, ?, ?, 'admin', 1, ?, ?, 'seed')
                        """,
                        (seed_email, seed_name, _hash(seed_password), now, now),
                    )
                    c.commit()
        _INITIALIZED = True


# ----- Auth -----

def find_active_by_email(email: str) -> sqlite3.Row | None:
    init()
    with _LOCK, _conn() as c:
        return c.execute(
            "SELECT * FROM users WHERE email = ? COLLATE NOCASE AND is_active = 1",
            (email.strip().lower(),),
        ).fetchone()


def authenticate(email: str, password: str) -> dict | None:
    row = find_active_by_email(email)
    if not row:
        return None
    if not _verify(password, row["password_hash"]):
        return None
    return _to_dict(row)


def find_by_id(user_id: int) -> sqlite3.Row | None:
    init()
    with _LOCK, _conn() as c:
        return c.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def find_by_email(email: str) -> sqlite3.Row | None:
    init()
    with _LOCK, _conn() as c:
        return c.execute(
            "SELECT * FROM users WHERE email = ? COLLATE NOCASE",
            (email.strip().lower(),),
        ).fetchone()


# ----- Admin CRUD -----

def list_all() -> list[dict]:
    init()
    with _LOCK, _conn() as c:
        rows = c.execute("SELECT * FROM users ORDER BY created_at DESC").fetchall()
    return [_to_dict(r) for r in rows]


def create(email: str, name: str, password: str, role: str, created_by: str) -> dict:
    init()
    if role not in ("admin", "user", "gerencia", "analista", "lector"):
        raise ValueError("role debe ser admin/user/gerencia/analista/lector")
    if not email or "@" not in email:
        raise ValueError("email invalido")
    if not password or len(password) < 6:
        raise ValueError("password muy corto (min 6 chars)")
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with _LOCK, _conn() as c:
        try:
            cur = c.execute(
                """
                INSERT INTO users (email, name, password_hash, role, is_active, created_at, updated_at, created_by)
                VALUES (?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (email.strip().lower(), name.strip(), _hash(password), role, now, now, created_by),
            )
            c.commit()
            return _to_dict(c.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone())
        except sqlite3.IntegrityError:
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
        sets.append("name = ?"); params.append(name.strip())
    if role is not None:
        if role not in ("admin", "user", "gerencia", "analista", "lector"):
            raise ValueError("role invalido")
        sets.append("role = ?"); params.append(role)
    if is_active is not None:
        sets.append("is_active = ?"); params.append(1 if is_active else 0)
    if new_password is not None:
        if len(new_password) < 6:
            raise ValueError("password muy corto (min 6 chars)")
        sets.append("password_hash = ?"); params.append(_hash(new_password))
    if not sets:
        return None
    sets.append("updated_at = ?"); params.append(dt.datetime.now(dt.timezone.utc).isoformat())
    params.append(user_id)
    with _LOCK, _conn() as c:
        c.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", params)
        c.commit()
        row = c.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
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


# ----- internals -----

def _to_dict(row: sqlite3.Row | None) -> dict:
    if row is None:
        return {}
    d = dict(row)
    d.pop("password_hash", None)
    d["is_active"] = bool(d.get("is_active"))
    return d

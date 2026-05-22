"""
People — modulo social interno (Humand-like).

Tablas:
  people_posts          -> feed (posts, anuncios pinneados, soft-delete)
  people_post_reactions -> emoji reactions sobre posts y comentarios
  people_post_comments  -> comentarios sobre un post
  people_post_reads     -> confirmacion de lectura de anuncios
  people_kudos          -> reconocimientos peer-to-peer (linkeados a un value)
  people_values         -> valores de empresa (configurables por admin/People)

Reglas:
- Cualquier user activo puede crear posts y comentar.
- Solo el autor o un admin/People puede editar/borrar su post o comentario.
- Solo gerencia/admin/People puede pinear/despinear anuncios.
- Cada kudo crea automaticamente un post anclado al feed para visibilidad.
"""
from __future__ import annotations

import datetime as dt
import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.people")

_LOCK = threading.RLock()
_INITIALIZED = False


# Valores default sembrados si la tabla esta vacia
VALUES_SEED: list[tuple[str, str, str, str, str]] = [
    # (slug, name, emoji, color, description)
    ("colaboracion",  "Colaboracion",   "🤝", "#06b6d4", "Trabajo en equipo, ayudar a otros, romper silos"),
    ("innovacion",    "Innovacion",     "💡", "#f59e0b", "Proponer nuevas formas, automatizar, mejorar procesos"),
    ("ownership",     "Ownership",      "🚀", "#ec4899", "Hacerse cargo, dar la cara, cerrar loops"),
    ("foco_cliente",  "Foco en cliente", "❤️", "#ef4444", "Resolver para el cliente, ponerse en sus zapatos"),
    ("calidad",       "Calidad",        "🎯", "#10b981", "Atencion al detalle, hacer las cosas bien"),
    ("aprendizaje",   "Aprendizaje",    "📚", "#8b5cf6", "Compartir conocimiento, capacitarse, mentorear"),
]


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            # --- people_values
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_values (
                    id           BIGSERIAL PRIMARY KEY,
                    slug         TEXT NOT NULL UNIQUE,
                    name         TEXT NOT NULL,
                    emoji        TEXT NOT NULL DEFAULT '⭐',
                    color        TEXT NOT NULL DEFAULT '#7a3eae',
                    description  TEXT NOT NULL DEFAULT '',
                    sort_order   INT NOT NULL DEFAULT 0,
                    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)

            # --- people_posts
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_posts (
                    id                BIGSERIAL PRIMARY KEY,
                    author_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    content           TEXT NOT NULL,
                    image_url         TEXT,
                    is_announcement   BOOLEAN NOT NULL DEFAULT FALSE,
                    pinned            BOOLEAN NOT NULL DEFAULT FALSE,
                    pinned_until      TIMESTAMPTZ,
                    pinned_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
                    requires_read_ack BOOLEAN NOT NULL DEFAULT FALSE,
                    kudo_id           BIGINT,
                    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    deleted_at        TIMESTAMPTZ
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_posts_feed "
                "ON people_posts (created_at DESC) WHERE deleted_at IS NULL"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_posts_pinned "
                "ON people_posts (pinned, created_at DESC) WHERE deleted_at IS NULL AND pinned = TRUE"
            )

            # --- people_post_reactions
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_post_reactions (
                    post_id      BIGINT NOT NULL REFERENCES people_posts(id) ON DELETE CASCADE,
                    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    emoji        TEXT NOT NULL,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (post_id, user_id, emoji)
                )
            """)

            # --- people_post_comments
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_post_comments (
                    id           BIGSERIAL PRIMARY KEY,
                    post_id      BIGINT NOT NULL REFERENCES people_posts(id) ON DELETE CASCADE,
                    author_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    content      TEXT NOT NULL,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    deleted_at   TIMESTAMPTZ
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_comments_post "
                "ON people_post_comments (post_id, created_at) WHERE deleted_at IS NULL"
            )

            # --- people_post_reads (confirmacion de lectura de anuncios)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_post_reads (
                    post_id   BIGINT NOT NULL REFERENCES people_posts(id) ON DELETE CASCADE,
                    user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    read_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (post_id, user_id)
                )
            """)

            # --- people_kudos
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_kudos (
                    id           BIGSERIAL PRIMARY KEY,
                    from_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    to_user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    value_slug   TEXT NOT NULL,
                    message      TEXT NOT NULL DEFAULT '',
                    post_id      BIGINT REFERENCES people_posts(id) ON DELETE SET NULL,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_kudos_to "
                "ON people_kudos (to_user_id, created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_kudos_from "
                "ON people_kudos (from_user_id, created_at DESC)"
            )

            # Seed valores si vacio
            cur.execute("SELECT COUNT(*) AS n FROM people_values")
            n = cur.fetchone()["n"]
            if n == 0:
                for i, (slug, name, emoji, color, desc) in enumerate(VALUES_SEED):
                    cur.execute(
                        """
                        INSERT INTO people_values (slug, name, emoji, color, description, sort_order)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (slug, name, emoji, color, desc, i),
                    )
                log.info("people_values seedeados: %d", len(VALUES_SEED))

        _INITIALIZED = True


# ---------- helpers ----------

def _iso(v):
    if v is None:
        return None
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    return v


def _post_to_dict(row: dict) -> dict:
    d = dict(row)
    for k in ("created_at", "updated_at", "deleted_at", "pinned_until"):
        if k in d:
            d[k] = _iso(d.get(k))
    return d


# ---------- directory + org chart ----------

def list_directory(only_active: bool = True) -> list[dict]:
    """Lista plana de colaboradores con su area y manager (no recursivo)."""
    init()
    sql = """
        SELECT u.id, u.email, u.name, u.role, u.is_admin, u.is_active,
               u.area_id, u.manager_user_id, u.job_title, u.bio,
               u.birthday_month, u.birthday_day, u.birthday_year,
               u.joined_at, u.location_city, u.avatar_url, u.interests,
               a.slug AS area_slug, a.name AS area_name, a.color AS area_color,
               m.name AS manager_name, m.email AS manager_email
          FROM users u
          LEFT JOIN areas a ON a.id = u.area_id
          LEFT JOIN users m ON m.id = u.manager_user_id
         {where}
         ORDER BY a.sort_order NULLS LAST, u.name ASC
    """
    where = "WHERE u.is_active = TRUE" if only_active else ""
    out = []
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql.format(where=where))
        for r in cur.fetchall():
            d = dict(r)
            d["joined_at"] = _iso(d.get("joined_at"))
            d["is_active"] = bool(d.get("is_active"))
            d["is_admin"] = bool(d.get("is_admin"))
            out.append(d)
    return out


def org_chart() -> list[dict]:
    """Devuelve la lista de users con info necesaria para construir arbol manager->reportes.

    El cliente arma el arbol; este endpoint solo da la data plana enriquecida.
    """
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT u.id, u.name, u.email, u.role, u.is_admin, u.avatar_url,
                   u.job_title, u.manager_user_id, u.joined_at,
                   a.slug AS area_slug, a.name AS area_name, a.color AS area_color,
                   m.name AS manager_name
              FROM users u
              LEFT JOIN areas a ON a.id = u.area_id
              LEFT JOIN users m ON m.id = u.manager_user_id
             WHERE u.is_active = TRUE
             ORDER BY u.name ASC
        """)
        users = [dict(r) for r in cur.fetchall()]

    # Marcar quienes son managers (tienen reportes)
    has_reports = set()
    for u in users:
        if u.get("manager_user_id"):
            has_reports.add(u["manager_user_id"])
    for u in users:
        u["is_manager"] = u["id"] in has_reports
        u["is_admin"] = bool(u.get("is_admin"))
        u["joined_at"] = _iso(u.get("joined_at"))
    return users


def get_public_profile(user_id: int, viewer_id: int) -> dict | None:
    """Profile publico de un colaborador (visible para todos los users activos)."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT u.id, u.email, u.name, u.role, u.is_admin, u.is_active,
                   u.manager_user_id, u.job_title, u.bio, u.interests,
                   u.birthday_month, u.birthday_day, u.birthday_year,
                   u.joined_at, u.location_city, u.avatar_url, u.created_at,
                   a.slug AS area_slug, a.name AS area_name, a.color AS area_color,
                   m.name AS manager_name, m.email AS manager_email, m.id AS manager_id
              FROM users u
              LEFT JOIN areas a ON a.id = u.area_id
              LEFT JOIN users m ON m.id = u.manager_user_id
             WHERE u.id = %s
        """, (user_id,))
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        d["joined_at"] = _iso(d.get("joined_at"))
        d["created_at"] = _iso(d.get("created_at"))
        d["is_active"] = bool(d.get("is_active"))
        d["is_admin"] = bool(d.get("is_admin"))

        # Reportes directos
        cur.execute("""
            SELECT u.id, u.name, u.email, u.avatar_url, u.job_title,
                   a.slug AS area_slug, a.name AS area_name, a.color AS area_color
              FROM users u
              LEFT JOIN areas a ON a.id = u.area_id
             WHERE u.manager_user_id = %s AND u.is_active = TRUE
             ORDER BY u.name ASC
        """, (user_id,))
        d["reports"] = [dict(r) for r in cur.fetchall()]

        # Kudos recibidos (count + ultimos 10)
        cur.execute("SELECT COUNT(*) AS n FROM people_kudos WHERE to_user_id = %s", (user_id,))
        d["kudos_received"] = cur.fetchone()["n"]
        cur.execute("""
            SELECT k.id, k.value_slug, k.message, k.created_at,
                   k.from_user_id, fu.name AS from_name, fu.avatar_url AS from_avatar,
                   v.name AS value_name, v.emoji AS value_emoji, v.color AS value_color
              FROM people_kudos k
              JOIN users fu ON fu.id = k.from_user_id
              LEFT JOIN people_values v ON v.slug = k.value_slug
             WHERE k.to_user_id = %s
             ORDER BY k.created_at DESC
             LIMIT 10
        """, (user_id,))
        d["recent_kudos"] = [_kudo_to_dict(r) for r in cur.fetchall()]

        # Kudos dados (count)
        cur.execute("SELECT COUNT(*) AS n FROM people_kudos WHERE from_user_id = %s", (user_id,))
        d["kudos_given"] = cur.fetchone()["n"]

        # Posts del user (count)
        cur.execute(
            "SELECT COUNT(*) AS n FROM people_posts WHERE author_id = %s AND deleted_at IS NULL",
            (user_id,),
        )
        d["posts_count"] = cur.fetchone()["n"]

    return d


# ---------- feed ----------

def list_feed(
    *,
    viewer_id: int,
    limit: int = 30,
    before_id: int | None = None,
) -> list[dict]:
    """Lista de posts (pinned arriba siempre + resto por fecha desc).

    Trae info denormalizada para evitar N+1 en el cliente:
    - autor (id/name/avatar/area)
    - reaction summary (lista de [emoji, count, has_reacted])
    - comment_count
    - has_read (para anuncios)
    - kudo info si el post fue creado por un kudo
    """
    init()
    with get_conn() as c, c.cursor() as cur:
        params: list = [viewer_id]
        cursor_clause = ""
        if before_id is not None:
            cursor_clause = "AND p.id < %s"
            params.append(before_id)

        # Estrategia: primero pinned activos, despues por id desc.
        # Devolvemos en dos queries por simplicidad de orden / paginacion.
        # En pagina 1 (sin before_id) trae pinned + ultimos N.
        # En siguientes paginas solo trae no-pinned mas viejos.
        pinned_rows: list[dict] = []
        if before_id is None:
            cur.execute(
                """
                SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
                       u.job_title AS author_job, a.slug AS author_area_slug,
                       a.name AS author_area_name, a.color AS author_area_color,
                       (SELECT COUNT(*) FROM people_post_comments c
                          WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
                       EXISTS(SELECT 1 FROM people_post_reads pr
                              WHERE pr.post_id = p.id AND pr.user_id = %s) AS has_read
                  FROM people_posts p
                  JOIN users u ON u.id = p.author_id
                  LEFT JOIN areas a ON a.id = u.area_id
                 WHERE p.deleted_at IS NULL
                   AND p.pinned = TRUE
                   AND (p.pinned_until IS NULL OR p.pinned_until > NOW())
                 ORDER BY p.created_at DESC
                """,
                [viewer_id],
            )
            pinned_rows = [dict(r) for r in cur.fetchall()]

        cur.execute(
            f"""
            SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
                   u.job_title AS author_job, a.slug AS author_area_slug,
                   a.name AS author_area_name, a.color AS author_area_color,
                   (SELECT COUNT(*) FROM people_post_comments c
                      WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
                   EXISTS(SELECT 1 FROM people_post_reads pr
                          WHERE pr.post_id = p.id AND pr.user_id = %s) AS has_read
              FROM people_posts p
              JOIN users u ON u.id = p.author_id
              LEFT JOIN areas a ON a.id = u.area_id
             WHERE p.deleted_at IS NULL
               AND (p.pinned = FALSE OR p.pinned_until <= NOW())
               {cursor_clause}
             ORDER BY p.id DESC
             LIMIT %s
            """,
            params + [int(limit)],
        )
        regular_rows = [dict(r) for r in cur.fetchall()]

        all_rows = pinned_rows + regular_rows
        if not all_rows:
            return []

        post_ids = [r["id"] for r in all_rows]

        # Reactions (agrupadas por emoji)
        cur.execute(
            """
            SELECT post_id, emoji, COUNT(*) AS n,
                   BOOL_OR(user_id = %s) AS has_reacted
              FROM people_post_reactions
             WHERE post_id = ANY(%s)
             GROUP BY post_id, emoji
            """,
            (viewer_id, post_ids),
        )
        reactions_by_post: dict[int, list[dict]] = {}
        for r in cur.fetchall():
            reactions_by_post.setdefault(r["post_id"], []).append({
                "emoji": r["emoji"],
                "count": r["n"],
                "reacted": bool(r["has_reacted"]),
            })

        # Kudo info (si algun post tiene kudo_id)
        kudo_ids = [r["kudo_id"] for r in all_rows if r.get("kudo_id")]
        kudo_info: dict[int, dict] = {}
        if kudo_ids:
            cur.execute(
                """
                SELECT k.id, k.value_slug, k.message,
                       k.from_user_id, fu.name AS from_name, fu.avatar_url AS from_avatar,
                       k.to_user_id, tu.name AS to_name, tu.avatar_url AS to_avatar,
                       v.name AS value_name, v.emoji AS value_emoji, v.color AS value_color
                  FROM people_kudos k
                  JOIN users fu ON fu.id = k.from_user_id
                  JOIN users tu ON tu.id = k.to_user_id
                  LEFT JOIN people_values v ON v.slug = k.value_slug
                 WHERE k.id = ANY(%s)
                """,
                (kudo_ids,),
            )
            kudo_info = {r["id"]: dict(r) for r in cur.fetchall()}

    out: list[dict] = []
    for r in all_rows:
        d = _post_to_dict(r)
        d["reactions"] = reactions_by_post.get(r["id"], [])
        d["has_read"] = bool(d.get("has_read"))
        if d.get("kudo_id"):
            ki = kudo_info.get(d["kudo_id"])
            if ki:
                d["kudo"] = {
                    "id": ki["id"],
                    "value_slug": ki["value_slug"],
                    "value_name": ki["value_name"],
                    "value_emoji": ki["value_emoji"],
                    "value_color": ki["value_color"],
                    "message": ki["message"],
                    "from_user_id": ki["from_user_id"],
                    "from_name": ki["from_name"],
                    "from_avatar": ki["from_avatar"],
                    "to_user_id": ki["to_user_id"],
                    "to_name": ki["to_name"],
                    "to_avatar": ki["to_avatar"],
                }
        out.append(d)
    return out


def create_post(
    *,
    author_id: int,
    content: str,
    image_url: str | None = None,
    is_announcement: bool = False,
    pinned: bool = False,
    pinned_until: str | None = None,
    pinned_by: int | None = None,
    requires_read_ack: bool = False,
    kudo_id: int | None = None,
) -> dict:
    init()
    if not content or not content.strip():
        raise ValueError("content vacio")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO people_posts
              (author_id, content, image_url, is_announcement, pinned, pinned_until,
               pinned_by, requires_read_ack, kudo_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                author_id, content.strip(), image_url,
                is_announcement, pinned, pinned_until,
                pinned_by, requires_read_ack, kudo_id,
            ),
        )
        return _post_to_dict(cur.fetchone())


def get_post(post_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM people_posts WHERE id = %s", (post_id,))
        row = cur.fetchone()
    return _post_to_dict(row) if row else None


def update_post(post_id: int, *, content: str | None = None, image_url: str | None = None) -> dict | None:
    init()
    sets: list[str] = []
    params: list = []
    if content is not None:
        if not content.strip():
            raise ValueError("content vacio")
        sets.append("content = %s"); params.append(content.strip())
    if image_url is not None:
        sets.append("image_url = %s"); params.append(image_url or None)
    if not sets:
        return None
    sets.append("updated_at = NOW()")
    params.append(post_id)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"UPDATE people_posts SET {', '.join(sets)} "
            f"WHERE id = %s AND deleted_at IS NULL RETURNING *",
            params,
        )
        row = cur.fetchone()
    return _post_to_dict(row) if row else None


def delete_post(post_id: int) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE people_posts SET deleted_at = NOW() "
            "WHERE id = %s AND deleted_at IS NULL RETURNING id",
            (post_id,),
        )
        return cur.fetchone() is not None


def pin_post(post_id: int, *, by_user_id: int, pinned_until: str | None = None, requires_read_ack: bool = False) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE people_posts
               SET pinned = TRUE,
                   pinned_until = %s,
                   pinned_by = %s,
                   is_announcement = TRUE,
                   requires_read_ack = %s,
                   updated_at = NOW()
             WHERE id = %s AND deleted_at IS NULL
             RETURNING *
            """,
            (pinned_until, by_user_id, requires_read_ack, post_id),
        )
        row = cur.fetchone()
    return _post_to_dict(row) if row else None


def unpin_post(post_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE people_posts
               SET pinned = FALSE, pinned_until = NULL, pinned_by = NULL,
                   updated_at = NOW()
             WHERE id = %s AND deleted_at IS NULL
             RETURNING *
            """,
            (post_id,),
        )
        row = cur.fetchone()
    return _post_to_dict(row) if row else None


def mark_post_read(post_id: int, user_id: int) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO people_post_reads (post_id, user_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING",
            (post_id, user_id),
        )


def list_post_reads(post_id: int) -> list[dict]:
    """Lista de users que confirmaron leer un anuncio (para vista admin/People)."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT pr.user_id, pr.read_at, u.name, u.email, u.avatar_url
              FROM people_post_reads pr
              JOIN users u ON u.id = pr.user_id
             WHERE pr.post_id = %s
             ORDER BY pr.read_at DESC
            """,
            (post_id,),
        )
        return [
            {**dict(r), "read_at": _iso(r["read_at"])}
            for r in cur.fetchall()
        ]


# ---------- reactions ----------

def toggle_reaction(post_id: int, user_id: int, emoji: str) -> dict:
    """Si ya existe la reaccion (post,user,emoji) la quita; si no, la crea.

    Retorna el snapshot de reacciones del post post-cambio.
    """
    init()
    emoji = (emoji or "").strip()
    if not emoji:
        raise ValueError("emoji vacio")
    if len(emoji) > 16:
        raise ValueError("emoji invalido")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "DELETE FROM people_post_reactions "
            "WHERE post_id = %s AND user_id = %s AND emoji = %s RETURNING 1",
            (post_id, user_id, emoji),
        )
        deleted = cur.fetchone() is not None
        if not deleted:
            cur.execute(
                "INSERT INTO people_post_reactions (post_id, user_id, emoji) "
                "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                (post_id, user_id, emoji),
            )
        cur.execute(
            """
            SELECT emoji, COUNT(*) AS n, BOOL_OR(user_id = %s) AS has_reacted
              FROM people_post_reactions
             WHERE post_id = %s
             GROUP BY emoji
             ORDER BY n DESC
            """,
            (user_id, post_id),
        )
        rows = [
            {"emoji": r["emoji"], "count": r["n"], "reacted": bool(r["has_reacted"])}
            for r in cur.fetchall()
        ]
    return {"post_id": post_id, "reactions": rows, "added": not deleted}


# ---------- comments ----------

def list_comments(post_id: int) -> list[dict]:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.post_id, c.author_id, c.content, c.created_at,
                   u.name AS author_name, u.avatar_url AS author_avatar,
                   u.job_title AS author_job,
                   a.slug AS author_area_slug, a.color AS author_area_color
              FROM people_post_comments c
              JOIN users u ON u.id = c.author_id
              LEFT JOIN areas a ON a.id = u.area_id
             WHERE c.post_id = %s AND c.deleted_at IS NULL
             ORDER BY c.created_at ASC
            """,
            (post_id,),
        )
        return [
            {**dict(r), "created_at": _iso(r["created_at"])}
            for r in cur.fetchall()
        ]


def create_comment(post_id: int, author_id: int, content: str) -> dict:
    init()
    if not content or not content.strip():
        raise ValueError("content vacio")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO people_post_comments (post_id, author_id, content) "
            "VALUES (%s, %s, %s) RETURNING *",
            (post_id, author_id, content.strip()),
        )
        row = dict(cur.fetchone())
        row["created_at"] = _iso(row.get("created_at"))
        return row


def get_comment(comment_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM people_post_comments WHERE id = %s", (comment_id,))
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    d["created_at"] = _iso(d.get("created_at"))
    return d


def delete_comment(comment_id: int) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE people_post_comments SET deleted_at = NOW() "
            "WHERE id = %s AND deleted_at IS NULL RETURNING id",
            (comment_id,),
        )
        return cur.fetchone() is not None


# ---------- values ----------

def list_values(only_active: bool = True) -> list[dict]:
    init()
    sql = "SELECT * FROM people_values"
    if only_active:
        sql += " WHERE is_active = TRUE"
    sql += " ORDER BY sort_order, id"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql)
        return [dict(r) for r in cur.fetchall()]


def create_value(*, slug: str, name: str, emoji: str, color: str, description: str) -> dict:
    init()
    slug = (slug or "").strip().lower()
    if not slug or not name or not emoji:
        raise ValueError("slug, name, emoji son obligatorios")
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(sort_order), 0) AS m FROM people_values")
        next_order = int(cur.fetchone()["m"]) + 1
        cur.execute(
            """
            INSERT INTO people_values (slug, name, emoji, color, description, sort_order)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (slug, name.strip(), emoji.strip(), color.strip() or "#7a3eae",
             (description or "").strip(), next_order),
        )
        return dict(cur.fetchone())


def update_value(value_id: int, **kwargs) -> dict | None:
    init()
    allowed = {"name", "emoji", "color", "description", "is_active", "sort_order"}
    sets: list[str] = []
    params: list = []
    for k, v in kwargs.items():
        if k in allowed and v is not None:
            sets.append(f"{k} = %s"); params.append(v)
    if not sets:
        return None
    params.append(value_id)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"UPDATE people_values SET {', '.join(sets)} WHERE id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
    return dict(row) if row else None


def delete_value(value_id: int) -> bool:
    """Soft-delete: marca is_active = FALSE. No borra para preservar kudos historicos."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE people_values SET is_active = FALSE WHERE id = %s RETURNING id",
            (value_id,),
        )
        return cur.fetchone() is not None


# ---------- kudos ----------

def create_kudo(
    *,
    from_user_id: int,
    to_user_id: int,
    value_slug: str,
    message: str = "",
    auto_post: bool = True,
) -> dict:
    """Crea un kudo + opcional auto-post en el feed.

    Reglas:
    - no podes darte kudos a vos mismo
    - el value_slug debe existir y estar activo
    - el to_user_id debe estar activo
    """
    init()
    if from_user_id == to_user_id:
        raise ValueError("no podes darte kudos a vos mismo")
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT 1 FROM people_values WHERE slug = %s AND is_active = TRUE", (value_slug,))
        if not cur.fetchone():
            raise ValueError(f"value_slug invalido o inactivo: {value_slug}")
        cur.execute("SELECT name FROM users WHERE id = %s AND is_active = TRUE", (to_user_id,))
        to_user = cur.fetchone()
        if not to_user:
            raise ValueError("usuario destinatario inactivo o inexistente")
        cur.execute("SELECT name FROM users WHERE id = %s", (from_user_id,))
        from_user = cur.fetchone()

        cur.execute(
            """
            INSERT INTO people_kudos (from_user_id, to_user_id, value_slug, message)
            VALUES (%s, %s, %s, %s)
            RETURNING *
            """,
            (from_user_id, to_user_id, value_slug, (message or "").strip()),
        )
        kudo = dict(cur.fetchone())
        kudo["created_at"] = _iso(kudo.get("created_at"))

        post_id = None
        if auto_post:
            content = f"reconocio a @{to_user['name']} por #{value_slug}"
            if message and message.strip():
                content = content + "\n\n" + message.strip()
            cur.execute(
                """
                INSERT INTO people_posts (author_id, content, kudo_id)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (from_user_id, content, kudo["id"]),
            )
            post_id = cur.fetchone()["id"]
            cur.execute(
                "UPDATE people_kudos SET post_id = %s WHERE id = %s",
                (post_id, kudo["id"]),
            )
            kudo["post_id"] = post_id

    return kudo


def list_kudos(
    *,
    to_user_id: int | None = None,
    from_user_id: int | None = None,
    value_slug: str | None = None,
    limit: int = 50,
) -> list[dict]:
    init()
    sql = """
        SELECT k.*,
               fu.name AS from_name, fu.avatar_url AS from_avatar,
               tu.name AS to_name, tu.avatar_url AS to_avatar,
               v.name AS value_name, v.emoji AS value_emoji, v.color AS value_color
          FROM people_kudos k
          JOIN users fu ON fu.id = k.from_user_id
          JOIN users tu ON tu.id = k.to_user_id
          LEFT JOIN people_values v ON v.slug = k.value_slug
    """
    where: list[str] = []
    params: list = []
    if to_user_id is not None:
        where.append("k.to_user_id = %s"); params.append(to_user_id)
    if from_user_id is not None:
        where.append("k.from_user_id = %s"); params.append(from_user_id)
    if value_slug:
        where.append("k.value_slug = %s"); params.append(value_slug)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY k.created_at DESC LIMIT %s"
    params.append(int(limit))
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return [_kudo_to_dict(r) for r in cur.fetchall()]


def kudos_leaderboard(*, since_days: int = 90, limit: int = 20) -> dict:
    """Top dadores y top receptores de kudos en los ultimos N dias."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT k.to_user_id AS user_id, u.name, u.avatar_url,
                   a.slug AS area_slug, a.color AS area_color,
                   COUNT(*) AS n
              FROM people_kudos k
              JOIN users u ON u.id = k.to_user_id
              LEFT JOIN areas a ON a.id = u.area_id
             WHERE k.created_at >= NOW() - (%s::text || ' days')::interval
             GROUP BY k.to_user_id, u.name, u.avatar_url, a.slug, a.color
             ORDER BY n DESC
             LIMIT %s
            """,
            (since_days, limit),
        )
        top_receivers = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT k.from_user_id AS user_id, u.name, u.avatar_url,
                   a.slug AS area_slug, a.color AS area_color,
                   COUNT(*) AS n
              FROM people_kudos k
              JOIN users u ON u.id = k.from_user_id
              LEFT JOIN areas a ON a.id = u.area_id
             WHERE k.created_at >= NOW() - (%s::text || ' days')::interval
             GROUP BY k.from_user_id, u.name, u.avatar_url, a.slug, a.color
             ORDER BY n DESC
             LIMIT %s
            """,
            (since_days, limit),
        )
        top_givers = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT v.slug, v.name, v.emoji, v.color, COUNT(*) AS n
              FROM people_kudos k
              JOIN people_values v ON v.slug = k.value_slug
             WHERE k.created_at >= NOW() - (%s::text || ' days')::interval
             GROUP BY v.slug, v.name, v.emoji, v.color
             ORDER BY n DESC
            """,
            (since_days,),
        )
        by_value = [dict(r) for r in cur.fetchall()]

    return {
        "since_days": since_days,
        "top_receivers": top_receivers,
        "top_givers": top_givers,
        "by_value": by_value,
    }


def _kudo_to_dict(row: dict) -> dict:
    d = dict(row)
    if "created_at" in d:
        d["created_at"] = _iso(d.get("created_at"))
    return d

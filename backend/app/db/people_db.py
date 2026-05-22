"""
People — modulo social interno (Humand-like).

Tablas:
  people_spaces         -> canales/espacios (1 por area + globales fijos)
  people_posts          -> feed (posts, anuncios pinneados, soft-delete)
  people_post_reactions -> emoji reactions sobre posts
  people_post_comments  -> comentarios sobre un post
  people_post_reads     -> confirmacion de lectura de anuncios
  people_post_mentions  -> @menciones en posts/comments
  people_kudos          -> reconocimientos peer-to-peer (linkeados a un value)
  people_values         -> valores de empresa (configurables por admin/People)
  people_conversations  -> DMs 1:1 y grupos ad-hoc
  people_conv_members   -> miembros + last_read_at por conversation
  people_messages       -> mensajes en DM
  people_notifications  -> inbox unificada

Reglas:
- Cualquier user activo crea posts, comenta, reacciona, da kudos, DMea.
- Solo el autor o admin/People puede editar/borrar su post o comentario.
- Solo gerencia/admin/People puede pinear/despinear anuncios.
- Cada kudo crea automaticamente un post anclado al feed.

Espacios:
- 10 espacios kind='area' seedeados (1 por area operativa)
- 3 espacios kind='global' seedeados (anuncios, random, cumples)
- Politica de posteo por espacio:
    - anuncios  -> solo admin/gerencia/People (todos leen)
    - random    -> todos
    - cumples   -> todos (auto-post de cumples/aniv del dia)
    - area      -> todos (politica abierta para colaboracion cross-area)

Notificaciones disparadas:
- @mention en post o comment   -> notif a cada mencionado (kind=mention)
- kudo recibido                -> notif al destinatario (kind=kudo)
- comment en un post propio    -> notif al autor del post (kind=comment)
- nuevo DM message             -> notif a los demas miembros (kind=dm)
- post pineado con read_ack    -> notif a todos los users activos (kind=announcement)
"""
from __future__ import annotations

import datetime as dt
import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.people")

_LOCK = threading.RLock()
_INITIALIZED = False


# Espacios globales fijos (kind='global'). Las areas se generan dinamicamente.
GLOBAL_SPACES_SEED: list[tuple[str, str, str, str, str, str]] = [
    # (slug, name, emoji, color, description, posting_policy)
    ("anuncios", "Anuncios",  "📣", "#7a3eae", "Comunicaciones oficiales y posts pineables", "admins_only"),
    ("random",   "Random",    "🌀", "#0ea5e9", "Charla libre, memes, watercooler", "everyone"),
    ("cumples",  "Cumples",   "🎂", "#f59e0b", "Cumpleanos y aniversarios del equipo", "everyone"),
]


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
            # --- people_spaces (canales / espacios)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_spaces (
                    id              BIGSERIAL PRIMARY KEY,
                    slug            TEXT NOT NULL UNIQUE,
                    name            TEXT NOT NULL,
                    kind            TEXT NOT NULL CHECK (kind IN ('area','global','custom')),
                    area_id         BIGINT REFERENCES areas(id) ON DELETE CASCADE,
                    emoji           TEXT NOT NULL DEFAULT '💬',
                    color           TEXT NOT NULL DEFAULT '#7a3eae',
                    description     TEXT NOT NULL DEFAULT '',
                    posting_policy  TEXT NOT NULL DEFAULT 'everyone'
                                    CHECK (posting_policy IN ('everyone','admins_only','area_members')),
                    sort_order      INT NOT NULL DEFAULT 0,
                    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_people_spaces_kind ON people_spaces(kind, sort_order)")

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
                    space_id          BIGINT REFERENCES people_spaces(id) ON DELETE SET NULL,
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
            # Migracion idempotente: agregar space_id a tablas existentes
            cur.execute(
                "ALTER TABLE people_posts "
                "ADD COLUMN IF NOT EXISTS space_id BIGINT REFERENCES people_spaces(id) ON DELETE SET NULL"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_posts_feed "
                "ON people_posts (created_at DESC) WHERE deleted_at IS NULL"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_posts_space "
                "ON people_posts (space_id, created_at DESC) WHERE deleted_at IS NULL"
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

            # --- people_post_mentions (menciones en posts/comments)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_post_mentions (
                    id                  BIGSERIAL PRIMARY KEY,
                    post_id             BIGINT REFERENCES people_posts(id) ON DELETE CASCADE,
                    comment_id          BIGINT REFERENCES people_post_comments(id) ON DELETE CASCADE,
                    mentioned_user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    mentioner_user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CHECK ((post_id IS NULL) <> (comment_id IS NULL))
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_mentions_user "
                "ON people_post_mentions (mentioned_user_id, created_at DESC)"
            )

            # --- people_conversations (DMs 1:1 + grupos)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_conversations (
                    id              BIGSERIAL PRIMARY KEY,
                    kind            TEXT NOT NULL CHECK (kind IN ('dm','group')),
                    name            TEXT,
                    created_by      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_conv_last "
                "ON people_conversations (last_message_at DESC)"
            )

            # --- people_conversation_members
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_conversation_members (
                    conversation_id BIGINT NOT NULL REFERENCES people_conversations(id) ON DELETE CASCADE,
                    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (conversation_id, user_id)
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_conv_members_user "
                "ON people_conversation_members (user_id, conversation_id)"
            )

            # --- people_messages
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_messages (
                    id              BIGSERIAL PRIMARY KEY,
                    conversation_id BIGINT NOT NULL REFERENCES people_conversations(id) ON DELETE CASCADE,
                    author_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    content         TEXT NOT NULL,
                    image_url       TEXT,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    deleted_at      TIMESTAMPTZ
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_messages_conv "
                "ON people_messages (conversation_id, created_at DESC) WHERE deleted_at IS NULL"
            )

            # --- polls (encuestas dentro de posts)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_polls (
                    id            BIGSERIAL PRIMARY KEY,
                    post_id       BIGINT NOT NULL UNIQUE REFERENCES people_posts(id) ON DELETE CASCADE,
                    question      TEXT NOT NULL,
                    multi_choice  BOOLEAN NOT NULL DEFAULT FALSE,
                    closes_at     TIMESTAMPTZ,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_poll_options (
                    id          BIGSERIAL PRIMARY KEY,
                    poll_id     BIGINT NOT NULL REFERENCES people_polls(id) ON DELETE CASCADE,
                    label       TEXT NOT NULL,
                    sort_order  INT NOT NULL DEFAULT 0
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_poll_votes (
                    poll_id    BIGINT NOT NULL REFERENCES people_polls(id) ON DELETE CASCADE,
                    option_id  BIGINT NOT NULL REFERENCES people_poll_options(id) ON DELETE CASCADE,
                    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (poll_id, option_id, user_id)
                )
            """)

            # --- bookmarks (posts guardados por user)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_post_bookmarks (
                    post_id    BIGINT NOT NULL REFERENCES people_posts(id) ON DELETE CASCADE,
                    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (post_id, user_id)
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_bookmarks_user "
                "ON people_post_bookmarks (user_id, created_at DESC)"
            )

            # ALTER idempotentes para edited_at
            cur.execute(
                "ALTER TABLE people_posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ"
            )
            cur.execute(
                "ALTER TABLE people_post_comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ"
            )

            # --- people_notifications (inbox unificado)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS people_notifications (
                    id              BIGSERIAL PRIMARY KEY,
                    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    kind            TEXT NOT NULL,
                    actor_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
                    source_kind     TEXT,
                    source_id       BIGINT,
                    preview         TEXT,
                    link            TEXT,
                    read_at         TIMESTAMPTZ,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_notif_unread "
                "ON people_notifications (user_id, created_at DESC) WHERE read_at IS NULL"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_notif_all "
                "ON people_notifications (user_id, created_at DESC)"
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

            # Seed espacios: 3 globales + 1 por cada area existente.
            # Idempotente: solo inserta los slugs que faltan.
            for i, (slug, name, emoji, color, desc, policy) in enumerate(GLOBAL_SPACES_SEED):
                cur.execute("SELECT 1 FROM people_spaces WHERE slug = %s", (slug,))
                if cur.fetchone() is None:
                    cur.execute(
                        """
                        INSERT INTO people_spaces (slug, name, kind, emoji, color, description, posting_policy, sort_order)
                        VALUES (%s, %s, 'global', %s, %s, %s, %s, %s)
                        """,
                        (slug, name, emoji, color, desc, policy, i),
                    )

            # Espacios kind='area' (1 por area operativa). Slug = 'area-<slug-area>'.
            cur.execute("SELECT id, slug, name, color, sort_order FROM areas ORDER BY sort_order")
            area_rows = cur.fetchall()
            base_order = 100  # despues de los globales
            for ar in area_rows:
                space_slug = f"area-{ar['slug']}"
                cur.execute("SELECT 1 FROM people_spaces WHERE slug = %s", (space_slug,))
                if cur.fetchone() is None:
                    cur.execute(
                        """
                        INSERT INTO people_spaces (slug, name, kind, area_id, emoji, color, description, posting_policy, sort_order)
                        VALUES (%s, %s, 'area', %s, %s, %s, %s, 'everyone', %s)
                        """,
                        (space_slug, ar["name"], ar["id"], "💬", ar["color"],
                         f"Espacio del area {ar['name']}", base_order + ar["sort_order"]),
                    )
            log.info("people_spaces seedeados (idempotente): %d globales + %d areas",
                     len(GLOBAL_SPACES_SEED), len(area_rows))

            # Backfill: posts existentes sin space_id van a 'random'
            cur.execute("SELECT id FROM people_spaces WHERE slug = 'random'")
            random_row = cur.fetchone()
            if random_row:
                cur.execute(
                    "UPDATE people_posts SET space_id = %s WHERE space_id IS NULL",
                    (random_row["id"],),
                )
                # log opcional de cuantos posts se movieron
                if cur.rowcount > 0:
                    log.info("backfill posts->random: %d posts", cur.rowcount)

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
    space_id: int | None = None,
) -> list[dict]:
    """Lista de posts (pinned arriba siempre + resto por fecha desc).

    Si space_id viene, filtra al espacio. Sin filtro = todos los espacios.
    """
    init()
    with get_conn() as c, c.cursor() as cur:
        params: list = [viewer_id]
        cursor_clause = ""
        if before_id is not None:
            cursor_clause = "AND p.id < %s"
            params.append(before_id)
        space_clause = ""
        if space_id is not None:
            space_clause = "AND p.space_id = %s"
            params.append(int(space_id))

        # Para los pinned usamos params separados (no incluyen cursor)
        pinned_params: list = [viewer_id]
        pinned_space_clause = ""
        if space_id is not None:
            pinned_space_clause = "AND p.space_id = %s"
            pinned_params.append(int(space_id))

        pinned_rows: list[dict] = []
        if before_id is None:
            cur.execute(
                f"""
                SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
                       u.job_title AS author_job, a.slug AS author_area_slug,
                       a.name AS author_area_name, a.color AS author_area_color,
                       sp.slug AS space_slug, sp.name AS space_name,
                       sp.emoji AS space_emoji, sp.color AS space_color, sp.kind AS space_kind,
                       (SELECT COUNT(*) FROM people_post_comments c
                          WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
                       EXISTS(SELECT 1 FROM people_post_reads pr
                              WHERE pr.post_id = p.id AND pr.user_id = %s) AS has_read
                  FROM people_posts p
                  JOIN users u ON u.id = p.author_id
                  LEFT JOIN areas a ON a.id = u.area_id
                  LEFT JOIN people_spaces sp ON sp.id = p.space_id
                 WHERE p.deleted_at IS NULL
                   AND p.pinned = TRUE
                   AND (p.pinned_until IS NULL OR p.pinned_until > NOW())
                   {pinned_space_clause}
                 ORDER BY p.created_at DESC
                """,
                pinned_params,
            )
            pinned_rows = [dict(r) for r in cur.fetchall()]

        cur.execute(
            f"""
            SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
                   u.job_title AS author_job, a.slug AS author_area_slug,
                   a.name AS author_area_name, a.color AS author_area_color,
                   sp.slug AS space_slug, sp.name AS space_name,
                   sp.emoji AS space_emoji, sp.color AS space_color, sp.kind AS space_kind,
                   (SELECT COUNT(*) FROM people_post_comments c
                      WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
                   EXISTS(SELECT 1 FROM people_post_reads pr
                          WHERE pr.post_id = p.id AND pr.user_id = %s) AS has_read
              FROM people_posts p
              JOIN users u ON u.id = p.author_id
              LEFT JOIN areas a ON a.id = u.area_id
              LEFT JOIN people_spaces sp ON sp.id = p.space_id
             WHERE p.deleted_at IS NULL
               AND (p.pinned = FALSE OR p.pinned_until <= NOW())
               {cursor_clause}
               {space_clause}
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

    # Bookmarks del viewer
    bookmarks_set: set[int] = set()
    polls_by_post: dict[int, dict] = {}
    with get_conn() as c, c.cursor() as cur:
        if post_ids:
            cur.execute(
                "SELECT post_id FROM people_post_bookmarks WHERE user_id = %s AND post_id = ANY(%s)",
                (viewer_id, post_ids),
            )
            bookmarks_set = {r["post_id"] for r in cur.fetchall()}
            # Polls
            cur.execute("""
                SELECT p.id, p.post_id, p.question, p.multi_choice, p.closes_at
                  FROM people_polls p WHERE p.post_id = ANY(%s)
            """, (post_ids,))
            polls_meta = {r["post_id"]: dict(r) for r in cur.fetchall()}
            if polls_meta:
                poll_ids = [pm["id"] for pm in polls_meta.values()]
                cur.execute("""
                    SELECT o.id, o.poll_id, o.label, o.sort_order,
                           (SELECT COUNT(*) FROM people_poll_votes v WHERE v.option_id = o.id) AS votes,
                           EXISTS(SELECT 1 FROM people_poll_votes v WHERE v.option_id = o.id AND v.user_id = %s) AS my_vote
                      FROM people_poll_options o WHERE o.poll_id = ANY(%s) ORDER BY o.sort_order
                """, (viewer_id, poll_ids))
                opts_by_poll: dict[int, list[dict]] = {}
                for r in cur.fetchall():
                    opts_by_poll.setdefault(r["poll_id"], []).append({
                        "id": r["id"], "label": r["label"], "sort_order": r["sort_order"],
                        "votes": int(r["votes"]), "my_vote": bool(r["my_vote"]),
                    })
                cur.execute(
                    "SELECT poll_id, COUNT(DISTINCT user_id) AS n FROM people_poll_votes "
                    "WHERE poll_id = ANY(%s) GROUP BY poll_id",
                    (poll_ids,),
                )
                voters_by_poll = {r["poll_id"]: int(r["n"]) for r in cur.fetchall()}
                for post_id_, pm in polls_meta.items():
                    polls_by_post[post_id_] = {
                        "id": pm["id"],
                        "question": pm["question"],
                        "multi_choice": bool(pm["multi_choice"]),
                        "closes_at": _iso(pm.get("closes_at")),
                        "options": opts_by_poll.get(pm["id"], []),
                        "total_voters": voters_by_poll.get(pm["id"], 0),
                    }

    out: list[dict] = []
    for r in all_rows:
        d = _post_to_dict(r)
        d["reactions"] = reactions_by_post.get(r["id"], [])
        d["has_read"] = bool(d.get("has_read"))
        d["bookmarked"] = r["id"] in bookmarks_set
        if r["id"] in polls_by_post:
            d["poll"] = polls_by_post[r["id"]]
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
    space_id: int | None = None,
    mention_user_ids: list[int] | None = None,
    author_name: str | None = None,
) -> dict:
    init()
    if not content or not content.strip():
        raise ValueError("content vacio")
    # Default space si no viene: random (creado en seed)
    if space_id is None:
        space_id = _get_space_id_by_slug("random")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO people_posts
              (author_id, space_id, content, image_url, is_announcement, pinned, pinned_until,
               pinned_by, requires_read_ack, kudo_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                author_id, space_id, content.strip(), image_url,
                is_announcement, pinned, pinned_until,
                pinned_by, requires_read_ack, kudo_id,
            ),
        )
        post = _post_to_dict(cur.fetchone())

        # Registrar menciones + disparar notifs
        if mention_user_ids:
            preview = content.strip()[:140]
            link = f"/dashboard/people?post_id={post['id']}"
            for mid in set(mention_user_ids):
                if mid == author_id:
                    continue  # no self-mention notif
                cur.execute(
                    "INSERT INTO people_post_mentions (post_id, mentioned_user_id, mentioner_user_id) "
                    "VALUES (%s, %s, %s)",
                    (post["id"], mid, author_id),
                )
                cur.execute(
                    """INSERT INTO people_notifications
                       (user_id, kind, actor_user_id, source_kind, source_id, preview, link)
                       VALUES (%s, 'mention', %s, 'post', %s, %s, %s)""",
                    (mid, author_id, post["id"], preview, link),
                )
    return post


def _get_space_id_by_slug(slug: str) -> int | None:
    """Cache-free lookup. Llamado pocas veces (creacion de posts)."""
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT id FROM people_spaces WHERE slug = %s", (slug,))
        r = cur.fetchone()
    return r["id"] if r else None


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
    sets.append("edited_at = NOW()")
    params.append(post_id)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"UPDATE people_posts SET {', '.join(sets)} "
            f"WHERE id = %s AND deleted_at IS NULL RETURNING *",
            params,
        )
        row = cur.fetchone()
    return _post_to_dict(row) if row else None


def update_comment(comment_id: int, *, content: str) -> dict | None:
    init()
    if not content or not content.strip():
        raise ValueError("content vacio")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE people_post_comments SET content = %s, edited_at = NOW() "
            "WHERE id = %s AND deleted_at IS NULL RETURNING *",
            (content.strip(), comment_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    d["created_at"] = _iso(d.get("created_at"))
    d["edited_at"] = _iso(d.get("edited_at"))
    return d


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
        if row and requires_read_ack:
            # Notifica a todos los users activos (excepto el que pinea)
            preview = (row["content"] or "")[:140]
            link = f"/dashboard/people?post_id={post_id}"
            cur.execute(
                """
                INSERT INTO people_notifications
                   (user_id, kind, actor_user_id, source_kind, source_id, preview, link)
                SELECT u.id, 'announcement', %s, 'post', %s, %s, %s
                  FROM users u
                 WHERE u.is_active = TRUE AND u.id <> %s
                """,
                (by_user_id, post_id, preview, link, by_user_id),
            )
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


def create_comment(
    post_id: int,
    author_id: int,
    content: str,
    *,
    mention_user_ids: list[int] | None = None,
) -> dict:
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
        cid = row["id"]
        preview = content.strip()[:140]
        link = f"/dashboard/people?post_id={post_id}"

        # Notif al autor del post (si no es el mismo que comenta)
        cur.execute(
            "SELECT author_id FROM people_posts WHERE id = %s AND deleted_at IS NULL",
            (post_id,),
        )
        post_row = cur.fetchone()
        if post_row and post_row["author_id"] != author_id:
            cur.execute(
                """INSERT INTO people_notifications
                   (user_id, kind, actor_user_id, source_kind, source_id, preview, link)
                   VALUES (%s, 'comment', %s, 'comment', %s, %s, %s)""",
                (post_row["author_id"], author_id, cid, preview, link),
            )

        # Menciones en el comment
        if mention_user_ids:
            for mid in set(mention_user_ids):
                if mid == author_id:
                    continue
                cur.execute(
                    "INSERT INTO people_post_mentions (comment_id, mentioned_user_id, mentioner_user_id) "
                    "VALUES (%s, %s, %s)",
                    (cid, mid, author_id),
                )
                cur.execute(
                    """INSERT INTO people_notifications
                       (user_id, kind, actor_user_id, source_kind, source_id, preview, link)
                       VALUES (%s, 'mention', %s, 'comment', %s, %s, %s)""",
                    (mid, author_id, cid, preview, link),
                )

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
            random_space = _get_space_id_by_slug_inline(cur, "random")
            content = f"reconocio a @{to_user['name']} por #{value_slug}"
            if message and message.strip():
                content = content + "\n\n" + message.strip()
            cur.execute(
                """
                INSERT INTO people_posts (author_id, content, kudo_id, space_id)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (from_user_id, content, kudo["id"], random_space),
            )
            post_id = cur.fetchone()["id"]
            cur.execute(
                "UPDATE people_kudos SET post_id = %s WHERE id = %s",
                (post_id, kudo["id"]),
            )
            kudo["post_id"] = post_id

        # Notif al destinatario del kudo
        preview = (message or "").strip()[:140] or f"#{value_slug}"
        link = f"/dashboard/people/{to_user_id}"
        cur.execute(
            """INSERT INTO people_notifications
               (user_id, kind, actor_user_id, source_kind, source_id, preview, link)
               VALUES (%s, 'kudo', %s, 'kudo', %s, %s, %s)""",
            (to_user_id, from_user_id, kudo["id"], preview, link),
        )

    return kudo


def _get_space_id_by_slug_inline(cur, slug: str) -> int | None:
    cur.execute("SELECT id FROM people_spaces WHERE slug = %s", (slug,))
    r = cur.fetchone()
    return r["id"] if r else None


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


# ============================================================
# Spaces (canales)
# ============================================================

def list_spaces(*, viewer_id: int) -> list[dict]:
    """Lista todos los espacios activos enriquecidos con:
    - last_post_at: timestamp del ultimo post no borrado
    - posts_count: total de posts no borrados
    - is_default_for_viewer: True si el viewer pertenece al area del espacio
    El cliente decide cuales mostrar como 'mios' vs 'otros'.
    """
    init()
    with get_conn() as c, c.cursor() as cur:
        # Areas a las que pertenece el viewer (primaria + secundarias)
        cur.execute("""
            SELECT u.area_id AS primary_area
              FROM users u WHERE u.id = %s
        """, (viewer_id,))
        urow = cur.fetchone()
        primary_area = urow["primary_area"] if urow else None
        cur.execute(
            "SELECT area_id FROM user_areas WHERE user_id = %s",
            (viewer_id,),
        )
        viewer_areas = set(r["area_id"] for r in cur.fetchall())
        if primary_area:
            viewer_areas.add(primary_area)

        cur.execute("""
            SELECT s.*,
                   (SELECT MAX(p.created_at) FROM people_posts p
                     WHERE p.space_id = s.id AND p.deleted_at IS NULL) AS last_post_at,
                   (SELECT COUNT(*) FROM people_posts p
                     WHERE p.space_id = s.id AND p.deleted_at IS NULL) AS posts_count
              FROM people_spaces s
             WHERE s.is_active = TRUE
             ORDER BY s.kind, s.sort_order, s.name
        """)
        rows = [dict(r) for r in cur.fetchall()]

    out = []
    for r in rows:
        r["last_post_at"] = _iso(r.get("last_post_at"))
        r["created_at"] = _iso(r.get("created_at"))
        r["is_default_for_viewer"] = bool(
            r.get("kind") == "global" or
            (r.get("area_id") and r["area_id"] in viewer_areas)
        )
        out.append(r)
    return out


def get_space(space_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM people_spaces WHERE id = %s", (space_id,))
        r = cur.fetchone()
    if not r:
        return None
    d = dict(r)
    d["created_at"] = _iso(d.get("created_at"))
    return d


def can_post_in_space(space: dict, *, is_privileged: bool, in_people: bool) -> bool:
    """Devuelve True si el viewer puede postear en el espacio dado."""
    policy = space.get("posting_policy", "everyone")
    if policy == "everyone":
        return True
    if policy == "admins_only":
        return is_privileged or in_people
    if policy == "area_members":
        # Politica futura para spaces custom de equipos
        return True
    return False


# ============================================================
# Mentions search (autocompletar)
# ============================================================

def search_users_for_mention(query: str, *, limit: int = 8) -> list[dict]:
    """Devuelve users activos cuyo nombre/email matchea con la query.

    Pensado para el autocompletar de @ en composer.
    """
    init()
    q = (query or "").strip()
    if not q:
        # Fallback: primeros N alfabeticos
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                SELECT u.id, u.name, u.email, u.avatar_url, u.job_title,
                       a.slug AS area_slug, a.color AS area_color, a.name AS area_name
                  FROM users u
                  LEFT JOIN areas a ON a.id = u.area_id
                 WHERE u.is_active = TRUE
                 ORDER BY u.name ASC
                 LIMIT %s
            """, (limit,))
            return [dict(r) for r in cur.fetchall()]
    pat = f"%{q.lower()}%"
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT u.id, u.name, u.email, u.avatar_url, u.job_title,
                   a.slug AS area_slug, a.color AS area_color, a.name AS area_name
              FROM users u
              LEFT JOIN areas a ON a.id = u.area_id
             WHERE u.is_active = TRUE
               AND (LOWER(u.name) LIKE %s OR LOWER(u.email) LIKE %s)
             ORDER BY
               CASE WHEN LOWER(u.name) LIKE %s THEN 0 ELSE 1 END,
               u.name ASC
             LIMIT %s
        """, (pat, pat, pat, limit))
        return [dict(r) for r in cur.fetchall()]


# ============================================================
# DMs (conversations + messages)
# ============================================================

def list_my_conversations(*, user_id: int) -> list[dict]:
    """Conversations del user con preview del ultimo mensaje + unread count."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT c.id, c.kind, c.name, c.last_message_at, c.created_at, c.created_by,
                   cm.last_read_at,
                   (SELECT m.content FROM people_messages m
                     WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
                     ORDER BY m.created_at DESC LIMIT 1) AS last_preview,
                   (SELECT m.author_id FROM people_messages m
                     WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
                     ORDER BY m.created_at DESC LIMIT 1) AS last_author_id,
                   (SELECT COUNT(*) FROM people_messages m
                     WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
                       AND m.created_at > cm.last_read_at
                       AND m.author_id <> %s) AS unread_count
              FROM people_conversations c
              JOIN people_conversation_members cm ON cm.conversation_id = c.id
             WHERE cm.user_id = %s
             ORDER BY c.last_message_at DESC
        """, (user_id, user_id))
        convs = [dict(r) for r in cur.fetchall()]
        if not convs:
            return []
        ids = [c["id"] for c in convs]
        cur.execute("""
            SELECT cm.conversation_id, u.id, u.name, u.email, u.avatar_url, u.job_title,
                   a.color AS area_color, a.name AS area_name
              FROM people_conversation_members cm
              JOIN users u ON u.id = cm.user_id
              LEFT JOIN areas a ON a.id = u.area_id
             WHERE cm.conversation_id = ANY(%s)
        """, (ids,))
        members_by_conv: dict[int, list[dict]] = {}
        for r in cur.fetchall():
            d = dict(r)
            cid = d.pop("conversation_id")
            members_by_conv.setdefault(cid, []).append(d)

    out = []
    for c in convs:
        c["last_message_at"] = _iso(c.get("last_message_at"))
        c["created_at"] = _iso(c.get("created_at"))
        c["last_read_at"] = _iso(c.get("last_read_at"))
        c["members"] = members_by_conv.get(c["id"], [])
        out.append(c)
    return out


def get_or_create_dm(*, user_a: int, user_b: int) -> int:
    """DM 1:1: si ya existe, devuelve el id; si no, lo crea con ambos miembros."""
    init()
    if user_a == user_b:
        raise ValueError("no podes DMearte a vos mismo")
    with get_conn() as c, c.cursor() as cur:
        # Buscar DM existente entre ambos
        cur.execute("""
            SELECT c.id FROM people_conversations c
             WHERE c.kind = 'dm'
               AND EXISTS(SELECT 1 FROM people_conversation_members
                          WHERE conversation_id = c.id AND user_id = %s)
               AND EXISTS(SELECT 1 FROM people_conversation_members
                          WHERE conversation_id = c.id AND user_id = %s)
               AND (SELECT COUNT(*) FROM people_conversation_members
                     WHERE conversation_id = c.id) = 2
             LIMIT 1
        """, (user_a, user_b))
        existing = cur.fetchone()
        if existing:
            return existing["id"]
        cur.execute(
            "INSERT INTO people_conversations (kind, created_by) VALUES ('dm', %s) RETURNING id",
            (user_a,),
        )
        cid = cur.fetchone()["id"]
        for uid in (user_a, user_b):
            cur.execute(
                "INSERT INTO people_conversation_members (conversation_id, user_id) "
                "VALUES (%s, %s)",
                (cid, uid),
            )
    return cid


def create_group_conversation(*, name: str, created_by: int, member_ids: list[int]) -> int:
    init()
    if not member_ids:
        raise ValueError("member_ids vacio")
    members = set(int(x) for x in member_ids)
    members.add(created_by)
    if len(members) < 2:
        raise ValueError("un grupo necesita al menos 2 miembros")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO people_conversations (kind, name, created_by) VALUES ('group', %s, %s) RETURNING id",
            ((name or "").strip() or None, created_by),
        )
        cid = cur.fetchone()["id"]
        for uid in members:
            cur.execute(
                "INSERT INTO people_conversation_members (conversation_id, user_id) "
                "VALUES (%s, %s)",
                (cid, uid),
            )
    return cid


def is_member_of_conversation(conversation_id: int, user_id: int) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM people_conversation_members "
            "WHERE conversation_id = %s AND user_id = %s",
            (conversation_id, user_id),
        )
        return cur.fetchone() is not None


def list_messages(*, conversation_id: int, viewer_id: int, limit: int = 50, before_id: int | None = None) -> list[dict]:
    """Mensajes de una conversation (mas nuevos primero invertidos -> mas viejos arriba)."""
    init()
    if not is_member_of_conversation(conversation_id, viewer_id):
        raise PermissionError("no sos miembro de esta conversation")
    params: list = [conversation_id]
    extra = ""
    if before_id is not None:
        extra = "AND m.id < %s"
        params.append(int(before_id))
    params.append(int(limit))
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"""
            SELECT m.*, u.name AS author_name, u.avatar_url AS author_avatar,
                   a.color AS author_area_color
              FROM people_messages m
              JOIN users u ON u.id = m.author_id
              LEFT JOIN areas a ON a.id = u.area_id
             WHERE m.conversation_id = %s
               AND m.deleted_at IS NULL
               {extra}
             ORDER BY m.id DESC
             LIMIT %s
            """,
            params,
        )
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["created_at"] = _iso(r.get("created_at"))
    rows.reverse()  # ascending para el render
    return rows


def post_message(*, conversation_id: int, author_id: int, content: str, image_url: str | None = None) -> dict:
    init()
    if not is_member_of_conversation(conversation_id, author_id):
        raise PermissionError("no sos miembro de esta conversation")
    if not content or not content.strip():
        raise ValueError("content vacio")
    preview = content.strip()[:140]
    link = f"/dashboard/people/dms?conversation_id={conversation_id}"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO people_messages (conversation_id, author_id, content, image_url) "
            "VALUES (%s, %s, %s, %s) RETURNING *",
            (conversation_id, author_id, content.strip(), image_url),
        )
        msg = dict(cur.fetchone())
        msg["created_at"] = _iso(msg.get("created_at"))
        # bump last_message_at + author's own last_read_at
        cur.execute(
            "UPDATE people_conversations SET last_message_at = NOW() WHERE id = %s",
            (conversation_id,),
        )
        cur.execute(
            "UPDATE people_conversation_members SET last_read_at = NOW() "
            "WHERE conversation_id = %s AND user_id = %s",
            (conversation_id, author_id),
        )
        # Notificar a los demas miembros
        cur.execute(
            """
            INSERT INTO people_notifications
               (user_id, kind, actor_user_id, source_kind, source_id, preview, link)
            SELECT cm.user_id, 'dm', %s, 'message', %s, %s, %s
              FROM people_conversation_members cm
             WHERE cm.conversation_id = %s AND cm.user_id <> %s
            """,
            (author_id, msg["id"], preview, link, conversation_id, author_id),
        )
    return msg


def mark_conversation_read(*, conversation_id: int, user_id: int) -> None:
    init()
    if not is_member_of_conversation(conversation_id, user_id):
        return
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE people_conversation_members SET last_read_at = NOW() "
            "WHERE conversation_id = %s AND user_id = %s",
            (conversation_id, user_id),
        )


# ============================================================
# Notifications
# ============================================================

def list_notifications(*, user_id: int, unread_only: bool = False, limit: int = 50) -> list[dict]:
    init()
    sql = """
        SELECT n.*, u.name AS actor_name, u.avatar_url AS actor_avatar,
               a.color AS actor_area_color
          FROM people_notifications n
          LEFT JOIN users u ON u.id = n.actor_user_id
          LEFT JOIN areas a ON a.id = u.area_id
         WHERE n.user_id = %s
    """
    params: list = [user_id]
    if unread_only:
        sql += " AND n.read_at IS NULL"
    sql += " ORDER BY n.created_at DESC LIMIT %s"
    params.append(int(limit))
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["created_at"] = _iso(r.get("created_at"))
        r["read_at"] = _iso(r.get("read_at"))
    return rows


def unread_badge(*, user_id: int) -> dict:
    """Solo el count, rapido para polling. Tambien devuelve count de DMs unread."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) AS n FROM people_notifications "
            "WHERE user_id = %s AND read_at IS NULL",
            (user_id,),
        )
        notif = cur.fetchone()["n"]
        cur.execute(
            """
            SELECT COUNT(*) AS n
              FROM people_conversation_members cm
              JOIN people_conversations c ON c.id = cm.conversation_id
             WHERE cm.user_id = %s
               AND c.last_message_at > cm.last_read_at
               AND EXISTS(SELECT 1 FROM people_messages m
                          WHERE m.conversation_id = c.id
                            AND m.author_id <> %s
                            AND m.deleted_at IS NULL
                            AND m.created_at > cm.last_read_at)
            """,
            (user_id, user_id),
        )
        dms = cur.fetchone()["n"]
    return {"notifications_unread": int(notif), "dms_unread": int(dms), "total": int(notif) + int(dms)}


def mark_notification_read(*, notification_id: int, user_id: int) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE people_notifications SET read_at = NOW() "
            "WHERE id = %s AND user_id = %s AND read_at IS NULL RETURNING id",
            (notification_id, user_id),
        )
        return cur.fetchone() is not None


def mark_all_notifications_read(*, user_id: int) -> int:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE people_notifications SET read_at = NOW() "
            "WHERE user_id = %s AND read_at IS NULL",
            (user_id,),
        )
        return cur.rowcount or 0


# ============================================================
# Polls (encuestas dentro de posts)
# ============================================================

def create_poll(*, post_id: int, question: str, options: list[str], multi_choice: bool = False, closes_at: str | None = None) -> dict:
    init()
    options = [o.strip() for o in options if o and o.strip()]
    if len(options) < 2:
        raise ValueError("una encuesta necesita al menos 2 opciones")
    if not question or not question.strip():
        raise ValueError("question vacia")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO people_polls (post_id, question, multi_choice, closes_at) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            (post_id, question.strip(), multi_choice, closes_at),
        )
        poll_id = cur.fetchone()["id"]
        for i, label in enumerate(options):
            cur.execute(
                "INSERT INTO people_poll_options (poll_id, label, sort_order) VALUES (%s, %s, %s)",
                (poll_id, label, i),
            )
    return {"poll_id": poll_id}


def get_poll_for_post(post_id: int, *, viewer_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM people_polls WHERE post_id = %s", (post_id,))
        poll = cur.fetchone()
        if not poll:
            return None
        cur.execute("""
            SELECT o.id, o.label, o.sort_order,
                   (SELECT COUNT(*) FROM people_poll_votes v WHERE v.option_id = o.id) AS votes,
                   EXISTS(SELECT 1 FROM people_poll_votes v WHERE v.option_id = o.id AND v.user_id = %s) AS my_vote
              FROM people_poll_options o
             WHERE o.poll_id = %s
             ORDER BY o.sort_order
        """, (viewer_id, poll["id"]))
        options = [dict(r) for r in cur.fetchall()]
        for o in options:
            o["my_vote"] = bool(o["my_vote"])
        cur.execute(
            "SELECT COUNT(DISTINCT user_id) AS n FROM people_poll_votes WHERE poll_id = %s",
            (poll["id"],),
        )
        total_voters = cur.fetchone()["n"]
    return {
        "id": poll["id"],
        "question": poll["question"],
        "multi_choice": bool(poll["multi_choice"]),
        "closes_at": _iso(poll.get("closes_at")),
        "options": options,
        "total_voters": int(total_voters),
        "closed": bool(poll.get("closes_at") and poll["closes_at"] < dt.datetime.now(dt.timezone.utc)),
    }


def vote_poll(*, post_id: int, option_id: int, user_id: int) -> dict:
    init()
    with get_conn() as c, c.cursor() as cur:
        # Validar que la opcion pertenece a un poll de ese post
        cur.execute("""
            SELECT p.id AS poll_id, p.multi_choice, p.closes_at
              FROM people_polls p
              JOIN people_poll_options o ON o.poll_id = p.id
             WHERE p.post_id = %s AND o.id = %s
        """, (post_id, option_id))
        poll = cur.fetchone()
        if not poll:
            raise ValueError("opcion invalida")
        if poll.get("closes_at"):
            cur.execute("SELECT NOW() > %s AS closed", (poll["closes_at"],))
            if cur.fetchone()["closed"]:
                raise ValueError("encuesta cerrada")
        if not poll["multi_choice"]:
            # Single choice: borrar votos previos del user en este poll
            cur.execute(
                "DELETE FROM people_poll_votes WHERE poll_id = %s AND user_id = %s",
                (poll["poll_id"], user_id),
            )
        cur.execute(
            "INSERT INTO people_poll_votes (poll_id, option_id, user_id) "
            "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (poll["poll_id"], option_id, user_id),
        )
    return get_poll_for_post(post_id, viewer_id=user_id) or {}


def unvote_poll(*, post_id: int, option_id: int, user_id: int) -> dict:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT p.id AS poll_id FROM people_polls p
              JOIN people_poll_options o ON o.poll_id = p.id
             WHERE p.post_id = %s AND o.id = %s
        """, (post_id, option_id))
        poll = cur.fetchone()
        if not poll:
            raise ValueError("opcion invalida")
        cur.execute(
            "DELETE FROM people_poll_votes WHERE poll_id = %s AND option_id = %s AND user_id = %s",
            (poll["poll_id"], option_id, user_id),
        )
    return get_poll_for_post(post_id, viewer_id=user_id) or {}


# ============================================================
# Bookmarks
# ============================================================

def toggle_bookmark(*, post_id: int, user_id: int) -> dict:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "DELETE FROM people_post_bookmarks WHERE post_id = %s AND user_id = %s RETURNING 1",
            (post_id, user_id),
        )
        was_bookmarked = cur.fetchone() is not None
        if not was_bookmarked:
            cur.execute(
                "INSERT INTO people_post_bookmarks (post_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (post_id, user_id),
            )
    return {"bookmarked": not was_bookmarked}


def list_my_bookmarks(*, user_id: int, limit: int = 50) -> list[dict]:
    """Devuelve posts bookmarkeados por el user con el mismo shape de list_feed."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
                   u.job_title AS author_job, a.slug AS author_area_slug,
                   a.name AS author_area_name, a.color AS author_area_color,
                   sp.slug AS space_slug, sp.name AS space_name,
                   sp.emoji AS space_emoji, sp.color AS space_color, sp.kind AS space_kind,
                   b.created_at AS bookmarked_at
              FROM people_post_bookmarks b
              JOIN people_posts p ON p.id = b.post_id
              JOIN users u ON u.id = p.author_id
              LEFT JOIN areas a ON a.id = u.area_id
              LEFT JOIN people_spaces sp ON sp.id = p.space_id
             WHERE b.user_id = %s AND p.deleted_at IS NULL
             ORDER BY b.created_at DESC
             LIMIT %s
        """, (user_id, limit))
        rows = [dict(r) for r in cur.fetchall()]
    out = []
    for r in rows:
        d = _post_to_dict(r)
        d["bookmarked_at"] = _iso(r.get("bookmarked_at"))
        d["bookmarked"] = True
        d["reactions"] = []  # simplifico, el frontend recarga si quiere reacciones
        d["comment_count"] = 0
        d["has_read"] = True
        out.append(d)
    return out


def is_bookmarked(post_id: int, user_id: int) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM people_post_bookmarks WHERE post_id = %s AND user_id = %s",
            (post_id, user_id),
        )
        return cur.fetchone() is not None


# ============================================================
# Search global (posts, users, spaces)
# ============================================================

def insights_dashboard(*, since_days: int = 30) -> dict:
    """Engagement analytics agregado para admin/People/gerencia.

    Devuelve:
    - totals: posts, comments, reactions, kudos, dms en el periodo
    - by_area: actividad por area
    - top_posters: top 10 users por count de posts
    - top_kudo_givers: top 10 quienes mas dieron kudos
    - top_kudo_receivers: top 10 quienes mas recibieron
    - silent_users: users activos sin actividad en el periodo
    - engagement_rate: % de users activos que postearon, comentaron o reaccionaron
    - posts_by_day: serie temporal de posts
    """
    init()
    since_clause = "NOW() - (%s::text || ' days')::interval"
    with get_conn() as c, c.cursor() as cur:
        # Totals
        cur.execute(f"SELECT COUNT(*) AS n FROM people_posts WHERE deleted_at IS NULL AND created_at >= {since_clause}", (since_days,))
        posts = cur.fetchone()["n"]
        cur.execute(f"SELECT COUNT(*) AS n FROM people_post_comments WHERE deleted_at IS NULL AND created_at >= {since_clause}", (since_days,))
        comments = cur.fetchone()["n"]
        cur.execute(f"SELECT COUNT(*) AS n FROM people_post_reactions WHERE created_at >= {since_clause}", (since_days,))
        reactions = cur.fetchone()["n"]
        cur.execute(f"SELECT COUNT(*) AS n FROM people_kudos WHERE created_at >= {since_clause}", (since_days,))
        kudos = cur.fetchone()["n"]
        cur.execute(f"SELECT COUNT(*) AS n FROM people_messages WHERE deleted_at IS NULL AND created_at >= {since_clause}", (since_days,))
        dms = cur.fetchone()["n"]
        cur.execute("SELECT COUNT(*) AS n FROM users WHERE is_active = TRUE")
        active_users = cur.fetchone()["n"]

        # Engagement: users que tuvieron alguna actividad (post/comment/reaccion/kudo dado/DM)
        cur.execute(f"""
            SELECT COUNT(DISTINCT user_id) AS n FROM (
                SELECT author_id AS user_id FROM people_posts WHERE deleted_at IS NULL AND created_at >= {since_clause}
                UNION
                SELECT author_id FROM people_post_comments WHERE deleted_at IS NULL AND created_at >= {since_clause}
                UNION
                SELECT user_id FROM people_post_reactions WHERE created_at >= {since_clause}
                UNION
                SELECT from_user_id FROM people_kudos WHERE created_at >= {since_clause}
                UNION
                SELECT author_id FROM people_messages WHERE deleted_at IS NULL AND created_at >= {since_clause}
            ) t
        """, (since_days,) * 5)
        engaged = cur.fetchone()["n"]
        engagement_rate = round((engaged / active_users) * 100, 1) if active_users else 0

        # By area
        cur.execute(f"""
            SELECT a.slug, a.name, a.color,
                   COUNT(DISTINCT p.id) AS posts,
                   COUNT(DISTINCT c.id) AS comments,
                   COUNT(DISTINCT u.id) AS users
              FROM areas a
              LEFT JOIN users u ON u.area_id = a.id AND u.is_active = TRUE
              LEFT JOIN people_posts p ON p.author_id = u.id AND p.deleted_at IS NULL AND p.created_at >= {since_clause}
              LEFT JOIN people_post_comments c ON c.author_id = u.id AND c.deleted_at IS NULL AND c.created_at >= {since_clause}
             GROUP BY a.id, a.slug, a.name, a.color, a.sort_order
             ORDER BY a.sort_order
        """, (since_days, since_days))
        by_area = [dict(r) for r in cur.fetchall()]

        # Top posters
        cur.execute(f"""
            SELECT u.id, u.name, u.avatar_url, a.color AS area_color,
                   COUNT(p.id) AS n
              FROM users u
              LEFT JOIN areas a ON a.id = u.area_id
              JOIN people_posts p ON p.author_id = u.id
             WHERE p.deleted_at IS NULL AND p.created_at >= {since_clause}
             GROUP BY u.id, u.name, u.avatar_url, a.color
             ORDER BY n DESC LIMIT 10
        """, (since_days,))
        top_posters = [dict(r) for r in cur.fetchall()]

        # Top kudo givers/receivers
        cur.execute(f"""
            SELECT u.id, u.name, u.avatar_url, a.color AS area_color,
                   COUNT(k.id) AS n
              FROM users u LEFT JOIN areas a ON a.id = u.area_id
              JOIN people_kudos k ON k.from_user_id = u.id
             WHERE k.created_at >= {since_clause}
             GROUP BY u.id, u.name, u.avatar_url, a.color
             ORDER BY n DESC LIMIT 10
        """, (since_days,))
        top_kudo_givers = [dict(r) for r in cur.fetchall()]
        cur.execute(f"""
            SELECT u.id, u.name, u.avatar_url, a.color AS area_color,
                   COUNT(k.id) AS n
              FROM users u LEFT JOIN areas a ON a.id = u.area_id
              JOIN people_kudos k ON k.to_user_id = u.id
             WHERE k.created_at >= {since_clause}
             GROUP BY u.id, u.name, u.avatar_url, a.color
             ORDER BY n DESC LIMIT 10
        """, (since_days,))
        top_kudo_receivers = [dict(r) for r in cur.fetchall()]

        # Silent users (sin actividad en periodo)
        cur.execute(f"""
            SELECT u.id, u.name, u.avatar_url, u.email, u.job_title,
                   a.color AS area_color, a.name AS area_name
              FROM users u
              LEFT JOIN areas a ON a.id = u.area_id
             WHERE u.is_active = TRUE
               AND NOT EXISTS (SELECT 1 FROM people_posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL AND p.created_at >= {since_clause})
               AND NOT EXISTS (SELECT 1 FROM people_post_comments c WHERE c.author_id = u.id AND c.deleted_at IS NULL AND c.created_at >= {since_clause})
               AND NOT EXISTS (SELECT 1 FROM people_post_reactions r WHERE r.user_id = u.id AND r.created_at >= {since_clause})
               AND NOT EXISTS (SELECT 1 FROM people_kudos k WHERE k.from_user_id = u.id AND k.created_at >= {since_clause})
               AND NOT EXISTS (SELECT 1 FROM people_messages m WHERE m.author_id = u.id AND m.deleted_at IS NULL AND m.created_at >= {since_clause})
             ORDER BY u.name LIMIT 50
        """, (since_days,) * 5)
        silent = [dict(r) for r in cur.fetchall()]

        # Posts por dia (serie)
        cur.execute(f"""
            SELECT DATE_TRUNC('day', created_at)::date AS day, COUNT(*) AS n
              FROM people_posts
             WHERE deleted_at IS NULL AND created_at >= {since_clause}
             GROUP BY day ORDER BY day
        """, (since_days,))
        posts_by_day = [{"day": _iso(r["day"]), "count": int(r["n"])} for r in cur.fetchall()]

        # eNPS reciente (encuesta NPS mas reciente con respuestas)
        cur.execute("""
            SELECT s.id, s.question, s.created_at,
                   COUNT(r.id) AS n,
                   SUM(CASE WHEN r.value >= 9 THEN 1 ELSE 0 END) AS promoters,
                   SUM(CASE WHEN r.value BETWEEN 7 AND 8 THEN 1 ELSE 0 END) AS passives,
                   SUM(CASE WHEN r.value <= 6 THEN 1 ELSE 0 END) AS detractors
              FROM people_pulse_surveys s
              LEFT JOIN people_pulse_responses r ON r.survey_id = s.id
             WHERE s.scale = 'nps'
             GROUP BY s.id, s.question, s.created_at
             HAVING COUNT(r.id) > 0
             ORDER BY s.created_at DESC LIMIT 1
        """)
        enps_row = cur.fetchone()
        enps_summary = None
        if enps_row and enps_row["n"]:
            n = int(enps_row["n"])
            prom = int(enps_row["promoters"] or 0)
            det = int(enps_row["detractors"] or 0)
            enps_summary = {
                "survey_id": enps_row["id"],
                "question": enps_row["question"],
                "responses": n,
                "score": round(((prom - det) / n) * 100, 1) if n else 0,
                "promoters_pct": round((prom / n) * 100, 1) if n else 0,
                "detractors_pct": round((det / n) * 100, 1) if n else 0,
            }

    return {
        "since_days": since_days,
        "totals": {
            "posts": posts, "comments": comments, "reactions": reactions,
            "kudos": kudos, "dms": dms,
            "active_users": active_users, "engaged_users": engaged,
            "engagement_rate": engagement_rate,
        },
        "by_area": by_area,
        "top_posters": top_posters,
        "top_kudo_givers": top_kudo_givers,
        "top_kudo_receivers": top_kudo_receivers,
        "silent_users": silent,
        "posts_by_day": posts_by_day,
        "enps_summary": enps_summary,
    }


def search_all(*, query: str, viewer_id: int, limit: int = 20) -> dict:
    init()
    q = (query or "").strip()
    if not q:
        return {"posts": [], "users": [], "spaces": []}
    pat = f"%{q.lower()}%"
    with get_conn() as c, c.cursor() as cur:
        # Posts
        cur.execute("""
            SELECT p.id, p.content, p.created_at,
                   u.id AS author_id, u.name AS author_name, u.avatar_url AS author_avatar,
                   a.color AS author_area_color,
                   sp.name AS space_name, sp.emoji AS space_emoji, sp.color AS space_color
              FROM people_posts p
              JOIN users u ON u.id = p.author_id
              LEFT JOIN areas a ON a.id = u.area_id
              LEFT JOIN people_spaces sp ON sp.id = p.space_id
             WHERE p.deleted_at IS NULL
               AND LOWER(p.content) LIKE %s
             ORDER BY p.created_at DESC
             LIMIT %s
        """, (pat, limit))
        posts = [dict(r) for r in cur.fetchall()]
        for p in posts:
            p["created_at"] = _iso(p.get("created_at"))

        # Users
        cur.execute("""
            SELECT u.id, u.name, u.email, u.avatar_url, u.job_title, u.bio,
                   a.color AS area_color, a.name AS area_name
              FROM users u
              LEFT JOIN areas a ON a.id = u.area_id
             WHERE u.is_active = TRUE
               AND (LOWER(u.name) LIKE %s OR LOWER(u.email) LIKE %s OR LOWER(u.job_title) LIKE %s OR LOWER(u.bio) LIKE %s)
             ORDER BY u.name
             LIMIT %s
        """, (pat, pat, pat, pat, limit))
        users = [dict(r) for r in cur.fetchall()]

        # Spaces
        cur.execute("""
            SELECT id, slug, name, emoji, color, description, kind
              FROM people_spaces
             WHERE is_active = TRUE
               AND (LOWER(name) LIKE %s OR LOWER(description) LIKE %s)
             ORDER BY kind, sort_order
             LIMIT %s
        """, (pat, pat, limit))
        spaces = [dict(r) for r in cur.fetchall()]

    return {"posts": posts, "users": users, "spaces": spaces}

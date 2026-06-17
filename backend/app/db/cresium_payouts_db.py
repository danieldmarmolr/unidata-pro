"""Estado del motor de payouts Cresium en la app DB de UNIDATA.

Port de los modelos Prisma cresium.* de Unidrop-Back, colapsados al stack
UNIDATA (psycopg2 sobre la app DB). El patron dual de Unidrop
(MercadoLibreRefundOrder + CancellationRefundOrder) se unifica en
cresium_payout_orders con un discriminador source_type.

Tablas:
  cresium_payout_orders     una orden de transferencia por devolucion (ML o
                            suscripcion). Snapshot anti-fraude + state machine.
  cresium_payout_events     auditoria de eventos de Cresium (webhook/polling).
                            UNIQUE(cresium_tx_id, status) = dedup idempotente.
  cresium_payout_batches    lote armado por Finanzas (batch + preview + confirm).
  cresium_verified_accounts cache de verificacion de cuentas contra Cresium
                            (cresium_to_id + match anti-fraude). Vive en la app
                            DB para no escribir en unidrop_api.

Mejora sobre Unidrop: las transiciones usan CAS a nivel DB
(WHERE id=%s AND status=%s ... RETURNING) en vez de read-then-check, cerrando
la ventana de carrera que el motor original tenia.
"""
from __future__ import annotations

import logging
import threading

from psycopg2.extras import Json

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.cresium.db")

_LOCK = threading.RLock()
_INITIALIZED = False

# Estados. Los 7 del enum RefundOrderStatus de Unidrop + SUBMITTING: un estado
# in-flight propio del port para CLAIMEAR la order de forma atomica antes del
# call saliente (cierra la race de doble pago que el motor original no tenia,
# porque alli el unico caller era un hook 1-por-order, no un endpoint de lote).
STATUSES = (
    "PENDING_VERIFICATION",
    "READY_TO_TRANSFER",
    "SUBMITTING",
    "SIGNATURE_REQUEST_CREATED",
    "PROCESSING",
    "SUCCESS",
    "FAILED",
    "CANCELED",
)

SOURCE_TYPES = ("ml_return", "subscription")

# Estados desde los que un evento terminal puede transicionar.
_PENDING_OUTBOUND = ("SIGNATURE_REQUEST_CREATED", "PROCESSING")

_ORDER_TS_FIELDS = ("created_at", "updated_at", "refunded_at")
_ORDER_NUM_FIELDS = ("amount",)


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS cresium_payout_batches (
                    id                  BIGSERIAL PRIMARY KEY,
                    created_by_user_id  BIGINT,
                    created_by_email    TEXT,
                    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','confirmed','done')),
                    note                TEXT,
                    orders_count        INT NOT NULL DEFAULT 0,
                    total_amount        NUMERIC(16,2) NOT NULL DEFAULT 0,
                    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    confirmed_at        TIMESTAMPTZ
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS cresium_payout_orders (
                    id                          BIGSERIAL PRIMARY KEY,
                    source_type                 TEXT NOT NULL
                        CHECK (source_type IN ('ml_return','subscription')),
                    ml_order_id                 BIGINT,
                    return_idx                  INT DEFAULT 1,
                    subscription_refund_request_id BIGINT,
                    batch_id                    BIGINT REFERENCES cresium_payout_batches(id),
                    dropshipper_user_id         BIGINT,
                    dropshipper_dni             TEXT,
                    dropshipper_name            TEXT,
                    amount                      NUMERIC(14,2) NOT NULL,
                    currency                    TEXT NOT NULL DEFAULT 'ARS',
                    idempotency_key             TEXT NOT NULL UNIQUE,
                    recipient_cbu               TEXT,
                    recipient_cvu               TEXT,
                    recipient_alias             TEXT,
                    recipient_holder_name       TEXT,
                    recipient_tax_id            TEXT,
                    cresium_to_id               TEXT,
                    status                      TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
                        CHECK (status IN ('PENDING_VERIFICATION','READY_TO_TRANSFER','SUBMITTING',
                               'SIGNATURE_REQUEST_CREATED','PROCESSING','SUCCESS','FAILED','CANCELED')),
                    cresium_preview_id          TEXT,
                    cresium_transaction_id      TEXT,
                    cresium_signature_request_id TEXT,
                    failure_reason              TEXT,
                    error_category              TEXT CHECK (error_category IN ('cliente','cresium')),
                    cresium_status              TEXT,
                    receipt_url                 TEXT,
                    refunded_at                 TIMESTAMPTZ,
                    triggered_by_user_id        BIGINT,
                    triggered_by_email          TEXT,
                    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_cpo_ml "
                "ON cresium_payout_orders (ml_order_id, return_idx) "
                "WHERE source_type = 'ml_return'"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_cpo_sub "
                "ON cresium_payout_orders (subscription_refund_request_id) "
                "WHERE source_type = 'subscription'"
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cpo_status ON cresium_payout_orders (status, updated_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cpo_txid ON cresium_payout_orders (cresium_transaction_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cpo_dropshipper ON cresium_payout_orders (dropshipper_user_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cpo_batch ON cresium_payout_orders (batch_id)")
            # columnas que pueden faltar si la tabla se creo antes de estos cambios.
            cur.execute("ALTER TABLE cresium_payout_orders ADD COLUMN IF NOT EXISTS error_category TEXT")
            cur.execute("ALTER TABLE cresium_payout_orders ADD COLUMN IF NOT EXISTS cresium_status TEXT")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS cresium_payout_events (
                    id               BIGSERIAL PRIMARY KEY,
                    payout_order_id  BIGINT NOT NULL REFERENCES cresium_payout_orders(id) ON DELETE CASCADE,
                    cresium_tx_id    TEXT NOT NULL,
                    type             TEXT,
                    status           TEXT NOT NULL,
                    total_amount     NUMERIC(18,2),
                    net_amount       NUMERIC(18,2),
                    fees             JSONB,
                    raw_payload      JSONB NOT NULL,
                    source           TEXT NOT NULL CHECK (source IN ('webhook','polling')),
                    fetched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (cresium_tx_id, status)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cpe_order ON cresium_payout_events (payout_order_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cpe_txid ON cresium_payout_events (cresium_tx_id)")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS cresium_verified_accounts (
                    id                  BIGSERIAL PRIMARY KEY,
                    dropshipper_user_id BIGINT NOT NULL,
                    value               TEXT NOT NULL,
                    tax_id              TEXT,
                    cresium_to_id       TEXT,
                    holder_name         TEXT,
                    holder_tax_id       TEXT,
                    bank_name           TEXT,
                    is_verified         BOOLEAN NOT NULL DEFAULT FALSE,
                    last_verified_at    TIMESTAMPTZ,
                    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (dropshipper_user_id, value)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cva_user ON cresium_verified_accounts (dropshipper_user_id)")
        _INITIALIZED = True


# ─── Orders ──────────────────────────────────────────────────────────────────

def create_order(data: dict) -> dict:
    """Crea una payout order de forma idempotente sobre idempotency_key.
    Si ya existe (mismo key), devuelve la existente sin tocarla."""
    init()
    cols = [
        "source_type", "ml_order_id", "return_idx", "subscription_refund_request_id",
        "batch_id", "dropshipper_user_id", "dropshipper_dni", "dropshipper_name",
        "amount", "currency", "idempotency_key", "recipient_cbu", "recipient_cvu",
        "recipient_alias", "recipient_holder_name", "recipient_tax_id", "cresium_to_id",
        "status", "triggered_by_user_id", "triggered_by_email",
    ]
    vals = [data.get(c) for c in cols]
    placeholders = ", ".join(["%s"] * len(cols))
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"INSERT INTO cresium_payout_orders ({', '.join(cols)}) VALUES ({placeholders}) "
            f"ON CONFLICT (idempotency_key) DO NOTHING RETURNING *",
            vals,
        )
        row = cur.fetchone()
        if row:
            return _order_dict(row)
        cur.execute(
            "SELECT * FROM cresium_payout_orders WHERE idempotency_key = %s",
            (data["idempotency_key"],),
        )
        return _order_dict(cur.fetchone())


def get_order(order_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM cresium_payout_orders WHERE id = %s", (order_id,))
        row = cur.fetchone()
    return _order_dict(row) if row else None


def list_orders(
    *,
    status: str | None = None,
    source_type: str | None = None,
    batch_id: int | None = None,
    dropshipper_user_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    init()
    where = []
    params: list = []
    if status:
        where.append("status = %s")
        params.append(status)
    if source_type:
        where.append("source_type = %s")
        params.append(source_type)
    if batch_id is not None:
        where.append("batch_id = %s")
        params.append(batch_id)
    if dropshipper_user_id is not None:
        where.append("dropshipper_user_id = %s")
        params.append(dropshipper_user_id)
    sql = "SELECT * FROM cresium_payout_orders"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC LIMIT %s OFFSET %s"
    params.extend([limit, offset])
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return [_order_dict(r) for r in cur.fetchall()]


# Mapeo estado de orden -> tab estilo Unidev (Pendiente / En Cresium / Errores
# cliente / Errores Cresium / Realizadas).
_EN_CRESIUM = ("SUBMITTING", "SIGNATURE_REQUEST_CREATED", "PROCESSING")
# Estados que sacan a la devolucion del pool 'Pendiente' (ya se envio o fallo).
_NOT_PENDING = ("SUBMITTING", "SIGNATURE_REQUEST_CREATED", "PROCESSING", "SUCCESS", "FAILED", "CANCELED")


def tab_for_order(status: str, error_category: str | None) -> str:
    if status in _EN_CRESIUM:
        return "en_cresium"
    if status == "SUCCESS":
        return "realizada"
    if status == "FAILED":
        return "error_cliente" if error_category == "cliente" else "error_cresium"
    if status == "CANCELED":
        return "error_cresium"
    return "pendiente"  # PENDING_VERIFICATION / READY_TO_TRANSFER


def _tab_where(tab: str) -> tuple[str, list]:
    if tab == "en_cresium":
        return "status = ANY(%s)", [list(_EN_CRESIUM)]
    if tab == "realizada":
        return "status = 'SUCCESS'", []
    if tab == "error_cliente":
        return "status = 'FAILED' AND error_category = 'cliente'", []
    if tab == "error_cresium":
        return "(status = 'FAILED' AND (error_category IS NULL OR error_category = 'cresium')) OR status = 'CANCELED'", []
    raise ValueError(f"tab invalido para orders: {tab}")


def list_orders_for_tab(source_type: str, tab: str, *, search: str | None = None, limit: int = 500) -> list[dict]:
    """Orders (con su snapshot) para los tabs post-envio (en_cresium / error_* /
    realizada). El tab 'pendiente' se arma desde el pool de devoluciones, no de aca."""
    init()
    where, params = _tab_where(tab)
    sql = f"SELECT * FROM cresium_payout_orders WHERE source_type = %s AND ({where})"
    p: list = [source_type, *params]
    if search:
        sql += " AND (dropshipper_name ILIKE %s OR dropshipper_dni ILIKE %s OR recipient_cbu ILIKE %s OR recipient_alias ILIKE %s)"
        like = f"%{search}%"
        p.extend([like, like, like, like])
    sql += " ORDER BY updated_at DESC LIMIT %s"
    p.append(limit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, p)
        return [_order_dict(r) for r in cur.fetchall()]


def active_order_keys(source_type: str) -> set:
    """Keys de devoluciones que YA tienen una orden fuera del pool Pendiente
    (enviada/fallada/exito) — para excluirlas del tab Pendiente.
    Para ml_return: (ml_order_id, return_idx). Para subscription: request_id."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT ml_order_id, return_idx, subscription_refund_request_id "
            "FROM cresium_payout_orders WHERE source_type = %s AND status = ANY(%s)",
            (source_type, list(_NOT_PENDING)),
        )
        rows = cur.fetchall()
    if source_type == "ml_return":
        return {(int(r["ml_order_id"]), int(r["return_idx"] or 1)) for r in rows if r["ml_order_id"] is not None}
    return {int(r["subscription_refund_request_id"]) for r in rows if r["subscription_refund_request_id"] is not None}


def totals_by_tab(source_type: str) -> dict[str, dict]:
    """Totales (count + monto) de los tabs post-envio. El total de 'pendiente' lo
    completa la capa de servicio desde el pool de devoluciones."""
    init()
    out = {t: {"count": 0, "monto": 0.0} for t in ("en_cresium", "error_cliente", "error_cresium", "realizada")}
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT status, error_category, COUNT(*) AS n, COALESCE(SUM(amount),0) AS monto "
            "FROM cresium_payout_orders WHERE source_type = %s GROUP BY status, error_category",
            (source_type,),
        )
        for r in cur.fetchall():
            t = tab_for_order(r["status"], r["error_category"])
            if t in out:
                out[t]["count"] += int(r["n"])
                out[t]["monto"] += float(r["monto"] or 0)
    return out


def find_order_by_cresium_event(
    *, cresium_transaction_id: str | None = None, idempotency_key: str | None = None
) -> dict | None:
    """Match de un evento entrante a su order: por cresium_transaction_id, o
    fallback por idempotency_key == externalReference."""
    init()
    conds = []
    params: list = []
    if cresium_transaction_id:
        conds.append("cresium_transaction_id = %s")
        params.append(cresium_transaction_id)
    if idempotency_key:
        conds.append("idempotency_key = %s")
        params.append(idempotency_key)
    if not conds:
        return None
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"SELECT * FROM cresium_payout_orders WHERE {' OR '.join(conds)} ORDER BY id DESC LIMIT 1",
            params,
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


def attach_to_batch(order_id: int, batch_id: int) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE cresium_payout_orders SET batch_id = %s, updated_at = NOW() WHERE id = %s",
            (batch_id, order_id),
        )


def promote_pending_to_ready(order_id: int, snapshot: dict) -> dict | None:
    """CAS: PENDING_VERIFICATION -> READY_TO_TRANSFER, congelando el snapshot
    anti-fraude. No-op si la order ya no esta en PENDING_VERIFICATION."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cresium_payout_orders
            SET status = 'READY_TO_TRANSFER',
                recipient_cbu = %s, recipient_cvu = %s, recipient_alias = %s,
                recipient_holder_name = %s, recipient_tax_id = %s, cresium_to_id = %s,
                updated_at = NOW()
            WHERE id = %s AND status = 'PENDING_VERIFICATION'
            RETURNING *
            """,
            (
                snapshot.get("recipient_cbu"), snapshot.get("recipient_cvu"),
                snapshot.get("recipient_alias"), snapshot.get("recipient_holder_name"),
                snapshot.get("recipient_tax_id"), snapshot.get("cresium_to_id"), order_id,
            ),
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


def claim_for_submit(order_id: int) -> dict | None:
    """CAS: READY_TO_TRANSFER -> SUBMITTING. Claim atomico antes del call
    saliente. Solo UN proceso puede ganarlo; el resto recibe None y hace no-op,
    de modo que dos confirm_batch concurrentes nunca disparan dos make-a-transfer
    para la misma order (anti doble-pago)."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cresium_payout_orders
            SET status = 'SUBMITTING', updated_at = NOW()
            WHERE id = %s AND status = 'READY_TO_TRANSFER'
            RETURNING *
            """,
            (order_id,),
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


def revert_submitting_to_ready(order_id: int) -> dict | None:
    """CAS: SUBMITTING -> READY_TO_TRANSFER (rollback si el claim no llega a
    disparar el call saliente)."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE cresium_payout_orders SET status = 'READY_TO_TRANSFER', updated_at = NOW() "
            "WHERE id = %s AND status = 'SUBMITTING' RETURNING *",
            (order_id,),
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


def set_transaction_ids(order_id: int, *, preview_id: str, transaction_id: str) -> dict | None:
    """Persiste los ids de Cresium tras make-a-transfer. CAS sobre SUBMITTING
    (no cambia el status; solo guarda ids antes del step 2)."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cresium_payout_orders
            SET cresium_preview_id = %s, cresium_transaction_id = %s, updated_at = NOW()
            WHERE id = %s AND status = 'SUBMITTING'
            RETURNING *
            """,
            (preview_id, transaction_id, order_id),
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


def mark_signature_request_created(order_id: int, signature_request_id: str) -> dict | None:
    """CAS: SUBMITTING -> SIGNATURE_REQUEST_CREATED."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cresium_payout_orders
            SET cresium_signature_request_id = %s, status = 'SIGNATURE_REQUEST_CREATED', updated_at = NOW()
            WHERE id = %s AND status = 'SUBMITTING'
            RETURNING *
            """,
            (signature_request_id, order_id),
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


def mark_failed(order_id: int, reason: str, *, transaction_id: str | None = None,
                category: str | None = None) -> dict | None:
    """Marca FAILED desde cualquier estado NO terminal. No pisa estados
    terminales (SUCCESS/CANCELED/FAILED) — un evento fuera de orden no debe
    flipear CANCELED->FAILED ni revivir un terminal. Idempotente.
    category: 'cliente' (banco/anti-fraude) | 'cresium' (API/red) | None."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cresium_payout_orders
            SET status = 'FAILED',
                failure_reason = %s,
                error_category = %s,
                cresium_transaction_id = COALESCE(%s, cresium_transaction_id),
                updated_at = NOW()
            WHERE id = %s AND status NOT IN ('FAILED','SUCCESS','CANCELED')
            RETURNING *
            """,
            (reason, category, transaction_id, order_id),
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


def mark_canceled(order_id: int, reason: str, *, transaction_id: str | None = None) -> dict | None:
    """Marca CANCELED desde un estado NO terminal. No pisa SUCCESS ni FAILED."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cresium_payout_orders
            SET status = 'CANCELED',
                failure_reason = %s,
                cresium_transaction_id = COALESCE(%s, cresium_transaction_id),
                updated_at = NOW()
            WHERE id = %s AND status NOT IN ('CANCELED','SUCCESS','FAILED')
            RETURNING *
            """,
            (reason, transaction_id, order_id),
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


def mark_success(order_id: int, *, transaction_id: str, receipt_url: str | None) -> dict | None:
    """CAS: -> SUCCESS. SUCCESS es el estado mas fuerte (la plata efectivamente
    se movio): puede pisar FAILED/CANCELED si Cresium termina confirmando.
    Idempotente (no-op si ya esta en SUCCESS). El caller (engine) ademas marca
    la devolucion como transferida en su tabla."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cresium_payout_orders
            SET status = 'SUCCESS',
                cresium_transaction_id = %s,
                receipt_url = COALESCE(%s, receipt_url),
                refunded_at = NOW(),
                failure_reason = NULL,
                updated_at = NOW()
            WHERE id = %s AND status <> 'SUCCESS'
            RETURNING *
            """,
            (transaction_id, receipt_url, order_id),
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


def reopen_order(order_id: int, target_status: str) -> dict | None:
    """Reabre una order en error (FAILED/CANCELED) a READY_TO_TRANSFER (si ya
    tiene cresium_to_id) o PENDING_VERIFICATION (si hay que re-verificar la
    cuenta). Limpia failure_reason + error_category."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE cresium_payout_orders SET status = %s, failure_reason = NULL, error_category = NULL, "
            "updated_at = NOW() WHERE id = %s AND status IN ('FAILED','CANCELED') RETURNING *",
            (target_status, order_id),
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


def set_cresium_status(order_id: int, status: str | None) -> None:
    """Guarda el ultimo status crudo que reporto Cresium (PREVIEW/PROCESSING/
    SUCCESS/FAILED) para mostrar en la UI 'esperando firma' vs 'procesando'."""
    if not status:
        return
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE cresium_payout_orders SET cresium_status = %s WHERE id = %s",
            (status, order_id),
        )


def get_order_by_subscription(request_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT * FROM cresium_payout_orders WHERE source_type = 'subscription' "
            "AND subscription_refund_request_id = %s ORDER BY id DESC LIMIT 1",
            (request_id,),
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


def update_recipient_and_reopen(order_id: int, recipient: dict) -> dict | None:
    """Tras una correccion de datos del dropper: actualiza el snapshot bancario y
    reabre la order a PENDING_VERIFICATION para re-verificar. No toca orders en
    vuelo (SUBMITTING/SIGNATURE_REQUEST_CREATED/PROCESSING) ni exitosas."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cresium_payout_orders
            SET recipient_cbu = %s, recipient_cvu = %s, recipient_alias = %s,
                recipient_holder_name = %s, recipient_tax_id = %s, cresium_to_id = NULL,
                status = 'PENDING_VERIFICATION', failure_reason = NULL, error_category = NULL,
                cresium_status = NULL, updated_at = NOW()
            WHERE id = %s AND status NOT IN ('SUCCESS','SUBMITTING','SIGNATURE_REQUEST_CREATED','PROCESSING')
            RETURNING *
            """,
            (
                recipient.get("recipient_cbu"), recipient.get("recipient_cvu"), recipient.get("recipient_alias"),
                recipient.get("recipient_holder_name"), recipient.get("recipient_tax_id"), order_id,
            ),
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


def reset_failed_to_ready(order_id: int, operator_id: int | None, operator_email: str | None) -> dict | None:
    """CAS: FAILED -> READY_TO_TRANSFER (retry)."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cresium_payout_orders
            SET status = 'READY_TO_TRANSFER', failure_reason = NULL,
                triggered_by_user_id = %s, triggered_by_email = %s, updated_at = NOW()
            WHERE id = %s AND status = 'FAILED'
            RETURNING *
            """,
            (operator_id, operator_email, order_id),
        )
        row = cur.fetchone()
    return _order_dict(row) if row else None


# ─── Events ──────────────────────────────────────────────────────────────────

def find_event(cresium_tx_id: str, status: str) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT id FROM cresium_payout_events WHERE cresium_tx_id = %s AND status = %s",
            (cresium_tx_id, status),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def insert_event(data: dict) -> dict | None:
    """Inserta el evento de auditoria. ON CONFLICT (cresium_tx_id, status) DO
    NOTHING para que dos entregas del mismo evento no dupliquen."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cresium_payout_events
                (payout_order_id, cresium_tx_id, type, status, total_amount, net_amount, fees, raw_payload, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (cresium_tx_id, status) DO NOTHING
            RETURNING id
            """,
            (
                data["payout_order_id"], data["cresium_tx_id"], data.get("type"),
                data["status"], data.get("total_amount"), data.get("net_amount"),
                Json(data["fees"]) if data.get("fees") is not None else None,
                Json(data.get("raw_payload")), data["source"],
            ),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def list_events(payout_order_id: int) -> list[dict]:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT * FROM cresium_payout_events WHERE payout_order_id = %s ORDER BY fetched_at ASC",
            (payout_order_id,),
        )
        return [_event_dict(r) for r in cur.fetchall()]


def pollable_orders(max_age_days: int = 7, limit: int = 50) -> list[dict]:
    """Orders pollables: SIGNATURE_REQUEST_CREATED/PROCESSING con tx id y
    actualizadas dentro de la ventana."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM cresium_payout_orders
            WHERE status IN ('SIGNATURE_REQUEST_CREATED','PROCESSING')
              AND cresium_transaction_id IS NOT NULL
              AND updated_at >= NOW() - (%s || ' days')::interval
            ORDER BY updated_at ASC
            LIMIT %s
            """,
            (str(max_age_days), limit),
        )
        return [_order_dict(r) for r in cur.fetchall()]


# ─── Batches ─────────────────────────────────────────────────────────────────

def create_batch(*, user_id: int | None, user_email: str | None, note: str | None) -> dict:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO cresium_payout_batches (created_by_user_id, created_by_email, note) "
            "VALUES (%s, %s, %s) RETURNING *",
            (user_id, user_email, note),
        )
        return _batch_dict(cur.fetchone())


def get_batch(batch_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM cresium_payout_batches WHERE id = %s", (batch_id,))
        row = cur.fetchone()
    return _batch_dict(row) if row else None


def recompute_batch_totals(batch_id: int) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cresium_payout_batches b
            SET orders_count = sub.cnt, total_amount = sub.total
            FROM (SELECT COUNT(*) cnt, COALESCE(SUM(amount),0) total
                  FROM cresium_payout_orders WHERE batch_id = %s) sub
            WHERE b.id = %s
            """,
            (batch_id, batch_id),
        )


def claim_batch_for_confirm(batch_id: int) -> bool:
    """CAS draft -> confirmed. Devuelve True si esta llamada gano el claim;
    False si el lote ya estaba confirmado (otra llamada / doble click / retry de
    proxy). Barrera a nivel lote: el loop de confirmacion solo corre si gana."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE cresium_payout_batches SET status = 'confirmed', confirmed_at = NOW() "
            "WHERE id = %s AND status = 'draft' RETURNING id",
            (batch_id,),
        )
        return cur.fetchone() is not None


def list_batches(limit: int = 50) -> list[dict]:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM cresium_payout_batches ORDER BY created_at DESC LIMIT %s", (limit,))
        return [_batch_dict(r) for r in cur.fetchall()]


# ─── Verified accounts ───────────────────────────────────────────────────────

def upsert_verified_account(data: dict) -> dict:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cresium_verified_accounts
                (dropshipper_user_id, value, tax_id, cresium_to_id, holder_name, holder_tax_id, bank_name, is_verified, last_verified_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (dropshipper_user_id, value) DO UPDATE SET
                tax_id = EXCLUDED.tax_id, cresium_to_id = EXCLUDED.cresium_to_id,
                holder_name = EXCLUDED.holder_name, holder_tax_id = EXCLUDED.holder_tax_id,
                bank_name = EXCLUDED.bank_name, is_verified = EXCLUDED.is_verified,
                last_verified_at = NOW(), updated_at = NOW()
            RETURNING *
            """,
            (
                data["dropshipper_user_id"], data["value"], data.get("tax_id"),
                data.get("cresium_to_id"), data.get("holder_name"), data.get("holder_tax_id"),
                data.get("bank_name"), data.get("is_verified", False),
            ),
        )
        return _va_dict(cur.fetchone())


def get_verified_account(dropshipper_user_id: int) -> dict | None:
    """Mejor cuenta verificada del dropper (la mas reciente con cresium_to_id)."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM cresium_verified_accounts
            WHERE dropshipper_user_id = %s AND is_verified = TRUE AND cresium_to_id IS NOT NULL
            ORDER BY last_verified_at DESC NULLS LAST LIMIT 1
            """,
            (dropshipper_user_id,),
        )
        row = cur.fetchone()
    return _va_dict(row) if row else None


# ─── Row -> dict helpers ─────────────────────────────────────────────────────

def _order_dict(row) -> dict:
    if not row:
        return {}
    d = dict(row)
    for k in _ORDER_TS_FIELDS:
        if d.get(k) is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    for k in _ORDER_NUM_FIELDS:
        if d.get(k) is not None:
            d[k] = float(d[k])
    return d


def _event_dict(row) -> dict:
    d = dict(row)
    for k in ("fetched_at",):
        if d.get(k) is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    for k in ("total_amount", "net_amount"):
        if d.get(k) is not None:
            d[k] = float(d[k])
    return d


def _batch_dict(row) -> dict:
    if not row:
        return {}
    d = dict(row)
    for k in ("created_at", "confirmed_at"):
        if d.get(k) is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    if d.get("total_amount") is not None:
        d["total_amount"] = float(d["total_amount"])
    return d


def _va_dict(row) -> dict:
    if not row:
        return {}
    d = dict(row)
    for k in ("created_at", "updated_at", "last_verified_at"):
        if d.get(k) is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    return d

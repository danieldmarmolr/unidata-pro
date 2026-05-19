"""
Lookup de dropshipper en public."User" (unidrop_api) por DNI + email.

Usado por el endpoint publico /api/public/refund-requests/validate para
confirmar que el solicitante existe antes de aceptar el formulario.

Tambien devuelve:
- bank_hints: ultima cuenta Talo registrada (CustomerPaymentAccount) para
  pre-llenar el form de datos bancarios.
- paid_subscription: snapshot del total pagado historicamente en suscripcion
  MELI (PaymentIntentSubscription PROCESSED), para que Finanzas vea el
  contexto de cuanto pago el dropshipper antes de definir el monto a
  devolver.
"""
from __future__ import annotations

import logging

from sqlalchemy import text

from app.db.engines import get_engine
from app.services._utils import list_columns

log = logging.getLogger("unidata.refund_requests.lookup")


def find_dropshipper(*, dni: str, email: str) -> dict | None:
    dni = (dni or "").strip()
    email = (email or "").strip()
    if not dni or not email:
        return None

    eng = get_engine("unidrop")

    base_sql = text("""
        SELECT u.id,
               u.name,
               u.email,
               u.dni,
               u.fantasy_name,
               u."subscriptionId" AS subscription_id,
               sm.name             AS subscription_plan_name
        FROM public."User" u
        LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = u."subscriptionId"
        WHERE u.dni = :dni
          AND LOWER(u.email) = LOWER(:email)
        LIMIT 1
    """)

    with eng.connect() as cx:
        row = cx.execute(base_sql, {"dni": dni, "email": email}).mappings().first()

    if not row:
        return None

    user_id = int(row["id"])
    sub_id = row["subscription_id"]
    bank_hints = _latest_talo_account(eng, user_id)
    paid_subscription = _paid_subscription_snapshot(eng, user_id)

    return {
        "id": user_id,
        "name": row["name"],
        "email": row["email"],
        "dni": row["dni"],
        "fantasy_name": row["fantasy_name"],
        "subscription_id": int(sub_id) if sub_id is not None else None,
        "subscription_plan_name": row["subscription_plan_name"],
        "has_active_subscription": sub_id is not None,
        "bank_hints": bank_hints,
        "paid_subscription": paid_subscription,
    }


def _latest_talo_account(eng, user_id: int) -> dict | None:
    """CustomerPaymentAccount mas reciente del dropshipper. Defensivo: usa
    list_columns para no romper si Talo agrega/quita columnas."""
    cpa_cols = list_columns(eng, "public", "CustomerPaymentAccount")
    if not cpa_cols:
        return None

    selects = []
    keys = []
    for col in ("cbu", "cbu_alias", "alias", "bank_name", "account_owner"):
        if col in cpa_cols:
            selects.append(f'COALESCE("{col}", \'\') AS {col}')
            keys.append(col)
    if not selects:
        return None

    sql = text(f"""
        SELECT {", ".join(selects)}
        FROM public."CustomerPaymentAccount"
        WHERE "userId" = :uid
        ORDER BY id DESC
        LIMIT 1
    """)
    try:
        with eng.connect() as cx:
            row = cx.execute(sql, {"uid": user_id}).mappings().first()
    except Exception as e:
        log.warning("talo account lookup fallo para user %s: %s", user_id, e)
        return None
    if not row:
        return None

    cbu = (row.get("cbu") or "").strip() if "cbu" in keys else ""
    if not cbu:
        return None

    alias = ""
    if "alias" in keys and row.get("alias"):
        alias = row["alias"].strip()
    elif "cbu_alias" in keys and row.get("cbu_alias"):
        alias = row["cbu_alias"].strip()

    return {
        "source": "talo",
        "cbu": cbu,
        "alias": alias or None,
        "bank_name": (row.get("bank_name") or "").strip() or None if "bank_name" in keys else None,
        "holder_name": (row.get("account_owner") or "").strip() or None if "account_owner" in keys else None,
    }


def _paid_subscription_snapshot(eng, user_id: int) -> dict:
    """Suma de paidAmount de PaymentIntentSubscription PROCESSED para el user."""
    pis_cols = list_columns(eng, "public", "PaymentIntentSubscription")
    if not pis_cols or "userId" not in pis_cols:
        return {"total_arg": 0.0, "count": 0}
    amount_col = '"paidAmount"' if "paidAmount" in pis_cols else (
        '"amount"' if "amount" in pis_cols else "0"
    )

    sql = text(f"""
        SELECT COALESCE(SUM({amount_col}), 0)::float AS total_arg,
               COUNT(*)::int                          AS cnt
        FROM public."PaymentIntentSubscription"
        WHERE "userId" = :uid
          AND status::text = 'PROCESSED'
    """)
    try:
        with eng.connect() as cx:
            row = cx.execute(sql, {"uid": user_id}).mappings().first()
    except Exception as e:
        log.warning("paid_subscription snapshot fallo para user %s: %s", user_id, e)
        return {"total_arg": 0.0, "count": 0}

    return {
        "total_arg": round(float(row["total_arg"] or 0), 2),
        "count": int(row["cnt"] or 0),
    }

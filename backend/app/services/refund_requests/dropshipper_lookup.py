"""
Lookup de dropshipper en public."User" (unidrop_api) por DNI + email.

Usado por el endpoint publico /api/public/refund-requests/validate para
confirmar que el solicitante existe antes de aceptar el formulario.

Tambien devuelve:
- bank_hints: cuenta bancaria REAL del dropshipper (cresium.UserBankAccount)
  para pre-llenar el form de datos bancarios. NO la CVU de cobro TaloPay.
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
               COALESCE(u.cuit, '')                   AS cuit,
               COALESCE(u.phone, '')                  AS phone,
               u.fantasy_name,
               u."subscriptionId"                     AS subscription_id,
               sm.name                                AS subscription_plan_name,
               sm.price::float                        AS subscription_plan_price_arg,
               u.end_date_subscription::text          AS subscription_ends_at,
               u.subscription_status::text            AS subscription_status
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
    bank_hints = _latest_bank_account(eng, user_id)
    paid_subscription = _paid_subscription_snapshot(eng, user_id)
    last_payment = _last_subscription_payment(eng, user_id)

    return {
        "id": user_id,
        "name": row["name"],
        "email": row["email"],
        "dni": row["dni"],
        "cuit": (row["cuit"] or "").strip() or None,
        "phone": (row["phone"] or "").strip() or None,
        "fantasy_name": row["fantasy_name"],
        "subscription_id": int(sub_id) if sub_id is not None else None,
        "subscription_plan_name": row["subscription_plan_name"],
        "subscription_plan_price_arg": (
            round(float(row["subscription_plan_price_arg"]), 2)
            if row["subscription_plan_price_arg"] is not None else None
        ),
        "subscription_ends_at": row["subscription_ends_at"],
        "subscription_status": row["subscription_status"],
        "has_active_subscription": sub_id is not None,
        "bank_hints": bank_hints,
        "paid_subscription": paid_subscription,
        "last_payment": last_payment,
    }


def _latest_bank_account(eng, user_id: int) -> dict | None:
    """Cuenta bancaria REAL del dropshipper desde cresium."UserBankAccount" —
    el CBU/CVU/alias PERSONAL que cargo para cobrar (modulo de payouts Unidrop).

    NO usamos public."CustomerPaymentAccount": esa es la CVU de COBRO de TaloPay
    (alias autogenerado `unidrop.*`, titularizada bajo el PSP), y pre-llenar el
    form con eso hace que el dropper devuelva la plata a "Fox Talo Pay" en vez
    de a su propia cuenta. Prioridad: cuenta con CBU/CVU > default > reciente.
    """
    sql = text("""
        SELECT COALESCE(cbu, '')           AS cbu,
               COALESCE(cvu, '')           AS cvu,
               COALESCE(alias, '')         AS alias,
               COALESCE("bankName", '')    AS bank_name,
               COALESCE("holderName", '')  AS holder_name,
               COALESCE("holderTaxId", '') AS holder_tax_id
        FROM cresium."UserBankAccount"
        WHERE "userId" = :uid
        ORDER BY (CASE WHEN COALESCE(TRIM(cbu), '') <> '' OR COALESCE(TRIM(cvu), '') <> '' THEN 0
                       WHEN COALESCE(TRIM(alias), '') <> '' THEN 1
                       ELSE 2 END),
                 "isDefault" DESC NULLS LAST,
                 "updatedAt" DESC NULLS LAST,
                 id DESC
        LIMIT 1
    """)
    try:
        with eng.connect() as cx:
            row = cx.execute(sql, {"uid": user_id}).mappings().first()
    except Exception as e:
        log.warning("bank account lookup fallo para user %s: %s", user_id, e)
        return None
    if not row:
        return None

    cbu = (row["cbu"] or "").strip()
    cvu = (row["cvu"] or "").strip()
    alias = (row["alias"] or "").strip()
    primary = cbu or cvu  # ambos son 22 digitos; el form valida CBU/CVU indistinto
    # Con alias solo tambien sirve (se transfiere por alias) → pre-llenamos igual.
    if not (primary or alias):
        return None

    return {
        "source": "cresium",
        "cbu": primary,
        "alias": alias or None,
        "bank_name": (row["bank_name"] or "").strip() or None,
        "holder_name": (row["holder_name"] or "").strip() or None,
        "holder_tax_id": (row["holder_tax_id"] or "").strip() or None,
    }


def _last_subscription_payment(eng, user_id: int) -> dict | None:
    """Ultimo PaymentIntentSubscription PROCESSED del user — el cobro mas reciente.

    Usamos expectedAmount (monto bruto del cobro = lo que el dropshipper
    efectivamente debio pagar) y NO paidAmount (que ya tiene descontados los
    intereses/fees de TaloPay). Para devoluciones se reembolsa el bruto.
    """
    pis_cols = list_columns(eng, "public", "PaymentIntentSubscription")
    if not pis_cols or "userId" not in pis_cols:
        return None
    amount_col = '"expectedAmount"' if "expectedAmount" in pis_cols else (
        '"paidAmount"' if "paidAmount" in pis_cols else (
            '"amount"' if "amount" in pis_cols else "0"
        )
    )
    sql = text(f"""
        SELECT COALESCE({amount_col}, 0)::float AS paid_amount,
               "createdAt"::text                AS paid_at
        FROM public."PaymentIntentSubscription"
        WHERE "userId" = :uid
          AND status::text = 'PROCESSED'
        ORDER BY "createdAt" DESC NULLS LAST
        LIMIT 1
    """)
    try:
        with eng.connect() as cx:
            row = cx.execute(sql, {"uid": user_id}).mappings().first()
    except Exception as e:
        log.warning("last_payment lookup fallo para user %s: %s", user_id, e)
        return None
    if not row:
        return None
    return {
        "paid_amount_arg": round(float(row["paid_amount"] or 0), 2),
        "paid_at": row["paid_at"],
    }


def _paid_subscription_snapshot(eng, user_id: int) -> dict:
    """Suma de expectedAmount de PaymentIntentSubscription PROCESSED para el user.

    Usamos expectedAmount (bruto, lo que el dropshipper debio pagar) en vez de
    paidAmount (neto despues de intereses/fees de TaloPay). El reembolso se
    calcula sobre el bruto.
    """
    pis_cols = list_columns(eng, "public", "PaymentIntentSubscription")
    if not pis_cols or "userId" not in pis_cols:
        return {"total_arg": 0.0, "count": 0}
    amount_col = '"expectedAmount"' if "expectedAmount" in pis_cols else (
        '"paidAmount"' if "paidAmount" in pis_cols else (
            '"amount"' if "amount" in pis_cols else "0"
        )
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

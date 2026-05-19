"""
Lookup de dropshipper en public."User" (unidrop_api) por DNI + email.

Usado por el endpoint publico /api/public/refund-requests/validate para
confirmar que el solicitante existe antes de aceptar el formulario.
"""
from __future__ import annotations

import logging

from sqlalchemy import text

from app.db.engines import get_engine

log = logging.getLogger("unidata.refund_requests.lookup")


def find_dropshipper(*, dni: str, email: str) -> dict | None:
    """
    Busca un dropshipper por DNI exacto + email case-insensitive.

    Devuelve:
      {
        "id": int,
        "name": str,
        "email": str,
        "dni": str,
        "fantasy_name": str | None,
        "subscription_id": int | None,
        "subscription_plan_name": str | None,
        "has_active_subscription": bool,
      }
    o None si no matchea.
    """
    dni = (dni or "").strip()
    email = (email or "").strip()
    if not dni or not email:
        return None

    sql = text("""
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

    eng = get_engine("unidrop")
    with eng.connect() as cx:
        row = cx.execute(sql, {"dni": dni, "email": email}).mappings().first()

    if not row:
        return None

    sub_id = row["subscription_id"]
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "email": row["email"],
        "dni": row["dni"],
        "fantasy_name": row["fantasy_name"],
        "subscription_id": int(sub_id) if sub_id is not None else None,
        "subscription_plan_name": row["subscription_plan_name"],
        "has_active_subscription": sub_id is not None,
    }

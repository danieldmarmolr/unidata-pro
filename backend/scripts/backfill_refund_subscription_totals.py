"""
One-off backfill: recalcula paid_subscription_total_arg + paid_subscription_count
de las solicitudes ya creadas en subscription_refund_requests.

Usa la MISMA logica que el form publico (_paid_subscription_snapshot), que ahora
suma los dos rieles de cobro: PaymentIntentSubscription PROCESSED (TaloPay viejo)
+ MpSubscriptionCharge approved (MercadoPago, modelo vigente desde 2026-06). Las
solicitudes creadas antes del fix mostraban $0 porque solo miraban TaloPay.

Idempotente: si el valor calculado coincide con el guardado (delta < 0.01),
no actualiza. Reporta un resumen al final.

Usage:
    cd backend
    ./venv/Scripts/python.exe -m scripts.backfill_refund_subscription_totals
"""
from __future__ import annotations

import logging

from app.db.engines import get_engine
from app.db.local_persistence import get_conn
from app.services.refund_requests.dropshipper_lookup import _paid_subscription_snapshot

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
log = logging.getLogger("backfill_refund_totals")


def main() -> None:
    eng = get_engine("unidrop")

    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT id,
                   dropshipper_user_id,
                   dropshipper_name,
                   paid_subscription_total_arg,
                   paid_subscription_count
            FROM subscription_refund_requests
            ORDER BY id
        """)
        rows = cur.fetchall()

    log.info("Solicitudes a evaluar: %d", len(rows))

    updated = 0
    skipped = 0
    for r in rows:
        rid = int(r["id"])
        uid = int(r["dropshipper_user_id"])
        name = r["dropshipper_name"]
        old_total = float(r["paid_subscription_total_arg"] or 0)
        old_count = int(r["paid_subscription_count"] or 0)

        snap = _paid_subscription_snapshot(eng, uid)
        new_total, new_count = snap["total_arg"], snap["count"]

        if abs(new_total - old_total) < 0.01 and new_count == old_count:
            log.info("  req#%s (%s) [user %s]: sin cambios -> %s / %s",
                     rid, name, uid, old_total, old_count)
            skipped += 1
            continue

        with get_conn() as c, c.cursor() as cur:
            cur.execute(
                """
                UPDATE subscription_refund_requests
                SET paid_subscription_total_arg = %s,
                    paid_subscription_count     = %s,
                    updated_at                  = NOW()
                WHERE id = %s
                """,
                (new_total, new_count, rid),
            )
        log.info("  req#%s (%s) [user %s]: %s / %s  ->  %s / %s",
                 rid, name, uid, old_total, old_count, new_total, new_count)
        updated += 1

    log.info("== RESUMEN ==  total=%d  actualizadas=%d  sin_cambios=%d",
             len(rows), updated, skipped)


if __name__ == "__main__":
    main()

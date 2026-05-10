"""
Clasificacion de Clientes VIP de Unistore (TN).

Regla multi-criterio: cliente es VIP si cumple al menos UNA condicion:
  1. facturacion_lifetime >= 300.000           ("Big spender acumulado")
  2. alguna_orden_individual >= 300.000        ("High ticket")
  3. (ordenes_pagadas >= 4) AND
     (ticket_promedio >= 75.000)               ("Recurrente premium")

Tiers internos por facturacion lifetime:
  - Bronze: 300k - 1M
  - Silver: 1M - 5M
  - Gold:   > 5M  (top 1%)
"""
from __future__ import annotations

import logging

from app.utils.tz import now_ar
from app.db.engines import get_engine
from app.services._utils import q

log = logging.getLogger("unidata.customer_vip")

# Umbrales (en pesos argentinos)
VIP_THRESHOLD = 300_000.0  # umbral base
HIGH_TICKET_THRESHOLD = 300_000.0  # orden individual
RECURRENT_MIN_ORDERS = 4
RECURRENT_MIN_TICKET = 75_000.0  # 75k * 4 = 300k

# Tiers
TIER_GOLD_MIN = 5_000_000.0
TIER_SILVER_MIN = 1_000_000.0
TIER_BRONZE_MIN = 300_000.0


def _classify_tier(lifetime: float) -> str | None:
    """Devuelve el tier del VIP segun facturacion lifetime."""
    if lifetime >= TIER_GOLD_MIN:
        return "gold"
    if lifetime >= TIER_SILVER_MIN:
        return "silver"
    if lifetime >= TIER_BRONZE_MIN:
        return "bronze"
    return None


def classify_vip(lifetime: float, max_order: float, paid_orders: int, avg_ticket: float) -> dict:
    """Recibe metricas del cliente y devuelve {is_vip, tier, reasons[]}."""
    reasons: list[str] = []

    if lifetime >= VIP_THRESHOLD:
        reasons.append(f"Lifetime ${int(lifetime):,} >= ${int(VIP_THRESHOLD):,}".replace(",", "."))
    if max_order >= HIGH_TICKET_THRESHOLD:
        reasons.append(f"Orden individual ${int(max_order):,} >= ${int(HIGH_TICKET_THRESHOLD):,}".replace(",", "."))
    if paid_orders >= RECURRENT_MIN_ORDERS and avg_ticket >= RECURRENT_MIN_TICKET:
        reasons.append(f"Recurrente: {paid_orders} ordenes con ticket promedio ${int(avg_ticket):,}".replace(",", "."))

    is_vip = len(reasons) > 0
    tier = _classify_tier(lifetime) if is_vip else None

    return {
        "is_vip": is_vip,
        "tier": tier,  # gold | silver | bronze | None
        "reasons": reasons,
        "lifetime": round(lifetime, 2),
        "max_order": round(max_order, 2),
        "paid_orders": paid_orders,
        "avg_ticket": round(avg_ticket, 2),
    }


def list_vip_customers(tier: str = "all") -> dict:
    """Lista todos los customers VIP de Unistore con su tier y metricas.
    tier: 'all' | 'gold' | 'silver' | 'bronze'.
    Devuelve formato compatible con DrillDownModal.
    """
    eng = get_engine("unistore")

    rows = q(eng, """
        WITH stats AS (
            SELECT
                c.id AS customer_id,
                COALESCE(c.name, c.email, 'Customer ' || c.id::text) AS nombre,
                COALESCE(c.email, '') AS email,
                COALESCE(c.phone, '') AS telefono,
                COALESCE(NULLIF(TRIM(c."billingProvince"),''), '-') AS provincia,
                COUNT(*)::int AS paid_orders,
                COALESCE(SUM(o.total), 0)::float AS lifetime,
                COALESCE(MAX(o.total), 0)::float AS max_order,
                COALESCE(AVG(o.total), 0)::float AS avg_ticket,
                MIN(o."createdAt")::date AS first_order,
                MAX(o."createdAt")::date AS last_order
            FROM tienda_nube."Customer" c
            INNER JOIN tienda_nube."Order" o ON o."customerId" = c.id
            WHERE o."paymentStatus" = 'paid'
            GROUP BY c.id, c.name, c.email, c.phone, c."billingProvince"
        )
        SELECT customer_id, nombre, email, telefono, provincia,
               paid_orders, lifetime, max_order, avg_ticket,
               first_order, last_order,
               EXTRACT(DAY FROM (NOW() - last_order))::int AS recency_dias
        FROM stats
        WHERE
            -- Cliente es VIP si cumple alguna de las 3 condiciones
            lifetime >= :vip_t
            OR max_order >= :ht_t
            OR (paid_orders >= :rec_n AND avg_ticket >= :rec_t)
        ORDER BY lifetime DESC NULLS LAST
        LIMIT 5000
    """, {
        "vip_t": VIP_THRESHOLD,
        "ht_t": HIGH_TICKET_THRESHOLD,
        "rec_n": RECURRENT_MIN_ORDERS,
        "rec_t": RECURRENT_MIN_TICKET,
    }) or []

    customers = []
    counts = {"gold": 0, "silver": 0, "bronze": 0}
    sums = {"gold": 0.0, "silver": 0.0, "bronze": 0.0}

    for r in rows:
        cid, nombre, email, tel, prov, n, lt, mo, at, fo, lo, rec = r
        cls = classify_vip(float(lt or 0), float(mo or 0), int(n or 0), float(at or 0))
        t = cls["tier"]
        if t is None:
            continue
        if tier != "all" and t != tier:
            continue
        counts[t] = counts.get(t, 0) + 1
        sums[t] = sums.get(t, 0.0) + float(lt or 0)
        customers.append({
            "customer_id": int(cid or 0),
            "cliente": nombre,
            "tier": t,
            "lifetime": round(float(lt or 0), 2),
            "max_order": round(float(mo or 0), 2),
            "ticket_promedio": round(float(at or 0), 2),
            "ordenes_pagadas": int(n or 0),
            "primera_compra": fo.isoformat() if fo else None,
            "ultima_compra": lo.isoformat() if lo else None,
            "recency_dias": int(rec or 0) if rec is not None else None,
            "email": email or "",
            "telefono": tel or "",
            "provincia": prov or "-",
            "razon": cls["reasons"][0] if cls["reasons"] else "",
        })

    cols = [
        "customer_id", "cliente", "tier", "lifetime", "max_order",
        "ticket_promedio", "ordenes_pagadas",
        "primera_compra", "ultima_compra", "recency_dias",
        "email", "telefono", "provincia", "razon",
    ]
    rows_out = [[c[k] for k in cols] for c in customers]

    return {
        "columns": cols,
        "rows": rows_out,
        "row_count": len(rows_out),
        "tiers": {
            "gold": {"count": counts["gold"], "lifetime_total": round(sums["gold"], 2)},
            "silver": {"count": counts["silver"], "lifetime_total": round(sums["silver"], 2)},
            "bronze": {"count": counts["bronze"], "lifetime_total": round(sums["bronze"], 2)},
        },
        "total_vips": sum(counts.values()),
        "lifetime_total": round(sum(sums.values()), 2),
        "tier_filter": tier,
        "rules": {
            "vip_threshold": VIP_THRESHOLD,
            "high_ticket_threshold": HIGH_TICKET_THRESHOLD,
            "recurrent_min_orders": RECURRENT_MIN_ORDERS,
            "recurrent_min_ticket": RECURRENT_MIN_TICKET,
            "tier_gold_min": TIER_GOLD_MIN,
            "tier_silver_min": TIER_SILVER_MIN,
            "tier_bronze_min": TIER_BRONZE_MIN,
        },
        "generated_at": now_ar().isoformat(),
    }


def vip_overview() -> dict:
    """KPI overview: cantidad de VIPs por tier + facturacion total VIP."""
    full = list_vip_customers("all")
    return {
        "total_vips": full["total_vips"],
        "tiers": full["tiers"],
        "lifetime_total": full["lifetime_total"],
        "rules": full["rules"],
        "generated_at": full["generated_at"],
    }


def get_customer_vip_status(customer_id: int) -> dict:
    """Devuelve {is_vip, tier, reasons, metrics} para un customer especifico.
    Util para mostrar en customer 360."""
    eng = get_engine("unistore")
    rows = q(eng, """
        SELECT
            COUNT(*)::int AS paid_orders,
            COALESCE(SUM(o.total), 0)::float AS lifetime,
            COALESCE(MAX(o.total), 0)::float AS max_order,
            COALESCE(AVG(o.total), 0)::float AS avg_ticket
        FROM tienda_nube."Order" o
        WHERE o."customerId" = :cid AND o."paymentStatus" = 'paid'
    """, {"cid": int(customer_id)}) or []
    if not rows or not rows[0]:
        return {"is_vip": False, "tier": None, "reasons": []}
    r = rows[0]
    return classify_vip(
        float(r[1] or 0),
        float(r[2] or 0),
        int(r[0] or 0),
        float(r[3] or 0),
    )

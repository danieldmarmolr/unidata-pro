"""
Clasificacion de Clientes VIP de Unistore (TN).

Regla simple y estricta: cliente es VIP si su TICKET PROMEDIO PAGADO
es >= $300.000. Lo que importa es la magnitud de CADA compra, no la
suma acumulada (un cliente con 10 compras de $50k NO es VIP aunque
acumule $500k - su comportamiento es de cliente comun, no premium).

  - 1 compra de $400k -> avg $400k -> VIP ✓
  - 2 compras de $400k + $200k -> avg $300k -> VIP (justo) ✓
  - 10 compras de $50k -> avg $50k -> NO VIP (LTV $500k pero no premium)

Tiers internos por ticket promedio:
  - Bronze: avg $300k - $500k    ("VIP estandar")
  - Silver: avg $500k - $1M      ("VIP premium")
  - Gold:   avg > $1M            ("VIP elite")
"""
from __future__ import annotations

import logging

from app.utils.tz import now_ar
from app.db.engines import get_engine
from app.services._utils import q

log = logging.getLogger("unidata.customer_vip")

# Umbral unico: ticket promedio pagado debe ser >= $300k
VIP_AVG_TICKET_THRESHOLD = 300_000.0

# Tiers por ticket promedio
TIER_GOLD_MIN = 1_000_000.0      # avg > $1M
TIER_SILVER_MIN = 500_000.0      # avg $500k - $1M
TIER_BRONZE_MIN = 300_000.0      # avg $300k - $500k


def _classify_tier(avg_ticket: float) -> str | None:
    """Devuelve el tier del VIP segun ticket promedio pagado."""
    if avg_ticket >= TIER_GOLD_MIN:
        return "gold"
    if avg_ticket >= TIER_SILVER_MIN:
        return "silver"
    if avg_ticket >= TIER_BRONZE_MIN:
        return "bronze"
    return None


def classify_vip(lifetime: float, max_order: float, paid_orders: int, avg_ticket: float) -> dict:
    """Recibe metricas del cliente y devuelve {is_vip, tier, reasons[]}.

    Regla: VIP si avg_ticket >= $300k (cada compra es de $300k+ en promedio).
    Esto distingue a clientes premium reales de clientes con muchas compras chicas.
    """
    is_vip = avg_ticket >= VIP_AVG_TICKET_THRESHOLD
    tier = _classify_tier(avg_ticket) if is_vip else None
    reasons: list[str] = []
    if is_vip:
        if paid_orders == 1:
            reasons.append(
                f"Primera compra ${int(max_order):,} >= ${int(VIP_AVG_TICKET_THRESHOLD):,}".replace(",", ".")
            )
        else:
            reasons.append(
                f"Ticket promedio ${int(avg_ticket):,} en {paid_orders} compras (todas premium)".replace(",", ".")
            )

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
        WHERE avg_ticket >= :avg_t
        ORDER BY avg_ticket DESC NULLS LAST
        LIMIT 5000
    """, {"avg_t": VIP_AVG_TICKET_THRESHOLD}) or []

    customers = []
    counts = {"gold": 0, "silver": 0, "bronze": 0}
    sums_lifetime = {"gold": 0.0, "silver": 0.0, "bronze": 0.0}

    for r in rows:
        cid, nombre, email, tel, prov, n, lt, mo, at, fo, lo, rec = r
        cls = classify_vip(float(lt or 0), float(mo or 0), int(n or 0), float(at or 0))
        t = cls["tier"]
        if t is None:
            continue
        if tier != "all" and t != tier:
            continue
        counts[t] = counts.get(t, 0) + 1
        sums_lifetime[t] = sums_lifetime.get(t, 0.0) + float(lt or 0)
        customers.append({
            "customer_id": int(cid or 0),
            "cliente": nombre,
            "tier": t,
            "ticket_promedio": round(float(at or 0), 2),
            "lifetime": round(float(lt or 0), 2),
            "max_order": round(float(mo or 0), 2),
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
        "customer_id", "cliente", "tier", "ticket_promedio", "lifetime",
        "max_order", "ordenes_pagadas",
        "primera_compra", "ultima_compra", "recency_dias",
        "email", "telefono", "provincia", "razon",
    ]
    rows_out = [[c[k] for k in cols] for c in customers]

    return {
        "columns": cols,
        "rows": rows_out,
        "row_count": len(rows_out),
        "tiers": {
            "gold": {"count": counts["gold"], "lifetime_total": round(sums_lifetime["gold"], 2)},
            "silver": {"count": counts["silver"], "lifetime_total": round(sums_lifetime["silver"], 2)},
            "bronze": {"count": counts["bronze"], "lifetime_total": round(sums_lifetime["bronze"], 2)},
        },
        "total_vips": sum(counts.values()),
        "lifetime_total": round(sum(sums_lifetime.values()), 2),
        "tier_filter": tier,
        "rules": {
            "vip_avg_ticket_threshold": VIP_AVG_TICKET_THRESHOLD,
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

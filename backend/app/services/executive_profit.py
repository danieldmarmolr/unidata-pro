"""
Motor de ganancia consolidada para el panel Gerencia 360.

Calcula la ganancia REAL que queda en caja por unidad y consolidada:
- Unistore (TN + ML): aplica profit_engine SKU-por-SKU usando cost_index_unistore
- Unidrop: Facturacion Contabilium - Comisiones - Egresos operativos del flujo-fondos
- Consolidado: suma de las dos + margen %
- Cobertura de costos %: % del revenue Unistore que tiene costo cargado (calidad de la data)
- Top 10 SKUs por ganancia $ + bottom SKUs con margen <5%
- Serie diaria 90d de ganancia Unistore por canal
"""
from __future__ import annotations

import datetime as dt
import logging
from datetime import date, timedelta
from typing import Any

from app.db.engines import get_engine
from app.services._utils import q, scalar, resolve_window
from app.services.profit_engine import cost_index_unistore, calc_profit

log = logging.getLogger("unidata.executive_profit")


# ---------------------------------------------------------------------------
# Unistore: ganancia neta a partir de SKU revenue + cost_index
# ---------------------------------------------------------------------------

def _unistore_sku_revenue_window(from_ts, to_ts) -> list[tuple]:
    """[(sku, units, revenue, rev_tn, rev_ml)] sumando TN + ML en la ventana."""
    eng = get_engine("unistore")
    p = {"from_ts": from_ts, "to_ts": to_ts}
    rows = q(eng, """
        SELECT sku,
               SUM(units)::int AS units,
               SUM(revenue)::float AS revenue,
               SUM(CASE WHEN canal='tn' THEN revenue ELSE 0 END)::float AS rev_tn,
               SUM(CASE WHEN canal='ml' THEN revenue ELSE 0 END)::float AS rev_ml
        FROM (
            SELECT oi.sku, SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi.price)::float AS revenue, 'tn' AS canal
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus"='paid'
              AND o."createdAt" >= :from_ts AND o."createdAt" < :to_ts
              AND oi.sku IS NOT NULL AND TRIM(oi.sku) <> ''
            GROUP BY oi.sku
            UNION ALL
            SELECT mi.seller_sku, SUM(mi.quantity)::int,
                   SUM(mi.unit_price * mi.quantity)::float, 'ml' AS canal
            FROM meli.meli_order_items mi
            JOIN meli.meli_orders mo ON mo.id = mi.order_id
            WHERE mo.date_created >= :from_ts AND mo.date_created < :to_ts
              AND mo.status IN ('paid','confirmed','shipped','delivered')
              AND mi.seller_sku IS NOT NULL AND TRIM(mi.seller_sku) <> ''
            GROUP BY mi.seller_sku
        ) x
        GROUP BY sku
    """, p) or []
    return rows


def ganancia_unistore(period: str, from_iso: str | None, to_iso: str | None,
                     *, cost_idx: dict | None = None) -> dict:
    """Ganancia neta Unistore: itera SKUs vendidos, aplica calc_profit con costo del lote."""
    cost_idx = cost_idx if cost_idx is not None else cost_index_unistore()
    win = resolve_window(period, from_iso, to_iso)
    rows = _unistore_sku_revenue_window(win["from_ts"], win["to_ts"])

    total_revenue = 0.0
    revenue_con_costo = 0.0
    total_costo = 0.0
    total_ganancia = 0.0
    skus_con_costo = 0
    skus_sin_costo = 0
    by_sku: list[dict] = []

    for sku, units, revenue, rev_tn, rev_ml in rows:
        rev = float(revenue or 0)
        u = int(units or 0)
        total_revenue += rev

        rec = cost_idx.get((sku or "").strip().lower())
        if rec and rec.get("costo_con_iva") and u > 0 and rev > 0:
            sin_iva = float(rec.get("costo_sin_iva") or 0)
            con_iva = float(rec.get("costo_con_iva") or sin_iva)
            costo_total = con_iva * u
            pb = calc_profit(
                ingreso_bruto=rev,
                costo_sin_iva=sin_iva * u,
                costo_con_iva=costo_total,
                is_cash=False,
                iva_aliquot_override=rec.get("iva_aliquot"),
            )
            total_costo += costo_total
            total_ganancia += pb.ganancia_neta
            revenue_con_costo += rev
            skus_con_costo += 1
            by_sku.append({
                "sku": sku,
                "units": u,
                "revenue": round(rev, 0),
                "costo": round(costo_total, 0),
                "ganancia_neta": round(pb.ganancia_neta, 0),
                "margen_pct": round(pb.margen_pct, 1),
                "rev_tn": round(float(rev_tn or 0), 0),
                "rev_ml": round(float(rev_ml or 0), 0),
            })
        else:
            skus_sin_costo += 1

    cobertura_pct = (revenue_con_costo / total_revenue * 100) if total_revenue > 0 else 0
    margen_pct = (total_ganancia / revenue_con_costo * 100) if revenue_con_costo > 0 else 0

    top10 = sorted(by_sku, key=lambda x: -x["ganancia_neta"])[:10]
    bottom = [s for s in sorted(by_sku, key=lambda x: x["margen_pct"]) if s["margen_pct"] < 5][:10]

    return {
        "unit": "unistore",
        "revenue": round(total_revenue, 0),
        "revenue_con_costo": round(revenue_con_costo, 0),
        "costo": round(total_costo, 0),
        "ganancia_neta": round(total_ganancia, 0),
        "margen_pct": round(margen_pct, 1),
        "cobertura_costos_pct": round(cobertura_pct, 1),
        "skus_con_costo": skus_con_costo,
        "skus_sin_costo": skus_sin_costo,
        "top10_skus_by_profit": top10,
        "bottom_skus_low_margin": bottom,
    }


# ---------------------------------------------------------------------------
# Unidrop: facturacion - comisiones - egresos operativos
# ---------------------------------------------------------------------------

def _egresos_unidrop(days: int) -> float:
    """Egresos operativos del periodo cargados en flujo-fondos asignados a Unidrop."""
    try:
        from app.db.flujo_fondos_db import get_conn
        hoy = date.today()
        desde = (hoy - timedelta(days=days)).isoformat()
        hasta = hoy.isoformat()
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                SELECT COALESCE(SUM(e.monto), 0)::float AS total
                FROM public."erogaciones" e
                LEFT JOIN public."empresas" em ON em.id = e.empresa_id
                WHERE e.fecha_pago >= %s AND e.fecha_pago <= %s
                  AND e.oculto = FALSE
                  AND e.estado::text IN ('pagado','en_curso','pendiente')
                  AND (em.nombre ILIKE %s OR e.categoria ILIKE %s)
            """, (desde, hasta, "%unidrop%", "%unidrop%"))
            row = cur.fetchone()
            return float(row["total"] if isinstance(row, dict) else row[0] or 0)
    except Exception as exc:
        log.warning("egresos_unidrop: %s", exc)
        return 0.0


def ganancia_unidrop(period: str, from_iso: str | None, to_iso: str | None) -> dict:
    """Ganancia Unidrop neta = Facturacion - Comisiones - Egresos operativos."""
    eng = get_engine("unidrop")
    win = resolve_window(period, from_iso, to_iso)
    days = win["days"]
    p = {"days": days}

    fact = float(scalar(eng, """
        SELECT COALESCE(SUM(total),0)::float
        FROM contabillium_dev."ContabilliumInvoice"
        WHERE "fechaEmision" >= NOW() - make_interval(days => :days)
    """, p) or 0)

    comisiones = float(scalar(eng, """
        SELECT (
            (SELECT COALESCE(SUM(commission),0)::float FROM public."PaymentTransaction"
              WHERE "createdAt" >= NOW() - make_interval(days => :days)) +
            (SELECT COALESCE(SUM(commission),0)::float FROM public."PaymentTransactionSubscription"
              WHERE "createdAt" >= NOW() - make_interval(days => :days))
        )
    """, p) or 0)

    egresos = _egresos_unidrop(days)

    ganancia_neta = fact - comisiones - egresos
    margen_pct = (ganancia_neta / fact * 100) if fact > 0 else 0

    return {
        "unit": "unidrop",
        "facturacion": round(fact, 0),
        "comisiones": round(comisiones, 0),
        "egresos_operativos": round(egresos, 0),
        "ganancia_neta": round(ganancia_neta, 0),
        "margen_pct": round(margen_pct, 1),
    }


# ---------------------------------------------------------------------------
# Deuda Talo pendiente
# ---------------------------------------------------------------------------

def deuda_talo_pendiente() -> float:
    """Suma expectedAmount de PaymentIntentSubscription PENDING (subs facturadas, no cobradas)."""
    try:
        eng = get_engine("unidrop")
        val = scalar(eng, """
            SELECT COALESCE(SUM("expectedAmount"), 0)::float
            FROM public."PaymentIntentSubscription"
            WHERE status::text = 'PENDING'
        """) or 0
        return round(float(val), 0)
    except Exception as exc:
        log.warning("deuda_talo_pendiente: %s", exc)
        return 0.0


# ---------------------------------------------------------------------------
# Serie diaria de ganancia 90d (TN + ML separadas)
# ---------------------------------------------------------------------------

def profit_daily_series(days: int = 90) -> dict:
    """Serie diaria de ganancia neta Unistore separando TN y ML."""
    eng = get_engine("unistore")
    cost_idx = cost_index_unistore()

    tn_rows = q(eng, """
        SELECT DATE(o."createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS dia,
               oi.sku,
               SUM(oi.quantity)::int AS units,
               SUM(oi.quantity * oi.price)::float AS revenue
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(days => :days)
          AND oi.sku IS NOT NULL AND TRIM(oi.sku) <> ''
        GROUP BY 1, 2
    """, {"days": days}) or []

    ml_rows = q(eng, """
        SELECT DATE(mo.date_created AT TIME ZONE 'America/Argentina/Buenos_Aires') AS dia,
               mi.seller_sku AS sku,
               SUM(mi.quantity)::int AS units,
               SUM(mi.quantity * mi.unit_price)::float AS revenue
        FROM meli.meli_order_items mi
        JOIN meli.meli_orders mo ON mo.id = mi.order_id
        WHERE mo.status IN ('paid','confirmed','shipped','delivered')
          AND mo.date_created >= NOW() - make_interval(days => :days)
          AND mi.seller_sku IS NOT NULL AND TRIM(mi.seller_sku) <> ''
        GROUP BY 1, 2
    """, {"days": days}) or []

    by_day: dict[str, dict] = {}

    def _accum(rows, canal: str) -> None:
        for dia, sku, units, revenue in rows:
            dkey = dia.isoformat() if dia else None
            if not dkey:
                continue
            slot = by_day.setdefault(dkey, {
                "ganancia_tn": 0.0, "ganancia_ml": 0.0,
                "revenue_tn": 0.0, "revenue_ml": 0.0,
            })
            rev = float(revenue or 0)
            u = int(units or 0)
            slot[f"revenue_{canal}"] += rev

            rec = cost_idx.get((sku or "").strip().lower())
            if rec and rec.get("costo_con_iva") and u > 0 and rev > 0:
                sin_iva = float(rec.get("costo_sin_iva") or 0)
                con_iva = float(rec.get("costo_con_iva") or sin_iva)
                pb = calc_profit(
                    ingreso_bruto=rev,
                    costo_sin_iva=sin_iva * u,
                    costo_con_iva=con_iva * u,
                    is_cash=False,
                    iva_aliquot_override=rec.get("iva_aliquot"),
                )
                slot[f"ganancia_{canal}"] += pb.ganancia_neta

    _accum(tn_rows, "tn")
    _accum(ml_rows, "ml")

    points = []
    for d in sorted(by_day.keys()):
        bd = by_day[d]
        total_gan = bd["ganancia_tn"] + bd["ganancia_ml"]
        total_rev = bd["revenue_tn"] + bd["revenue_ml"]
        points.append({
            "date": d,
            "ganancia_tn": round(bd["ganancia_tn"], 0),
            "ganancia_ml": round(bd["ganancia_ml"], 0),
            "ganancia_total": round(total_gan, 0),
            "revenue_total": round(total_rev, 0),
        })

    return {"days": days, "points": points}


# ---------------------------------------------------------------------------
# Overview consolidado para Gerencia 360
# ---------------------------------------------------------------------------

def gerencia_profit_overview(period: str = "30d", from_iso: str | None = None,
                              to_iso: str | None = None) -> dict:
    cost_idx = cost_index_unistore()
    uni = ganancia_unistore(period, from_iso, to_iso, cost_idx=cost_idx)
    drop = ganancia_unidrop(period, from_iso, to_iso)

    ganancia_total = uni["ganancia_neta"] + drop["ganancia_neta"]
    revenue_total = uni["revenue"] + drop["facturacion"]
    margen_consolidado = (ganancia_total / revenue_total * 100) if revenue_total > 0 else 0

    return {
        "period": period,
        "unistore": uni,
        "unidrop": drop,
        "consolidado": {
            "revenue": round(revenue_total, 0),
            "ganancia_neta": round(ganancia_total, 0),
            "margen_pct": round(margen_consolidado, 1),
            "cobertura_costos_unistore_pct": uni["cobertura_costos_pct"],
        },
        "deuda_talo_pendiente": deuda_talo_pendiente(),
        "profit_series_90d": profit_daily_series(90),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

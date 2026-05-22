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


def _meta_ads_spend_unidrop(period: str) -> float:
    """Spend Meta Ads del periodo asignado a unidad Unidrop (via meta_ad_accounts.unit)."""
    try:
        from app.services.meta_ads import overview as meta_overview
        out = meta_overview(period=period, unit="unidrop") or {}
        kpi = out.get("kpi") or {}
        return float(kpi.get("spend") or 0)
    except Exception as exc:
        log.warning("meta_ads_spend_unidrop: %s", exc)
        return 0.0


def _ganancia_mayorista_unidrop(days: int, cost_idx: dict) -> dict:
    """Ganancia mayorista de Unidrop = SUM por SKU vendido a un dropshipper
    de (precio_mayorista_unidrop - costo_lote_unistore) × qty.

    - TN Unidrop: tienda_nube_order_items.cost = lo que el dropshipper le paga
                  a Unidrop por unidad (precio mayorista).
    - ML Unidrop: OrderItemMercadoLibre.unitCost = igual.
    - Costo del lote: cost_idx (cost_index_unistore) que toma el ULTIMO lote
                      por SKU (costo_con_iva_unit_ars).

    Returns:
        precio_mayorista_total, costo_lote_total, ganancia_bruta,
        desglose tn/ml, skus_con_costo, skus_sin_costo, revenue_sin_costo,
        error.
    """
    try:
        eng = get_engine("unidrop")
        p = {"days": days}

        # Agregar por SKU en Unidrop TN
        tn_rows = q(eng, """
            SELECT tnoi.sku,
                   SUM(tnoi.quantity)::int AS qty,
                   SUM(tnoi.cost * tnoi.quantity)::float AS precio_mayorista_total
            FROM public.tienda_nube_orders tno
            INNER JOIN public.tienda_nube_order_items tnoi
              ON tnoi.tienda_nube_order_id = tno.tienda_nube_id
            WHERE tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - make_interval(days => :days)
              AND tnoi.sku IS NOT NULL AND TRIM(tnoi.sku) <> ''
              AND tnoi.cost IS NOT NULL AND tnoi.cost > 0
            GROUP BY tnoi.sku
        """, p) or []

        # Agregar por SKU en Unidrop ML
        ml_rows = q(eng, """
            SELECT oi."sellerSku" AS sku,
                   SUM(oi.quantity)::int AS qty,
                   SUM(oi."unitCost" * oi.quantity)::float AS precio_mayorista_total
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            INNER JOIN mercado_libre_dev."OrderMercadoLibre" oml
              ON oml.id::text = oi."orderId"::text
            WHERE oml.status IN ('paid','confirmed','shipped','delivered')
              AND oml."dateCreated" >= NOW() - make_interval(days => :days)
              AND oi."sellerSku" IS NOT NULL AND TRIM(oi."sellerSku") <> ''
              AND oi."unitCost" IS NOT NULL AND oi."unitCost" > 0
            GROUP BY oi."sellerSku"
        """, p) or []

        def _process(rows, label: str):
            precio_total = 0.0
            costo_total = 0.0
            sin_costo_revenue = 0.0
            skus_con = 0
            skus_sin = 0
            for sku, qty, precio in rows:
                precio = float(precio or 0)
                qty = int(qty or 0)
                if qty <= 0 or precio <= 0:
                    continue
                precio_total += precio
                rec = cost_idx.get((sku or "").strip().lower())
                if rec and rec.get("costo_con_iva"):
                    costo_unit = float(rec["costo_con_iva"])
                    costo_total += costo_unit * qty
                    skus_con += 1
                else:
                    sin_costo_revenue += precio
                    skus_sin += 1
            return {
                "precio_mayorista": round(precio_total, 0),
                "costo_lote": round(costo_total, 0),
                "ganancia_bruta": round(precio_total - costo_total, 0),
                "revenue_sin_costo": round(sin_costo_revenue, 0),
                "skus_con_costo": skus_con,
                "skus_sin_costo": skus_sin,
            }

        tn = _process(tn_rows, "tn")
        ml = _process(ml_rows, "ml")

        precio_total = tn["precio_mayorista"] + ml["precio_mayorista"]
        costo_total = tn["costo_lote"] + ml["costo_lote"]
        ganancia = precio_total - costo_total
        sin_costo_total = tn["revenue_sin_costo"] + ml["revenue_sin_costo"]
        cobertura_pct = ((precio_total - sin_costo_total) / precio_total * 100) if precio_total > 0 else 0

        return {
            "precio_mayorista_total": round(precio_total, 0),
            "costo_lote_total": round(costo_total, 0),
            "ganancia_bruta": round(ganancia, 0),
            "ganancia_tn": tn["ganancia_bruta"],
            "ganancia_ml": ml["ganancia_bruta"],
            "precio_mayorista_tn": tn["precio_mayorista"],
            "precio_mayorista_ml": ml["precio_mayorista"],
            "costo_tn": tn["costo_lote"],
            "costo_ml": ml["costo_lote"],
            "skus_con_costo": tn["skus_con_costo"] + ml["skus_con_costo"],
            "skus_sin_costo": tn["skus_sin_costo"] + ml["skus_sin_costo"],
            "revenue_sin_costo": round(sin_costo_total, 0),
            "cobertura_pct": round(cobertura_pct, 1),
            "error": None,
        }
    except Exception as exc:
        log.warning("_ganancia_mayorista_unidrop: %s", exc)
        return {
            "precio_mayorista_total": 0, "costo_lote_total": 0, "ganancia_bruta": 0,
            "ganancia_tn": 0, "ganancia_ml": 0,
            "precio_mayorista_tn": 0, "precio_mayorista_ml": 0,
            "costo_tn": 0, "costo_ml": 0,
            "skus_con_costo": 0, "skus_sin_costo": 0,
            "revenue_sin_costo": 0, "cobertura_pct": 0,
            "error": str(exc),
        }


def ganancia_unidrop(period: str, from_iso: str | None, to_iso: str | None,
                     *, cost_idx: dict | None = None) -> dict:
    """Modelo mixto: volumen plataforma (informativo) + retencion neta de Unidrop.

    Volumen plataforma (NO entra en ganancia Unidrop, es solo referencia):
      - Facturacion operativa = TN paid + ML paid (volumen omnicanal)
      - Costo mercaderia      = SUM(items.cost*qty) en TN + merchandise_cost en ML
        = lo que el DROPSHIPPER le pagó a Unidrop por la mercadería (precio mayorista)

    Retencion neta de Unidrop:
      Ingresos:
        + Comisiones Talo (PaymentTransaction.commission + subs)
        + Suscripciones MELI cobradas (PaymentIntentSubscription PROCESSED.paidAmount)
        + Ganancia mayorista mercadería:
            SUM por SKU vendido de (precio_mayorista_unidrop − costo_lote_unistore) × qty
            usando el ULTIMO lote cargado en cost_index_unistore.
      Egresos:
        - Meta Ads spend asignado a unit='unidrop'
        - Egresos operativos del flujo-fondos asignados a empresa Unidrop
      Ganancia neta = Ingresos - Egresos
    """
    eng = get_engine("unidrop")
    win = resolve_window(period, from_iso, to_iso)
    days = win["days"]
    p = {"days": days}

    # ---------- VOLUMEN PLATAFORMA (informativo) ----------

    # TN paid: volumen + costo de mercaderia per item
    tn_row = q(eng, """
        SELECT COALESCE(SUM(tno.total), 0)::float AS volumen,
               COALESCE(SUM(tnoi.cost * tnoi.quantity) FILTER (WHERE tnoi.cost IS NOT NULL), 0)::float AS costo,
               COUNT(DISTINCT tno.tienda_nube_id)::int AS ordenes
        FROM public.tienda_nube_orders tno
        LEFT JOIN public.tienda_nube_order_items tnoi
          ON tnoi.tienda_nube_order_id = tno.tienda_nube_id
        WHERE tno.payment_status::text = 'paid'
          AND tno.created_at >= NOW() - make_interval(days => :days)
    """, p) or [(0, 0, 0)]
    tn_vol, tn_costo, tn_ords = float(tn_row[0][0] or 0), float(tn_row[0][1] or 0), int(tn_row[0][2] or 0)

    # ML paid: volumen + costo (merchandise_cost ya agregado por orden)
    ml_row = q(eng, """
        SELECT COALESCE(SUM("totalAmount"), 0)::float AS volumen,
               COALESCE(SUM("merchandise_cost"), 0)::float AS costo,
               COUNT(*)::int AS ordenes
        FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE status IN ('paid','confirmed','shipped','delivered')
          AND "dateCreated" >= NOW() - make_interval(days => :days)
    """, p) or [(0, 0, 0)]
    ml_vol, ml_costo, ml_ords = float(ml_row[0][0] or 0), float(ml_row[0][1] or 0), int(ml_row[0][2] or 0)

    volumen_plataforma = tn_vol + ml_vol
    costo_mercaderia = tn_costo + ml_costo
    ordenes_pagadas = tn_ords + ml_ords

    # ---------- INGRESOS UNIDROP (lo que retiene) ----------

    comisiones = float(scalar(eng, """
        SELECT (
            (SELECT COALESCE(SUM(commission),0)::float FROM public."PaymentTransaction"
              WHERE "createdAt" >= NOW() - make_interval(days => :days)) +
            (SELECT COALESCE(SUM(commission),0)::float FROM public."PaymentTransactionSubscription"
              WHERE "createdAt" >= NOW() - make_interval(days => :days))
        )
    """, p) or 0)

    suscripciones_cobradas = float(scalar(eng, """
        SELECT COALESCE(SUM("paidAmount"), 0)::float
        FROM public."PaymentIntentSubscription"
        WHERE status::text = 'PROCESSED'
          AND "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0)

    # Ganancia mayorista por mercaderia vendida a dropshippers.
    # cost_idx puede venir precomputado del overview (evita doble carga).
    if cost_idx is None:
        cost_idx = cost_index_unistore()
    mayorista = _ganancia_mayorista_unidrop(days, cost_idx)
    ganancia_mayorista = float(mayorista["ganancia_bruta"])

    ingresos_unidrop = comisiones + suscripciones_cobradas + ganancia_mayorista

    # ---------- EGRESOS UNIDROP ----------
    meta_ads_spend = _meta_ads_spend_unidrop(period)
    egresos = _egresos_unidrop(days)

    ganancia_neta = ingresos_unidrop - meta_ads_spend - egresos
    margen_pct = (ganancia_neta / ingresos_unidrop * 100) if ingresos_unidrop > 0 else 0

    # Facturacion Contabilium queda como referencia (no para calculo)
    fact_contabilium = float(scalar(eng, """
        SELECT COALESCE(SUM(total),0)::float
        FROM contabillium_dev."ContabilliumInvoice"
        WHERE "fechaEmision" >= NOW() - make_interval(days => :days)
    """, p) or 0)

    return {
        "unit": "unidrop",
        # Volumen plataforma (informativo, NO entra en ganancia)
        "volumen_plataforma": round(volumen_plataforma, 0),
        "volumen_tn": round(tn_vol, 0),
        "volumen_ml": round(ml_vol, 0),
        "costo_mercaderia": round(costo_mercaderia, 0),
        "costo_tn": round(tn_costo, 0),
        "costo_ml": round(ml_costo, 0),
        "ordenes_pagadas": ordenes_pagadas,
        "margen_bruto_plataforma": round(volumen_plataforma - costo_mercaderia, 0),
        # Ingresos Unidrop (retencion real)
        "comisiones": round(comisiones, 0),
        "suscripciones_cobradas": round(suscripciones_cobradas, 0),
        "ganancia_mayorista": round(ganancia_mayorista, 0),
        "ingresos_unidrop": round(ingresos_unidrop, 0),
        # Desglose ganancia mayorista (precio mayorista vs costo lote del ultimo)
        "mayorista_breakdown": {
            "precio_mayorista_total": mayorista["precio_mayorista_total"],
            "costo_lote_total": mayorista["costo_lote_total"],
            "ganancia_tn": mayorista["ganancia_tn"],
            "ganancia_ml": mayorista["ganancia_ml"],
            "precio_mayorista_tn": mayorista["precio_mayorista_tn"],
            "precio_mayorista_ml": mayorista["precio_mayorista_ml"],
            "costo_tn": mayorista["costo_tn"],
            "costo_ml": mayorista["costo_ml"],
            "skus_con_costo": mayorista["skus_con_costo"],
            "skus_sin_costo": mayorista["skus_sin_costo"],
            "revenue_sin_costo": mayorista["revenue_sin_costo"],
            "cobertura_pct": mayorista["cobertura_pct"],
            "error": mayorista.get("error"),
        },
        # Egresos Unidrop
        "meta_ads_spend": round(meta_ads_spend, 0),
        "egresos_operativos": round(egresos, 0),
        # Resultado
        "ganancia_neta": round(ganancia_neta, 0),
        "margen_pct": round(margen_pct, 1),
        # Compat / referencia
        "facturacion": round(fact_contabilium, 0),  # legacy field name = Contabilium ref
        "facturacion_contabilium": round(fact_contabilium, 0),
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
    """Serie diaria de ganancia neta Unistore separando TN y ML.

    Resiliente: si el engine falla, devuelve {points: [], error: "..."}."""
    try:
        eng = get_engine("unistore")
        cost_idx = cost_index_unistore()
    except Exception as exc:
        log.warning("profit_daily_series init: %s", exc)
        return {"days": days, "points": [], "error": str(exc)}

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

    return {"days": days, "points": points, "error": None}


# ---------------------------------------------------------------------------
# Serie diaria consolidada (Unistore + Unidrop) + forecast comparativo
# ---------------------------------------------------------------------------

def profit_daily_consolidated(days: int = 90, forecast_horizon: int = 28) -> dict:
    """Serie diaria de ganancia por canal + forecast multi-metodo.

    Canales:
      - unistore_tn:  ganancia neta Unistore TN (SKU-by-SKU calc_profit)
      - unistore_ml:  ganancia neta Unistore ML
      - unidrop:      retencion neta diaria Unidrop = (comisiones + subs) - meta_ads
                       (sin egresos operativos porque son mensuales/no granulares)
      - total:        suma de los 3

    Devuelve la serie historica + forecasts de 7 metodos + MAPE comparativo para
    elegir el mejor para extrapolar.
    """
    from app.services.forecast_methods import compare_forecasts

    # ---- Series Unistore TN + ML (reuso logica de profit_daily_series) ----
    try:
        uni_series = profit_daily_series(days=days)
    except Exception as exc:
        log.warning("profit_daily_consolidated unistore: %s", exc)
        uni_series = {"days": days, "points": [], "error": str(exc)}

    # Indice por fecha → {tn, ml}
    uni_by_date: dict[str, dict] = {p["date"]: p for p in uni_series.get("points", [])}

    # ---- Serie Unidrop diaria ----
    drop_by_date: dict[str, float] = {}
    try:
        eng = get_engine("unidrop")
        p = {"days": days}

        # Comisiones diarias (PaymentTransaction + subs)
        comm_rows = q(eng, """
            SELECT DATE("createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   COALESCE(SUM(commission), 0)::float AS comm
            FROM public."PaymentTransaction"
            WHERE "createdAt" >= NOW() - make_interval(days => :days)
            GROUP BY 1
        """, p) or []
        comm_subs_rows = q(eng, """
            SELECT DATE("createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   COALESCE(SUM(commission), 0)::float AS comm
            FROM public."PaymentTransactionSubscription"
            WHERE "createdAt" >= NOW() - make_interval(days => :days)
            GROUP BY 1
        """, p) or []
        # Suscripciones cobradas diarias
        subs_rows = q(eng, """
            SELECT DATE("createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   COALESCE(SUM("paidAmount"), 0)::float AS amt
            FROM public."PaymentIntentSubscription"
            WHERE status::text = 'PROCESSED'
              AND "createdAt" >= NOW() - make_interval(days => :days)
            GROUP BY 1
        """, p) or []

        for d, val in (comm_rows + comm_subs_rows + subs_rows):
            if d is None:
                continue
            key = d.isoformat()
            drop_by_date[key] = drop_by_date.get(key, 0.0) + float(val or 0)
    except Exception as exc:
        log.warning("profit_daily_consolidated unidrop ingresos: %s", exc)

    # Meta Ads spend diario (resta de la retencion)
    meta_by_date: dict[str, float] = {}
    try:
        from app.services.meta_ads import overview as meta_overview
        # Period semantica: el endpoint usa "Xd" como string
        meta_period = f"{days}d" if days in (7, 14, 30, 60, 90, 180, 365) else "90d"
        meta_out = meta_overview(period=meta_period, unit="unidrop") or {}
        for row in (meta_out.get("daily") or []):
            d = row.get("d") or row.get("date")
            if not d:
                continue
            meta_by_date[d] = float(row.get("spend") or 0)
    except Exception as exc:
        log.warning("profit_daily_consolidated meta_ads: %s", exc)

    # ---- Merge en serie diaria ordenada ----
    all_dates = set(uni_by_date.keys()) | set(drop_by_date.keys()) | set(meta_by_date.keys())
    points: list[dict] = []
    for d in sorted(all_dates):
        tn = float(uni_by_date.get(d, {}).get("ganancia_tn", 0) or 0)
        ml = float(uni_by_date.get(d, {}).get("ganancia_ml", 0) or 0)
        drop_ingresos = drop_by_date.get(d, 0.0)
        meta_spend = meta_by_date.get(d, 0.0)
        unidrop_net = drop_ingresos - meta_spend
        total = tn + ml + unidrop_net
        points.append({
            "date": d,
            "unistore_tn": round(tn, 0),
            "unistore_ml": round(ml, 0),
            "unidrop": round(unidrop_net, 0),
            "unidrop_ingresos": round(drop_ingresos, 0),
            "meta_ads": round(meta_spend, 0),
            "total": round(total, 0),
        })

    # ---- Forecast comparativo sobre la serie TOTAL ----
    total_values = [p["total"] for p in points]
    forecasts = compare_forecasts(total_values, horizon=forecast_horizon, backtest_size=14)

    # Agregar fechas a los forecasts para que el front pueda graficar
    if points:
        last_date = points[-1]["date"]
        from datetime import date as _date, timedelta as _td
        last = _date.fromisoformat(last_date)
        forecast_dates = [(last + _td(days=i + 1)).isoformat() for i in range(forecast_horizon)]
    else:
        forecast_dates = []

    return {
        "days": days,
        "horizon": forecast_horizon,
        "points": points,
        "forecast_dates": forecast_dates,
        "forecasts": forecasts,
        "error": None,
    }


# ---------------------------------------------------------------------------
# Overview consolidado para Gerencia 360
# ---------------------------------------------------------------------------

_UNISTORE_EMPTY = {
    "unit": "unistore", "revenue": 0, "revenue_con_costo": 0, "costo": 0,
    "ganancia_neta": 0, "margen_pct": 0, "cobertura_costos_pct": 0,
    "skus_con_costo": 0, "skus_sin_costo": 0,
    "top10_skus_by_profit": [], "bottom_skus_low_margin": [],
}

_UNIDROP_EMPTY = {
    "unit": "unidrop",
    "volumen_plataforma": 0, "volumen_tn": 0, "volumen_ml": 0,
    "costo_mercaderia": 0, "costo_tn": 0, "costo_ml": 0,
    "ordenes_pagadas": 0, "margen_bruto_plataforma": 0,
    "comisiones": 0, "suscripciones_cobradas": 0,
    "ganancia_mayorista": 0,
    "ingresos_unidrop": 0,
    "mayorista_breakdown": {
        "precio_mayorista_total": 0, "costo_lote_total": 0,
        "ganancia_tn": 0, "ganancia_ml": 0,
        "precio_mayorista_tn": 0, "precio_mayorista_ml": 0,
        "costo_tn": 0, "costo_ml": 0,
        "skus_con_costo": 0, "skus_sin_costo": 0,
        "revenue_sin_costo": 0, "cobertura_pct": 0,
        "error": None,
    },
    "meta_ads_spend": 0, "egresos_operativos": 0,
    "ganancia_neta": 0, "margen_pct": 0,
    "facturacion": 0, "facturacion_contabilium": 0,
}


def gerencia_profit_overview(period: str = "30d", from_iso: str | None = None,
                              to_iso: str | None = None) -> dict:
    """Vista principal de ganancia — SIN la serie 90d (esa va por endpoint aparte).

    Resiliente: cada sub-funcion va en su propio try. Si un engine SSH se cae
    o una query timeoutea, devolvemos esa parte vacia con flag de error y el
    resto del panel sigue funcionando. La UI muestra el warning correspondiente
    en cada bloque sin tumbar la pagina.
    """
    errors: dict[str, str] = {}

    try:
        cost_idx = cost_index_unistore()
    except Exception as exc:
        log.warning("cost_index_unistore: %s", exc)
        cost_idx = {}
        errors["cost_idx"] = str(exc)

    try:
        uni = ganancia_unistore(period, from_iso, to_iso, cost_idx=cost_idx)
    except Exception as exc:
        log.warning("ganancia_unistore: %s", exc)
        uni = dict(_UNISTORE_EMPTY)
        errors["unistore"] = str(exc)

    try:
        drop = ganancia_unidrop(period, from_iso, to_iso, cost_idx=cost_idx)
    except Exception as exc:
        log.warning("ganancia_unidrop: %s", exc)
        drop = dict(_UNIDROP_EMPTY)
        errors["unidrop"] = str(exc)

    try:
        deuda = deuda_talo_pendiente()
    except Exception as exc:
        log.warning("deuda_talo_pendiente: %s", exc)
        deuda = 0
        errors["deuda_talo"] = str(exc)

    # Ganancia consolidada: Unistore (margen sobre venta propia) + Unidrop (retencion neta).
    # NO sumamos revenue de Unidrop al revenue total porque seria doble-conteo (las
    # ordenes son de los dropshippers, Unidrop solo retiene comisiones+subs).
    # El "revenue total" del consolidado es Unistore propio + ingresos Unidrop.
    ganancia_total = uni["ganancia_neta"] + drop["ganancia_neta"]
    revenue_total = uni["revenue"] + drop["ingresos_unidrop"]
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
        "deuda_talo_pendiente": deuda,
        "errors": errors or None,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

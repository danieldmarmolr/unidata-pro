"""
Curva precio-volumen mayorista + elasticidades retail vs mayorista por SKU.

Endpoint principal: `wholesale_curve(sku)` — devuelve serie mensual de
(precio_mayorista, unidades_unidrop) + serie (precio_retail_unistore,
unidades_unistore) + las dos elasticidades estimadas por regresion
log-log + comparacion.

Endpoint de overview: `elasticity_comparison(top_n)` — calcula las dos
elasticidades para los SKUs con mas data y devuelve la lista ordenada
por diferencia retail vs mayorista, util para decidir donde Unistore
tiene mas poder de pricing sobre los dropshippers.

Modelo: regresion lineal sobre ln(unidades) ~ a + b*ln(precio). El
coeficiente b es la elasticidad-precio. Necesita al menos 4 puntos
mensuales con variacion de precio para ser confiable.
"""
from __future__ import annotations

import logging
import math
from collections import defaultdict

from app.db.engines import get_engine
from app.services._utils import q
from app.utils.tz import now_ar

log = logging.getLogger("unidata.wholesale_curve")


def _linear_regression(xs: list[float], ys: list[float]) -> dict | None:
    """Regresion lineal simple y = a + b*x. Devuelve b (slope), a (intercept),
    r2 (coeficiente de determinacion) y n (puntos). None si <2 puntos o sin varianza."""
    n = len(xs)
    if n < 2:
        return None
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    var_x = sum((x - mean_x) ** 2 for x in xs)
    if var_x == 0:
        return None
    cov_xy = sum((xs[i] - mean_x) * (ys[i] - mean_y) for i in range(n))
    b = cov_xy / var_x
    a = mean_y - b * mean_x
    ss_res = sum((ys[i] - (a + b * xs[i])) ** 2 for i in range(n))
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    r2 = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0
    return {"slope": b, "intercept": a, "r2": r2, "n": n}


def _monthly_unidrop_ml(eng_drp, sku: str, months: int) -> list[tuple]:
    """Serie mensual (mes, precio_mayorista_avg, unidades) en Unidrop MELI."""
    try:
        rows = q(eng_drp, """
            SELECT DATE_TRUNC('month', o."dateCreated")::date AS mes,
                   AVG(oi."unitCost")::float                  AS precio_may,
                   SUM(oi.quantity)::int                      AS unidades
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
            WHERE oi."sellerSku" = :sku
              AND o."dateCreated" >= NOW() - make_interval(months => :months)
              AND o.status IN ('paid','partially_refunded')
              AND oi."unitCost" IS NOT NULL AND oi."unitCost" > 0
            GROUP BY 1 ORDER BY 1
        """, {"sku": sku, "months": months}) or []
        return rows
    except Exception as e:
        log.warning("unidrop_ml monthly fail sku=%s: %s", sku, e)
        return []


def _monthly_unistore_tn(eng_uni, sku: str, months: int) -> list[tuple]:
    """Serie mensual (mes, precio_retail_avg, unidades) en Unistore TN."""
    rows = q(eng_uni, """
        SELECT DATE_TRUNC('month', o."createdAt")::date AS mes,
               AVG(oi.price)::float                     AS precio_ret,
               SUM(oi.quantity)::int                    AS unidades
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE oi.sku = :sku
          AND o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(months => :months)
          AND oi.price > 0
        GROUP BY 1 ORDER BY 1
    """, {"sku": sku, "months": months}) or []
    return rows


def _elasticity(rows: list[tuple]) -> dict | None:
    """Toma rows [(mes, precio, unidades)] y calcula elasticidad log-log.
    Necesita al menos 4 puntos con varianza en precio para ser confiable."""
    valid = [(float(p), int(u)) for _, p, u in rows if p and p > 0 and u and u > 0]
    if len(valid) < 4:
        return None
    xs = [math.log(p) for p, _ in valid]
    ys = [math.log(u) for _, u in valid]
    reg = _linear_regression(xs, ys)
    if reg is None:
        return None
    return {
        "elasticity": round(reg["slope"], 3),
        "r2": round(reg["r2"], 3),
        "n_points": reg["n"],
        "interpretation": _interpret_elasticity(reg["slope"]),
    }


def _interpret_elasticity(e: float) -> str:
    """Etiqueta humana para el coeficiente."""
    a = abs(e)
    if a < 0.3:
        return "muy_inelastico"  # demanda insensible al precio
    if a < 0.8:
        return "inelastico"
    if a < 1.2:
        return "unitario"
    if a < 2:
        return "elastico"
    return "muy_elastico"


def wholesale_curve(sku: str, months: int = 12) -> dict:
    """Curva precio-volumen mayorista + retail para un SKU. Devuelve series
    mensuales + elasticidades estimadas + comparacion."""
    eng_uni = get_engine("unistore")
    eng_drp = get_engine("unidrop")

    rows_may = _monthly_unidrop_ml(eng_drp, sku, months)
    rows_ret = _monthly_unistore_tn(eng_uni, sku, months)

    el_may = _elasticity(rows_may)
    el_ret = _elasticity(rows_ret)

    # Diagnostico de poder de pricing mayorista
    diagnostico = None
    if el_may is not None and el_ret is not None:
        if abs(el_may["elasticity"]) < abs(el_ret["elasticity"]):
            diagnostico = "poder_pricing_mayorista"  # Unistore puede subir PVP mayorista
        elif abs(el_may["elasticity"]) > abs(el_ret["elasticity"]) * 1.5:
            diagnostico = "riesgo_churn_dropshippers"  # dropshippers cambian de fuente facil
        else:
            diagnostico = "balanceado"

    series_mayorista = [
        {"mes": r[0].isoformat(), "precio": round(float(r[1] or 0), 0), "unidades": int(r[2] or 0)}
        for r in rows_may
    ]
    series_retail = [
        {"mes": r[0].isoformat(), "precio": round(float(r[1] or 0), 0), "unidades": int(r[2] or 0)}
        for r in rows_ret
    ]

    return {
        "sku": sku,
        "months": months,
        "series_mayorista": series_mayorista,
        "series_retail": series_retail,
        "elasticidad_mayorista": el_may,
        "elasticidad_retail": el_ret,
        "diagnostico": diagnostico,
        "generated_at": now_ar().isoformat(),
    }


def elasticity_comparison(top_n: int = 50, months: int = 12, min_units: int = 30) -> dict:
    """Para los SKUs con suficiente data, calcula elasticidades retail y
    mayorista y devuelve la lista ordenada por diferencia.

    Usado para identificar SKUs donde Unistore podria subir el PVP mayorista
    sin perder volumen (mayorista mucho mas inelastica que retail) o donde
    los dropshippers son sensibles a cambios de precio (mayorista elastica).
    """
    eng_uni = get_engine("unistore")
    eng_drp = get_engine("unidrop")

    # SKUs candidatos: top por volumen Unidrop en el periodo
    candidatos = q(eng_drp, """
        SELECT oi."sellerSku" AS sku, SUM(oi.quantity)::int AS units
        FROM mercado_libre_dev."OrderItemMercadoLibre" oi
        JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
        WHERE oi."sellerSku" IS NOT NULL
          AND o."dateCreated" >= NOW() - make_interval(months => :months)
          AND o.status IN ('paid','partially_refunded')
        GROUP BY 1
        HAVING SUM(oi.quantity) >= :min_units
        ORDER BY units DESC
        LIMIT :top_n
    """, {"months": months, "min_units": min_units, "top_n": top_n}) or []

    results = []
    for sku, units in candidatos:
        rows_may = _monthly_unidrop_ml(eng_drp, sku, months)
        rows_ret = _monthly_unistore_tn(eng_uni, sku, months)
        el_may = _elasticity(rows_may)
        el_ret = _elasticity(rows_ret)

        diff = None
        diagnostico = None
        if el_may is not None and el_ret is not None:
            diff = round(abs(el_ret["elasticity"]) - abs(el_may["elasticity"]), 3)
            if diff > 0.5:
                diagnostico = "poder_pricing_mayorista"
            elif diff < -0.5:
                diagnostico = "riesgo_churn_dropshippers"
            else:
                diagnostico = "balanceado"

        # Nombre del producto (best effort)
        name = None
        try:
            nm_rows = q(eng_uni, """
                SELECT MAX(p.name) FROM tienda_nube."ProductVariant" pv
                JOIN tienda_nube."Product" p ON p.id = pv."productId"
                WHERE pv.sku = :sku
            """, {"sku": sku}) or []
            if nm_rows and nm_rows[0][0]:
                name = nm_rows[0][0]
        except Exception:
            pass

        results.append({
            "sku": sku,
            "name": (name or sku)[:120],
            "units_unidrop_periodo": int(units or 0),
            "elasticidad_mayorista": el_may,
            "elasticidad_retail": el_ret,
            "diff_retail_minus_mayorista": diff,
            "diagnostico": diagnostico,
        })

    # Ordenar: primero los con diff (calculables) por diff descendente (mayor poder de pricing)
    results.sort(key=lambda x: (x["diff_retail_minus_mayorista"] is None, -(x["diff_retail_minus_mayorista"] or 0)))

    summary = {
        "total_candidatos": len(results),
        "con_elasticidad_completa": sum(1 for r in results if r["diff_retail_minus_mayorista"] is not None),
        "poder_pricing_mayorista": sum(1 for r in results if r["diagnostico"] == "poder_pricing_mayorista"),
        "riesgo_churn_dropshippers": sum(1 for r in results if r["diagnostico"] == "riesgo_churn_dropshippers"),
        "balanceado": sum(1 for r in results if r["diagnostico"] == "balanceado"),
    }

    return {
        "months": months,
        "min_units": min_units,
        "summary": summary,
        "results": results,
        "generated_at": now_ar().isoformat(),
    }

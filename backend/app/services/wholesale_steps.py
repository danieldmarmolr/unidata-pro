"""
Detecta cambios escalon de `unitCost` (precio mayorista que paga el dropshipper)
y mide el impacto en el volumen movido por Unidrop tras cada cambio.

Cuando Unistore sube/baja el PVP mayorista, suele ser un escalon discreto:
un mes el precio promedio salta >= UMBRAL_PCT vs el mes anterior. Esta
funcion detecta esos puntos y compara unidades del mes despues del cambio
vs el promedio de los 3 meses previos.

Util para ver retro si una suba de PVP mayorista produjo churn de
dropshippers (volumen baja mas de lo esperado).
"""
from __future__ import annotations

import logging

from app.db.engines import get_engine
from app.services._utils import q
from app.utils.tz import now_ar

log = logging.getLogger("unidata.wholesale_steps")

UMBRAL_CAMBIO_PCT = 5.0   # >= 5% mes a mes es "cambio detectable"


def _monthly_series(eng_drp, sku: str, months: int) -> list[dict]:
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
    return [
        {"mes": r[0].isoformat(), "precio": float(r[1] or 0), "unidades": int(r[2] or 0)}
        for r in rows
    ]


def _detect_steps(series: list[dict]) -> list[dict]:
    """Encuentra puntos donde el precio cambia >= UMBRAL_CAMBIO_PCT vs mes anterior."""
    steps = []
    for i in range(1, len(series)):
        prev = series[i - 1]
        curr = series[i]
        if prev["precio"] <= 0:
            continue
        delta_pct = (curr["precio"] - prev["precio"]) / prev["precio"] * 100
        if abs(delta_pct) >= UMBRAL_CAMBIO_PCT:
            # Volumen baseline = promedio de los 3 meses previos (sin contar el propio)
            baseline_window = series[max(0, i - 3):i]
            baseline_units = (
                sum(s["unidades"] for s in baseline_window) / len(baseline_window)
                if baseline_window else 0
            )
            # Impacto = (unidades del mes nuevo / baseline) - 1
            impact_pct = None
            if baseline_units > 0:
                impact_pct = (curr["unidades"] - baseline_units) / baseline_units * 100

            steps.append({
                "mes": curr["mes"],
                "precio_anterior": round(prev["precio"], 0),
                "precio_nuevo": round(curr["precio"], 0),
                "delta_precio_pct": round(delta_pct, 1),
                "unidades_baseline_3m": round(baseline_units, 1),
                "unidades_mes": curr["unidades"],
                "impacto_volumen_pct": round(impact_pct, 1) if impact_pct is not None else None,
                "direccion": "suba" if delta_pct > 0 else "baja",
            })
    return steps


def wholesale_steps(months: int = 18, min_units_total: int = 30, top_n: int = 60) -> dict:
    """Lista los SKUs con cambios escalon detectados de unitCost en los ultimos
    `months` meses. Devuelve los `top_n` con mas data."""
    eng_drp = get_engine("unidrop")
    eng_uni = get_engine("unistore")

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
    """, {"months": months, "min_units": min_units_total, "top_n": top_n}) or []

    sku_results = []
    total_steps = 0
    for sku, units in candidatos:
        series = _monthly_series(eng_drp, sku, months)
        steps = _detect_steps(series)
        if not steps:
            continue
        total_steps += len(steps)

        # Nombre + imagen
        name = None
        imagen = None
        try:
            row = q(eng_uni, """
                SELECT MAX(p.name) AS name,
                       (SELECT pi.src FROM tienda_nube."ProductImage" pi
                        WHERE pi."productId" = MAX(p.id)
                        ORDER BY pi.position ASC NULLS LAST LIMIT 1) AS imagen
                FROM tienda_nube."ProductVariant" pv
                JOIN tienda_nube."Product" p ON p.id = pv."productId"
                WHERE pv.sku = :sku
            """, {"sku": sku}) or []
            if row:
                name = row[0][0]
                imagen = row[0][1]
        except Exception:
            pass

        # Resumen por SKU: cuantas subas / bajas / impacto promedio
        subas = [s for s in steps if s["direccion"] == "suba"]
        bajas = [s for s in steps if s["direccion"] == "baja"]
        impactos_suba = [s["impacto_volumen_pct"] for s in subas if s["impacto_volumen_pct"] is not None]
        impactos_baja = [s["impacto_volumen_pct"] for s in bajas if s["impacto_volumen_pct"] is not None]

        sku_results.append({
            "sku": sku,
            "name": (name or sku)[:120],
            "imagen": imagen or "",
            "units_periodo": int(units or 0),
            "steps": steps,
            "n_subas": len(subas),
            "n_bajas": len(bajas),
            "impacto_promedio_suba_pct": round(sum(impactos_suba) / max(1, len(impactos_suba)), 1) if impactos_suba else None,
            "impacto_promedio_baja_pct": round(sum(impactos_baja) / max(1, len(impactos_baja)), 1) if impactos_baja else None,
            "ultimo_cambio_mes": steps[-1]["mes"],
            "ultimo_cambio_pct": steps[-1]["delta_precio_pct"],
            "ultimo_impacto_pct": steps[-1]["impacto_volumen_pct"],
        })

    # Ordenar por magnitud del ultimo cambio (mas relevantes primero)
    sku_results.sort(key=lambda x: -abs(x["ultimo_cambio_pct"] or 0))

    summary = {
        "skus_analizados": len(candidatos),
        "skus_con_cambios_escalon": len(sku_results),
        "total_cambios_detectados": total_steps,
        "umbral_pct": UMBRAL_CAMBIO_PCT,
        "months": months,
    }

    return {
        "summary": summary,
        "results": sku_results,
        "generated_at": now_ar().isoformat(),
    }

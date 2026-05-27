"""
Forecast batch - prediccion de demanda por SKU para proximos 30-60 dias.

Metodo: media movil ponderada de los ultimos 90 dias + factor de tendencia.
No usa libreria de ML pesada (statsmodels/prophet) para mantener el deploy
de Railway liviano - el calculo es 100% SQL + Python stdlib.

Para cada SKU con ventas en los ultimos 90 dias:
1. Calcula daily_velocity = unidades vendidas / dias con venta
2. Detecta tendencia comparando 30d recientes vs 30d anteriores
3. Forecast 30d = daily_velocity * 30 * (1 + factor_tendencia)
4. Forecast 60d = idem * 60

El factor_tendencia se acota a [-0.5, 0.5] para evitar predicciones
extremas en SKUs muy volatiles.

Output: tabla de SKUs ordenada por forecast 30d desc, con stock actual
para comparar (alarma si forecast > stock).
"""
from __future__ import annotations

import datetime as dt
import logging

from app.db.engines import get_engine
from app.services._utils import q

log = logging.getLogger("unidata.forecast")


def forecast_all_skus(top_n: int = 100) -> dict:
    """Forecast simple de demanda para los top SKUs por volumen reciente.

    Devuelve hasta `top_n` SKUs con prediccion 30d / 60d + stock actual +
    alerta si forecast > stock.
    """
    eng = get_engine("unistore")

    # Ventas detalladas ultimos 90 dias por SKU
    rows = q(eng, """
        WITH ventas AS (
            SELECT oi.sku,
                   MAX(oi.name) AS nombre,
                   SUM(oi.quantity) FILTER (WHERE o."createdAt" >= NOW() - INTERVAL '30 days')::int AS units_30d,
                   SUM(oi.quantity) FILTER (WHERE o."createdAt" >= NOW() - INTERVAL '60 days'
                                              AND o."createdAt" < NOW() - INTERVAL '30 days')::int AS units_prev30d,
                   SUM(oi.quantity) FILTER (WHERE o."createdAt" >= NOW() - INTERVAL '90 days')::int AS units_90d,
                   COUNT(DISTINCT o."createdAt"::date) FILTER (WHERE o."createdAt" >= NOW() - INTERVAL '90 days')::int AS dias_con_venta,
                   AVG(oi.price)::float AS precio_promedio
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - INTERVAL '90 days'
              AND oi.sku IS NOT NULL
              AND oi.sku NOT ILIKE 'PVA%'
            GROUP BY oi.sku
            HAVING SUM(oi.quantity) FILTER (WHERE o."createdAt" >= NOW() - INTERVAL '90 days') >= 5
        ),
        stock AS (
            SELECT "codigoArticulo" AS sku, COALESCE("unidadesDisponibles", 0)::int AS stock_total
            FROM digip."Stock"
        )
        SELECT v.sku, v.nombre, v.units_30d, v.units_prev30d, v.units_90d,
               v.dias_con_venta, v.precio_promedio,
               COALESCE(s.stock_total, 0) AS stock_actual
        FROM ventas v
        LEFT JOIN stock s ON s.sku = v.sku
        ORDER BY v.units_30d DESC NULLS LAST
        LIMIT :n
    """, {"n": top_n}) or []

    forecasts: list[dict] = []
    for r in rows:
        sku = r[0]
        nombre = r[1] or sku
        units_30d = int(r[2] or 0)
        units_prev30d = int(r[3] or 0)
        units_90d = int(r[4] or 0)
        dias_venta = max(int(r[5] or 1), 1)
        precio = float(r[6] or 0)
        stock = int(r[7] or 0)

        # Daily velocity normalizado: total 90d / dias del periodo (90)
        # No usamos dias_con_venta porque eso da una velocidad falsa cuando un
        # SKU vende salteado.
        daily_velocity = units_90d / 90.0

        # Factor de tendencia: cuanto crece o decrece la velocidad de venta
        # comparando 30d vs prev30d
        if units_prev30d > 0:
            factor = (units_30d - units_prev30d) / units_prev30d
            # Acotar a [-0.5, +0.5] para evitar predicciones extremas
            factor = max(-0.5, min(0.5, factor))
        else:
            factor = 0.5 if units_30d > 0 else 0  # SKU nuevo - asumir crecimiento moderado

        forecast_30d = max(0, daily_velocity * 30 * (1 + factor))
        forecast_60d = max(0, daily_velocity * 60 * (1 + factor))
        forecast_30d_rev = forecast_30d * precio

        # Alarmas
        stockout_30d = stock < forecast_30d
        stockout_60d = stock < forecast_60d
        # Cuantos dias dura el stock segun forecast
        days_until_stockout = (stock / daily_velocity) if daily_velocity > 0 else 999

        forecasts.append({
            "sku": sku,
            "nombre": nombre[:80],
            "units_30d": units_30d,
            "units_prev30d": units_prev30d,
            "units_90d": units_90d,
            "daily_velocity": round(daily_velocity, 2),
            "trend_pct": round(factor * 100, 1),
            "forecast_30d": round(forecast_30d, 0),
            "forecast_60d": round(forecast_60d, 0),
            "forecast_30d_revenue": round(forecast_30d_rev, 0),
            "stock_actual": stock,
            "days_until_stockout": round(days_until_stockout, 0) if days_until_stockout < 999 else None,
            "alert_30d": stockout_30d,
            "alert_60d": stockout_60d,
            "po_sugerida_30d": max(0, round(forecast_30d - stock, 0)) if stockout_30d else 0,
            "po_sugerida_60d": max(0, round(forecast_60d - stock, 0)) if stockout_60d else 0,
        })

    # Sort: alertas 30d primero (mas urgente), despues por forecast desc
    forecasts.sort(key=lambda f: (
        not f["alert_30d"],  # alertas primero
        -f["forecast_30d"],  # mayor demanda primero
    ))

    # Totales agregados
    total_units_30d = sum(f["forecast_30d"] for f in forecasts)
    total_rev_30d = sum(f["forecast_30d_revenue"] for f in forecasts)
    alerts_30d_count = sum(1 for f in forecasts if f["alert_30d"])
    alerts_60d_count = sum(1 for f in forecasts if f["alert_60d"])

    return {
        "forecasts": forecasts,
        "summary": {
            "total_skus": len(forecasts),
            "total_units_30d": int(total_units_30d),
            "total_revenue_30d": round(total_rev_30d, 0),
            "alerts_30d": alerts_30d_count,
            "alerts_60d": alerts_60d_count,
        },
        "method": "Velocidad 90d × (1 + tendencia 30d vs 30d previo, acotada ±50%)",
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

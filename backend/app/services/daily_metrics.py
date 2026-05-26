"""
Series diarias multi-canal multi-metrica.

Genera una serie diaria con shape estandar {unistore_tn, unistore_ml, unidrop, total}
para cualquiera de las metricas mas usadas en BI de ecommerce:

  - profit     : ganancia neta (lo que ya hacia profit_daily_consolidated)
  - revenue    : facturacion (GMV)
  - units      : unidades vendidas (SUM quantity)
  - orders     : ordenes pagas (COUNT DISTINCT)
  - customers  : clientes unicos (COUNT DISTINCT)
  - aov        : ticket promedio (revenue / orders)

Mas un forecast comparativo de la serie total (igual que ya hace
profit_daily_consolidated) para cualquier variable.

Convenciones de canal en este modulo:
  - unistore_tn  : tienda_nube.Order (paid) en motor Unistore
  - unistore_ml  : meli.meli_orders (paid/confirmed/shipped/delivered) Unistore
  - unidrop      :
      - profit:    retencion neta diaria (comisiones+subs - meta_ads) — legacy
      - revenue:   PaymentIntent.paidAmount PROCESSED (lo que cobra Unidrop)
      - units/orders/customers: equivalentes a TN+ML del motor unidrop_api
        (volumen de los dropshippers — es el flujo fisico que pasa por la plataforma)
      - aov:       revenue / orders
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Any, Literal

from app.db.engines import get_engine
from app.services._utils import q

log = logging.getLogger("unidata.daily_metrics")

Variable = Literal["profit", "revenue", "units", "orders", "customers", "aov"]

VARIABLE_LABELS: dict[str, dict[str, str]] = {
    "profit":    {"label": "Ganancia neta", "unit": "currency", "short": "ganancia"},
    "revenue":   {"label": "Facturación / GMV", "unit": "currency", "short": "facturación"},
    "units":     {"label": "Unidades vendidas", "unit": "number", "short": "unidades"},
    "orders":    {"label": "Órdenes pagas", "unit": "number", "short": "órdenes"},
    "customers": {"label": "Clientes únicos", "unit": "number", "short": "clientes"},
    "aov":       {"label": "Ticket promedio (AOV)", "unit": "currency", "short": "AOV"},
}


# ---------------------------------------------------------------------------
# Daily series builders: each returns {date_iso: value} per canal
# ---------------------------------------------------------------------------

def _empty_by_date() -> dict[str, float]:
    return {}


def _daily_revenue() -> dict[str, dict[str, float]]:
    """Revenue diario por canal."""
    out = {"unistore_tn": _empty_by_date(), "unistore_ml": _empty_by_date(), "unidrop": _empty_by_date()}

    # Unistore TN
    try:
        eng_u = get_engine("unistore")
        rows = q(eng_u, """
            SELECT DATE("createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   SUM(total)::float AS revenue
            FROM tienda_nube."Order"
            WHERE "paymentStatus" = 'paid'
              AND "createdAt" >= NOW() - INTERVAL '180 days'
            GROUP BY 1
        """) or []
        for d, v in rows:
            if d:
                out["unistore_tn"][d.isoformat()] = float(v or 0)
    except Exception as exc:
        log.warning("daily_revenue unistore_tn: %s", exc)

    # Unistore ML
    try:
        eng_u = get_engine("unistore")
        rows = q(eng_u, """
            SELECT DATE(date_created AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   SUM(total_amount)::float AS revenue
            FROM meli.meli_orders
            WHERE status IN ('paid','confirmed','shipped','delivered')
              AND date_created >= NOW() - INTERVAL '180 days'
            GROUP BY 1
        """) or []
        for d, v in rows:
            if d:
                out["unistore_ml"][d.isoformat()] = float(v or 0)
    except Exception as exc:
        log.warning("daily_revenue unistore_ml: %s", exc)

    # Unidrop: PaymentIntent PROCESSED (lo que cobra Unidrop a dropshippers via Talo)
    try:
        eng_d = get_engine("unidrop")
        rows = q(eng_d, """
            SELECT DATE("createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   SUM("paidAmount")::float AS revenue
            FROM public."PaymentIntent"
            WHERE status = 'PROCESSED'
              AND "createdAt" >= NOW() - INTERVAL '180 days'
            GROUP BY 1
        """) or []
        for d, v in rows:
            if d:
                out["unidrop"][d.isoformat()] = float(v or 0)
    except Exception as exc:
        log.warning("daily_revenue unidrop: %s", exc)

    return out


def _daily_units() -> dict[str, dict[str, float]]:
    """Unidades vendidas por canal."""
    out = {"unistore_tn": _empty_by_date(), "unistore_ml": _empty_by_date(), "unidrop": _empty_by_date()}

    try:
        eng_u = get_engine("unistore")
        rows = q(eng_u, """
            SELECT DATE(o."createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   SUM(oi.quantity)::int AS units
            FROM tienda_nube."Order" o
            JOIN tienda_nube."OrderItem" oi ON oi."orderId" = o.id
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - INTERVAL '180 days'
            GROUP BY 1
        """) or []
        for d, v in rows:
            if d:
                out["unistore_tn"][d.isoformat()] = float(v or 0)
    except Exception as exc:
        log.warning("daily_units unistore_tn: %s", exc)

    try:
        eng_u = get_engine("unistore")
        rows = q(eng_u, """
            SELECT DATE(mo.date_created AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   SUM(mi.quantity)::int AS units
            FROM meli.meli_order_items mi
            JOIN meli.meli_orders mo ON mo.id = mi.order_id
            WHERE mo.status IN ('paid','confirmed','shipped','delivered')
              AND mo.date_created >= NOW() - INTERVAL '180 days'
            GROUP BY 1
        """) or []
        for d, v in rows:
            if d:
                out["unistore_ml"][d.isoformat()] = float(v or 0)
    except Exception as exc:
        log.warning("daily_units unistore_ml: %s", exc)

    # Unidrop: volumen fisico = TN + ML de los dropshippers
    try:
        eng_d = get_engine("unidrop")
        # TN dropshippers
        rows_tn = q(eng_d, """
            SELECT DATE(tno.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   SUM(tnoi.quantity)::int AS units
            FROM public.tienda_nube_orders tno
            JOIN public.tienda_nube_order_items tnoi
              ON tnoi.tienda_nube_order_id = tno.tienda_nube_id
            WHERE tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - INTERVAL '180 days'
            GROUP BY 1
        """) or []
        rows_ml = q(eng_d, """
            SELECT DATE(oml."dateCreated" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   SUM(oi.quantity)::int AS units
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            JOIN mercado_libre_dev."OrderMercadoLibre" oml ON oml.id::text = oi."orderId"::text
            WHERE oml.status IN ('paid','confirmed','shipped','delivered')
              AND oml."dateCreated" >= NOW() - INTERVAL '180 days'
            GROUP BY 1
        """) or []
        for d, v in rows_tn + rows_ml:
            if d:
                k = d.isoformat()
                out["unidrop"][k] = out["unidrop"].get(k, 0.0) + float(v or 0)
    except Exception as exc:
        log.warning("daily_units unidrop: %s", exc)

    return out


def _daily_orders() -> dict[str, dict[str, float]]:
    """Cantidad de ordenes pagadas por dia."""
    out = {"unistore_tn": _empty_by_date(), "unistore_ml": _empty_by_date(), "unidrop": _empty_by_date()}

    try:
        eng_u = get_engine("unistore")
        rows = q(eng_u, """
            SELECT DATE("createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   COUNT(*)::int AS n
            FROM tienda_nube."Order"
            WHERE "paymentStatus" = 'paid'
              AND "createdAt" >= NOW() - INTERVAL '180 days'
            GROUP BY 1
        """) or []
        for d, v in rows:
            if d:
                out["unistore_tn"][d.isoformat()] = float(v or 0)

        rows = q(eng_u, """
            SELECT DATE(date_created AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   COUNT(*)::int AS n
            FROM meli.meli_orders
            WHERE status IN ('paid','confirmed','shipped','delivered')
              AND date_created >= NOW() - INTERVAL '180 days'
            GROUP BY 1
        """) or []
        for d, v in rows:
            if d:
                out["unistore_ml"][d.isoformat()] = float(v or 0)
    except Exception as exc:
        log.warning("daily_orders unistore: %s", exc)

    # Unidrop: PaymentIntent PROCESSED como proxy de "ordenes facturadas via Talo"
    try:
        eng_d = get_engine("unidrop")
        rows = q(eng_d, """
            SELECT DATE("createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   COUNT(*)::int AS n
            FROM public."PaymentIntent"
            WHERE status = 'PROCESSED'
              AND "createdAt" >= NOW() - INTERVAL '180 days'
            GROUP BY 1
        """) or []
        for d, v in rows:
            if d:
                out["unidrop"][d.isoformat()] = float(v or 0)
    except Exception as exc:
        log.warning("daily_orders unidrop: %s", exc)

    return out


def _daily_customers() -> dict[str, dict[str, float]]:
    """Clientes unicos por canal por dia.
    - Unistore TN/ML: customer_id de las ordenes paid
    - Unidrop: dropshippers (User) que firmaron / pagaron en el dia
    """
    out = {"unistore_tn": _empty_by_date(), "unistore_ml": _empty_by_date(), "unidrop": _empty_by_date()}

    try:
        eng_u = get_engine("unistore")
        rows = q(eng_u, """
            SELECT DATE("createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   COUNT(DISTINCT "customerId")::int AS n
            FROM tienda_nube."Order"
            WHERE "paymentStatus" = 'paid'
              AND "createdAt" >= NOW() - INTERVAL '180 days'
              AND "customerId" IS NOT NULL
            GROUP BY 1
        """) or []
        for d, v in rows:
            if d:
                out["unistore_tn"][d.isoformat()] = float(v or 0)

        rows = q(eng_u, """
            SELECT DATE(date_created AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   COUNT(DISTINCT buyer_id)::int AS n
            FROM meli.meli_orders
            WHERE status IN ('paid','confirmed','shipped','delivered')
              AND date_created >= NOW() - INTERVAL '180 days'
              AND buyer_id IS NOT NULL
            GROUP BY 1
        """) or []
        for d, v in rows:
            if d:
                out["unistore_ml"][d.isoformat()] = float(v or 0)
    except Exception as exc:
        log.warning("daily_customers unistore: %s", exc)

    # Unidrop: customers de los dropshippers (clientes finales que les compran)
    # = COUNT DISTINCT (email u OML.buyer_id) por dia, en TN+ML de unidrop_api
    try:
        eng_d = get_engine("unidrop")
        rows_tn = q(eng_d, """
            SELECT DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   COUNT(DISTINCT customer_email)::int AS n
            FROM public.tienda_nube_orders
            WHERE payment_status::text = 'paid'
              AND created_at >= NOW() - INTERVAL '180 days'
              AND customer_email IS NOT NULL
            GROUP BY 1
        """) or []
        rows_ml = q(eng_d, """
            SELECT DATE("dateCreated" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS d,
                   COUNT(DISTINCT "buyerId")::int AS n
            FROM mercado_libre_dev."OrderMercadoLibre"
            WHERE status IN ('paid','confirmed','shipped','delivered')
              AND "dateCreated" >= NOW() - INTERVAL '180 days'
              AND "buyerId" IS NOT NULL
            GROUP BY 1
        """) or []
        # sumamos counts (puede haber doble conteo si un mismo cliente compro TN y ML el mismo dia,
        # pero es un proxy suficiente — para evitarlo habria que UNION los emails/ids cross-canal)
        for d, v in rows_tn + rows_ml:
            if d:
                k = d.isoformat()
                out["unidrop"][k] = out["unidrop"].get(k, 0.0) + float(v or 0)
    except Exception as exc:
        log.warning("daily_customers unidrop: %s", exc)

    return out


def _daily_profit_series() -> dict[str, dict[str, float]]:
    """Reutiliza profit_daily_consolidated para no duplicar logica.
    Devuelve {unistore_tn: {d: value}, unistore_ml: {...}, unidrop: {...}}."""
    from app.services.executive_profit import profit_daily_consolidated
    out = {"unistore_tn": _empty_by_date(), "unistore_ml": _empty_by_date(), "unidrop": _empty_by_date()}
    pdc = profit_daily_consolidated(days=180, forecast_horizon=1)  # horizon minimo, no usamos forecast
    for p in pdc.get("points", []):
        d = p["date"]
        out["unistore_tn"][d] = float(p.get("unistore_tn") or 0)
        out["unistore_ml"][d] = float(p.get("unistore_ml") or 0)
        out["unidrop"][d] = float(p.get("unidrop") or 0)
    return out


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_BUILDERS = {
    "profit": _daily_profit_series,
    "revenue": _daily_revenue,
    "units": _daily_units,
    "orders": _daily_orders,
    "customers": _daily_customers,
}


def daily_metric_series(variable: Variable = "revenue",
                         days: int = 90,
                         horizon: int = 28) -> dict:
    """Devuelve la serie diaria multi-canal de la variable + forecast multi-metodo
    sobre la serie total.

    Shape (compatible con ProfitConsolidatedResponse del frontend):
      {
        days, horizon,
        variable, variable_label, variable_unit,
        points: [{date, unistore_tn, unistore_ml, unidrop, total}],
        forecast_dates: [...],
        forecasts: {results, winner, horizon, backtest_size, history_n},
        error
      }
    """
    from app.services.forecast_methods import compare_forecasts

    label_info = VARIABLE_LABELS.get(variable, {"label": variable, "unit": "number"})

    # AOV es derivado de revenue + orders, lo manejamos aparte
    if variable == "aov":
        rev = _daily_revenue()
        ords = _daily_orders()
        all_dates = set()
        for canal in ("unistore_tn", "unistore_ml", "unidrop"):
            all_dates.update(rev[canal].keys())
            all_dates.update(ords[canal].keys())
        series_by_canal = {"unistore_tn": {}, "unistore_ml": {}, "unidrop": {}}
        for canal in series_by_canal:
            for d in all_dates:
                r = rev[canal].get(d, 0.0)
                o = ords[canal].get(d, 0.0)
                series_by_canal[canal][d] = (r / o) if o > 0 else 0.0
    else:
        builder = _BUILDERS.get(variable)
        if not builder:
            return {
                "days": days, "horizon": horizon, "variable": variable,
                "variable_label": label_info["label"], "variable_unit": label_info["unit"],
                "points": [], "forecast_dates": [], "forecasts": {"results": [], "winner": None},
                "error": f"Variable desconocida: {variable}",
            }
        try:
            series_by_canal = builder()
        except Exception as exc:
            log.warning("daily_metric_series builder %s: %s", variable, exc)
            return {
                "days": days, "horizon": horizon, "variable": variable,
                "variable_label": label_info["label"], "variable_unit": label_info["unit"],
                "points": [], "forecast_dates": [], "forecasts": {"results": [], "winner": None},
                "error": str(exc),
            }

    # Merge en serie diaria ordenada, recortada a los ultimos `days` dias
    today = dt.date.today()
    from_date = today - dt.timedelta(days=days)
    all_dates = set()
    for canal_series in series_by_canal.values():
        all_dates.update(canal_series.keys())
    sorted_dates = sorted(d for d in all_dates if d >= from_date.isoformat())

    points: list[dict] = []
    for d in sorted_dates:
        tn = float(series_by_canal["unistore_tn"].get(d, 0.0))
        ml = float(series_by_canal["unistore_ml"].get(d, 0.0))
        drop = float(series_by_canal["unidrop"].get(d, 0.0))

        if variable == "aov":
            # AOV total NO es suma, es weighted average. Aprox: promediar los 3.
            non_zero = [v for v in [tn, ml, drop] if v > 0]
            total = sum(non_zero) / len(non_zero) if non_zero else 0.0
        else:
            total = tn + ml + drop

        points.append({
            "date": d,
            "unistore_tn": round(tn, 2),
            "unistore_ml": round(ml, 2),
            "unidrop": round(drop, 2),
            "total": round(total, 2),
        })

    # Forecast sobre la serie total
    total_values = [p["total"] for p in points]
    try:
        forecasts = compare_forecasts(total_values, horizon=horizon, backtest_size=14)
    except Exception as exc:
        log.warning("daily_metric_series compare_forecasts: %s", exc)
        forecasts = {"results": [], "winner": None, "horizon": horizon,
                     "backtest_size": 14, "history_n": len(total_values)}

    if points:
        last_date = points[-1]["date"]
        last = dt.date.fromisoformat(last_date)
        forecast_dates = [(last + dt.timedelta(days=i + 1)).isoformat() for i in range(horizon)]
    else:
        forecast_dates = []

    return {
        "days": days,
        "horizon": horizon,
        "variable": variable,
        "variable_label": label_info["label"],
        "variable_unit": label_info["unit"],
        "points": points,
        "forecast_dates": forecast_dates,
        "forecasts": forecasts,
        "error": None,
    }

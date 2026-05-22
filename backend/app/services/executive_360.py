"""
Bloques de la vista 360 enriquecida del panel Gerencia.

Cuatro modulos independientes (cada uno tolera fallo del resto):
- dropshippers_performance: top 10 por ganancia Unidrop + bottom 5 criticos
- customer_intelligence: resumen RFM Unistore + cohorts Unidrop
- forecast_stock_health: top 5 riesgo quiebre 30d + top 5 sobre-stock (DoI alto)
- cash_flow_projection_30d: proyeccion saldo 30d + acuerdos urgentes

Cada uno devuelve { ...payload, "error": str | None } para que la UI pueda
mostrar el bloque vacio sin tumbar la pagina entera.
"""
from __future__ import annotations

import datetime as dt
import logging
from datetime import date, timedelta
from typing import Any

log = logging.getLogger("unidata.executive_360")


# ---------------------------------------------------------------------------
# Dropshippers performance
# ---------------------------------------------------------------------------

def dropshippers_performance(period: str = "30d") -> dict:
    """Top 10 dropshippers por ganancia Unidrop + bottom 5 criticos del periodo."""
    try:
        from app.services.dropshippers import dropshippers_master
        master = dropshippers_master(period=period, limit=2000)
        items = master.get("items", []) or []

        def _profit(d: dict) -> float:
            return float(d.get("profit_unidrop") or 0)

        def _gmv(d: dict) -> float:
            return float(d.get("gmv_total") or d.get("gmv") or 0)

        def _deuda(d: dict) -> float:
            return float(d.get("deuda_pendiente") or 0)

        # Top 10 por ganancia
        sorted_by_profit = sorted(items, key=lambda x: -_profit(x))[:10]
        top10 = [
            {
                "user_id": d.get("user_id"),
                "nombre": d.get("nombre") or d.get("email") or "?",
                "plan": d.get("plan"),
                "canal": d.get("canal"),
                "gmv": round(_gmv(d), 0),
                "profit_unidrop": round(_profit(d), 0),
                "ventas_pagadas": int(d.get("ventas_pagadas") or 0),
            }
            for d in sorted_by_profit
            if _profit(d) > 0 or _gmv(d) > 0
        ]

        # Bottom criticos: deuda > 0 ordenado por deuda + caida de ventas
        criticos_pool = [
            d for d in items
            if _deuda(d) > 0 or (_gmv(d) > 0 and _profit(d) < 0)
        ]
        criticos = sorted(criticos_pool, key=lambda x: -_deuda(x))[:5]
        bottom5 = [
            {
                "user_id": d.get("user_id"),
                "nombre": d.get("nombre") or d.get("email") or "?",
                "plan": d.get("plan"),
                "canal": d.get("canal"),
                "gmv": round(_gmv(d), 0),
                "profit_unidrop": round(_profit(d), 0),
                "deuda_pendiente": round(_deuda(d), 0),
                "ventas_pagadas": int(d.get("ventas_pagadas") or 0),
            }
            for d in criticos
        ]

        return {
            "period": period,
            "total_dropshippers": master.get("total", 0),
            "top10_by_profit": top10,
            "bottom5_criticos": bottom5,
            "stats": master.get("stats", {}),
            "error": None,
        }
    except Exception as exc:
        log.warning("dropshippers_performance: %s", exc)
        return {"period": period, "top10_by_profit": [], "bottom5_criticos": [], "error": str(exc)}


# ---------------------------------------------------------------------------
# Customer intelligence: RFM + cohorts
# ---------------------------------------------------------------------------

def customer_intelligence() -> dict:
    """Resumen RFM Unistore + cohorts Unidrop (count + facturacion por segmento)."""
    result: dict[str, Any] = {"rfm": None, "cohorts_unidrop": None, "error": None}

    # RFM Unistore (ventana 365d para tener data de Champions)
    try:
        from app.services.rfm_analytics import rfm_overview
        rfm = rfm_overview(period_days=365)
        result["rfm"] = {
            "totals": rfm.get("totals", {}),
            "segments": [
                {
                    "key": s["key"],
                    "label": s["label"],
                    "color": s.get("color"),
                    "customers": s["customers"],
                    "pct_total": s.get("pct_total", 0),
                    "monetary_total": s.get("monetary_total", 0),
                    "ticket_avg": s.get("ticket_avg", 0),
                }
                for s in rfm.get("segments", [])
            ],
        }
    except Exception as exc:
        log.warning("customer_intelligence.rfm: %s", exc)
        result["rfm"] = {"error": str(exc)}

    # Cohorts Unidrop (lifecycle de dropshippers)
    try:
        from app.services.cohorts_analytics import cohorts_overview
        coh = cohorts_overview(period="90d", unit="unidrop")
        result["cohorts_unidrop"] = {
            "totals": coh.get("totals", {}),
            "states": [
                {
                    "key": s["key"],
                    "label": s["label"],
                    "color": s.get("color"),
                    "customers": s["customers"],
                    "ordenes": s["ordenes"],
                    "facturacion": s["facturacion"],
                }
                for s in coh.get("states", [])
            ],
        }
    except Exception as exc:
        log.warning("customer_intelligence.cohorts: %s", exc)
        result["cohorts_unidrop"] = {"error": str(exc)}

    return result


# ---------------------------------------------------------------------------
# Forecast & Stock health
# ---------------------------------------------------------------------------

def forecast_stock_health() -> dict:
    """Top SKUs en riesgo de quiebre 30d + top SKUs con DoI alto (sobre-stock)."""
    try:
        from app.services.forecast_batch import forecast_all_skus
        fc = forecast_all_skus(top_n=100)
        forecasts = fc.get("forecasts", []) or []

        # Riesgo: alert_30d + days_until_stockout asc
        riesgo = sorted(
            [f for f in forecasts if f.get("alert_30d") and (f.get("days_until_stockout") or 999) < 30],
            key=lambda x: (x.get("days_until_stockout") or 999),
        )[:5]

        # Sobre-stock: days_until_stockout > 90 + stock_actual > 0
        sobre_stock = sorted(
            [f for f in forecasts if (f.get("days_until_stockout") or 0) > 90 and int(f.get("stock_actual") or 0) > 0],
            key=lambda x: -(x.get("days_until_stockout") or 0),
        )[:5]

        return {
            "summary": fc.get("summary", {}),
            "riesgo_quiebre_30d": [
                {
                    "sku": f.get("sku"),
                    "nombre": f.get("nombre"),
                    "stock_actual": int(f.get("stock_actual") or 0),
                    "daily_velocity": round(float(f.get("daily_velocity") or 0), 2),
                    "days_until_stockout": round(float(f.get("days_until_stockout") or 0), 1),
                    "forecast_30d": round(float(f.get("forecast_30d") or 0), 0),
                    "po_sugerida_30d": round(float(f.get("po_sugerida_30d") or 0), 0),
                }
                for f in riesgo
            ],
            "sobre_stock": [
                {
                    "sku": f.get("sku"),
                    "nombre": f.get("nombre"),
                    "stock_actual": int(f.get("stock_actual") or 0),
                    "daily_velocity": round(float(f.get("daily_velocity") or 0), 2),
                    "days_until_stockout": round(float(f.get("days_until_stockout") or 0), 1),
                    "units_30d": int(f.get("units_30d") or 0),
                }
                for f in sobre_stock
            ],
            "method": fc.get("method"),
            "error": None,
        }
    except Exception as exc:
        log.warning("forecast_stock_health: %s", exc)
        return {"riesgo_quiebre_30d": [], "sobre_stock": [], "error": str(exc)}


# ---------------------------------------------------------------------------
# Cash flow projection 30d
# ---------------------------------------------------------------------------

def cash_flow_projection_30d() -> dict:
    """Proyeccion 30d de saldo + acuerdos urgentes. Reusa motor de flujo-fondos."""
    try:
        from app.db import flujo_fondos_db as ff
        from app.services.flujo_fondos.proyeccion import construir_proyeccion

        today = date.today()
        saldo_inicial = ff.get_saldo_inicial_total(fecha_hasta=today.isoformat())
        unidades = ff.list_unidades_negocio(only_active=True)
        facturacion = ff.get_facturacion_window(today.isoformat(), 12)
        fecha_fin = today + timedelta(days=29)
        erogaciones = ff.get_erogaciones_window(today.isoformat(), fecha_fin.isoformat())
        ingresos_puntuales = ff.get_ingresos_puntuales_window(today.isoformat(), fecha_fin.isoformat())

        proyeccion = construir_proyeccion(
            fecha_inicio=today,
            dias=30,
            saldo_inicial_total=float(saldo_inicial),
            unidades_activas=unidades,
            facturacion_filas=facturacion,
            erogaciones=erogaciones,
            ingresos_puntuales=ingresos_puntuales,
        )

        resumen = proyeccion.get("resumen", {})
        # Saldo diario simplificado para grafico
        saldo_serie = [
            {"date": d["fecha"], "saldo": round(float(d["saldo_final"] or 0), 0)}
            for d in proyeccion.get("dias", [])
        ]

        # Acuerdos urgentes (de home_dashboard)
        try:
            home = ff.home_dashboard() or {}
            acuerdos_urgentes = home.get("acuerdos_urgentes", []) or []
        except Exception:
            acuerdos_urgentes = []

        # Runway: cuantos meses sobreviviria con egresos del mes en curso (simple)
        egresos_total = float(resumen.get("total_egresos") or 0)
        ingresos_total = float(resumen.get("total_ingresos_proyectados") or 0) + float(resumen.get("total_ingresos_puntuales") or 0)
        runway_meses: float | None = None
        if egresos_total > ingresos_total and egresos_total > 0:
            deficit_mensual = egresos_total - ingresos_total
            saldo_actual = float(saldo_inicial or 0)
            runway_meses = round(saldo_actual / deficit_mensual, 1) if deficit_mensual > 0 else None

        return {
            "saldo_inicial": round(float(saldo_inicial or 0), 0),
            "saldo_final_30d": round(float(resumen.get("saldo_final") or 0), 0),
            "total_ingresos_proyectados": round(ingresos_total, 0),
            "total_egresos_comprometidos": round(egresos_total, 0),
            "neto_30d": round(float(resumen.get("neto_periodo") or 0), 0),
            "runway_meses": runway_meses,
            "saldo_serie": saldo_serie,
            "acuerdos_urgentes": acuerdos_urgentes[:5],
            "error": None,
        }
    except Exception as exc:
        log.warning("cash_flow_projection_30d: %s", exc)
        return {"saldo_serie": [], "acuerdos_urgentes": [], "error": str(exc)}


# ---------------------------------------------------------------------------
# Operational counts (Fase 3)
# ---------------------------------------------------------------------------

def ops_counts() -> dict:
    """Counts operacionales: alertas IT, CS actions, stock critico, Meta Ads."""
    out: dict[str, Any] = {
        "it_alerts_pending": None,
        "it_alerts_critical": None,
        "cs_actions_pending": None,
        "stock_critical_zones": None,
        "meta_ads_roas": None,
        "meta_ads_hint": "Conexion pendiente con Meta Ads",
    }

    try:
        from app.db import notifications_db
        out["it_alerts_pending"] = int(notifications_db.count_pending() or 0)
        out["it_alerts_critical"] = int(notifications_db.count_pending(severity="critical") or 0)
    except Exception as exc:
        log.warning("ops_counts.it_alerts: %s", exc)

    try:
        from app.db import cs_actions_db
        out["cs_actions_pending"] = int(cs_actions_db.count_pending() or 0)
    except Exception as exc:
        log.warning("ops_counts.cs_actions: %s", exc)

    try:
        from app.services.stock_heatmap import stock_heatmap
        sh = stock_heatmap(top_skus=200)
        # "criticos": zonas con stock_actual <= 5 unidades segun la matriz devuelta
        cells = sh.get("matrix") or sh.get("cells") or []
        if isinstance(cells, list):
            criticos = sum(1 for c in cells if isinstance(c, dict) and int(c.get("units") or c.get("stock") or 0) <= 5)
        else:
            criticos = 0
        out["stock_critical_zones"] = criticos
    except Exception as exc:
        log.warning("ops_counts.stock: %s", exc)

    # Meta Ads ROAS: si hay servicio expuesto se intenta, sino queda en None con hint.
    try:
        from app.services import meta_ads  # type: ignore
        if hasattr(meta_ads, "current_roas"):
            roas = meta_ads.current_roas()
            out["meta_ads_roas"] = float(roas) if roas is not None else None
            out["meta_ads_hint"] = None
    except Exception:
        pass

    return out


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def gerencia_360_blocks(period: str = "30d") -> dict:
    """Devuelve los 5 bloques juntos para una sola llamada del frontend."""
    return {
        "dropshippers": dropshippers_performance(period=period),
        "customer_intelligence": customer_intelligence(),
        "forecast_stock_health": forecast_stock_health(),
        "cash_flow_30d": cash_flow_projection_30d(),
        "ops_counts": ops_counts(),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

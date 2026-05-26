"""
Comparativa de los dos modelos de atribución Meta Ads → Unidrop:

 1. **Period-based** (lo que hoy se resta en Gerencia): TODO el spend del período
    aunque ese spend captó dropshippers que recién facturarán meses después.

 2. **Cohort-attributed**: revenue generado por los users firmados DURANTE el período
    en sus primeros 30d. ROAS = revenue_cohort / spend_periodo.

Devuelve también la 'recomendación' textual: que modelo refleja mejor la realidad
económica según la madurez del negocio.
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("unidata.meta_explain")


def explain_meta_unidrop(period: str = "30d") -> dict:
    """Compara los 2 modelos. Reutiliza overview + sales_attribution + unidrop_impact."""
    from app.services.meta_ads import (
        overview as meta_overview,
        sales_attribution,
        unidrop_impact,
    )

    overview = meta_overview(period=period, unit="unidrop") or {}
    attr = sales_attribution(period=period) or {}
    impact = unidrop_impact(period=period) or {}

    kpi_period = overview.get("kpi") or {}
    kpi_attr = attr.get("kpi") or {}
    kpi_imp = impact.get("kpi") or {}

    spend = float(kpi_period.get("spend") or 0)
    revenue_attributed = float(kpi_attr.get("revenue_attributed") or 0)
    revenue_total_period = float(kpi_attr.get("revenue_total") or 0)
    new_signups = int(kpi_attr.get("new_signups") or 0)
    cohort_size = new_signups
    activation_rate = float(kpi_attr.get("activation_rate") or 0)
    ltv_30d = float(kpi_attr.get("ltv_first_30d") or 0)

    cac_signup = float(kpi_imp.get("cac_dropshipper") or 0)
    cac_sub = float(kpi_imp.get("cac_subscripcion") or 0)

    # ROAS period-based: revenue total del período / spend del período
    roas_period_based = (revenue_total_period / spend) if spend > 0 else 0.0
    # ROAS cohort-attributed: revenue de la cohort en 30d / spend del período
    roas_cohort = (revenue_attributed / spend) if spend > 0 else 0.0

    # Recomendación: depende de la madurez del LTV
    if cohort_size == 0:
        recommendation = (
            "Sin signups en el período, no se puede calcular un ROAS cohort-attributed. "
            "El número de spend es el upper bound del costo del período."
        )
    elif ltv_30d > cac_signup and roas_cohort >= 1:
        recommendation = (
            f"LTV 30d (${ltv_30d:,.0f}) > CAC signup (${cac_signup:,.0f}) y ROAS cohort ≥ 1 → "
            "el spend del período se justifica por la calidad de la cohort capturada. "
            "El modelo period-based puede ser pesimista (la cohort aún facturará más en los próximos meses)."
        )
    elif ltv_30d > cac_signup:
        recommendation = (
            f"LTV 30d (${ltv_30d:,.0f}) > CAC signup (${cac_signup:,.0f}) pero ROAS aún < 1. "
            "La cohort recupera el CAC pero todavía no llega al breakeven en 30d. "
            "Mirar retention 60d/90d para validar si se justifica."
        )
    else:
        recommendation = (
            f"LTV 30d (${ltv_30d:,.0f}) < CAC signup (${cac_signup:,.0f}) → "
            "el spend del período NO está siendo recuperado por la cohort capturada en sus primeros 30 días. "
            "Considerar revisar audiencias, creativos o el funnel signup→sub."
        )

    return {
        "period": period,
        "spend": spend,
        "models": {
            "period_based": {
                "name": "Period-based (modelo actual en Gerencia)",
                "spend_assigned": spend,
                "revenue_total_period": revenue_total_period,
                "roas": roas_period_based,
                "description": (
                    "Resta TODO el spend del período del ingreso del período. "
                    "Sobrestima el costo si captó dropshippers que aún no facturaron."
                ),
                "drawback": "No considera el lag entre adquisición y monetización.",
            },
            "cohort_attributed": {
                "name": "Cohort-attributed (ventana de creación)",
                "spend_assigned": spend,
                "cohort_size": cohort_size,
                "users_with_revenue": int(kpi_attr.get("users_with_revenue") or 0),
                "activation_rate_pct": activation_rate,
                "revenue_attributed": revenue_attributed,
                "ltv_first_30d": ltv_30d,
                "roas": roas_cohort,
                "rev_attribution_pct": float(kpi_attr.get("rev_attribution_pct") or 0),
                "description": (
                    "Atribuye el spend del período a los users CREADOS en ese período, "
                    "y mide su revenue en los primeros 30 días."
                ),
                "drawback": "Sub-mide los signups que firman al final del período (no llegan a tener 30d).",
            },
        },
        "funnel": {
            "impressions": int(kpi_imp.get("impressions") or 0),
            "clicks": int(kpi_imp.get("clicks") or 0),
            "new_signups": new_signups,
            "new_subscriptions": int(kpi_imp.get("new_subscriptions") or 0),
            "users_with_revenue": int(kpi_attr.get("users_with_revenue") or 0),
            "cac_signup": cac_signup,
            "cac_subscription": cac_sub,
            "cpc": float(kpi_imp.get("cpc") or 0),
        },
        "recommendation": recommendation,
        "daily_overlay": impact.get("daily") or [],
    }

"""
Breakdown estructurado de cada KPI de la pagina Gerencia.

La idea: el usuario hace click en una card del panel y necesita ver paso a paso
como se calculo el numero — formula, fuentes (tablas + filtros), warnings,
y un link al drilldown crudo para validar manualmente.

Cada metrica devuelve un dict con shape:
{
  "metric": str,
  "title": str,
  "value": float,
  "value_format": "currency" | "percent" | "number",
  "period": str,
  "formula": str,
  "description": str,
  "steps": [{label, value, operator, subtotal?, negative?, explain_metric?, drill_endpoint?, hint?}],
  "sources": [{table, engine, filter, rows?}],
  "sql_summary": str,
  "warnings": [str],
  "computed_at": iso str,
}
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Any

from app.services.executive_profit import gerencia_profit_overview, deuda_talo_pendiente

log = logging.getLogger("unidata.gerencia_explain")


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _wrap(metric: str, title: str, value: float, *,
         value_format: str = "currency",
         period: str = "30d",
         formula: str = "",
         description: str = "",
         steps: list[dict] | None = None,
         sources: list[dict] | None = None,
         sql_summary: str = "",
         warnings: list[str] | None = None,
         drilldown_url: str | None = None) -> dict:
    return {
        "metric": metric,
        "title": title,
        "value": float(value or 0),
        "value_format": value_format,
        "period": period,
        "formula": formula,
        "description": description,
        "steps": steps or [],
        "sources": sources or [],
        "sql_summary": sql_summary.strip(),
        "warnings": warnings or [],
        "drilldown_url": drilldown_url,
        "computed_at": _now_iso(),
    }


def explain_metric(metric: str, period: str = "30d",
                   from_iso: str | None = None,
                   to_iso: str | None = None) -> dict:
    """Router: dado un slug de metrica, calcula su breakdown.

    Optimizacion: si la metrica pertenece al overview consolidado, hace UN solo
    llamado a gerencia_profit_overview() y deriva el detalle.
    """
    overview = gerencia_profit_overview(period=period, from_iso=from_iso, to_iso=to_iso)
    uni = overview["unistore"]
    drop = overview["unidrop"]
    cons = overview["consolidado"]

    # ---------- Consolidadas ----------
    if metric == "ganancia-consolidada":
        warnings: list[str] = []
        if cons["cobertura_costos_unistore_pct"] < 75:
            warnings.append(
                f"Cobertura Unistore {cons['cobertura_costos_unistore_pct']:.1f}%: "
                f"{uni['skus_sin_costo']} SKUs sin costo cargado → la ganancia Unistore puede estar subestimada"
            )
        return _wrap(
            metric=metric,
            title="Ganancia Neta Consolidada",
            value=cons["ganancia_neta"],
            period=period,
            formula="Unistore.ganancia_neta + Unidrop.ganancia_neta",
            description="Suma de la ganancia neta operativa de las dos unidades. NO suma el revenue de Unidrop al revenue total para evitar doble conteo (las órdenes son de los dropshippers; Unidrop solo retiene comisiones + subs + ganancia mayorista).",
            steps=[
                {"label": "Ganancia neta Unistore (TN + ML)", "value": uni["ganancia_neta"],
                 "operator": None, "explain_metric": "unistore-ganancia",
                 "hint": "SKU-by-SKU profit engine descontando IVA, IIBB, gateway fee"},
                {"label": "Ganancia neta Unidrop (retención)", "value": drop["ganancia_neta"],
                 "operator": "+", "explain_metric": "unidrop-ganancia-neta",
                 "negative": drop["ganancia_neta"] < 0,
                 "hint": "Comisiones + Subs MELI + Ganancia mayorista − Meta Ads − Egresos"},
                {"label": "Total consolidado", "value": cons["ganancia_neta"],
                 "operator": "=", "subtotal": True},
            ],
            sources=[
                {"table": "tienda_nube.OrderItem + meli.meli_order_items", "engine": "unistore",
                 "filter": f"paymentStatus IN ('paid','confirmed','shipped','delivered') · periodo {period}"},
                {"table": "PaymentTransaction + PaymentIntentSubscription + tienda_nube_order_items + OrderItemMercadoLibre", "engine": "unidrop",
                 "filter": f"periodo {period} · PROCESSED para subs"},
                {"table": "meta_insights_daily (Supabase local)", "engine": "supabase",
                 "filter": f"meta_ad_accounts.unit='unidrop' · periodo {period}"},
                {"table": "erogaciones (flujo-fondos)", "engine": "supabase",
                 "filter": f"empresa ILIKE '%unidrop%' OR categoria ILIKE '%unidrop%' · periodo {period}"},
            ],
            warnings=warnings,
        )

    if metric == "margen-consolidado":
        revenue_total = uni["revenue"] + drop["ingresos_unidrop"]
        return _wrap(
            metric=metric,
            title="Margen Consolidado",
            value=cons["margen_pct"],
            value_format="percent",
            period=period,
            formula="(ganancia_neta_consolidada / revenue_real) * 100",
            description="Ratio sobre el revenue REAL de cada unidad. Revenue real = revenue propio de Unistore + ingresos retenidos por Unidrop (NO el volumen plataforma de los dropshippers).",
            steps=[
                {"label": "Ganancia neta consolidada", "value": cons["ganancia_neta"],
                 "operator": None, "explain_metric": "ganancia-consolidada"},
                {"label": "Revenue Unistore propio", "value": uni["revenue"], "operator": "÷",
                 "hint": "TN + ML paid en el período"},
                {"label": "+ Ingresos Unidrop retenidos", "value": drop["ingresos_unidrop"],
                 "operator": "+", "hint": "Comisiones + Subs + Mayorista (NO volumen dropshipper)"},
                {"label": "= Revenue real total", "value": revenue_total,
                 "operator": "=", "subtotal": True},
                {"label": "Margen", "value": cons["margen_pct"],
                 "operator": "×100", "subtotal": True},
            ],
            warnings=[]
            if revenue_total > 0
            else ["Revenue real total = 0 → margen no definido (devuelve 0)"],
        )

    if metric == "cobertura-costos":
        return _wrap(
            metric=metric,
            title="Cobertura de costos Unistore",
            value=cons["cobertura_costos_unistore_pct"],
            value_format="percent",
            period=period,
            formula="(revenue_con_costo_unistore / revenue_total_unistore) * 100",
            description="Porcentaje del revenue Unistore cuyos SKUs vendidos tienen costo cargado en cost_index_unistore (ultimo lote). Si está bajo, la ganancia Unistore queda subestimada.",
            steps=[
                {"label": "Revenue Unistore total", "value": uni["revenue"], "operator": None},
                {"label": "Revenue con costo cargado", "value": uni["revenue_con_costo"],
                 "operator": "÷", "hint": f"{uni['skus_con_costo']} SKUs con costo"},
                {"label": "% Cobertura", "value": cons["cobertura_costos_unistore_pct"],
                 "operator": "×100", "subtotal": True},
                {"label": "SKUs sin costo cargado", "value": uni["skus_sin_costo"],
                 "operator": "⚠", "hint": "Hay que cargar lotes en /dashboard/costos para cerrar la brecha"},
            ],
            sources=[
                {"table": "cost_index_unistore (compute en runtime)", "engine": "unistore",
                 "filter": "ultimo lote por SKU con costo_con_iva_unit_ars"},
            ],
            warnings=[
                f"{uni['skus_sin_costo']} SKUs sin costo cargado en el período"
            ] if uni["skus_sin_costo"] > 0 else [],
            drilldown_url="/dashboard/costos",
        )

    if metric == "deuda-talo":
        return _wrap(
            metric=metric,
            title="Deuda Talo pendiente",
            value=overview["deuda_talo_pendiente"],
            period=period,
            formula="SUM(PaymentIntentSubscription.expectedAmount) WHERE status='PENDING'",
            description="Suscripciones MELI facturadas pero todavía no cobradas vía Talo. Es deuda nominal — algunas se cobran con retraso, otras nunca (churn). El número agregado da el upper bound.",
            steps=[
                {"label": "Subs PaymentIntent en PENDING", "value": overview["deuda_talo_pendiente"],
                 "operator": None, "drill_endpoint": "/api/drilldowns/talo/transactions?period=30d&status=pending"},
            ],
            sources=[
                {"table": "PaymentIntentSubscription", "engine": "unidrop",
                 "filter": "status::text = 'PENDING' · sin filtro de período (todos los pendientes acumulados)"},
            ],
            sql_summary="""
SELECT COALESCE(SUM("expectedAmount"), 0)
FROM public."PaymentIntentSubscription"
WHERE status::text = 'PENDING';
""",
            drilldown_url="/api/drilldowns/talo/transactions?period=90d&status=pending",
        )

    # ---------- Unistore ----------
    if metric == "unistore-revenue":
        return _wrap(
            metric=metric,
            title="Revenue total Unistore",
            value=uni["revenue"],
            period=period,
            formula="SUM(TN paid) + SUM(ML paid)",
            description="Suma del revenue (precio × cantidad) de las órdenes pagadas de Unistore en TN y MELI durante el período.",
            steps=[
                {"label": "Revenue Unistore total", "value": uni["revenue"],
                 "operator": None, "drill_endpoint": f"/api/drilldowns/orders/paid?period={period}"},
            ],
            sources=[
                {"table": "tienda_nube.\"Order\" + tienda_nube.\"OrderItem\"", "engine": "unistore",
                 "filter": "paymentStatus='paid'"},
                {"table": "meli.meli_orders + meli.meli_order_items", "engine": "unistore",
                 "filter": "status IN ('paid','confirmed','shipped','delivered')"},
            ],
            drilldown_url=f"/api/drilldowns/orders/paid?period={period}",
        )

    if metric == "unistore-ganancia":
        return _wrap(
            metric=metric,
            title="Ganancia neta Unistore (TN + ML)",
            value=uni["ganancia_neta"],
            period=period,
            formula="SUM por SKU vendido de calc_profit(ingreso, costo_lote, IVA, IIBB, gateway)",
            description="Calcula la ganancia SKU-por-SKU usando profit_engine que descuenta IVA neto a pagar, IIBB 5%, fee del gateway y resta el costo con IVA del último lote importado.",
            steps=[
                {"label": "Revenue con costo cargado", "value": uni["revenue_con_costo"],
                 "operator": None, "hint": f"{uni['cobertura_costos_pct']:.1f}% del revenue total"},
                {"label": "− Costo mercadería (con IVA)", "value": uni["costo"],
                 "operator": "−", "negative": True, "hint": "Último lote × unidades vendidas"},
                {"label": "− IVA neto + IIBB + Gateway fee", "value": uni["revenue_con_costo"] - uni["costo"] - uni["ganancia_neta"],
                 "operator": "−", "negative": True,
                 "hint": "Descuentos contables (calculados por profit_engine SKU por SKU)"},
                {"label": "= Ganancia neta", "value": uni["ganancia_neta"],
                 "operator": "=", "subtotal": True,
                 "negative": uni["ganancia_neta"] < 0},
                {"label": "Margen", "value": uni["margen_pct"],
                 "operator": "%", "hint": "Sobre revenue con costo"},
            ],
            sources=[
                {"table": "cost_index_unistore", "engine": "unistore",
                 "filter": "último lote por SKU"},
                {"table": "tienda_nube.\"OrderItem\" + meli.meli_order_items", "engine": "unistore",
                 "filter": f"período {period} · paymentStatus='paid'"},
            ],
            warnings=[
                f"{uni['skus_sin_costo']} SKUs vendidos sin costo cargado — no entran en ganancia",
            ] if uni["skus_sin_costo"] > 0 else [],
            drilldown_url=f"/api/drilldowns/orders/paid?period={period}",
        )

    if metric == "unistore-costo":
        return _wrap(
            metric=metric,
            title="Costo de mercadería Unistore (con IVA)",
            value=uni["costo"],
            period=period,
            formula="SUM(costo_con_iva_lote × cantidad_vendida) por SKU",
            description="Suma del costo mayorista con IVA del último lote importado, multiplicado por las unidades vendidas en el período. Solo considera SKUs con costo cargado.",
            steps=[
                {"label": "Costo de mercadería (c/IVA)", "value": uni["costo"], "operator": None},
                {"label": "SKUs con costo", "value": uni["skus_con_costo"], "operator": "ℹ", "value_format": "number"},
                {"label": "SKUs sin costo", "value": uni["skus_sin_costo"], "operator": "⚠", "value_format": "number"},
            ],
            sources=[
                {"table": "lotes_unistore (cost_index_unistore)", "engine": "unistore",
                 "filter": "último lote por SKU con costo_con_iva_unit_ars"},
            ],
            drilldown_url="/dashboard/costos",
        )

    if metric == "unistore-margen":
        return _wrap(
            metric=metric,
            title="Margen Unistore",
            value=uni["margen_pct"],
            value_format="percent",
            period=period,
            formula="(ganancia_neta / revenue_con_costo) * 100",
            description="Margen sobre el revenue del que tenemos costo cargado (no sobre revenue total). Si la cobertura es baja el margen real puede ser menor.",
            steps=[
                {"label": "Ganancia neta", "value": uni["ganancia_neta"], "operator": None,
                 "explain_metric": "unistore-ganancia"},
                {"label": "Revenue con costo", "value": uni["revenue_con_costo"], "operator": "÷"},
                {"label": "Margen", "value": uni["margen_pct"],
                 "operator": "×100", "subtotal": True},
            ],
        )

    # ---------- Unidrop volumen plataforma (informativo) ----------
    if metric == "unidrop-volumen":
        return _wrap(
            metric=metric,
            title="Volumen plataforma Unidrop",
            value=drop["volumen_plataforma"],
            period=period,
            formula="SUM(TN paid total) + SUM(ML paid totalAmount)",
            description="Volumen omnicanal de los dropshippers de Unidrop. NO entra en la ganancia Unidrop, es referencia. Unidrop solo retiene comisiones, subs y ganancia mayorista de este volumen.",
            steps=[
                {"label": "Facturación TN paid (dropshippers)", "value": drop["volumen_tn"],
                 "operator": None, "hint": f"{drop.get('ordenes_pagadas', 0)} órdenes total (TN+ML)"},
                {"label": "+ Facturación ML paid (dropshippers)", "value": drop["volumen_ml"], "operator": "+"},
                {"label": "= Volumen plataforma", "value": drop["volumen_plataforma"],
                 "operator": "=", "subtotal": True},
            ],
            sources=[
                {"table": "tienda_nube_orders", "engine": "unidrop",
                 "filter": f"payment_status='paid' · período {period}"},
                {"table": "OrderMercadoLibre", "engine": "unidrop",
                 "filter": f"status IN ('paid','confirmed','shipped','delivered') · período {period}"},
            ],
        )

    if metric == "unidrop-costo-mercaderia":
        return _wrap(
            metric=metric,
            title="Costo de mercadería Unidrop",
            value=drop["costo_mercaderia"],
            period=period,
            formula="SUM(tnoi.cost × qty) [TN] + SUM(OML.merchandise_cost) [ML]",
            description="Lo que los dropshippers le pagaron a Unidrop por la mercadería (precio mayorista cobrado). NO es nuestro costo: es nuestro ingreso por mercadería antes de descontar el costo del lote (eso se hace en 'Ganancia mayorista').",
            steps=[
                {"label": "Costo TN (paga el dropshipper)", "value": drop["costo_tn"], "operator": None},
                {"label": "+ Costo ML (paga el dropshipper)", "value": drop["costo_ml"], "operator": "+"},
                {"label": "= Costo mercadería total", "value": drop["costo_mercaderia"],
                 "operator": "=", "subtotal": True},
            ],
            sources=[
                {"table": "tienda_nube_order_items.cost · OrderItemMercadoLibre.unitCost", "engine": "unidrop",
                 "filter": f"orders paid · período {period}"},
            ],
        )

    if metric == "unidrop-margen-bruto":
        return _wrap(
            metric=metric,
            title="Margen bruto plataforma Unidrop",
            value=drop["margen_bruto_plataforma"],
            period=period,
            formula="volumen_plataforma - costo_mercaderia",
            description="Diferencia entre lo que pagaron los clientes finales y lo que pagaron los dropshippers a Unidrop. NO es ganancia Unidrop (es el margen que se queda el dropshipper).",
            steps=[
                {"label": "Volumen plataforma", "value": drop["volumen_plataforma"],
                 "operator": None, "explain_metric": "unidrop-volumen"},
                {"label": "− Costo mercadería pagado por dropshipper", "value": drop["costo_mercaderia"],
                 "operator": "−", "negative": True, "explain_metric": "unidrop-costo-mercaderia"},
                {"label": "= Margen bruto del dropshipper", "value": drop["margen_bruto_plataforma"],
                 "operator": "=", "subtotal": True},
            ],
        )

    # ---------- Unidrop retencion ----------
    if metric == "unidrop-comisiones":
        return _wrap(
            metric=metric,
            title="Comisiones Talo cobradas",
            value=drop["comisiones"],
            period=period,
            formula="SUM(PaymentTransaction.commission) + SUM(PaymentTransactionSubscription.commission)",
            description="Comisiones que cobra Unidrop a través de Talo: fee por cada transacción procesada (pagos de pedidos + pagos de suscripciones).",
            steps=[
                {"label": "Comisiones por transacciones de pedidos", "value": drop["comisiones"],
                 "operator": None, "hint": "Combina PT (pedidos) + PTS (suscripciones)"},
            ],
            sources=[
                {"table": "PaymentTransaction + PaymentTransactionSubscription", "engine": "unidrop",
                 "filter": f"createdAt en período {period} · commission > 0"},
            ],
            sql_summary="""
SELECT (
  (SELECT SUM(commission) FROM "PaymentTransaction" WHERE "createdAt" >= NOW() - INTERVAL '30 days') +
  (SELECT SUM(commission) FROM "PaymentTransactionSubscription" WHERE "createdAt" >= NOW() - INTERVAL '30 days')
);
""",
        )

    if metric == "unidrop-subs-meli":
        return _wrap(
            metric=metric,
            title="Suscripciones MELI cobradas",
            value=drop["suscripciones_cobradas"],
            period=period,
            formula="SUM(PaymentIntentSubscription.paidAmount) WHERE status='PROCESSED'",
            description="Monto de suscripciones MELI cobradas exitosamente en el período. Es el revenue recurrente principal de Unidrop (subscripcion mensual al servicio).",
            steps=[
                {"label": "Subs PaymentIntent PROCESSED", "value": drop["suscripciones_cobradas"],
                 "operator": None, "drill_endpoint": "/api/drilldowns/saas/users-active"},
            ],
            sources=[
                {"table": "PaymentIntentSubscription", "engine": "unidrop",
                 "filter": f"status='PROCESSED' · createdAt en período {period}"},
            ],
        )

    if metric == "unidrop-mayorista":
        m = drop["mayorista_breakdown"]
        warnings: list[str] = []
        if m["cobertura_pct"] < 75:
            warnings.append(
                f"Cobertura de costos {m['cobertura_pct']:.1f}%: {m['skus_sin_costo']} SKUs sin costo de lote — la ganancia mayorista puede estar sobreestimada"
            )
        if m.get("revenue_sin_costo", 0) > 0:
            warnings.append(
                f"${m['revenue_sin_costo']:.0f} de revenue mayorista sin costo de lote atribuido"
            )
        return _wrap(
            metric=metric,
            title="Ganancia mayorista mercadería",
            value=drop["ganancia_mayorista"],
            period=period,
            formula="SUM por SKU vendido de (precio_mayorista_pagado_por_dropshipper - costo_ultimo_lote_unistore) × qty",
            description="Margen que retiene Unidrop sobre la mercadería que vende a los dropshippers: precio que cobra al dropshipper menos costo del último lote importado.",
            steps=[
                {"label": "Precio mayorista total (TN+ML)", "value": m["precio_mayorista_total"],
                 "operator": None, "hint": "Lo que pagaron los dropshippers a Unidrop"},
                {"label": "− Costo último lote", "value": m["costo_lote_total"],
                 "operator": "−", "negative": True, "hint": "cost_index_unistore: último lote con costo_con_iva por SKU"},
                {"label": "= Ganancia mayorista total", "value": drop["ganancia_mayorista"],
                 "operator": "=", "subtotal": True},
                {"label": "  · Ganancia TN", "value": m["ganancia_tn"], "operator": "  →", "hint": "SUM(tnoi.cost × qty) - SUM(costo_lote × qty)"},
                {"label": "  · Ganancia ML", "value": m["ganancia_ml"], "operator": "  →", "hint": "SUM(unitCost × qty) - SUM(costo_lote × qty)"},
            ],
            sources=[
                {"table": "tienda_nube_order_items.cost", "engine": "unidrop",
                 "filter": f"paid orders · período {period}"},
                {"table": "OrderItemMercadoLibre.unitCost", "engine": "unidrop",
                 "filter": f"paid orders · período {period}"},
                {"table": "cost_index_unistore", "engine": "unistore",
                 "filter": "último lote por SKU"},
            ],
            warnings=warnings,
        )

    if metric == "unidrop-meta-ads" or metric == "meta-spend":
        return explain_meta_ads_spend(period=period)

    # ---------- Meta Ads cross (CAC, ROAS, LTV) ----------
    if metric in ("meta-cac-signup", "meta-cac-sub", "meta-roas-cohort", "meta-ltv-30d", "meta-roas-period"):
        return explain_meta_kpi(metric=metric, period=period)

    if metric == "unidrop-egresos":
        return _wrap(
            metric=metric,
            title="Egresos operativos Unidrop",
            value=drop["egresos_operativos"],
            period=period,
            formula="SUM(erogaciones.monto) WHERE empresa~'unidrop' OR categoria~'unidrop'",
            description="Egresos operativos cargados en el módulo Flujo de Fondos que están asignados a Unidrop (sueldos, servicios, etc.) en el período.",
            steps=[
                {"label": "Egresos asignados a Unidrop", "value": drop["egresos_operativos"],
                 "operator": None, "drill_endpoint": "/dashboard/finanzas/flujo-fondos"},
            ],
            sources=[
                {"table": "erogaciones (flujo-fondos)", "engine": "supabase",
                 "filter": f"fecha_pago en período {period} · estado IN ('pagado','en_curso','pendiente') · empresa OR categoria ILIKE '%unidrop%'"},
            ],
            drilldown_url="/dashboard/finanzas/flujo-fondos",
        )

    if metric == "unidrop-ingresos":
        return _wrap(
            metric=metric,
            title="Ingresos Unidrop (retención bruta)",
            value=drop["ingresos_unidrop"],
            period=period,
            formula="comisiones + suscripciones_cobradas + ganancia_mayorista",
            description="Suma de los 3 streams de revenue real de Unidrop, antes de descontar Meta Ads y egresos operativos.",
            steps=[
                {"label": "Comisiones Talo", "value": drop["comisiones"], "operator": None,
                 "explain_metric": "unidrop-comisiones"},
                {"label": "+ Suscripciones MELI cobradas", "value": drop["suscripciones_cobradas"],
                 "operator": "+", "explain_metric": "unidrop-subs-meli"},
                {"label": "+ Ganancia mayorista mercadería", "value": drop["ganancia_mayorista"],
                 "operator": "+", "explain_metric": "unidrop-mayorista"},
                {"label": "= Ingresos Unidrop", "value": drop["ingresos_unidrop"],
                 "operator": "=", "subtotal": True},
            ],
        )

    if metric == "unidrop-ganancia-neta":
        return _wrap(
            metric=metric,
            title="Ganancia neta Unidrop (retención)",
            value=drop["ganancia_neta"],
            period=period,
            formula="ingresos_unidrop − meta_ads_spend − egresos_operativos",
            description="Ganancia neta que retiene Unidrop después de pagar Meta Ads y los egresos operativos asignados.",
            steps=[
                {"label": "Ingresos Unidrop", "value": drop["ingresos_unidrop"],
                 "operator": None, "explain_metric": "unidrop-ingresos"},
                {"label": "− Meta Ads Unidrop", "value": drop["meta_ads_spend"],
                 "operator": "−", "negative": True, "explain_metric": "unidrop-meta-ads"},
                {"label": "− Egresos operativos", "value": drop["egresos_operativos"],
                 "operator": "−", "negative": True, "explain_metric": "unidrop-egresos"},
                {"label": "= Ganancia neta Unidrop", "value": drop["ganancia_neta"],
                 "operator": "=", "subtotal": True,
                 "negative": drop["ganancia_neta"] < 0},
                {"label": "Margen sobre retención", "value": drop["margen_pct"],
                 "operator": "%", "subtotal": True, "value_format": "percent"},
            ],
            warnings=(
                ["Ganancia negativa: Meta Ads + egresos superan los ingresos retenidos del período. "
                 "Importante: el modelo period-based descuenta TODO el spend del período aunque ese spend "
                 "captó dropshippers que recién facturarán meses después. Ver 'unidrop-meta-ads' para el modelo cohort-attributed."]
                if drop["ganancia_neta"] < 0 else []
            ),
        )

    if metric == "unidrop-margen":
        return _wrap(
            metric=metric,
            title="Margen Unidrop sobre retención",
            value=drop["margen_pct"],
            value_format="percent",
            period=period,
            formula="(ganancia_neta_unidrop / ingresos_unidrop) * 100",
            description="Margen de Unidrop sobre sus ingresos retenidos (no sobre volumen plataforma).",
            steps=[
                {"label": "Ganancia neta Unidrop", "value": drop["ganancia_neta"],
                 "operator": None, "explain_metric": "unidrop-ganancia-neta"},
                {"label": "Ingresos Unidrop", "value": drop["ingresos_unidrop"],
                 "operator": "÷", "explain_metric": "unidrop-ingresos"},
                {"label": "Margen", "value": drop["margen_pct"],
                 "operator": "×100", "subtotal": True},
            ],
        )

    raise ValueError(f"Métrica desconocida: {metric}")


def explain_meta_ads_spend(period: str = "30d") -> dict:
    """Detalle del spend Meta Ads UNIDROP — incluye breakdown por cuenta + por campaña +
    cobertura del sync. Comparte forma con explain_metric pero requiere queries propias."""
    from app.services.meta_ads import overview as meta_overview, campaigns as meta_campaigns, spend_for_period
    from app.db.local_persistence import get_conn
    from app.db.meta_ads_db import init as meta_init

    meta_init()
    out = meta_overview(period=period, unit="unidrop") or {}
    accounts = out.get("accounts") or []
    daily = out.get("daily") or []
    # Total con la ventana correcta (today/yesterday/12m soportados — meta_overview no lo hace).
    total_spend = spend_for_period(period=period, unit="unidrop")

    # Top 10 campañas
    try:
        campaigns = meta_campaigns(period=period, unit="unidrop", limit=10) or []
    except Exception as exc:
        log.warning("explain_meta_ads_spend: campaigns fail: %s", exc)
        campaigns = []

    # Date range real de la data sincronizada
    date_min = daily[0]["d"] if daily else None
    date_max = daily[-1]["d"] if daily else None
    expected_days = _period_days(period)
    actual_days = len(daily)
    coverage_pct = (actual_days / expected_days * 100) if expected_days > 0 else 0

    warnings: list[str] = []
    if coverage_pct < 90 and expected_days > 0:
        warnings.append(
            f"Cobertura sync {coverage_pct:.0f}%: {actual_days} de {expected_days} días con data. Puede faltar pull histórico."
        )
    for acc in accounts:
        if not acc.get("last_synced_at"):
            warnings.append(f"Cuenta {acc.get('name')} nunca sincronizada — el spend puede estar incompleto.")

    # Step list
    steps: list[dict] = []
    for acc in accounts:
        steps.append({
            "label": f"  · {acc.get('name', acc.get('id'))} ({acc.get('unit', '?')})",
            "value": float(acc.get("spend") or 0),
            "operator": "  →",
            "hint": f"{acc.get('currency')} · last sync {acc.get('last_synced_at') or 'nunca'}",
        })

    return _wrap(
        metric="unidrop-meta-ads",
        title="Meta Ads spend Unidrop",
        value=total_spend,
        period=period,
        formula="SUM(meta_insights_daily.spend) WHERE meta_ad_accounts.unit='unidrop'",
        description="Spend Meta Ads agregado de todas las cuentas publicitarias clasificadas como unidad='unidrop'. Modelo period-based: descuenta el spend del período sin atribución a la cohort que se capturó.",
        steps=[
            {"label": "Spend total Meta Ads (Unidrop)", "value": total_spend, "operator": None,
             "hint": f"{len(accounts)} cuenta(s) publicitaria(s) clasificadas a Unidrop"},
            *steps,
            {"label": "Top campañas (por spend)", "value": sum(float(c.get("spend") or 0) for c in campaigns),
             "operator": "ℹ", "hint": f"{len(campaigns)} mostradas · click 'Ver detalle' para tabla completa"},
        ],
        sources=[
            {"table": "meta_insights_daily ⋈ meta_ad_accounts", "engine": "supabase",
             "filter": f"unit='unidrop' · date_start >= CURRENT_DATE - INTERVAL '{expected_days} days'"},
        ],
        sql_summary=f"""
SELECT SUM(i.spend) AS spend_total
FROM meta_insights_daily i
INNER JOIN meta_ad_accounts a ON a.id = i.ad_account_id
WHERE a.unit = 'unidrop'
  AND i.date_start >= CURRENT_DATE - INTERVAL '{expected_days} days';
""",
        warnings=warnings,
        drilldown_url="/dashboard/marketing/meta",
    )


def _period_days(period: str) -> int:
    return {
        "today": 1, "yesterday": 1,
        "7d": 7, "30d": 30, "90d": 90, "12m": 365, "1y": 365,
    }.get(period, 30)


def explain_meta_kpi(metric: str, period: str = "30d") -> dict:
    """Explain breakdown para KPIs cross-Meta-Unidrop (CAC, ROAS, LTV).
    Reutiliza meta_explain.explain_meta_unidrop() que ya cruza los 3 modelos."""
    from app.services.meta_explain import explain_meta_unidrop

    me = explain_meta_unidrop(period=period)
    spend = float(me.get("spend") or 0)
    funnel = me.get("funnel") or {}
    cohort = me.get("models", {}).get("cohort_attributed") or {}
    period_based = me.get("models", {}).get("period_based") or {}

    if metric == "meta-cac-signup":
        value = float(funnel.get("cac_signup") or 0)
        signups = int(funnel.get("new_signups") or 0)
        return _wrap(
            metric=metric,
            title="CAC dropshipper",
            value=value,
            period=period,
            formula="spend_total / nuevos_signups",
            description="Costo de adquisición promedio por dropshipper firmado. Considera TODO el spend del período sobre los signups del mismo período (no ajusta por lag).",
            steps=[
                {"label": "Spend total Meta (Unidrop)", "value": spend, "operator": None,
                 "explain_metric": "unidrop-meta-ads"},
                {"label": "Nuevos signups en el período", "value": signups,
                 "operator": "÷", "value_format": "number"},
                {"label": "CAC dropshipper", "value": value,
                 "operator": "=", "subtotal": True},
            ],
            sources=[
                {"table": "meta_insights_daily ⋈ meta_ad_accounts", "engine": "supabase",
                 "filter": f"unit='unidrop' · período {period}"},
                {"table": "public.User", "engine": "unidrop",
                 "filter": f"createdAt en período {period}"},
            ],
            warnings=[
                "CAC infinito (spend > 0 pero 0 signups)" if spend > 0 and signups == 0 else "",
                "Sub-mide los signups que llegan al final del período (no completaron 30 días aún)."
                if signups > 0 else "",
            ],
        )

    if metric == "meta-cac-sub":
        value = float(funnel.get("cac_subscription") or 0)
        subs = int(funnel.get("new_subscriptions") or 0)
        return _wrap(
            metric=metric,
            title="CAC suscripción",
            value=value,
            period=period,
            formula="spend_total / nuevos_suscripciones",
            description="Costo de adquisición por suscripción activa nueva en el período. Es más estricto que CAC signup (los signups que no convierten a sub no entran).",
            steps=[
                {"label": "Spend total Meta (Unidrop)", "value": spend, "operator": None,
                 "explain_metric": "unidrop-meta-ads"},
                {"label": "Nuevas suscripciones (start_date_subscription)", "value": subs,
                 "operator": "÷", "value_format": "number"},
                {"label": "CAC suscripción", "value": value,
                 "operator": "=", "subtotal": True},
            ],
            sources=[
                {"table": "public.User.start_date_subscription", "engine": "unidrop",
                 "filter": f"start_date_subscription en período {period}"},
            ],
        )

    if metric == "meta-roas-cohort":
        value = float(cohort.get("roas") or 0)
        rev_attr = float(cohort.get("revenue_attributed") or 0)
        return _wrap(
            metric=metric,
            title="ROAS cohort-attributed",
            value=value,
            value_format="number",
            period=period,
            formula="revenue_de_la_cohort_en_30d / spend_del_periodo",
            description="ROAS calculado sobre el revenue que generó la cohort firmada en el período, en sus primeros 30 días. Es la métrica honesta para evaluar la calidad del spend.",
            steps=[
                {"label": "Revenue de la cohort en sus primeros 30d", "value": rev_attr,
                 "operator": None, "hint": f"{cohort.get('users_with_revenue', 0)} usuarios que pagaron"},
                {"label": "Spend del período", "value": spend, "operator": "÷",
                 "explain_metric": "unidrop-meta-ads"},
                {"label": "ROAS cohort", "value": value,
                 "operator": "=", "subtotal": True, "hint": "Si <1, no recupera el CAC en 30d"},
            ],
            sources=[
                {"table": "PaymentIntent ⋈ User (cohort) en sus primeros 30d", "engine": "unidrop",
                 "filter": f"status='PROCESSED' · u.createdAt en período {period}"},
            ],
            warnings=[
                "ROAS < 1: la cohort no recupera el CAC en 30 días. Mirar retention 60d/90d antes de bajar inversión."
                if value < 1 and value > 0 else "",
            ],
        )

    if metric == "meta-roas-period":
        value = float(period_based.get("roas") or 0)
        rev_period = float(period_based.get("revenue_total_period") or 0)
        return _wrap(
            metric=metric,
            title="ROAS period-based (gross)",
            value=value,
            value_format="number",
            period=period,
            formula="revenue_total_periodo / spend_periodo",
            description="ROAS calculado sobre TODO el revenue del período (incluso de usuarios viejos, no solo de la cohort nueva). Sobreestima el efecto del spend.",
            steps=[
                {"label": "Revenue total del período (todos los users)", "value": rev_period,
                 "operator": None, "hint": "Incluye facturación de dropshippers viejos no atribuible al spend"},
                {"label": "Spend del período", "value": spend, "operator": "÷",
                 "explain_metric": "unidrop-meta-ads"},
                {"label": "ROAS gross", "value": value,
                 "operator": "=", "subtotal": True},
            ],
            warnings=[
                "Modelo optimista: cuenta revenue de users que ya estaban antes del período. Comparar con ROAS cohort-attributed (más honesto)."
            ],
        )

    if metric == "meta-ltv-30d":
        value = float(cohort.get("ltv_first_30d") or 0)
        rev_attr = float(cohort.get("revenue_attributed") or 0)
        cohort_size = int(cohort.get("cohort_size") or 0)
        return _wrap(
            metric=metric,
            title="LTV inicial 30d (cohort)",
            value=value,
            period=period,
            formula="revenue_atribuido_cohort / cohort_size",
            description="Revenue promedio por dropshipper en sus primeros 30 días de vida. Es el LTV inicial — el upper bound es ROAS positivo cuando LTV30d > CAC.",
            steps=[
                {"label": "Revenue atribuido a la cohort", "value": rev_attr, "operator": None},
                {"label": "Cohort size", "value": cohort_size,
                 "operator": "÷", "value_format": "number"},
                {"label": "LTV inicial 30d", "value": value,
                 "operator": "=", "subtotal": True,
                 "hint": f"CAC signup: ${funnel.get('cac_signup', 0):,.0f}"},
            ],
            sources=[
                {"table": "PaymentIntent en los primeros 30d post-signup", "engine": "unidrop",
                 "filter": f"u.createdAt en período {period} · pi.createdAt <= u.createdAt + 30d"},
            ],
        )

    raise ValueError(f"Métrica Meta desconocida: {metric}")

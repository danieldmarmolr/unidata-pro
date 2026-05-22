"""
Dashboard Logistica - Unistore.
Funnel TN.Order -> Digip.Pedido -> Preparacion -> Despacho -> Fulfillment.
Stock por area, productos criticos, ajustes.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}
STOCK_CRITICO_TH = 5  # unidades


def logistica_unistore(period: str = "30d", area: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine("unistore")
    p = {"days": days}

    area_filter = ""
    area_param = {}
    if area and area != "all":
        area_filter = ' AND "areaDescripcion" = :area '
        area_param = {"area": area}

    cards: list[dict] = []

    # KPIs principales
    pedidos_pendientes = int(scalar(eng, """
        SELECT COUNT(*) FROM digip."Pedido"
        WHERE "PedidoEstado" ILIKE '%Pendiente%' OR "PedidoEstado" ILIKE '%Aprobado%'
    """) or 0)
    en_preparacion = int(scalar(eng, """
        SELECT COUNT(DISTINCT "pedidoCodigo") FROM digip."Preparacion"
        WHERE "preparacionEstado" NOT ILIKE '%Finalizada%'
          AND "preparacionEstado" NOT ILIKE '%Cancelada%'
    """) or 0)

    despachados_periodo = int(scalar(eng, """
        SELECT COUNT(*) FROM digip."DespachoPedido"
        WHERE fecha >= NOW() - make_interval(days => :days)
    """, p) or 0)
    despachados_prev = int(scalar(eng, """
        SELECT COUNT(*) FROM digip."DespachoPedido"
        WHERE fecha >= NOW() - make_interval(days => :days2)
          AND fecha <  NOW() - make_interval(days => :days)
    """, {"days": days, "days2": days * 2}) or 0)
    delta_disp = ((despachados_periodo - despachados_prev) / despachados_prev * 100) if despachados_prev > 0 else None

    # Lead time Pedido Digip -> Despacho (filtra negativos provenientes de imports historicos)
    lead_avg = scalar(eng, """
        SELECT AVG(EXTRACT(EPOCH FROM (dp.fecha - pd."Fecha"))/86400.0)::float
        FROM digip."Pedido" pd
        JOIN digip."DespachoPedido" dp ON dp."pedidoCodigo" = pd."Codigo"
        WHERE dp.fecha >= NOW() - make_interval(days => :days)
          AND dp.fecha >= pd."Fecha"
    """, p)

    # Pedidos atascados: TN.Order paid >5 dias atras Y shippingStatus aun en estado abierto.
    # Estados abiertos reales en TN: 'unpacked', 'unshipped', 'partially_packed', 'partially_fulfilled'.
    stuck = int(scalar(eng, """
        SELECT COUNT(*)
        FROM tienda_nube."Order" o
        WHERE o."paymentStatus" = 'paid'
          AND o."shippingStatus" IN ('unpacked','unshipped','partially_packed','partially_fulfilled')
          AND o."createdAt" < NOW() - INTERVAL '5 days'
    """) or 0)

    # SKUs con stock critico
    sku_critico = int(scalar(eng, """
        SELECT COUNT(*) FROM (
            SELECT "articuloCodigo" FROM digip."StockDetalle"
            GROUP BY "articuloCodigo"
            HAVING SUM(unidades) <= :th AND SUM(unidades) >= 0
        ) x
    """, {"th": STOCK_CRITICO_TH}) or 0)

    cards.append({"label": "Pedidos pendientes (Digip)", "value": pedidos_pendientes,
                  "hint": "Estado pendiente o aprobado"})
    cards.append({"label": "En preparacion", "value": en_preparacion,
                  "hint": "Preparaciones no finalizadas"})
    cards.append({"label": f"Despachados ({period})", "value": despachados_periodo,
                  "delta": round(delta_disp, 1) if delta_disp is not None else None})
    cards.append({"label": "Lead time avg", "value": round(float(lead_avg), 1) if lead_avg else 0,
                  "suffix": " dias", "hint": "Order TN -> Despacho Digip"})
    cards.append({"label": "Pedidos atascados", "value": stuck,
                  "hint": "Pagados sin fulfillment >5 dias"})
    cards.append({"label": "SKUs con stock critico", "value": sku_critico,
                  "hint": f"<= {STOCK_CRITICO_TH} unidades totales"})

    # ---------- Funnel ----------
    o_count = int(scalar(eng, """
        SELECT COUNT(*) FROM tienda_nube."Order"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
          AND "paymentStatus" = 'paid'
    """, p) or 0)
    pd_count = int(scalar(eng, """
        SELECT COUNT(DISTINCT pd.id) FROM digip."Pedido" pd
        JOIN tienda_nube."Order" o ON o.id = pd."orderId"
        WHERE o."createdAt" >= NOW() - make_interval(days => :days)
          AND o."paymentStatus" = 'paid'
    """, p) or 0)
    prep_count = int(scalar(eng, """
        SELECT COUNT(DISTINCT pr."pedidoCodigo")
        FROM digip."Preparacion" pr
        JOIN digip."Pedido" pd ON pd."Codigo" = pr."pedidoCodigo"
        JOIN tienda_nube."Order" o ON o.id = pd."orderId"
        WHERE o."createdAt" >= NOW() - make_interval(days => :days)
          AND o."paymentStatus" = 'paid'
    """, p) or 0)
    desp_count = int(scalar(eng, """
        SELECT COUNT(DISTINCT dp."pedidoCodigo")
        FROM digip."DespachoPedido" dp
        JOIN digip."Pedido" pd ON pd."Codigo" = dp."pedidoCodigo"
        JOIN tienda_nube."Order" o ON o.id = pd."orderId"
        WHERE o."createdAt" >= NOW() - make_interval(days => :days)
          AND o."paymentStatus" = 'paid'
    """, p) or 0)
    ff_count = int(scalar(eng, """
        SELECT COUNT(DISTINCT f."orderId")
        FROM tienda_nube."Fulfillment" f
        JOIN tienda_nube."Order" o ON o.id = f."orderId"
        WHERE o."createdAt" >= NOW() - make_interval(days => :days)
          AND o."paymentStatus" = 'paid'
    """, p) or 0)

    funnel = [
        {"category": "1. Order pagada", "value": float(o_count)},
        {"category": "2. Pedido Digip", "value": float(pd_count)},
        {"category": "3. En preparacion", "value": float(prep_count)},
        {"category": "4. Despachado", "value": float(desp_count)},
        {"category": "5. Fulfillment", "value": float(ff_count)},
    ]

    # ---------- Lead time daily 60 dias (Pedido Digip -> Despacho, solo positivos) ----------
    lt_rows = q(eng, """
        SELECT date_trunc('day', dp.fecha)::date,
               AVG(EXTRACT(EPOCH FROM (dp.fecha - pd."Fecha"))/86400.0)::float
        FROM digip."Pedido" pd
        JOIN digip."DespachoPedido" dp ON dp."pedidoCodigo" = pd."Codigo"
        WHERE dp.fecha >= NOW() - INTERVAL '60 days'
          AND dp.fecha >= pd."Fecha"
        GROUP BY 1 ORDER BY 1
    """) or []
    lead_time_daily = [{"date": r[0].strftime("%Y-%m-%d") if r[0] else "",
                        "value": float(r[1] or 0)} for r in lt_rows]

    # ---------- Stock por area ----------
    rows = q(eng, """
        SELECT "areaDescripcion" AS area,
               SUM(unidades)::int AS unidades,
               COUNT(DISTINCT "articuloCodigo")::int AS skus
        FROM digip."StockDetalle"
        WHERE "areaDescripcion" IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC
        LIMIT 15
    """) or []
    stock_by_area = [{
        "category": r[0],
        "value": float(r[1] or 0),
        "extra": {"skus": int(r[2] or 0)},
    } for r in rows]

    # ---------- Productos con stock critico ----------
    rows = q(eng, """
        SELECT "articuloCodigo", MAX("articuloDescripcion") AS desc,
               SUM(unidades)::int AS unidades,
               COUNT(DISTINCT "areaDescripcion")::int AS areas
        FROM digip."StockDetalle"
        GROUP BY 1
        HAVING SUM(unidades) >= 0 AND SUM(unidades) <= :th
        ORDER BY unidades ASC
        LIMIT 20
    """, {"th": STOCK_CRITICO_TH}) or []
    stock_critico = [{
        "category": r[0] or "?",
        "value": float(r[2] or 0),
        "extra": {"desc": r[1] or "", "areas": int(r[3] or 0)},
    } for r in rows]

    # ---------- Movimientos de ajuste por motivo ----------
    rows = q(eng, """
        SELECT COALESCE(NULLIF(TRIM("motivoAjuste"),''),'sin motivo'),
               COUNT(*)::int,
               SUM(CASE WHEN signo = '-' THEN ("unidadesAnterior" - "unidadesNuevo") ELSE 0 END)::int AS bajas,
               SUM(CASE WHEN signo = '+' THEN ("unidadesNuevo" - "unidadesAnterior") ELSE 0 END)::int AS altas
        FROM digip."MovimientoAjuste"
        WHERE fecha >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC
        LIMIT 10
    """, p) or []
    ajustes = [{
        "category": r[0],
        "value": float(r[1] or 0),
        "extra": {"bajas": int(r[2] or 0), "altas": int(r[3] or 0)},
    } for r in rows]

    # ---------- Top pedidos atascados (detalle) enriquecidos con DigiP estado ----------
    rows = q(eng, """
        SELECT o.id, o.number, o.total, o."paymentStatus", o."shippingStatus",
               o."createdAt", EXTRACT(DAY FROM (NOW() - o."createdAt"))::int AS dias,
               pd."PedidoEstado" AS digip_estado,
               pd."Codigo" AS digip_codigo
        FROM tienda_nube."Order" o
        LEFT JOIN digip."Pedido" pd ON pd."orderId" = o.id
        WHERE o."paymentStatus" = 'paid'
          AND o."shippingStatus" IN ('unpacked','unshipped','partially_packed','partially_fulfilled')
          AND o."createdAt" < NOW() - INTERVAL '5 days'
        ORDER BY o."createdAt" ASC
        LIMIT 20
    """) or []
    stuck_orders = [{
        "category": str(r[1] or r[0]),
        "value": float(r[2] or 0),
        "extra": {
            "id": int(r[0] or 0),
            "payment": r[3] or "",
            "shipping": r[4] or "",
            "created_at": r[5].isoformat() if r[5] else None,
            "dias_atrasado": int(r[6] or 0),
            "digip_estado": r[7] or "(sin pedido)",
            "digip_codigo": r[8] or "",
        },
    } for r in rows]

    # ============================================================
    # F1 - Espejo Unidrop: distribucion por estado, top SKUs, top localidades
    # ============================================================

    # ---------- Distribucion por PedidoEstado (donut friendly) ----------
    rows = q(eng, """
        SELECT "PedidoEstado", COUNT(*)::int
        FROM digip."Pedido"
        WHERE "Fecha" >= NOW() - make_interval(days => :days)
        GROUP BY 1
        ORDER BY 2 DESC
    """, p) or []
    by_estado = [{"category": (r[0] or "(sin)"), "value": float(r[1] or 0)} for r in rows]

    # ---------- Top SKUs pedidos via PedidoDetalle ----------
    rows = q(eng, """
        SELECT pdd."articuloCodigo",
               MAX(pdd."articuloDescripcion") AS desc,
               SUM(pdd.unidades)::int AS uds,
               COUNT(DISTINCT pd."Codigo")::int AS pedidos
        FROM digip."PedidoDetalle" pdd
        JOIN digip."Pedido" pd ON pd."Codigo" = pdd."pedidoCodigo"
        WHERE pd."Fecha" >= NOW() - make_interval(days => :days)
        GROUP BY 1
        ORDER BY uds DESC
        LIMIT 15
    """, p) or []
    top_skus = [{
        "category": r[0] or "(sin)",
        "value": float(r[2] or 0),
        "extra": {"desc": r[1] or "", "pedidos": int(r[3] or 0)},
    } for r in rows]

    # ---------- Top localidades de despacho via ClienteUbicacion ----------
    rows = q(eng, """
        SELECT COALESCE(NULLIF(TRIM(cu."Localidad"),''),'(sin)') AS loc,
               COALESCE(NULLIF(TRIM(cu."Provincia"),''),'') AS prov,
               COUNT(*)::int AS n
        FROM digip."Pedido" pd
        LEFT JOIN digip."ClienteUbicacion" cu
               ON cu."Codigo" = pd."CodigoClienteUbicacion"
        WHERE pd."Fecha" >= NOW() - make_interval(days => :days)
        GROUP BY 1, 2
        ORDER BY n DESC
        LIMIT 12
    """, p) or []
    top_localidades = [{
        "category": r[0],
        "value": float(r[2] or 0),
        "extra": {"provincia": r[1] or ""},
    } for r in rows]

    # ============================================================
    # F2 - Riqueza unica Unistore: throughput, items pendientes,
    #      stock por contenedor, lead time desglosado en 2 etapas
    # ============================================================

    # ---------- Lead time desglosado: Pedido->Preparacion y Preparacion->Despacho ----------
    lt_pedido_prep = scalar(eng, """
        SELECT AVG(EXTRACT(EPOCH FROM (pr.fecha - pd."Fecha"))/86400.0)::float
        FROM digip."Pedido" pd
        JOIN digip."Preparacion" pr ON pr."pedidoCodigo" = pd."Codigo"
        WHERE pr.fecha >= NOW() - make_interval(days => :days)
          AND pr.fecha >= pd."Fecha"
    """, p)
    lt_prep_despacho = scalar(eng, """
        SELECT AVG(EXTRACT(EPOCH FROM (dp.fecha - pr.fecha))/86400.0)::float
        FROM digip."Preparacion" pr
        JOIN digip."DespachoPedido" dp ON dp."pedidoCodigo" = pr."pedidoCodigo"
        WHERE dp.fecha >= NOW() - make_interval(days => :days)
          AND dp.fecha >= pr.fecha
    """, p)
    lead_time_etapas = {
        "pedido_to_prep_avg": round(float(lt_pedido_prep), 2) if lt_pedido_prep else None,
        "prep_to_despacho_avg": round(float(lt_prep_despacho), 2) if lt_prep_despacho else None,
    }

    # ---------- Throughput preparaciones: creadas vs finalizadas por dia (60d) ----------
    rows = q(eng, """
        SELECT date_trunc('day', fecha)::date AS d,
               COUNT(*)::int AS creadas,
               SUM(CASE WHEN "preparacionEstado" ILIKE '%Finalizada%' THEN 1 ELSE 0 END)::int AS finalizadas
        FROM digip."Preparacion"
        WHERE fecha >= NOW() - INTERVAL '60 days'
        GROUP BY 1 ORDER BY 1
    """) or []
    prep_throughput = [{
        "date": r[0].strftime("%Y-%m-%d") if r[0] else "",
        "creadas": int(r[1] or 0),
        "finalizadas": int(r[2] or 0),
    } for r in rows]

    # ---------- Items pendientes por SKU: pedidos - despachados ----------
    # SUM por SKU de las unidades pedidas vs las que se despacharon
    rows = q(eng, """
        WITH pedidos_periodo AS (
            SELECT pdd."articuloCodigo" AS sku,
                   MAX(pdd."articuloDescripcion") AS desc,
                   SUM(pdd.unidades)::int AS uds_pedidas
            FROM digip."PedidoDetalle" pdd
            JOIN digip."Pedido" pd ON pd."Codigo" = pdd."pedidoCodigo"
            WHERE pd."Fecha" >= NOW() - make_interval(days => :days)
            GROUP BY 1
        ),
        despachados_periodo AS (
            SELECT dpd."articuloCodigo" AS sku,
                   SUM(dpd.unidades)::int AS uds_desp
            FROM digip."DespachoPedidoDetalle" dpd
            JOIN digip."DespachoPedido" dp ON dp."Codigo" = dpd."despachoPedidoCodigo"
            WHERE dp.fecha >= NOW() - make_interval(days => :days)
            GROUP BY 1
        )
        SELECT p.sku, p.desc, p.uds_pedidas,
               COALESCE(d.uds_desp, 0) AS uds_desp,
               (p.uds_pedidas - COALESCE(d.uds_desp, 0)) AS pendiente
        FROM pedidos_periodo p
        LEFT JOIN despachados_periodo d ON d.sku = p.sku
        WHERE (p.uds_pedidas - COALESCE(d.uds_desp, 0)) > 0
        ORDER BY pendiente DESC
        LIMIT 15
    """, p) or []
    items_pendientes = [{
        "category": r[0] or "(sin)",
        "value": float(r[4] or 0),
        "extra": {
            "desc": r[1] or "",
            "uds_pedidas": int(r[2] or 0),
            "uds_despachadas": int(r[3] or 0),
        },
    } for r in rows]

    # ---------- Stock por contenedor (top 15) ----------
    rows = q(eng, """
        SELECT dc."Codigo" AS contenedor,
               COALESCE(dc."areaDescripcion",'(sin area)') AS area,
               SUM(dcd.unidades)::int AS unidades,
               COUNT(DISTINCT dcd."articuloCodigo")::int AS skus
        FROM digip."DepositoContenedor" dc
        JOIN digip."DepositoContenedorDetalle" dcd ON dcd."contenedorCodigo" = dc."Codigo"
        GROUP BY 1, 2
        HAVING SUM(dcd.unidades) > 0
        ORDER BY unidades DESC
        LIMIT 15
    """) or []
    stock_por_contenedor = [{
        "category": r[0] or "(sin)",
        "value": float(r[2] or 0),
        "extra": {"area": r[1] or "", "skus": int(r[3] or 0)},
    } for r in rows]

    return {
        "period": period,
        "area": area,
        "source": "digip",
        "cards": cards,
        "funnel": funnel,
        "lead_time_daily": lead_time_daily,
        "lead_time_etapas": lead_time_etapas,
        "stock_by_area": stock_by_area,
        "stock_critico": stock_critico,
        "ajustes": ajustes,
        "stuck_orders": stuck_orders,
        "by_estado": by_estado,
        "top_skus": top_skus,
        "top_localidades": top_localidades,
        "prep_throughput": prep_throughput,
        "items_pendientes": items_pendientes,
        "stock_por_contenedor": stock_por_contenedor,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

"""
Logistica Unidrop: DigiP como cerebro (schema digip_dev en unidrop_api).

Schema descubierto 2026-05-21:
- 4 tablas: clientes, clientes_ubicaciones, pedidos, pedidos_detalles
- NO existen Despacho/Preparacion/Stock por separado - todo vive en `pedidos`
- Solo pedidos MELI: 88.6% match contra OML.number = pedidos.Codigo,
  0% contra TN (DigiP Unidrop no registra TN orders)
- Estados reales: pendiente -> preparacion -> completo, mas `eliminado` (cancel)
- pedidos.orderId esta siempre NULL (no usar para join)

OCA/LightData quedan como bloques opcionales secundarios (despachos reales
de TN), no como cerebro del funnel.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window

ESTADOS_ACTIVOS = ("pendiente", "preparacion")  # incluyen el happy path no terminado
ATASCO_DIAS = 5


def logistica_unidrop(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine("unidrop")
    p = {"days": days}
    p2 = {"days": days, "days2": days * 2}

    cards: list[dict] = []

    # ---------- KPI 1: pendientes (snapshot, no filtra por periodo) ----------
    pendientes = int(scalar(eng, """
        SELECT COUNT(*) FROM digip_dev.pedidos
        WHERE "PedidoEstado" = 'pendiente'
    """) or 0)

    # ---------- KPI 2: en preparacion (snapshot) ----------
    en_prep = int(scalar(eng, """
        SELECT COUNT(*) FROM digip_dev.pedidos
        WHERE "PedidoEstado" = 'preparacion'
    """) or 0)

    # ---------- KPI 3: completados en periodo + delta vs periodo previo ----------
    completados = int(scalar(eng, """
        SELECT COUNT(*) FROM digip_dev.pedidos
        WHERE "PedidoEstado" = 'completo'
          AND "Fecha" >= NOW() - make_interval(days => :days)
    """, p) or 0)
    completados_prev = int(scalar(eng, """
        SELECT COUNT(*) FROM digip_dev.pedidos
        WHERE "PedidoEstado" = 'completo'
          AND "Fecha" >= NOW() - make_interval(days => :days2)
          AND "Fecha" <  NOW() - make_interval(days => :days)
    """, p2) or 0)
    delta_comp = ((completados - completados_prev) / completados_prev * 100) if completados_prev > 0 else None

    # Year-over-year (DigiP Unidrop tiene poca historia, suele dar null)
    completados_yoy = int(scalar(eng, """
        SELECT COUNT(*) FROM digip_dev.pedidos
        WHERE "PedidoEstado" = 'completo'
          AND "Fecha" >= NOW() - INTERVAL '1 year' - make_interval(days => :days)
          AND "Fecha" <  NOW() - INTERVAL '1 year'
    """, p) or 0)
    delta_yoy = ((completados - completados_yoy) / completados_yoy * 100) if completados_yoy > 0 else None

    # ---------- KPI 4: eliminados en periodo (tasa de cancelacion) ----------
    eliminados = int(scalar(eng, """
        SELECT COUNT(*) FROM digip_dev.pedidos
        WHERE "PedidoEstado" = 'eliminado'
          AND "Fecha" >= NOW() - make_interval(days => :days)
    """, p) or 0)
    # tasa = eliminados / (completados + eliminados) sobre el periodo (excluye
    # los que aun estan en vuelo - mide solo decisiones terminales)
    total_terminales = completados + eliminados
    tasa_cancel = (eliminados / total_terminales * 100) if total_terminales > 0 else None

    # ---------- KPI 5: atascados (en pendiente/preparacion > 5d) ----------
    atascados = int(scalar(eng, f"""
        SELECT COUNT(*) FROM digip_dev.pedidos
        WHERE "PedidoEstado" IN ('pendiente','preparacion')
          AND "Fecha" < NOW() - INTERVAL '{ATASCO_DIAS} days'
    """) or 0)

    # ---------- KPI 6: lead time avg (Fecha -> FechaEstimadaEntrega en completos) ----------
    lead_avg = scalar(eng, """
        SELECT AVG(EXTRACT(EPOCH FROM ("FechaEstimadaEntrega" - "Fecha"))/86400.0)::float
        FROM digip_dev.pedidos
        WHERE "PedidoEstado" = 'completo'
          AND "Fecha" >= NOW() - make_interval(days => :days)
          AND "FechaEstimadaEntrega" IS NOT NULL
          AND "FechaEstimadaEntrega" >= "Fecha"
    """, p)

    from app.db import logistics_targets_db as _lt
    targets = _lt.get_map("unidrop")

    def _enrich(card: dict, kpi_key: str) -> dict:
        t = targets.get(kpi_key)
        if not t:
            return card
        try:
            v = float(card.get("value") or 0)
            target_v = float(t["target_value"])
            delta_t = ((v - target_v) / target_v * 100) if target_v else None
            card["target"] = target_v
            card["target_direction"] = t.get("direction") or "lower_is_better"
            card["delta_target"] = round(delta_t, 1) if delta_t is not None else None
        except Exception:
            pass
        return card

    cards.append(_enrich({"label": "Pedidos pendientes", "value": pendientes,
                  "hint": "DigiP: estado=pendiente"}, "pending_orders_max"))
    cards.append(_enrich({"label": "En preparacion", "value": en_prep,
                  "hint": "DigiP: estado=preparacion"}, "in_prep_max"))
    cards.append(_enrich({"label": f"Completados ({period})", "value": completados,
                  "delta": round(delta_comp, 1) if delta_comp is not None else None,
                  "delta_yoy": round(delta_yoy, 1) if delta_yoy is not None else None,
                  "delta_yoy_label": "vs hace 1 ano",
                  "hint": "DigiP: estado=completo en periodo"}, "completed_target"))
    cards.append(_enrich({"label": f"Eliminados ({period})", "value": eliminados,
                  "hint": f"Tasa cancelacion: {round(tasa_cancel,1)}%" if tasa_cancel is not None else "Sin terminales"}, "cancelled_max"))
    cards.append(_enrich({"label": "Atascados", "value": atascados,
                  "hint": f">{ATASCO_DIAS}d en pendiente/preparacion"}, "stuck_orders_max"))
    cards.append(_enrich({"label": "Lead time avg", "value": round(float(lead_avg), 1) if lead_avg else 0,
                  "suffix": " dias", "hint": "Pedido -> entrega estimada (completos)"}, "lead_time_days"))

    # ---------- Funnel: happy path 3 pasos ----------
    # Total iniciados en periodo = todos los pedidos creados en el periodo
    # (pendiente + preparacion + completo + eliminado; los eliminados quedan fuera del funnel)
    iniciados = int(scalar(eng, """
        SELECT COUNT(*) FROM digip_dev.pedidos
        WHERE "Fecha" >= NOW() - make_interval(days => :days)
          AND "PedidoEstado" != 'eliminado'
    """, p) or 0)
    en_prep_p = int(scalar(eng, """
        SELECT COUNT(*) FROM digip_dev.pedidos
        WHERE "Fecha" >= NOW() - make_interval(days => :days)
          AND "PedidoEstado" IN ('preparacion','completo')
    """, p) or 0)
    completo_p = int(scalar(eng, """
        SELECT COUNT(*) FROM digip_dev.pedidos
        WHERE "Fecha" >= NOW() - make_interval(days => :days)
          AND "PedidoEstado" = 'completo'
    """, p) or 0)

    funnel = [
        {"category": "1. Pedido recibido", "value": float(iniciados)},
        {"category": "2. En preparacion", "value": float(en_prep_p)},
        {"category": "3. Completo", "value": float(completo_p)},
    ]

    # ---------- Daily dispatch: completados por dia 60d ----------
    rows = q(eng, """
        SELECT date_trunc('day', "Fecha")::date AS d,
               COUNT(*)::int AS n
        FROM digip_dev.pedidos
        WHERE "PedidoEstado" = 'completo'
          AND "Fecha" >= NOW() - INTERVAL '60 days'
        GROUP BY 1 ORDER BY 1
    """) or []
    daily_dispatch = [{"date": r[0].strftime("%Y-%m-%d") if r[0] else "",
                       "value": float(r[1] or 0)} for r in rows]

    # ---------- Top provincias (join clientes_ubicaciones por CodigoClienteUbicacion) ----------
    # NOTA: linkage es pedidos."CodigoClienteUbicacion" -> clientes_ubicaciones."Codigo"
    rows = q(eng, """
        SELECT COALESCE(NULLIF(TRIM(cu."Provincia"),''),'(sin)') AS prov,
               COUNT(*)::int AS n,
               COALESCE(SUM(pd."Importe"),0)::float AS importe_total
        FROM digip_dev.pedidos pd
        LEFT JOIN digip_dev.clientes_ubicaciones cu
               ON cu."Codigo" = pd."CodigoClienteUbicacion"
        WHERE pd."Fecha" >= NOW() - make_interval(days => :days)
          AND pd."PedidoEstado" != 'eliminado'
        GROUP BY 1
        ORDER BY n DESC
        LIMIT 10
    """, p) or []
    top_provinces = [{
        "category": r[0],
        "value": float(r[1] or 0),
        "extra": {"importe": float(r[2] or 0)},
    } for r in rows]

    # ---------- Stuck orders (detalle) enriquecidos con OML ----------
    rows = q(eng, f"""
        SELECT pd."Codigo",
               pd."PedidoEstado",
               pd."Importe"::float,
               pd."Fecha"::text,
               EXTRACT(DAY FROM (NOW() - pd."Fecha"))::int AS dias,
               oml.status AS ml_status,
               oml."totalAmount"::float AS ml_total,
               cu."Provincia"
        FROM digip_dev.pedidos pd
        LEFT JOIN mercado_libre_dev."OrderMercadoLibre" oml
               ON oml.number = pd."Codigo"
        LEFT JOIN digip_dev.clientes_ubicaciones cu
               ON cu."Codigo" = pd."CodigoClienteUbicacion"
        WHERE pd."PedidoEstado" IN ('pendiente','preparacion')
          AND pd."Fecha" < NOW() - INTERVAL '{ATASCO_DIAS} days'
        ORDER BY pd."Fecha" ASC
        LIMIT 20
    """) or []
    stuck_orders = [{
        "category": str(r[0] or ""),
        "value": float(r[2] or r[6] or 0),  # importe DigiP, fallback OML
        "extra": {
            "id": str(r[0] or ""),  # Codigo como id - el frontend lo usa para abrir modal
            "estado": r[1] or "",
            "fecha": (r[3] or "")[:10],
            "dias_atrasado": int(r[4] or 0),
            "ml_status": r[5] or "",
            "provincia": r[7] or "",
            "payment": "ml",  # placeholder para que el frontend mantenga la col
            "status": r[1] or "",
        },
    } for r in rows]

    # ---------- Distribucion por estado (donut friendly) ----------
    rows = q(eng, """
        SELECT "PedidoEstado", COUNT(*)::int
        FROM digip_dev.pedidos
        WHERE "Fecha" >= NOW() - make_interval(days => :days)
        GROUP BY 1
        ORDER BY 2 DESC
    """, p) or []
    by_estado = [{"category": r[0] or "(sin)", "value": float(r[1] or 0)} for r in rows]

    # ---------- Top SKUs preparados (join pedidos_detalles) ----------
    rows = q(eng, """
        SELECT pdd."CodigoArticulo",
               MAX(pdd."DescripcionArticulo") AS desc,
               SUM(pdd."Unidades")::int AS uds,
               SUM(pdd."UnidadesSatisfecha")::int AS uds_ok,
               COUNT(DISTINCT pd."Codigo")::int AS pedidos
        FROM digip_dev.pedidos_detalles pdd
        JOIN digip_dev.pedidos pd ON pd.id = pdd."pedidoId"
        WHERE pd."Fecha" >= NOW() - make_interval(days => :days)
          AND pd."PedidoEstado" != 'eliminado'
        GROUP BY 1
        ORDER BY uds DESC
        LIMIT 15
    """, p) or []
    top_skus = [{
        "category": r[0] or "(sin)",
        "value": float(r[2] or 0),
        "extra": {
            "desc": r[1] or "",
            "uds_satisfechas": int(r[3] or 0),
            "pedidos": int(r[4] or 0),
        },
    } for r in rows]

    return {
        "unit": "unidrop",
        "period": period,
        "source": "digip_dev",
        "cards": cards,
        "funnel": funnel,
        "daily_dispatch": daily_dispatch,
        "top_provinces": top_provinces,
        "stuck_orders": stuck_orders,
        "by_estado": by_estado,
        "top_skus": top_skus,
        "stories": _build_stories_unidrop(
            completados=completados,
            delta_comp=delta_comp,
            eliminados=eliminados,
            tasa_cancel=tasa_cancel,
            atascados=atascados,
            pendientes=pendientes,
            period=period,
        ),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def _build_stories_unidrop(
    *,
    completados: int,
    delta_comp: float | None,
    eliminados: int,
    tasa_cancel: float | None,
    atascados: int,
    pendientes: int,
    period: str,
) -> list[dict]:
    """Stories operativas DigiP Unidrop. {tone: ok|warn|alert, text: str}."""
    stories: list[dict] = []

    if delta_comp is not None:
        if delta_comp >= 15:
            stories.append({"tone": "ok",
                            "text": f"Volumen completado +{delta_comp:.0f}% vs periodo previo ({completados} en {period})"})
        elif delta_comp <= -15:
            stories.append({"tone": "alert",
                            "text": f"Completados {delta_comp:.0f}% vs periodo previo. Posible bottleneck operativo."})

    if tasa_cancel is not None:
        if tasa_cancel >= 40:
            stories.append({"tone": "alert",
                            "text": f"Tasa de cancelacion {tasa_cancel:.0f}% ({eliminados} eliminados). Hay un problema sistemico."})
        elif tasa_cancel >= 25:
            stories.append({"tone": "warn",
                            "text": f"Tasa de cancelacion {tasa_cancel:.0f}% - encima del umbral saludable (~20%)"})

    if atascados > 30:
        stories.append({"tone": "alert",
                        "text": f"{atascados} pedidos atascados > {ATASCO_DIAS}d. Revisar bandeja DigiP."})
    elif atascados > 10:
        stories.append({"tone": "warn",
                        "text": f"{atascados} pedidos atascados > {ATASCO_DIAS}d - revisar prioridades"})

    if pendientes > 100:
        stories.append({"tone": "warn",
                        "text": f"{pendientes} pedidos en estado pendiente - capacidad de preparacion al limite"})

    return stories

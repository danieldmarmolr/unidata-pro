"""
Devoluciones (Unidev) - dashboard de RMA de Unistore Group.
Hoy todas las devoluciones cuelgan de unistore_order_id (modelo de negocio implicito = unistore).
Cuando empiece a abarcar Unidrop/Unifull se sumaran las columnas correspondientes.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}


def devoluciones(period: str = "30d", modelo: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """
    period: 7d|30d|90d|12m
    modelo: all|unistore|unidrop|unifull (filtro por modelo de negocio - hoy solo unistore aplica)
    """
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine("unidev")
    p = {"days": days}
    p2 = {"days": days, "days2": days * 2}

    # Hoy todas las devoluciones son de unistore (devolucion_items.unistore_order_id).
    # Cuando aparezcan campos para unidrop/unifull, agregar joins/filtros aca.
    modelo_filter_join = ""
    if modelo == "unistore":
        modelo_filter_join = ""  # default
    # Si pidio unidrop/unifull, todavia no hay data — devolvemos vacio implícito porque no hay rows con esos lazos.
    # Por ahora aplicamos el filtro luego en cards/series solo si modelo=='unistore' o 'all'.

    cards: list[dict] = []

    # Total devoluciones
    total = int(scalar(eng, """
        SELECT COUNT(*) FROM public.devoluciones
        WHERE fecha_creacion >= NOW() - make_interval(days => :days)
    """, p) or 0)
    total_prev = int(scalar(eng, """
        SELECT COUNT(*) FROM public.devoluciones
        WHERE fecha_creacion >= NOW() - make_interval(days => :days2)
          AND fecha_creacion <  NOW() - make_interval(days => :days)
    """, p2) or 0)
    delta = ((total - total_prev) / total_prev * 100) if total_prev > 0 else None

    cards.append({
        "label": f"Devoluciones ({period})",
        "value": total,
        "delta": round(delta, 1) if delta is not None else None,
        "hint": "Cabeceras creadas en el periodo",
    })

    # Estado general distribution → admitidas vs en proceso vs rechazadas
    admitidas = int(scalar(eng, """
        SELECT COUNT(*) FROM public.devoluciones
        WHERE fecha_creacion >= NOW() - make_interval(days => :days)
          AND estado_general ILIKE '%admit%'
    """, p) or 0)
    cards.append({"label": "Admitidas", "value": admitidas,
                  "hint": "Estado: admitida"})

    rechazadas = int(scalar(eng, """
        SELECT COUNT(*) FROM public.devoluciones
        WHERE fecha_creacion >= NOW() - make_interval(days => :days)
          AND (estado_general ILIKE '%rechaz%' OR estado_general ILIKE '%cancel%')
    """, p) or 0)
    cards.append({"label": "Rechazadas / canceladas", "value": rechazadas,
                  "hint": "estado_general"})

    # Monto reembolsado por transferencias finalizadas
    monto_transf = float(scalar(eng, """
        SELECT COALESCE(SUM(t.monto), 0)::float
        FROM public.transferencias t
        WHERE t.\"createdAt\" >= NOW() - make_interval(days => :days)
          AND t.status ILIKE '%finaliz%'
    """, p) or 0)
    cards.append({
        "label": "Reembolsado por transferencias",
        "value": round(monto_transf, 0),
        "prefix": "$ ",
        "hint": "Transferencias finalizadas",
    })

    # Cupones emitidos
    cupones_count = int(scalar(eng, """
        SELECT COUNT(*) FROM public.cupones
        WHERE fecha_emision >= NOW() - make_interval(days => :days)
    """, p) or 0)
    cupones_monto = float(scalar(eng, """
        SELECT COALESCE(SUM(monto), 0)::float FROM public.cupones
        WHERE fecha_emision >= NOW() - make_interval(days => :days)
    """, p) or 0)
    cards.append({
        "label": "Cupones emitidos",
        "value": cupones_count,
        "hint": f"$ {cupones_monto:,.0f} en monto",
    })

    # Tiempo de resolucion promedio (dias entre creacion y ultima actualizacion en estado final)
    avg_resolution = scalar(eng, """
        SELECT AVG(EXTRACT(EPOCH FROM (fecha_ultima_actualizacion - fecha_creacion))/86400.0)::float
        FROM public.devoluciones
        WHERE fecha_creacion >= NOW() - make_interval(days => :days)
          AND fecha_ultima_actualizacion IS NOT NULL
          AND fecha_ultima_actualizacion > fecha_creacion
    """, p)
    cards.append({
        "label": "Tiempo resolucion avg",
        "value": round(float(avg_resolution), 1) if avg_resolution else 0,
        "suffix": " dias",
        "hint": "creacion -> ultima actualizacion",
    })

    # ---------- Trends 12m ----------
    rows = q(eng, """
        SELECT date_trunc('month', fecha_creacion)::date,
               COUNT(*)::int,
               COUNT(*) FILTER (WHERE estado_general ILIKE '%admit%')::int
        FROM public.devoluciones
        WHERE fecha_creacion >= date_trunc('month', NOW() - INTERVAL '11 months')
        GROUP BY 1 ORDER BY 1
    """) or []
    trends = [
        {
            "label": "Total devoluciones",
            "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
        },
        {
            "label": "Admitidas",
            "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[2] or 0)} for r in rows],
        },
    ]

    # ---------- Distribucion por estado_general ----------
    rows = q(eng, """
        SELECT COALESCE(estado_general,'(sin estado)') AS st, COUNT(*)::int
        FROM public.devoluciones
        WHERE fecha_creacion >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or []
    estados = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    # ---------- Distribucion por tipo_resolucion_preferida ----------
    rows = q(eng, """
        SELECT COALESCE(tipo_resolucion_preferida,'(sin tipo)') AS tipo, COUNT(*)::int
        FROM public.devoluciones
        WHERE fecha_creacion >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or []
    resoluciones = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    # ---------- Tipo devolucion (presencial / a domicilio / etc) ----------
    rows = q(eng, """
        SELECT COALESCE(tipo_devolucion,'(sin tipo)') AS tipo, COUNT(*)::int
        FROM public.devoluciones
        WHERE fecha_creacion >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or []
    tipos_dev = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    # ---------- Top motivos de falla ----------
    rows = q(eng, """
        SELECT COALESCE(f.descripcion,'(sin descripcion)') AS motivo,
               SUM(f.canitdad)::int AS cant_total,
               COUNT(DISTINCT f.devolucion_item_id)::int AS items_afectados
        FROM public.devolucion_items_fallas f
        GROUP BY 1 ORDER BY cant_total DESC LIMIT 15
    """) or []
    top_motivos = [{
        "category": r[0],
        "value": float(r[1] or 0),
        "extra": {"items": int(r[2] or 0)},
    } for r in rows]

    # ---------- Top SKUs devueltos ----------
    rows = q(eng, """
        SELECT COALESCE(di.sku,'(sin SKU)') AS sku,
               COUNT(*)::int AS cant_items,
               SUM(di.cantidad_solicitada)::int AS unidades,
               COALESCE(SUM(di.monto_unitario * di.cantidad_solicitada),0)::float AS monto_total
        FROM public.devolucion_items di
        JOIN public.devoluciones d ON d.devolucion_id = di.devolucion_id
        WHERE d.fecha_creacion >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY unidades DESC LIMIT 15
    """, p) or []
    top_skus = [{
        "category": r[0],
        "value": float(r[2] or 0),  # unidades
        "extra": {"items": int(r[1] or 0), "monto": float(r[3] or 0)},
    } for r in rows]

    # ---------- Listado de devoluciones recientes ----------
    rows = q(eng, """
        SELECT d.devolucion_id, d.user_id, d.estado_general, d.tipo_resolucion_preferida,
               d.tipo_devolucion, d.fecha_creacion::text,
               EXTRACT(DAY FROM (NOW() - d.fecha_creacion))::int AS dias,
               COALESCE(d.monto_aprobado, d.monto_estimado, 0)::float AS monto
        FROM public.devoluciones d
        ORDER BY d.fecha_creacion DESC LIMIT 25
    """) or []
    recent = [{
        "category": r[0] or "?",
        "value": float(r[7] or 0),
        "extra": {
            "user_id": int(r[1] or 0) if r[1] else 0,
            "estado": r[2] or "",
            "resolucion": r[3] or "",
            "tipo": r[4] or "",
            "fecha": r[5][:10] if r[5] else None,
            "dias_abierta": int(r[6] or 0),
        },
    } for r in rows]

    # ---------- Estadisticas de transferencias ----------
    rows = q(eng, """
        SELECT COALESCE(t.status,'?') AS st, COUNT(*)::int, COALESCE(SUM(t.monto),0)::float
        FROM public.transferencias t
        WHERE t."createdAt" >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or []
    transferencias_stats = [{
        "category": r[0],
        "value": float(r[1] or 0),
        "extra": {"monto": float(r[2] or 0)},
    } for r in rows]

    return {
        "period": period,
        "modelo": modelo,
        "cards": cards,
        "trends": trends,
        "estados": estados,
        "resoluciones": resoluciones,
        "tipos_dev": tipos_dev,
        "top_motivos": top_motivos,
        "top_skus": top_skus,
        "recent": recent,
        "transferencias_stats": transferencias_stats,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

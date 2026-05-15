"""
End Consumer 360 - UNIDROP.

Los CLIENTES FINALES de Unidrop son las personas que compran a los dropshippers
(no los dropshippers en si, que son nuestros propios clientes / usuarios de la
plataforma).

Fuente: public.tienda_nube_orders en la BBDD unidrop_api.
Pivot: contact_identification (DNI) - es el identificador unico del comprador
       en TN orders. Si un mismo DNI compra a varios dropshippers, queremos
       verlo todo agregado.

Limitacion conocida: las ordenes MELI (mercado_libre_dev.OrderMercadoLibre) NO
guardan info del comprador (solo sellerId = dropshipper). Por eso esta vista
360 cubre SOLO la pata TN de Unidrop. Cuando MELI exponga el buyer agregamos.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from app.db.engines import get_engine
from app.services._utils import q


def end_consumer_detail_unidrop(dni: str) -> dict[str, Any]:
    """Vista 360 del cliente final por DNI.

    Devuelve info de identidad + LTV + orders + cross-dropshippers + provincias
    + ultimas ordenes. Todo desde unidrop_api/public.tienda_nube_orders.
    """
    eng = get_engine("unidrop")
    dni_clean = (dni or "").strip()
    if not dni_clean:
        return {"dni": dni, "found": False}

    # 1) Identidad + LTV agregado
    head = q(eng, """
        SELECT
            COALESCE(MAX(billing_name),'(sin nombre)') AS nombre,
            COALESCE(MAX(billing_email),'') AS email,
            COALESCE(MAX(billing_phone),'') AS telefono,
            COALESCE(MAX(billing_province),'') AS provincia,
            COALESCE(MAX(billing_city),'') AS ciudad,
            COUNT(*)::int AS ordenes_totales,
            COUNT(*) FILTER (WHERE payment_status::text='paid')::int AS ordenes_pagas,
            COUNT(*) FILTER (WHERE payment_status::text IN ('pending','authorized'))::int AS ordenes_pendientes,
            COUNT(*) FILTER (WHERE status::text='cancelled')::int AS ordenes_canceladas,
            COALESCE(SUM(total) FILTER (WHERE payment_status::text='paid'),0)::float AS ltv,
            COALESCE(AVG(total) FILTER (WHERE payment_status::text='paid'),0)::float AS ticket_promedio,
            MAX(total) FILTER (WHERE payment_status::text='paid')::float AS max_order,
            MIN(created_at) FILTER (WHERE payment_status::text='paid')::text AS primera_compra,
            MAX(created_at) FILTER (WHERE payment_status::text='paid')::text AS ultima_compra,
            COUNT(DISTINCT user_id)::int AS dropshippers_distintos
        FROM public.tienda_nube_orders
        WHERE contact_identification = :dni
    """, {"dni": dni_clean}) or []

    if not head or not head[0] or int(head[0][5] or 0) == 0:
        return {"dni": dni_clean, "found": False}

    h = head[0]
    consumer = {
        "dni": dni_clean,
        "nombre": h[0],
        "email": h[1],
        "telefono": h[2],
        "provincia": h[3],
        "ciudad": h[4],
    }
    totals = {
        "ordenes_totales": int(h[5] or 0),
        "ordenes_pagas": int(h[6] or 0),
        "ordenes_pendientes": int(h[7] or 0),
        "ordenes_canceladas": int(h[8] or 0),
        "ltv": round(float(h[9] or 0), 0),
        "ticket_promedio": round(float(h[10] or 0), 0),
        "max_order": round(float(h[11] or 0), 0),
        "primera_compra": h[12],
        "ultima_compra": h[13],
        "dropshippers_distintos": int(h[14] or 0),
    }

    # 2) Dropshippers a los que les compro este consumidor (cross-stores)
    drops = q(eng, """
        SELECT
            tno.user_id::int AS user_id,
            COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, ('User #' || tno.user_id::text)) AS dropshipper,
            COUNT(*) FILTER (WHERE tno.payment_status::text='paid')::int AS ordenes_pagas,
            COALESCE(SUM(tno.total) FILTER (WHERE tno.payment_status::text='paid'),0)::float AS revenue,
            MAX(tno.created_at) FILTER (WHERE tno.payment_status::text='paid')::text AS ultima_compra
        FROM public.tienda_nube_orders tno
        LEFT JOIN public."User" u ON u.id = tno.user_id
        WHERE tno.contact_identification = :dni
        GROUP BY tno.user_id, u.fantasy_name, u.name, u.email
        ORDER BY revenue DESC
        LIMIT 20
    """, {"dni": dni_clean}) or []
    dropshippers = [{
        "category": r[1] or f"User #{r[0]}",
        "value": float(r[3] or 0),
        "extra": {
            "user_id": int(r[0] or 0),
            "ordenes": int(r[2] or 0),
            "ultima_compra": (r[4] or "")[:10] if r[4] else None,
        },
    } for r in drops]

    # 3) Ultimas ordenes
    orders = q(eng, """
        SELECT
            tno.tienda_nube_id,
            tno.order_number,
            tno.created_at::text,
            tno.total::float,
            tno.payment_status::text,
            tno.status::text,
            tno.user_id::int,
            COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, ('User #' || tno.user_id::text)) AS dropshipper,
            COALESCE(tno.billing_province,'') AS provincia
        FROM public.tienda_nube_orders tno
        LEFT JOIN public."User" u ON u.id = tno.user_id
        WHERE tno.contact_identification = :dni
        ORDER BY tno.created_at DESC NULLS LAST
        LIMIT 40
    """, {"dni": dni_clean}) or []
    ordenes = [{
        "id": int(r[0]) if r[0] else None,
        "numero": str(r[1] or r[0] or ""),
        "fecha": (r[2] or "")[:10] if r[2] else "",
        "total": float(r[3] or 0),
        "payment_status": r[4] or "",
        "status": r[5] or "",
        "user_id": int(r[6] or 0),
        "dropshipper": r[7] or "",
        "provincia": r[8] or "",
    } for r in orders]

    # 4) Distribucion por provincia (multi-envio)
    provs = q(eng, """
        SELECT
            COALESCE(NULLIF(TRIM(billing_province),''),'(sin provincia)') AS prov,
            COUNT(*) FILTER (WHERE payment_status::text='paid')::int AS ordenes,
            COALESCE(SUM(total) FILTER (WHERE payment_status::text='paid'),0)::float AS revenue
        FROM public.tienda_nube_orders
        WHERE contact_identification = :dni
        GROUP BY 1
        ORDER BY 3 DESC
        LIMIT 10
    """, {"dni": dni_clean}) or []
    provincias = [{
        "category": r[0],
        "value": float(r[2] or 0),
        "extra": {"ordenes": int(r[1] or 0)},
    } for r in provs]

    return {
        "found": True,
        "consumer": consumer,
        "totals": totals,
        "dropshippers": dropshippers,
        "ordenes": ordenes,
        "provincias": provincias,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def top_end_consumers_for_dropshipper(user_id: int, period_days: int = 365, limit: int = 20) -> list[dict]:
    """Top clientes finales del dropshipper — TN + ML combinados.

    Los compradores TN se identifican por DNI (contact_identification). Los
    compradores ML por buyerId numerico (Meli no expone DNI). Ambos canales
    se muestran en la misma tabla con un campo "canal" para distinguir.

    Para usar como tabla en Dropshipper 360 con drill a End Consumer 360
    (solo TN, los ML no tienen perfil en nuestra DB todavia).
    """
    eng = get_engine("unidrop")

    tn_rows = q(eng, """
        SELECT
            contact_identification AS dni,
            COALESCE(MAX(billing_name),'(sin nombre)') AS nombre,
            COALESCE(MAX(billing_province),'') AS provincia,
            COUNT(*) FILTER (WHERE payment_status::text='paid')::int AS ordenes,
            COALESCE(SUM(total) FILTER (WHERE payment_status::text='paid'),0)::float AS revenue
        FROM public.tienda_nube_orders
        WHERE user_id = :uid
          AND contact_identification IS NOT NULL
          AND TRIM(contact_identification) <> ''
          AND created_at >= NOW() - make_interval(days => :d)
        GROUP BY contact_identification
        HAVING COUNT(*) FILTER (WHERE payment_status::text='paid') > 0
        ORDER BY revenue DESC
        LIMIT :limit
    """, {"uid": int(user_id), "d": int(period_days), "limit": int(limit)}) or []

    ml_rows = q(eng, """
        SELECT
            "buyerId"::text AS buyer_id,
            COALESCE(MAX(buyer_name), '(sin nombre)') AS nombre,
            COUNT(*) FILTER (WHERE "paidAmount" > 0)::int AS ordenes,
            COALESCE(SUM("totalAmount") FILTER (WHERE "paidAmount" > 0), 0)::float AS revenue
        FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE "userId" = :uid
          AND "buyerId" IS NOT NULL
          AND "dateCreated" >= NOW() - make_interval(days => :d)
        GROUP BY "buyerId"
        HAVING COUNT(*) FILTER (WHERE "paidAmount" > 0) > 0
        ORDER BY revenue DESC
        LIMIT :limit
    """, {"uid": int(user_id), "d": int(period_days), "limit": int(limit)}) or []

    out: list[dict] = []
    for r in tn_rows:
        out.append({
            "category": r[1] or f"DNI {r[0]}",
            "value": float(r[4] or 0),
            "extra": {
                "canal": "TN",
                "dni": r[0],
                "provincia": r[2],
                "ordenes": int(r[3] or 0),
                "unidrop_consumer": True,
            },
        })
    for r in ml_rows:
        out.append({
            "category": r[1] or f"ML buyer {r[0]}",
            "value": float(r[3] or 0),
            "extra": {
                "canal": "ML",
                "buyer_id": r[0],
                "ordenes": int(r[2] or 0),
                "unidrop_consumer": False,
            },
        })
    out.sort(key=lambda x: x["value"], reverse=True)
    return out[:limit]

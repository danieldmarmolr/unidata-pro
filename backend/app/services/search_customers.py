"""
Busqueda rapida de clientes:
- Unistore: tienda_nube."Customer" por nombre / email / telefono / DNI (en
  realidad TN no tiene DNI, pero buscamos por id tambien).
- Unidrop: public."User" (los dropshippers) por nombre / fantasy_name / email
  / DNI / cuit.

Ambas funciones soportan filtro de periodo: si se pasa una ventana, solo
devuelven clientes que tuvieron actividad (orden paga) en esa ventana.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, resolve_window


def search_unistore_customers(
    query: str,
    *,
    period: str = "12m",
    from_iso: str | None = None,
    to_iso: str | None = None,
    only_active_in_period: bool = False,
    limit: int = 50,
) -> dict:
    """Busca customers Unistore por texto libre.

    only_active_in_period=True restringe a los que tuvieron orden paga en
    la ventana. Sino devuelve cualquier customer que matchee.
    """
    eng = get_engine("unistore")
    qstr = (query or "").strip()
    if not qstr:
        return {"rows": [], "total": 0, "query": "", "generated_at": dt.datetime.now(dt.timezone.utc).isoformat()}

    days = resolve_window(period, from_iso, to_iso)["days"]

    # Si el query es numerico y razonablemente corto, tambien buscamos por id exacto.
    id_candidate = None
    try:
        if qstr.isdigit() and len(qstr) <= 12:
            id_candidate = int(qstr)
    except ValueError:
        pass

    # Si solo queremos los que compraron en la ventana, agregamos EXISTS.
    period_filter = ""
    if only_active_in_period:
        period_filter = (
            " AND EXISTS ("
            "  SELECT 1 FROM tienda_nube.\"Order\" o2 "
            "  WHERE o2.\"customerId\" = c.id "
            "    AND o2.\"paymentStatus\" = 'paid' "
            "    AND o2.\"createdAt\" >= NOW() - make_interval(days => :d)"
            ") "
        )

    rows = q(eng, f"""
        SELECT c.id,
               COALESCE(NULLIF(TRIM(c.name),''), '(sin nombre)') AS nombre,
               COALESCE(c.email,'') AS email,
               COALESCE(c.phone,'') AS telefono,
               COALESCE(c."billingProvince",'') AS provincia,
               COALESCE(c."billingCity",'') AS ciudad,
               COALESCE(c."totalSpent",0)::float AS lifetime_spent,
               COALESCE((
                  SELECT COUNT(*) FROM tienda_nube."Order" o
                  WHERE o."customerId" = c.id AND o."paymentStatus" = 'paid'
               ),0)::int AS ordenes_pagas_lifetime,
               COALESCE((
                  SELECT COUNT(*) FROM tienda_nube."Order" o
                  WHERE o."customerId" = c.id
                    AND o."paymentStatus" = 'paid'
                    AND o."createdAt" >= NOW() - make_interval(days => :d)
               ),0)::int AS ordenes_periodo,
               COALESCE((
                  SELECT SUM(o.total)::float FROM tienda_nube."Order" o
                  WHERE o."customerId" = c.id
                    AND o."paymentStatus" = 'paid'
                    AND o."createdAt" >= NOW() - make_interval(days => :d)
               ),0)::float AS revenue_periodo,
               (
                  SELECT MAX(o."createdAt")::text FROM tienda_nube."Order" o
                  WHERE o."customerId" = c.id AND o."paymentStatus" = 'paid'
               ) AS ultima_compra
        FROM tienda_nube."Customer" c
        WHERE (
              c.name ILIKE :pat
           OR c.email ILIKE :pat
           OR c.phone ILIKE :pat
           OR ({'c.id = :cid' if id_candidate is not None else 'FALSE'})
        )
        {period_filter}
        ORDER BY lifetime_spent DESC NULLS LAST
        LIMIT :lim
    """, {
        "pat": f"%{qstr}%",
        "cid": id_candidate if id_candidate is not None else 0,
        "d": int(days),
        "lim": int(limit),
    }) or []

    out = [{
        "id": int(r[0] or 0),
        "nombre": r[1],
        "email": r[2],
        "telefono": r[3],
        "provincia": r[4],
        "ciudad": r[5],
        "lifetime_spent": float(r[6] or 0),
        "ordenes_pagas_lifetime": int(r[7] or 0),
        "ordenes_periodo": int(r[8] or 0),
        "revenue_periodo": float(r[9] or 0),
        "ultima_compra": (r[10] or "")[:10] if r[10] else None,
    } for r in rows]

    return {
        "rows": out,
        "total": len(out),
        "query": qstr,
        "period_days": days,
        "only_active_in_period": only_active_in_period,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def search_unidrop_dropshippers(
    query: str,
    *,
    period: str = "12m",
    from_iso: str | None = None,
    to_iso: str | None = None,
    only_active_in_period: bool = False,
    limit: int = 50,
) -> dict:
    """Busca dropshippers Unidrop (los usuarios de la plataforma) por texto.

    Matchea por: nombre, fantasy_name (nombre comercial), email, dni, cuit.
    """
    eng = get_engine("unidrop")
    qstr = (query or "").strip()
    if not qstr:
        return {"rows": [], "total": 0, "query": "", "generated_at": dt.datetime.now(dt.timezone.utc).isoformat()}

    days = resolve_window(period, from_iso, to_iso)["days"]

    id_candidate = None
    try:
        if qstr.isdigit() and len(qstr) <= 12:
            id_candidate = int(qstr)
    except ValueError:
        pass

    # Solo activos en ventana = tienen al menos 1 orden TN o MELI paga
    period_filter = ""
    if only_active_in_period:
        period_filter = (
            " AND ("
            "  EXISTS ("
            "    SELECT 1 FROM public.tienda_nube_orders tno "
            "    WHERE tno.user_id = u.id "
            "      AND tno.payment_status::text = 'paid' "
            "      AND tno.created_at >= NOW() - make_interval(days => :d)"
            "  ) OR EXISTS ("
            "    SELECT 1 FROM mercado_libre_dev.\"OrderMercadoLibre\" mo "
            "    JOIN mercado_libre_dev.\"MercadoLibreUserAccount\" mla "
            "      ON mla.\"mlUserId\"::text = mo.\"sellerId\"::text "
            "    WHERE mla.\"userId\" = u.id "
            "      AND mo.\"dateCreated\" >= NOW() - make_interval(days => :d) "
            "      AND mo.status IN ('paid','confirmed','shipped','delivered')"
            "  )"
            ") "
        )

    rows = q(eng, f"""
        SELECT u.id,
               COALESCE(NULLIF(u.fantasy_name,''), NULLIF(u.name,''), '(sin nombre)') AS nombre,
               COALESCE(NULLIF(u.fantasy_name,''),'') AS fantasy_name,
               COALESCE(u.email,'') AS email,
               COALESCE(u.phone,'') AS telefono,
               COALESCE(u.dni,'') AS dni,
               COALESCE(u.cuit,'') AS cuit,
               u."createdAt"::text AS fecha_alta,
               u.end_date_subscription::text AS vence_suscripcion,
               COALESCE((
                  SELECT COUNT(*) FROM public.tienda_nube_orders tno
                  WHERE tno.user_id = u.id
                    AND tno.payment_status::text='paid'
                    AND tno.created_at >= NOW() - make_interval(days => :d)
               ),0)::int AS tn_ordenes_periodo,
               COALESCE((
                  SELECT SUM(tno.total)::float FROM public.tienda_nube_orders tno
                  WHERE tno.user_id = u.id
                    AND tno.payment_status::text='paid'
                    AND tno.created_at >= NOW() - make_interval(days => :d)
               ),0)::float AS tn_revenue_periodo,
               COALESCE((
                  SELECT COUNT(*) FROM mercado_libre_dev."OrderMercadoLibre" mo
                  JOIN mercado_libre_dev."MercadoLibreUserAccount" mla
                    ON mla."mlUserId"::text = mo."sellerId"::text
                  WHERE mla."userId" = u.id
                    AND mo."dateCreated" >= NOW() - make_interval(days => :d)
                    AND mo.status IN ('paid','confirmed','shipped','delivered')
               ),0)::int AS ml_ordenes_periodo
        FROM public."User" u
        WHERE (
              u.name ILIKE :pat
           OR u.fantasy_name ILIKE :pat
           OR u.email ILIKE :pat
           OR u.phone ILIKE :pat
           OR u.dni ILIKE :pat
           OR u.cuit ILIKE :pat
           OR ({'u.id = :uid' if id_candidate is not None else 'FALSE'})
        )
        {period_filter}
        ORDER BY (tn_revenue_periodo) DESC NULLS LAST, u."createdAt" DESC NULLS LAST
        LIMIT :lim
    """, {
        "pat": f"%{qstr}%",
        "uid": id_candidate if id_candidate is not None else 0,
        "d": int(days),
        "lim": int(limit),
    }) or []

    out = [{
        "id": int(r[0] or 0),
        "nombre": r[1],
        "fantasy_name": r[2],
        "email": r[3],
        "telefono": r[4],
        "dni": r[5],
        "cuit": r[6],
        "fecha_alta": (r[7] or "")[:10] if r[7] else None,
        "vence_suscripcion": (r[8] or "")[:10] if r[8] else None,
        "tn_ordenes_periodo": int(r[9] or 0),
        "tn_revenue_periodo": float(r[10] or 0),
        "ml_ordenes_periodo": int(r[11] or 0),
    } for r in rows]

    return {
        "rows": out,
        "total": len(out),
        "query": qstr,
        "period_days": days,
        "only_active_in_period": only_active_in_period,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

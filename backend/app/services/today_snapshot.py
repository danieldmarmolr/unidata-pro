"""
Comparador HOY: para cada KPI calcula su valor en HOY (CURRENT_DATE),
hace 7 dias (mismo dia de la semana anterior), hace 30 dias, hace 365 dias.

Cada bloque devuelve {label, today, w_ago, m_ago, y_ago, deltas %}
"""
from __future__ import annotations

import datetime as dt
import logging

from app.db.engines import get_engine
from app.services._utils import scalar

log = logging.getLogger("unidata.today")

ANCHORS_DAYS = {
    "today": 0,
    "w_ago": 7,
    "m_ago": 30,
    "y_ago": 365,
}


def _kpi_block(label: str, values: dict[str, float], *, prefix: str = "", suffix: str = "", hint: str = "") -> dict:
    base = values.get("today", 0) or 0
    out = {
        "label": label,
        "prefix": prefix,
        "suffix": suffix,
        "hint": hint,
        "today": round(base, 0),
        "anchors": [],
    }
    for k in ("w_ago", "m_ago", "y_ago"):
        v = values.get(k, 0) or 0
        delta = ((base - v) / v * 100) if v > 0 else None
        out["anchors"].append({
            "key": k,
            "label": {"w_ago": "hace 7 dias", "m_ago": "hace 30 dias", "y_ago": "hace 1 ano"}[k],
            "value": round(v, 0),
            "delta_pct": round(delta, 1) if delta is not None else None,
        })
    return out


def today_snapshot(unit: str | None = None) -> dict:
    """Snapshot HOY vs 7d/30d/365d.

    - Si unit es None: muestra TODOS los KPIs (vista cross-unidad / Gerencial).
    - Si unit='unistore': solo Unistore (incluye Devoluciones/Unidev por ser parte del dominio).
    - Si unit='unidrop': solo Unidrop.
    """
    show_unistore = unit in (None, "unistore")
    show_unidrop = unit in (None, "unidrop")
    show_unidev = unit in (None, "unistore")  # Unidev pertenece al dominio Unistore

    uni = get_engine("unistore") if show_unistore else None
    drop = get_engine("unidrop") if show_unidrop else None

    blocks: list[dict] = []

    # === Bloques de UNISTORE ===
    if show_unistore and uni is not None:
        # --- GMV Unistore (TN paid + ML paid/conf/ship/del) por dia ---
        def gmv_for_day(days_back: int) -> float:
            tn = float(scalar(uni, """
                SELECT COALESCE(SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END),0)
                FROM tienda_nube."Order"
                WHERE "createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)
            ml = float(scalar(uni, """
                SELECT COALESCE(SUM(COALESCE(total_amount,0)),0)
                FROM meli.meli_orders
                WHERE date_created::date = (CURRENT_DATE - CAST(:d AS integer))
                  AND status IN ('paid','confirmed','shipped','delivered')
            """, {"d": days_back}) or 0)
            return tn + ml

        blocks.append(_kpi_block(
            "GMV Unistore",
            {k: gmv_for_day(d) for k, d in ANCHORS_DAYS.items()},
            prefix="$ ",
            hint="TN paid + ML paid/confirmed/shipped/delivered",
        ))

        # --- Ordenes Unistore por dia ---
        def orders_for_day(days_back: int) -> float:
            tn = int(scalar(uni, """
                SELECT COUNT(*) FROM tienda_nube."Order"
                WHERE "createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)
            ml = int(scalar(uni, """
                SELECT COUNT(*) FROM meli.meli_orders
                WHERE date_created::date = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)
            return tn + ml

        blocks.append(_kpi_block(
            "Ordenes Unistore",
            {k: orders_for_day(d) for k, d in ANCHORS_DAYS.items()},
            hint="TN + ML del dia",
        ))

        # --- AOV Unistore (TN paid del dia) ---
        def aov_for_day(days_back: int) -> float:
            return float(scalar(uni, """
                SELECT COALESCE(AVG(NULLIF(total,0)),0)
                FROM tienda_nube."Order"
                WHERE "createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
                  AND "paymentStatus"='paid'
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Ticket promedio (TN)",
            {k: aov_for_day(d) for k, d in ANCHORS_DAYS.items()},
            prefix="$ ",
            hint="AOV de TN paid",
        ))

    # === Bloques de UNIDROP ===
    if show_unidrop and drop is not None:
        # --- Pagos Talo Unidrop por dia ---
        def talo_for_day(days_back: int) -> float:
            return float(scalar(drop, """
                SELECT COALESCE(SUM(amount),0)
                FROM public."PaymentTransaction"
                WHERE "createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
                  AND status::text IN ('completed','succeeded','approved','paid','PROCESSED','processed')
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Pagos Talo (Unidrop)",
            {k: talo_for_day(d) for k, d in ANCHORS_DAYS.items()},
            prefix="$ ",
            hint="Volumen procesado en el dia",
        ))

        # --- Usuarios nuevos Unidrop por dia ---
        def new_users_for_day(days_back: int) -> float:
            return int(scalar(drop, """
                SELECT COUNT(*) FROM public."User"
                WHERE "createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Usuarios nuevos (Unidrop)",
            {k: new_users_for_day(d) for k, d in ANCHORS_DAYS.items()},
            hint="Altas del dia",
        ))

    # === Bloque de UNIDEV (parte del dominio Unistore) ===
    if show_unidev:
        try:
            dev = get_engine("unidev")
            def dev_for_day(days_back: int) -> float:
                return int(scalar(dev, """
                    SELECT COUNT(*) FROM public.devoluciones
                    WHERE fecha_creacion::date = (CURRENT_DATE - CAST(:d AS integer))
                """, {"d": days_back}) or 0)
            blocks.append(_kpi_block(
                "Devoluciones (Unidev)",
                {k: dev_for_day(d) for k, d in ANCHORS_DAYS.items()},
                hint="Casos abiertos del dia",
            ))
        except Exception as e:
            log.warning("dev snapshot fail: %s", e)

    return {
        "level": "today",
        "today_date": dt.date.today().isoformat(),
        "blocks": blocks,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

"""
RFM Segmentation - Recency, Frequency, Monetary scoring.

Calcula por cada cliente:
- Recency (R): cuantos dias desde ultima compra (menor = mejor)
- Frequency (F): cuantas ordenes paid totales (mayor = mejor)
- Monetary (M): facturacion total (mayor = mejor)

Asigna scores 1-5 por cada dimension usando quintiles, luego categoriza
en segmentos clasicos:
- Champions: R>=4 F>=4 M>=4 (los mejores)
- Loyal: R>=3 F>=4 (frecuentes)
- Potential Loyalist: R>=4 F<=3 M>=2 (recientes, pueden crecer)
- New Customers: R>=4 F=1 (acaban de llegar)
- Promising: R>=3 F<=2 M>=2 (interes inicial)
- Need Attention: R 2-3, F 2-3 (clientes en riesgo)
- About to Sleep: R 2-3 F<=2 (perdiendo interes)
- At Risk: R<=2 F>=3 M>=3 (eran buenos, se estan yendo)
- Cant Lose: R<=1 F>=4 M>=4 (mejores que se fueron)
- Hibernating: R<=2 F<=2 M<=2 (probablemente perdidos)
- Lost: R=1 F=1 (perdidos)
"""
from __future__ import annotations

import datetime as dt
import logging

from app.utils.tz import today_ar, now_ar
from app.db.engines import get_engine
from app.services._utils import q

log = logging.getLogger("unidata.rfm")


SEGMENTS = {
    "champions":          {"label": "Champions",         "color": "#10b981", "icon": "👑", "desc": "Los mejores: compran seguido y mucho"},
    "loyal":              {"label": "Leales",            "color": "#3b82f6", "icon": "💎", "desc": "Compras frecuentes recientes"},
    "potential_loyalist": {"label": "Potencial Leal",    "color": "#06b6d4", "icon": "✨", "desc": "Recientes con valor creciente"},
    "new":                {"label": "Nuevos",            "color": "#a259ff", "icon": "🆕", "desc": "Primera compra reciente"},
    "promising":          {"label": "Prometedores",      "color": "#8b5cf6", "icon": "🌱", "desc": "Interes inicial saludable"},
    "need_attention":     {"label": "Atencion",          "color": "#f59e0b", "icon": "⚠️", "desc": "En riesgo de perderlos"},
    "about_to_sleep":     {"label": "Dormidos",          "color": "#fb923c", "icon": "😴", "desc": "Perdiendo interes"},
    "at_risk":            {"label": "En riesgo",         "color": "#ef4444", "icon": "🚨", "desc": "Eran buenos pero se alejan"},
    "cant_lose":          {"label": "No perder",         "color": "#dc2626", "icon": "🆘", "desc": "Top que dejaron de comprar"},
    "hibernating":        {"label": "Hibernando",        "color": "#94a3b8", "icon": "❄️", "desc": "Probablemente perdidos"},
    "lost":               {"label": "Perdidos",          "color": "#475569", "icon": "💀", "desc": "Compraron una vez hace mucho"},
}


def _classify_segment(r: int, f: int, m: int) -> str:
    """Mapeo RFM scores 1-5 a segmento."""
    if r >= 4 and f >= 4 and m >= 4:
        return "champions"
    if r >= 4 and f == 1:
        return "new"
    if r >= 4 and f <= 2 and m >= 2:
        return "potential_loyalist"
    if r >= 3 and f >= 4:
        return "loyal"
    if r >= 3 and f <= 2 and m >= 2:
        return "promising"
    if r <= 1 and f >= 4 and m >= 4:
        return "cant_lose"
    if r <= 2 and f >= 3 and m >= 3:
        return "at_risk"
    if r <= 2 and f <= 2 and m <= 2:
        return "hibernating"
    if r in (2, 3) and f <= 2:
        return "about_to_sleep"
    if r in (2, 3) and f in (2, 3):
        return "need_attention"
    if r == 1 and f == 1:
        return "lost"
    return "need_attention"


def _quintile_score(value: float, sorted_values: list[float], higher_is_better: bool = True) -> int:
    """Devuelve score 1-5 basado en quintiles (1 bajo, 5 alto)."""
    if not sorted_values:
        return 1
    n = len(sorted_values)
    # Indice de este value
    pos = 0
    for v in sorted_values:
        if v <= value:
            pos += 1
        else:
            break
    pct = pos / n
    score = max(1, min(5, int(pct * 5) + 1))
    return score if higher_is_better else (6 - score)


def rfm_overview(period_days: int = 365) -> dict:
    """Calcula RFM para todos los clientes con compras en los ultimos N dias."""
    eng = get_engine("unistore")
    today = today_ar()

    rows = q(eng, """
        SELECT
            c.id,
            COALESCE(c.name, c.email, 'Customer ' || c.id::text) AS nombre,
            COUNT(o.id)::int AS frecuencia,
            SUM(o.total)::float AS monetario,
            MAX(o."createdAt")::date AS ultima_compra,
            MIN(o."createdAt")::date AS primera_compra
        FROM tienda_nube."Customer" c
        INNER JOIN tienda_nube."Order" o ON o."customerId" = c.id
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(days => :d)
        GROUP BY c.id, c.name, c.email
        HAVING COUNT(o.id) > 0
    """, {"d": period_days}) or []

    if not rows:
        return _empty_response()

    # Calcular metricas raw
    customers = []
    for r in rows:
        cid, nombre, freq, monto, ultima, primera = r
        recency_days = (today - ultima).days if ultima else 9999
        customers.append({
            "customer_id": int(cid),
            "nombre": nombre,
            "recency_days": recency_days,
            "frequency": int(freq or 0),
            "monetary": float(monto or 0),
            "ultima_compra": ultima.isoformat() if ultima else None,
            "primera_compra": primera.isoformat() if primera else None,
        })

    # Sortear para quintiles
    rec_sorted = sorted([c["recency_days"] for c in customers], reverse=True)  # mayor recency_days = peor (escala invertida)
    freq_sorted = sorted([c["frequency"] for c in customers])
    mon_sorted = sorted([c["monetary"] for c in customers])

    # Asignar scores
    seg_counts: dict[str, dict] = {k: {"count": 0, "monetary": 0.0, "frequency": 0, "label": v["label"], "color": v["color"], "icon": v["icon"], "desc": v["desc"]} for k, v in SEGMENTS.items()}
    customers_by_seg: dict[str, list[dict]] = {k: [] for k in SEGMENTS.keys()}

    for c in customers:
        # R: menos dias = mejor → invertir (rec_sorted ya esta DESC para que pos pequeño = pocos dias)
        # Truco: invertir la formula para R
        r_score = max(1, min(5, 6 - _quintile_score(c["recency_days"], sorted(rec_sorted), True)))
        f_score = _quintile_score(c["frequency"], freq_sorted, True)
        m_score = _quintile_score(c["monetary"], mon_sorted, True)

        seg = _classify_segment(r_score, f_score, m_score)
        c["r_score"] = r_score
        c["f_score"] = f_score
        c["m_score"] = m_score
        c["segment"] = seg

        seg_counts[seg]["count"] += 1
        seg_counts[seg]["monetary"] += c["monetary"]
        seg_counts[seg]["frequency"] += c["frequency"]
        customers_by_seg[seg].append(c)

    # Top customers por segmento (10 max)
    top_by_seg = {
        k: sorted(v, key=lambda x: -x["monetary"])[:10]
        for k, v in customers_by_seg.items() if v
    }

    # Construir array de segmentos
    seg_arr = []
    total_customers = len(customers)
    for key, data in seg_counts.items():
        if data["count"] == 0:
            continue
        seg_arr.append({
            "key": key,
            "label": data["label"],
            "color": data["color"],
            "icon": data["icon"],
            "desc": data["desc"],
            "customers": data["count"],
            "pct_total": round((data["count"] / total_customers * 100), 2),
            "monetary_total": round(data["monetary"], 2),
            "frequency_total": data["frequency"],
            "ticket_avg": round(data["monetary"] / data["frequency"], 2) if data["frequency"] else 0,
        })
    seg_arr.sort(key=lambda x: -x["monetary_total"])

    return {
        "period_days": period_days,
        "totals": {
            "customers": total_customers,
            "monetary": round(sum(c["monetary"] for c in customers), 2),
            "frequency": sum(c["frequency"] for c in customers),
            "avg_recency_days": round(sum(c["recency_days"] for c in customers) / total_customers, 1),
        },
        "segments": seg_arr,
        "top_by_segment": top_by_seg,
        "generated_at": now_ar().isoformat(),
    }


def _empty_response() -> dict:
    return {
        "period_days": 0,
        "totals": {"customers": 0, "monetary": 0, "frequency": 0, "avg_recency_days": 0},
        "segments": [],
        "top_by_segment": {},
        "generated_at": now_ar().isoformat(),
    }

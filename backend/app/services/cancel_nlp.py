"""
Clustering simple de motivos de cancelacion - NLP liviano (sin ML pesado).

TN no graba motivos de cancelacion en texto libre que podamos clusterizar
realmente. Lo que tiene es un campo enum `cancel_reason` con valores como
'customer', 'other', 'staff', 'inventory', etc.

Sin embargo, hay 2 fuentes utiles:
1. tienda_nube."Order".cancel_reason: el enum oficial (limitado pero util)
2. tienda_nube."Order".notes / customer_note: a veces el operador escribe
   el motivo real en notas libres

Esta implementacion:
- Agrupa por cancel_reason enum (vista oficial)
- Por cada orden cancelada con notas libres, busca keywords comunes
  (talle, color, demora, pago, calidad, devolucion, equivocado, error)
  y los agrupa en clusters semanticos.
- Devuelve top motivos por frecuencia + revenue perdido.

Cuando UNIDATA tenga una fuente de chat/email del CS (futuro), se puede
extender con embeddings reales.
"""
from __future__ import annotations

import datetime as dt
import re
import logging

from app.db.engines import get_engine
from app.services._utils import q

log = logging.getLogger("unidata.cancel_nlp")


# Lexicon manual: palabras clave -> cluster semantico.
# Ordenado por especificidad - el primer match gana.
KEYWORD_CLUSTERS: list[tuple[str, list[str]]] = [
    ("Producto incorrecto / error de pedido", [
        "equivocad", "error pedido", "error en pedido", "mal pedido",
        "no era", "queria otro", "queria diferente", "se equivoc",
    ]),
    ("Talle / color erroneo", [
        "talle", "talla", "color", "tamaño", "tamano", "size",
    ]),
    ("Demora en envio", [
        "demora", "demoro", "tarda", "tardo", "no llega", "no llego",
        "retraso", "envio lento", "shipping delay",
    ]),
    ("Problema de pago", [
        "no pude pagar", "no puedo pagar", "tarjeta", "rechazo",
        "rechazada", "no acepta", "error pago", "payment", "mp ",
        "mercado pago", "transferencia",
    ]),
    ("Calidad del producto", [
        "calidad", "roto", "rota", "defecto", "no funciona", "fallad",
        "rotura", "broken", "defective",
    ]),
    ("Cliente cambio de opinion", [
        "no quiero", "no necesito", "cambio de opinion", "me arrepent",
        "no me sirve", "no lo quiero", "anular", "cancelar",
    ]),
    ("Stock / no disponibilidad", [
        "sin stock", "no hay stock", "fuera de stock", "agotad",
        "no disponible", "out of stock",
    ]),
    ("Encontro mas barato en otro lado", [
        "mas barato", "mejor precio", "competencia", "otra tienda",
        "amazon", "mercado libre", "meli",
    ]),
    ("Doble compra / duplicado", [
        "duplicad", "doble", "ya compre", "dos veces", "2 veces",
    ]),
]


def _classify_note(note: str | None) -> str | None:
    """Asigna un cluster a una nota libre. Devuelve None si no matchea."""
    if not note:
        return None
    text = note.lower()
    # Limpiar accentos basico (no es perfecto pero es suficiente)
    text = (text.replace("á", "a").replace("é", "e").replace("í", "i")
                  .replace("ó", "o").replace("ú", "u").replace("ñ", "n"))
    for cluster_name, keywords in KEYWORD_CLUSTERS:
        for kw in keywords:
            if kw in text:
                return cluster_name
    return None


def cancellations_analysis() -> dict:
    """Analiza ordenes canceladas en los ultimos 90 dias: motivos enum +
    clustering de notas libres + revenue perdido por motivo."""
    eng = get_engine("unistore")

    rows = q(eng, """
        SELECT o.id,
               o."createdAt"::date AS fecha,
               COALESCE(o.cancel_reason::text, 'sin_motivo') AS motivo_enum,
               COALESCE(o.notes, '') AS notas,
               COALESCE(o."customerNote", '') AS notes_cliente,
               COALESCE(o."billingProvince", '') AS provincia,
               o.total::float AS total,
               o."customerId" AS cliente_id
        FROM tienda_nube."Order" o
        WHERE o.status = 'cancelled'
          AND o."createdAt" >= NOW() - INTERVAL '90 days'
        ORDER BY o."createdAt" DESC
        LIMIT 2000
    """) or []

    # Bucket 1: agrupado por cancel_reason enum (oficial)
    by_enum: dict[str, dict] = {}
    # Bucket 2: clustering de notas libres
    by_cluster: dict[str, dict] = {}
    # Bucket 3: ordenes sin clasificar (para revisar manualmente)
    sin_clasificar: list[dict] = []

    for r in rows:
        oid, fecha, motivo, notas, notas_c, prov, total, cid = r
        total_f = float(total or 0)

        # Bucket enum
        if motivo not in by_enum:
            by_enum[motivo] = {"count": 0, "revenue_perdido": 0.0}
        by_enum[motivo]["count"] += 1
        by_enum[motivo]["revenue_perdido"] += total_f

        # Bucket cluster: priorizar customerNote (lo que escribio el cliente)
        cluster = _classify_note(notas_c) or _classify_note(notas)
        if cluster:
            if cluster not in by_cluster:
                by_cluster[cluster] = {"count": 0, "revenue_perdido": 0.0, "samples": []}
            by_cluster[cluster]["count"] += 1
            by_cluster[cluster]["revenue_perdido"] += total_f
            if len(by_cluster[cluster]["samples"]) < 3:
                # Sample para mostrar al usuario
                snippet = (notas_c or notas or "")[:160]
                by_cluster[cluster]["samples"].append({
                    "orden_id": int(oid),
                    "fecha": str(fecha) if fecha else None,
                    "nota": snippet,
                    "monto": total_f,
                })
        elif (notas_c or notas):
            # Tiene nota pero no matcheo cluster - guardar para revisar
            if len(sin_clasificar) < 20:
                sin_clasificar.append({
                    "orden_id": int(oid),
                    "fecha": str(fecha) if fecha else None,
                    "nota": (notas_c or notas)[:160],
                    "monto": total_f,
                })

    enum_list = [
        {"motivo": k, "count": v["count"], "revenue_perdido": round(v["revenue_perdido"], 0)}
        for k, v in sorted(by_enum.items(), key=lambda kv: -kv[1]["count"])
    ]

    cluster_list = [
        {
            "cluster": k,
            "count": v["count"],
            "revenue_perdido": round(v["revenue_perdido"], 0),
            "samples": v["samples"],
        }
        for k, v in sorted(by_cluster.items(), key=lambda kv: -kv[1]["count"])
    ]

    total_cancel = sum(v["count"] for v in by_enum.values())
    total_revenue_perdido = sum(v["revenue_perdido"] for v in by_enum.values())

    return {
        "total_cancelaciones_90d": total_cancel,
        "total_revenue_perdido": round(total_revenue_perdido, 0),
        "by_enum": enum_list,
        "by_cluster_nlp": cluster_list,
        "sin_clasificar": sin_clasificar,
        "metodo": (
            "Cluster manual basado en lexicon de keywords (talle, demora, pago, etc.). "
            "Para clustering semantico real con embeddings se necesita una fuente "
            "de texto mas rica (chat CS, emails) que TN no provee actualmente."
        ),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

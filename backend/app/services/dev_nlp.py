"""
NLP devoluciones (Unidev) - clustering de causas usando lexicon manual.

Las devoluciones tienen 2 fuentes de texto utiles:
1. `devolucion_items_fallas.descripcion` - texto libre con la causa real
   (lo que el cliente escribio o lo que registro el CS).
2. (en futuro) tipo_devolucion / observaciones en devoluciones header.

A diferencia de cancel_nlp.py donde TN tiene un enum oficial, en Unidev
las descripciones SI son texto libre, asi que el NLP es mas util.

Cuando Unidata tenga embeddings reales (futuro), se extiende. Por ahora
lexicon-based matching es robusto y suficiente para detectar patrones
operativos (top motivos, tendencia mes a mes, SKUs criticos por motivo).
"""
from __future__ import annotations

import datetime as dt
import logging

from app.db.engines import get_engine
from app.services._utils import q

log = logging.getLogger("unidata.dev_nlp")


# Lexicon ordenado por especificidad (primer match gana).
# Diseñado para devoluciones de electronica / accesorios (perfil Unistore).
KEYWORD_CLUSTERS: list[tuple[str, list[str]]] = [
    ("Producto defectuoso / no funciona", [
        "no funciona", "no enciende", "no carga", "no prende", "defecto",
        "defectuos", "fallad", "no sirve", "rota", "roto", "broken",
        "defective", "no anda", "no opera", "no responde", "se apaga",
    ]),
    ("Llegó dañado / mal embalado", [
        "llego daniad", "llego daiad", "llego roto", "embalaje", "embalado",
        "golpe", "golpead", "rayado", "rayad", "marcado", "abollad",
        "manchado", "manchad", "sucio", "sucia", "danio", "daño",
    ]),
    ("Producto incorrecto / equivocado", [
        "equivocad", "no era", "no es el", "diferent", "otro produc",
        "queria otro", "error pedido", "error en pedido", "mal pedido",
        "no coincide", "no corresponde", "se equivoc", "wrong",
    ]),
    ("Talle / color / tamaño erróneo", [
        "talle", "talla", "color", "tamano", "tamaño", "size", "muy chico",
        "muy grande", "muy pequen", "queda chico", "queda grande",
    ]),
    ("No coincide con descripción / publicación", [
        "no coincide", "no es lo que", "descripcion", "publicacion",
        "engano", "engaño", "estafa", "publicado", "anunciado", "como en la foto",
        "como la foto", "imagen", "diferent al",
    ]),
    ("Calidad inferior a esperada", [
        "calidad", "mala calidad", "baja calidad", "feo", "barato",
        "no vale", "decepcion", "decepcionad", "esperaba mas",
        "cheap", "low quality",
    ]),
    ("Llegó tarde / fuera de tiempo", [
        "demora", "demoro", "tarda", "tardo", "no llega", "no llego",
        "retraso", "tardio", "muy tarde", "fuera de tiempo", "ya no",
        "shipping delay", "late",
    ]),
    ("Faltan piezas / incompleto", [
        "falta", "faltan", "incomplet", "viene sin", "no trae",
        "no incluye", "no vino", "missing", "incomplete",
    ]),
    ("Cliente cambió de opinión", [
        "no quiero", "no necesito", "cambio de opinion", "me arrepent",
        "no me sirve", "no lo quiero", "ya no", "regalo no se usa",
    ]),
    ("Doble compra / duplicado", [
        "duplicad", "doble", "ya compre", "dos veces", "2 veces", "repetid",
    ]),
    ("Problema técnico (compatibilidad / instalación)", [
        "no es compatible", "compatib", "no instala", "instalac",
        "no se conect", "no se conecta", "no pude usar", "no funciona con mi",
    ]),
    ("Problema de garantía / posventa", [
        "garantia", "warranty", "service tecnico", "soporte",
    ]),
]


def _classify_note(note: str | None) -> str | None:
    """Asigna un cluster a una descripcion. Devuelve None si no matchea."""
    if not note:
        return None
    text = note.lower()
    # Normalizacion basica de acentos
    text = (text.replace("á", "a").replace("é", "e").replace("í", "i")
                  .replace("ó", "o").replace("ú", "u").replace("ñ", "n"))
    for cluster_name, keywords in KEYWORD_CLUSTERS:
        for kw in keywords:
            if kw in text:
                return cluster_name
    return None


def devoluciones_nlp(period_days: int = 90) -> dict:
    """Analiza descripciones de fallas de los ultimos N dias y clusteriza."""
    eng = get_engine("unidev")

    rows = q(eng, """
        SELECT f.devolucion_item_id,
               f.descripcion,
               COALESCE(f.canitdad, 0)::int AS cantidad,
               di.devolucion_id,
               di.sku,
               COALESCE(di.monto_unitario, 0)::float * COALESCE(di.cantidad_solicitada, 0)::int AS monto_item,
               d.estado_general,
               d.tipo_resolucion_preferida,
               d.fecha_creacion::text AS fecha,
               COALESCE(d.monto_aprobado, d.monto_estimado, 0)::float AS monto_dev
        FROM public.devolucion_items_fallas f
        JOIN public.devolucion_items di ON di.devolucion_item_id = f.devolucion_item_id
        JOIN public.devoluciones d ON d.devolucion_id = di.devolucion_id
        WHERE d.fecha_creacion >= NOW() - make_interval(days => :days)
        ORDER BY d.fecha_creacion DESC
        LIMIT 5000
    """, {"days": int(period_days)}) or []

    by_cluster: dict[str, dict] = {}
    sin_clasificar: list[dict] = []
    by_sku_cluster: dict[tuple[str, str], int] = {}
    total_items = 0
    total_monto = 0.0

    for r in rows:
        _it_id, desc, cant, _dev_id, sku, monto_item, estado, resol, fecha, _monto_dev = r
        cant = int(cant or 0)
        monto_item_f = float(monto_item or 0)
        total_items += cant
        total_monto += monto_item_f

        cluster = _classify_note(desc)
        if cluster:
            if cluster not in by_cluster:
                by_cluster[cluster] = {
                    "count_items": 0, "count_unidades": 0,
                    "monto_total": 0.0, "samples": [],
                    "skus": set(),
                }
            by_cluster[cluster]["count_items"] += 1
            by_cluster[cluster]["count_unidades"] += cant
            by_cluster[cluster]["monto_total"] += monto_item_f
            if sku:
                by_cluster[cluster]["skus"].add(sku)
                key = (cluster, sku)
                by_sku_cluster[key] = by_sku_cluster.get(key, 0) + cant
            if len(by_cluster[cluster]["samples"]) < 3 and desc:
                by_cluster[cluster]["samples"].append({
                    "descripcion": (desc or "")[:200],
                    "sku": sku or "",
                    "cantidad": cant,
                    "fecha": fecha[:10] if fecha else None,
                    "estado": estado or "",
                    "resolucion": resol or "",
                })
        else:
            if desc and len(sin_clasificar) < 20:
                sin_clasificar.append({
                    "descripcion": (desc or "")[:200],
                    "sku": sku or "",
                    "cantidad": cant,
                    "fecha": fecha[:10] if fecha else None,
                    "estado": estado or "",
                })

    # Convertir cluster -> lista ordenada
    cluster_list = []
    for cluster_name, data in sorted(by_cluster.items(), key=lambda kv: -kv[1]["count_unidades"]):
        top_skus_in_cluster = sorted(
            ((sku, cant) for (c, sku), cant in by_sku_cluster.items() if c == cluster_name),
            key=lambda x: -x[1],
        )[:5]
        cluster_list.append({
            "cluster": cluster_name,
            "count_items": data["count_items"],
            "count_unidades": data["count_unidades"],
            "monto_total": round(data["monto_total"], 0),
            "skus_distintos": len(data["skus"]),
            "top_skus": [{"sku": s, "unidades": c} for s, c in top_skus_in_cluster],
            "samples": data["samples"],
        })

    return {
        "period_days": int(period_days),
        "total_items_analizados": len(rows),
        "total_unidades": total_items,
        "total_monto": round(total_monto, 0),
        "clusters": cluster_list,
        "sin_clasificar": sin_clasificar,
        "metodo": (
            "Lexicon manual basado en keywords (defecto, daño en envio, talle/color, "
            "calidad, equivocado, demora, falta, etc). Devuelve top motivos + SKUs "
            "afectados por motivo + muestras de descripciones."
        ),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

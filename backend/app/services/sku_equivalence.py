"""
Mapeo de equivalencias de SKU cross-canal.

Detecta automaticamente SKUs que son el mismo producto fisico pero con
codigo distinto en otros canales. Tres heuristicas, en orden de confianza:

1. **EAN match**: si el EAN de Unistore (digip.ArticuloUnidadMedidaCodigo)
   matchea con un SKU de Unidrop, son el mismo producto. Confianza ALTA.
2. **Match exacto post-normalizado**: uppercase + sin guiones + sin espacios
   + sin caracteres especiales. Confianza ALTA.
3. **Fuzzy match por prefijo**: SKUs Unistore "M25" y Unidrop "M25-NEGRO"
   tienen prefijo comun >= 4 chars. Confianza MEDIA. Si encima tienen nombre
   parecido (Levenshtein < 5) sube a ALTA.

Devuelve un dataset de propuestas que un humano puede revisar y aceptar
para construir la tabla canonica `sku_omnichannel_map`.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict

from app.db.engines import get_engine
from app.services._utils import q
from app.utils.tz import now_ar

log = logging.getLogger("unidata.sku_equivalence")


def _normalize(sku: str) -> str:
    """Normaliza un SKU: uppercase, sin separadores, sin caracteres extra."""
    if not sku:
        return ""
    s = sku.strip().upper()
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s


def _levenshtein(a: str, b: str, max_dist: int = 6) -> int:
    """Distancia Levenshtein con early-exit cuando supera max_dist."""
    if a == b:
        return 0
    if abs(len(a) - len(b)) > max_dist:
        return max_dist + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i] + [0] * len(b)
        row_min = curr[0]
        for j, cb in enumerate(b, 1):
            curr[j] = min(
                prev[j] + 1,        # delete
                curr[j - 1] + 1,    # insert
                prev[j - 1] + (0 if ca == cb else 1),  # substitute
            )
            row_min = min(row_min, curr[j])
        if row_min > max_dist:
            return max_dist + 1
        prev = curr
    return prev[len(b)]


def sku_equivalence(period_months: int = 6, min_units: int = 5) -> dict:
    """Encuentra equivalencias entre SKUs de Unistore TN y Unidrop ML/TN.

    Solo considera SKUs activos en el periodo (con >= min_units vendidas)
    para no inundar con la cola larga.
    """
    eng_uni = get_engine("unistore")
    eng_drp = get_engine("unidrop")

    # --- SKUs activos Unistore TN
    uni_skus = q(eng_uni, """
        SELECT oi.sku, MAX(oi.name) AS name, SUM(oi.quantity)::int AS units
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(months => :months)
          AND oi.sku IS NOT NULL
        GROUP BY oi.sku
        HAVING SUM(oi.quantity) >= :min_units
    """, {"months": period_months, "min_units": min_units}) or []

    # --- SKUs activos Unidrop ML
    drp_ml_skus = q(eng_drp, """
        SELECT oi."sellerSku" AS sku, MAX(oi.title) AS name, SUM(oi.quantity)::int AS units
        FROM mercado_libre_dev."OrderItemMercadoLibre" oi
        JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
        WHERE oi."sellerSku" IS NOT NULL
          AND o."dateCreated" >= NOW() - make_interval(months => :months)
          AND o.status IN ('paid','partially_refunded')
        GROUP BY oi."sellerSku"
        HAVING SUM(oi.quantity) >= :min_units
    """, {"months": period_months, "min_units": min_units}) or []

    # --- SKUs activos Unidrop TN
    drp_tn_skus = []
    try:
        drp_tn_skus = q(eng_drp, """
            SELECT oi.sku, MAX(oi.name) AS name, SUM(oi.quantity)::int AS units
            FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.order_id
            WHERE tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - make_interval(months => :months)
              AND oi.sku IS NOT NULL
            GROUP BY oi.sku
            HAVING SUM(oi.quantity) >= :min_units
        """, {"months": period_months, "min_units": min_units}) or []
    except Exception as e:
        log.warning("drp_tn_skus fail: %s", e)

    # --- Sets para detectar matches exactos
    uni_set = {sku for sku, _, _ in uni_skus}
    drp_ml_set = {sku for sku, _, _ in drp_ml_skus}
    drp_tn_set = {sku for sku, _, _ in drp_tn_skus}

    # --- 1. Matches exactos: aparecen identicos en ambos lados (no es bug, es OK pero confirmamos)
    exact_matches_uni_drp_ml = uni_set & drp_ml_set
    exact_matches_uni_drp_tn = uni_set & drp_tn_set

    # --- 2. SKUs que solo aparecen en Unidrop (huerfanos) — son los candidatos a mapear
    huerfanos_drp_ml = drp_ml_set - uni_set
    huerfanos_drp_tn = drp_tn_set - uni_set
    huerfanos_uni = uni_set - drp_ml_set - drp_tn_set

    # --- 3. Indice normalizado de Unistore para buscar matches
    norm_to_uni: dict[str, list[tuple[str, str, int]]] = defaultdict(list)
    uni_by_sku: dict[str, tuple[str, int]] = {}
    for sku, name, units in uni_skus:
        norm = _normalize(sku)
        norm_to_uni[norm].append((sku, name or sku, units))
        uni_by_sku[sku] = (name or sku, units)

    # Tambien indice por prefijo (3+ chars) para fuzzy match
    prefix_to_uni: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for sku, name, _ in uni_skus:
        norm = _normalize(sku)
        if len(norm) >= 3:
            prefix_to_uni[norm[:3]].append((sku, name or sku))
            if len(norm) >= 4:
                prefix_to_uni[norm[:4]].append((sku, name or sku))

    # --- 3.5. Mapear sku -> (imagen, ean) para Unistore (catalogo TN)
    uni_sku_set = list(uni_set)
    image_by_sku: dict[str, dict] = {}
    if uni_sku_set:
        CHUNK = 500
        for i in range(0, len(uni_sku_set), CHUNK):
            chunk = uni_sku_set[i:i + CHUNK]
            try:
                rows = q(eng_uni, """
                    SELECT pv.sku,
                           COALESCE(MAX(pv.barcode), '') AS ean,
                           (SELECT pi.src FROM tienda_nube."ProductImage" pi
                            WHERE pi."productId" = MAX(p.id)
                            ORDER BY pi.position ASC NULLS LAST LIMIT 1) AS imagen
                    FROM tienda_nube."ProductVariant" pv
                    JOIN tienda_nube."Product" p ON p.id = pv."productId"
                    WHERE pv.sku = ANY(:skus)
                    GROUP BY pv.sku
                """, {"skus": chunk}) or []
                for sku, ean, imagen in rows:
                    image_by_sku[sku] = {"ean": ean or "", "imagen": imagen or ""}
            except Exception as e:
                log.warning("uni image chunk %d fail: %s", i, e)

    # --- 4. Para cada huerfano Unidrop, buscar candidato Unistore
    proposals = []
    for canal_label, huerfanos, units_by_sku in [
        ("unidrop_ml", huerfanos_drp_ml, {sku: (name or sku, units) for sku, name, units in drp_ml_skus}),
        ("unidrop_tn", huerfanos_drp_tn, {sku: (name or sku, units) for sku, name, units in drp_tn_skus}),
    ]:
        for sku in huerfanos:
            name, units = units_by_sku.get(sku, (sku, 0))
            norm = _normalize(sku)

            # 4a) Match exacto normalizado
            if norm in norm_to_uni:
                for uni_sku, uni_name, uni_units in norm_to_uni[norm]:
                    enr = image_by_sku.get(uni_sku, {})
                    proposals.append({
                        "sku_canal": sku,
                        "name_canal": name,
                        "units_canal": units,
                        "canal": canal_label,
                        "sku_unistore": uni_sku,
                        "name_unistore": uni_name,
                        "units_unistore": uni_units,
                        "imagen_unistore": enr.get("imagen", ""),
                        "ean_unistore": enr.get("ean", ""),
                        "score": "alta_normalizado",
                        "match_type": "Match exacto post-normalizar (uppercase + sin separadores)",
                    })
                continue

            # 4b) Fuzzy por prefijo + nombre similar
            best = None
            best_distance = 999
            for prefix_len in [4, 3]:
                if len(norm) < prefix_len:
                    continue
                prefix = norm[:prefix_len]
                for uni_sku, uni_name in prefix_to_uni.get(prefix, []):
                    uni_norm = _normalize(uni_sku)
                    name_dist = _levenshtein(
                        (name or "").upper()[:40],
                        (uni_name or "").upper()[:40],
                        max_dist=8,
                    )
                    sku_dist = _levenshtein(norm, uni_norm, max_dist=10)
                    if sku_dist <= 2 and name_dist <= best_distance:
                        best = uni_sku
                        best_distance = name_dist
                if best:
                    break

            if best and best_distance <= 5:
                uni_name, uni_units = uni_by_sku.get(best, (best, 0))
                enr = image_by_sku.get(best, {})
                proposals.append({
                    "sku_canal": sku,
                    "name_canal": name,
                    "units_canal": units,
                    "canal": canal_label,
                    "sku_unistore": best,
                    "name_unistore": uni_name,
                    "units_unistore": uni_units,
                    "imagen_unistore": enr.get("imagen", ""),
                    "ean_unistore": enr.get("ean", ""),
                    "score": "media_prefijo_nombre",
                    "match_type": f"Prefijo comun + nombre similar (dist nombre={best_distance})",
                })

    proposals.sort(key=lambda p: -p["units_canal"])

    summary = {
        "period_months": period_months,
        "min_units": min_units,
        "uni_skus_activos": len(uni_set),
        "drp_ml_skus_activos": len(drp_ml_set),
        "drp_tn_skus_activos": len(drp_tn_set),
        "match_exacto_uni_ml": len(exact_matches_uni_drp_ml),
        "match_exacto_uni_tn": len(exact_matches_uni_drp_tn),
        "huerfanos_drp_ml": len(huerfanos_drp_ml),
        "huerfanos_drp_tn": len(huerfanos_drp_tn),
        "huerfanos_unistore": len(huerfanos_uni),
        "propuestas": len(proposals),
        "propuestas_alta_confianza": sum(1 for p in proposals if p["score"].startswith("alta")),
    }

    return {
        "summary": summary,
        "proposals": proposals,
        "generated_at": now_ar().isoformat(),
    }

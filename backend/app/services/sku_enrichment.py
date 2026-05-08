"""
Enriquecimiento de SKUs con imagen + EAN.

Fuentes:
- Imagen: tienda_nube.ProductImage (joineado a ProductVariant.sku)
- EAN: tienda_nube.ProductVariant.barcode (preferida) o digip.ArticuloUnidadMedidaCodigo (fallback)

Cache en memoria por unit + sku con TTL 1 hora para evitar JOINs repetidos.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Iterable

from sqlalchemy import text

from app.db.engines import get_engine

logger = logging.getLogger(__name__)

_CACHE_TTL_SEC = 3600  # 1 hora
_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_LOCK = threading.RLock()


def _cache_get(key: str) -> dict | None:
    with _CACHE_LOCK:
        item = _CACHE.get(key)
        if not item:
            return None
        ts, value = item
        if time.time() - ts > _CACHE_TTL_SEC:
            _CACHE.pop(key, None)
            return None
        return value


def _cache_set(key: str, value: dict) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = (time.time(), value)


def enrich_skus_unistore(skus: Iterable[str]) -> dict[str, dict]:
    """Recibe una lista de SKUs y devuelve {sku: {image_url, ean, name}}.

    Para SKUs que no encuentre en TN intenta digip como fallback.
    """
    sku_list = [s.strip() for s in skus if s and s.strip()]
    if not sku_list:
        return {}

    # 1. Sacar de cache lo que se pueda
    result: dict[str, dict] = {}
    missing: list[str] = []
    for sku in sku_list:
        cached = _cache_get(f"unistore:{sku}")
        if cached is not None:
            result[sku] = cached
        else:
            missing.append(sku)

    if not missing:
        return result

    # 2. Query a Tienda Nube (imagen primaria + barcode + nombre)
    try:
        eng = get_engine("unistore")
        with eng.connect() as c:
            rows = c.execute(text("""
                WITH variants AS (
                    SELECT
                        pv.sku,
                        pv.barcode,
                        p.id AS product_id,
                        p.name AS product_name,
                        ROW_NUMBER() OVER (PARTITION BY pv.sku ORDER BY pv."updatedAt" DESC NULLS LAST, pv.id DESC) AS rn
                    FROM tienda_nube."ProductVariant" pv
                    JOIN tienda_nube."Product" p ON p.id = pv."productId"
                    WHERE pv.sku = ANY(:skus)
                ),
                first_image AS (
                    SELECT DISTINCT ON (pi."productId")
                        pi."productId", pi.src
                    FROM tienda_nube."ProductImage" pi
                    ORDER BY pi."productId", pi.position ASC NULLS LAST, pi.id ASC
                )
                SELECT v.sku, v.product_name, v.barcode, fi.src AS image_url
                FROM variants v
                LEFT JOIN first_image fi ON fi."productId" = v.product_id
                WHERE v.rn = 1
            """), {"skus": missing}).mappings().all()

        tn_data = {r["sku"]: dict(r) for r in rows}
    except Exception as e:
        logger.warning("enrich_skus_unistore: TN query failed: %s", e)
        tn_data = {}

    # 3. Para SKUs sin barcode en TN, fallback a digip ArticuloUnidadMedidaCodigo
    skus_needing_ean = [
        s for s in missing
        if s not in tn_data or not tn_data[s].get("barcode")
    ]

    digip_eans: dict[str, str] = {}
    if skus_needing_ean:
        try:
            eng = get_engine("unistore")
            with eng.connect() as c:
                rows = c.execute(text("""
                    SELECT a."CodigoArticulo" AS sku, c."Codigo" AS codigo, LENGTH(c."Codigo") AS len
                    FROM digip."Articulo" a
                    JOIN digip."ArticuloUnidadMedida" u ON u."articuloCodigo" = a."CodigoArticulo"
                    JOIN digip."ArticuloUnidadMedidaCodigo" c ON c."unidadMedidaId" = u.id
                    WHERE a."CodigoArticulo" = ANY(:skus)
                    ORDER BY a."CodigoArticulo",
                             CASE WHEN LENGTH(c."Codigo") = 13 THEN 0
                                  WHEN LENGTH(c."Codigo") = 12 THEN 1
                                  WHEN LENGTH(c."Codigo") = 8  THEN 2
                                  ELSE 3 END
                """), {"skus": skus_needing_ean}).mappings().all()

            # tomar el primer codigo por sku (el ranking ORDER BY ya prioriza EAN-13)
            for r in rows:
                if r["sku"] not in digip_eans:
                    digip_eans[r["sku"]] = r["codigo"]
        except Exception as e:
            logger.warning("enrich_skus_unistore: digip query failed: %s", e)

    # 4. Mergear y cachear
    for sku in missing:
        tn = tn_data.get(sku, {})
        ean = tn.get("barcode") or digip_eans.get(sku)
        enriched = {
            "image_url": tn.get("image_url"),
            "ean": ean,
            "name": tn.get("product_name"),
        }
        result[sku] = enriched
        _cache_set(f"unistore:{sku}", enriched)

    return result


def clear_cache() -> int:
    """Helper para invalidar el cache (admin)."""
    with _CACHE_LOCK:
        n = len(_CACHE)
        _CACHE.clear()
        return n

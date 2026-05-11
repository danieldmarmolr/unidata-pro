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
from app.services.sku_rules import is_service_sku

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

    # 2. Query a Tienda Nube (solo imagen primaria + nombre - NO usamos su barcode)
    try:
        eng = get_engine("unistore")
        with eng.connect() as c:
            rows = c.execute(text("""
                WITH variants AS (
                    SELECT
                        pv.sku,
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
                SELECT v.sku, v.product_name, fi.src AS image_url
                FROM variants v
                LEFT JOIN first_image fi ON fi."productId" = v.product_id
                WHERE v.rn = 1
            """), {"skus": missing}).mappings().all()

        tn_data = {r["sku"]: dict(r) for r in rows}
    except Exception as e:
        logger.warning("enrich_skus_unistore: TN query failed: %s", e)
        tn_data = {}

    # 3. EAN: SIEMPRE de digip (fuente de verdad)
    # tienda_nube.ProductVariant.barcode no es el EAN, es un campo libre que casi nunca se llena.
    # El EAN real esta en digip.ArticuloUnidadMedidaCodigo, priorizando codigos de 13 digitos.
    digip_eans: dict[str, str] = {}
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
                         -- Priorizar EAN-13, luego EAN-12 (UPC), luego EAN-8, luego cualquier otro
                         CASE WHEN LENGTH(c."Codigo") = 13 THEN 0
                              WHEN LENGTH(c."Codigo") = 12 THEN 1
                              WHEN LENGTH(c."Codigo") = 8  THEN 2
                              ELSE 3 END,
                         c.id ASC
            """), {"skus": missing}).mappings().all()

        # tomar el primer codigo por sku (el ranking ORDER BY prioriza EAN-13)
        for r in rows:
            if r["sku"] not in digip_eans:
                digip_eans[r["sku"]] = r["codigo"]
    except Exception as e:
        logger.warning("enrich_skus_unistore: digip query failed: %s", e)

    # 4. Mergear y cachear
    for sku in missing:
        tn = tn_data.get(sku, {})
        is_service = is_service_sku(sku)
        enriched = {
            "image_url": tn.get("image_url"),
            "ean": digip_eans.get(sku),  # SIEMPRE de digip
            "name": tn.get("product_name"),
            "is_service": is_service,
            # Tag visual: servicios de Unidrop se distinguen
            "kind": "service" if is_service else "product",
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


def lookup_by_ean(ean: str) -> dict | None:
    """Busca un SKU a partir de su EAN (codigo de barra). Inversa de enrich.

    Recorre digip.ArticuloUnidadMedidaCodigo (donde vive el EAN real) -> arma el SKU
    canonico del Articulo y lo enriquece con la informacion completa.

    Devuelve {sku, image_url, ean, name, is_service, kind} o None si no existe.
    """
    ean_clean = (ean or "").strip()
    if not ean_clean:
        return None
    try:
        eng = get_engine("unistore")
        with eng.connect() as c:
            row = c.execute(text("""
                SELECT a."CodigoArticulo" AS sku, a."Descripcion" AS digip_name
                FROM digip."ArticuloUnidadMedidaCodigo" cd
                JOIN digip."ArticuloUnidadMedida" u ON u.id = cd."unidadMedidaId"
                JOIN digip."Articulo" a ON a."CodigoArticulo" = u."articuloCodigo"
                WHERE cd."Codigo" = :ean
                ORDER BY a."Activo" DESC, a."updatedAt" DESC NULLS LAST
                LIMIT 1
            """), {"ean": ean_clean}).mappings().first()
        if not row:
            return None
        sku = row["sku"]
    except Exception as e:
        logger.warning("lookup_by_ean: digip query failed: %s", e)
        return None

    # Re-uso enrich_skus_unistore para llenar foto + name + el resto
    enriched = enrich_skus_unistore([sku]).get(sku, {})
    return {
        "sku": sku,
        "image_url": enriched.get("image_url"),
        "ean": enriched.get("ean") or ean_clean,
        "name": enriched.get("name") or row["digip_name"],
        "is_service": enriched.get("is_service", False),
        "kind": enriched.get("kind", "product"),
    }


def search_skus_partial(query: str, limit: int = 12) -> list[dict]:
    """Busqueda parcial de SKUs por texto (autocomplete).

    Matchea contra:
      - tienda_nube.ProductVariant.sku (parcial ILIKE)
      - tienda_nube.Product.name (parcial ILIKE)
      - digip.ArticuloUnidadMedidaCodigo.Codigo (EAN parcial, util si tipean
        parte del codigo de barra)

    Devuelve lista de {sku, name, image_url, ean} listos para mostrar en un
    dropdown estilo autocomplete.
    """
    qstr = (query or "").strip()
    if not qstr or len(qstr) < 2:
        return []

    try:
        eng = get_engine("unistore")
        with eng.connect() as c:
            rows = c.execute(text("""
                WITH matched AS (
                    SELECT
                        pv.sku,
                        p.id AS product_id,
                        p.name AS product_name,
                        ROW_NUMBER() OVER (PARTITION BY pv.sku
                                           ORDER BY pv."updatedAt" DESC NULLS LAST, pv.id DESC) AS rn,
                        -- Score: prefiero matches por SKU literal sobre name
                        CASE
                            WHEN pv.sku ILIKE :exact THEN 100
                            WHEN pv.sku ILIKE :start THEN 90
                            WHEN pv.sku ILIKE :pat THEN 80
                            WHEN p.name ILIKE :pat THEN 50
                            ELSE 10
                        END AS score
                    FROM tienda_nube."ProductVariant" pv
                    JOIN tienda_nube."Product" p ON p.id = pv."productId"
                    WHERE pv.sku ILIKE :pat OR p.name ILIKE :pat
                ),
                deduped AS (
                    SELECT sku, product_id, product_name, MAX(score) AS score
                    FROM matched WHERE rn = 1
                    GROUP BY sku, product_id, product_name
                ),
                first_image AS (
                    SELECT DISTINCT ON (pi."productId")
                        pi."productId", pi.src
                    FROM tienda_nube."ProductImage" pi
                    ORDER BY pi."productId", pi.position ASC NULLS LAST, pi.id ASC
                )
                SELECT d.sku, d.product_name, fi.src AS image_url, d.score
                FROM deduped d
                LEFT JOIN first_image fi ON fi."productId" = d.product_id
                ORDER BY d.score DESC, d.sku ASC
                LIMIT :lim
            """), {
                "pat": f"%{qstr}%",
                "exact": qstr,
                "start": f"{qstr}%",
                "lim": int(limit),
            }).mappings().all()
    except Exception as e:
        logger.warning("search_skus_partial failed: %s", e)
        return []

    # Enriquecemos con EAN desde digip para los SKUs encontrados
    skus = [r["sku"] for r in rows]
    enriched_map = enrich_skus_unistore(skus) if skus else {}

    return [{
        "sku": r["sku"],
        "name": r["product_name"] or "",
        "image_url": r["image_url"],
        "ean": enriched_map.get(r["sku"], {}).get("ean"),
    } for r in rows]

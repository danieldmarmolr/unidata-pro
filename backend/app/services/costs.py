"""
Servicios de costos de importacion.
- Parser CSV con detect de delimitador y mapeo a las 52 columnas del template
- Scraper BNA para tipo de cambio USD venta (cache 1h)
- Conversion USD -> ARS para markup en dashboards
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import logging
import re
from typing import Any

import urllib.request

from app.db import costs_db

log = logging.getLogger("unidata.costs")

BNA_URL = "https://www.bna.com.ar/Personas"
BNA_CACHE_HOURS = 1

# ============================================================
# CSV PARSING
# ============================================================

# mapping del header del template SharePoint -> campo interno
HEADER_MAP: dict[str, str] = {
    "lote": "lote",
    "proveedor": "proveedor",
    "fecha ingreso": "fecha_ingreso",
    "categoria": "categoria",
    "sub-categoria": "sub_categoria",
    "subcategoria": "sub_categoria",
    "ncm": "ncm",
    "sku2": "sku",
    "sku": "sku",
    "cantidad": "cantidad",
    "producto": "producto",
    "moneda val": "moneda",
    "origen": "origen",
    "valor maximo": "valor_max_usd",
    "valor minimo": "valor_min_usd",
    "alto (m)": "alto_m",
    "largo (m)": "largo_m",
    "ancho (m)": "ancho_m",
    "peso grueso (kg)": "peso_kg",
    "cbm (un)": "cbm_un",
    "envio": "envio",
    "costo total s/ iva": "costo_total_sin_iva_usd",
    "costo total s/iva": "costo_total_sin_iva_usd",
    "costo con iva": "costo_con_iva_usd",
    "precio": "precio_ars",
    "rentabilidad": "rentabilidad_ars",
    "% rentab": "pct_rentabilidad",
    "% rentabilidad": "pct_rentabilidad",
}


def _norm_header(h: str) -> str:
    return re.sub(r"\s+", " ", (h or "").strip().lower()).rstrip("2").strip()


def _parse_number(v: Any) -> float | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    # remove % and currency symbols
    s = s.replace("%", "").replace("$", "").replace("USD", "").replace("ARS", "").strip()
    # decimal: en CSV viene con coma como decimal y punto como miles eventual
    if "," in s and "." in s:
        # asumimos punto como miles
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _parse_int(v: Any) -> int | None:
    f = _parse_number(v)
    if f is None:
        return None
    try:
        return int(f)
    except (ValueError, TypeError):
        return None


def _parse_date(v: Any) -> str | None:
    if not v:
        return None
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y", "%d/%m/%y"):
        try:
            return dt.datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return s  # devolvemos raw si no matchea


def parse_csv(content: bytes, source_file: str) -> dict:
    """
    Parsea el CSV/XLSX-export al formato de items.
    Detecta delimitador (; o , o \t).
    Devuelve {lotes: {lote_name: {meta..., items: [...]}}, total_rows, errors}
    """
    text = content.decode("utf-8-sig", errors="replace")
    sniff = csv.Sniffer()
    delim = ";"
    try:
        delim = sniff.sniff(text[:4096], delimiters=";,|\t").delimiter
    except csv.Error:
        delim = ";" if text.count(";") > text.count(",") else ","

    reader = csv.reader(io.StringIO(text), delimiter=delim)
    rows = list(reader)
    if not rows:
        return {"lotes": {}, "total_rows": 0, "errors": ["archivo vacio"]}

    raw_header = rows[0]
    header_norm = [_norm_header(h) for h in raw_header]
    # mapeo posicion -> campo interno
    pos_to_field: dict[int, str] = {}
    for i, h in enumerate(header_norm):
        # match parcial: si el header empieza con la key del map
        for key, field in HEADER_MAP.items():
            if h == key or (key and h.startswith(key)):
                pos_to_field.setdefault(i, field)
                break

    lotes: dict[str, dict] = {}
    errors: list[str] = []
    parsed_rows = 0

    for ridx, row in enumerate(rows[1:], start=2):
        if not any((c or "").strip() for c in row):
            continue
        record: dict = {"raw_payload": dict(zip(raw_header, row))}
        for i, val in enumerate(row):
            if i in pos_to_field:
                record[pos_to_field[i]] = val

        sku = (record.get("sku") or "").strip()
        lote_name = (record.get("lote") or "").strip()
        if not sku or not lote_name:
            continue  # silently skip rows without sku or lote

        # numeric coercions
        item = {
            "sku": sku,
            "producto": (record.get("producto") or "").strip() or None,
            "categoria": (record.get("categoria") or "").strip() or None,
            "sub_categoria": (record.get("sub_categoria") or "").strip() or None,
            "ncm": (record.get("ncm") or "").strip() or None,
            "cantidad": _parse_int(record.get("cantidad")),
            "valor_max_usd": _parse_number(record.get("valor_max_usd")),
            "valor_min_usd": _parse_number(record.get("valor_min_usd")),
            "costo_total_sin_iva_usd": _parse_number(record.get("costo_total_sin_iva_usd")),
            "costo_con_iva_usd": _parse_number(record.get("costo_con_iva_usd")),
            "precio_ars": _parse_number(record.get("precio_ars")),
            "rentabilidad_ars": _parse_number(record.get("rentabilidad_ars")),
            "pct_rentabilidad": _parse_number(record.get("pct_rentabilidad")),
            "alto_m": _parse_number(record.get("alto_m")),
            "largo_m": _parse_number(record.get("largo_m")),
            "ancho_m": _parse_number(record.get("ancho_m")),
            "peso_kg": _parse_number(record.get("peso_kg")),
            "cbm_un": _parse_number(record.get("cbm_un")),
            "raw_payload": record["raw_payload"],
        }

        if lote_name not in lotes:
            lotes[lote_name] = {
                "lote": lote_name,
                "proveedor": (record.get("proveedor") or "").strip() or None,
                "fecha_ingreso": _parse_date(record.get("fecha_ingreso")),
                "origen": (record.get("origen") or "").strip() or None,
                "envio": (record.get("envio") or "").strip() or None,
                "moneda": (record.get("moneda") or "").strip() or None,
                "source_file": source_file,
                "items": [],
            }
        lotes[lote_name]["items"].append(item)
        parsed_rows += 1

    return {"lotes": lotes, "total_rows": parsed_rows, "errors": errors, "delimiter": delim, "headers": raw_header}


def import_file(content: bytes, *, source_file: str, imported_by: str) -> dict:
    """Parsea + persiste todos los lotes detectados."""
    parsed = parse_csv(content, source_file=source_file)
    summary: list[dict] = []
    for lote_name, meta in parsed["lotes"].items():
        items = meta.pop("items")
        result = costs_db.upsert_lote(
            lote=meta["lote"],
            proveedor=meta.get("proveedor"),
            fecha_ingreso=meta.get("fecha_ingreso"),
            origen=meta.get("origen"),
            envio=meta.get("envio"),
            moneda=meta.get("moneda"),
            source_file=source_file,
            imported_by=imported_by,
            items=items,
        )
        summary.append({
            "lote": lote_name,
            "items": len(items),
            "replaced": result["replaced"],
            "lote_id": result["lote_id"],
        })
    return {
        "summary": summary,
        "total_rows": parsed["total_rows"],
        "lotes_count": len(parsed["lotes"]),
        "errors": parsed["errors"],
        "delimiter": parsed.get("delimiter"),
    }


# ============================================================
# BNA USD VENTA SCRAPER
# ============================================================

def fetch_usd_rate_bna() -> dict | None:
    """Scrape https://www.bna.com.ar/Personas. Devuelve {venta, compra, source}."""
    try:
        req = urllib.request.Request(BNA_URL, headers={
            "User-Agent": "Mozilla/5.0 (UNIDATA cost-loader)",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except Exception as e:
        log.warning("BNA fetch failed: %s", e)
        return None

    # Buscar bloque tabla con "Dolar U.S.A"
    # El sitio renderiza una tabla; los numeros vienen como "1.410,00"
    pattern = re.compile(
        r"Dolar\s*U\.?S\.?A.*?<td[^>]*>([\d\.,]+)</td>\s*<td[^>]*>([\d\.,]+)</td>",
        re.IGNORECASE | re.DOTALL,
    )
    m = pattern.search(html)
    if not m:
        log.warning("BNA: no match dolar pattern")
        return None
    compra = _parse_number(m.group(1))
    venta = _parse_number(m.group(2))
    if not venta:
        return None
    return {"venta": venta, "compra": compra, "source": "BNA"}


def get_usd_rate(force_refresh: bool = False) -> dict:
    """Devuelve cotizacion USD/ARS. Cache 1h. Fallback al ultimo conocido."""
    cached = costs_db.get_cached_rate()
    if cached and not force_refresh:
        try:
            ts = dt.datetime.fromisoformat(cached["fetched_at"])
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=dt.timezone.utc)
            age = dt.datetime.now(dt.timezone.utc) - ts
            if age < dt.timedelta(hours=BNA_CACHE_HOURS):
                return {**cached, "from_cache": True}
        except Exception:
            pass

    fresh = fetch_usd_rate_bna()
    if fresh:
        costs_db.set_cached_rate(
            venta=fresh["venta"], compra=fresh.get("compra"), source=fresh["source"],
        )
        return {**costs_db.get_cached_rate(), "from_cache": False}

    if cached:
        return {**cached, "from_cache": True, "stale": True}
    raise RuntimeError("No se pudo obtener cotizacion USD ni hay cache previa")


# ============================================================
# QUERIES PARA INTEGRACION CON DASHBOARDS
# ============================================================

def cost_for_sku(sku: str, *, in_ars: bool = True) -> dict | None:
    """Devuelve costo vigente del SKU. Si in_ars=True multiplica por venta USD/ARS."""
    rec = costs_db.cost_by_sku(sku)
    if not rec:
        return None
    cur = rec["current"]
    cost_usd = cur.get("costo_con_iva_usd") or cur.get("costo_total_sin_iva_usd")
    out = {
        "sku": sku,
        "lote": cur.get("lote"),
        "fecha_ingreso": cur.get("fecha_ingreso"),
        "cost_usd": cost_usd,
        "valor_compra_usd": cur.get("valor_max_usd") or cur.get("valor_min_usd"),
    }
    if in_ars and cost_usd:
        try:
            rate = get_usd_rate()
            out["cost_ars"] = round(cost_usd * rate["venta"], 2)
            out["usd_rate"] = rate["venta"]
        except Exception:
            pass
    return out

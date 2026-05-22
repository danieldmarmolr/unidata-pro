"""
Costos de importacion (lote + item por SKU). PostgreSQL via Supabase.
Auto-migra al boot. Replace-on-import por (lote): si subis el mismo lote
otra vez, se reemplazan todos sus items.
"""
from __future__ import annotations

import datetime as dt
import json
import threading

from app.db.local_persistence import get_conn

_LOCK = threading.RLock()
_INITIALIZED = False


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS cost_lote (
                    id            BIGSERIAL PRIMARY KEY,
                    lote          TEXT NOT NULL,
                    proveedor     TEXT,
                    fecha_ingreso TEXT,
                    origen        TEXT,
                    envio         TEXT,
                    moneda        TEXT,
                    source_file   TEXT,
                    imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    imported_by   TEXT NOT NULL,
                    items_count   INTEGER NOT NULL DEFAULT 0
                )
            """)
            cur.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_lote_lote_lower
                ON cost_lote (LOWER(lote))
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS cost_item (
                    id            BIGSERIAL PRIMARY KEY,
                    lote_id       BIGINT NOT NULL REFERENCES cost_lote(id) ON DELETE CASCADE,
                    sku           TEXT NOT NULL,
                    producto      TEXT,
                    categoria     TEXT,
                    sub_categoria TEXT,
                    ncm           TEXT,
                    cantidad      INTEGER,
                    valor_max_usd DOUBLE PRECISION,
                    valor_min_usd DOUBLE PRECISION,
                    costo_total_sin_iva_usd DOUBLE PRECISION,
                    costo_con_iva_usd       DOUBLE PRECISION,
                    precio_ars              DOUBLE PRECISION,
                    rentabilidad_ars        DOUBLE PRECISION,
                    pct_rentabilidad        DOUBLE PRECISION,
                    alto_m DOUBLE PRECISION, largo_m DOUBLE PRECISION, ancho_m DOUBLE PRECISION,
                    peso_kg DOUBLE PRECISION, cbm_un DOUBLE PRECISION,
                    raw_payload   TEXT,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_costitem_sku ON cost_item (LOWER(sku))")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_costitem_lote ON cost_item (lote_id)")

            # Migracion: agregar columnas nuevas para el parser corregido del CSV.
            # Checkeamos primero information_schema (lectura barata, no toma lock)
            # antes de hacer ALTER TABLE (que toma AccessExclusiveLock y puede
            # generar deadlocks entre procesos cuando dos backends arrancan
            # simultaneamente — pasaba en local con --reload).
            cur.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'cost_item'
            """)
            existing_cols = {r["column_name"] for r in cur.fetchall()}
            new_cols = [
                "costo_unit_usd_max DOUBLE PRECISION",
                "costo_unit_usd_min DOUBLE PRECISION",
                "costo_unit_ars DOUBLE PRECISION",
                "costo_con_iva_unit_ars DOUBLE PRECISION",
                "rent_neta_lote_ars DOUBLE PRECISION",
                "facturacion_ars DOUBLE PRECISION",
            ]
            for col_def in new_cols:
                col_name = col_def.split()[0]
                if col_name not in existing_cols:
                    cur.execute(f"ALTER TABLE cost_item ADD COLUMN IF NOT EXISTS {col_def}")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS usd_rate_cache (
                    id          INTEGER PRIMARY KEY CHECK (id = 1),
                    venta       DOUBLE PRECISION NOT NULL,
                    compra      DOUBLE PRECISION,
                    source      TEXT NOT NULL,
                    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
        _INITIALIZED = True


# ============================================================
# LOTES
# ============================================================

def upsert_lote(
    *,
    lote: str,
    proveedor: str | None,
    fecha_ingreso: str | None,
    origen: str | None,
    envio: str | None,
    moneda: str | None,
    source_file: str | None,
    imported_by: str,
    items: list[dict],
) -> dict:
    """Replace-on-import: borra el lote existente con mismo nombre + lo recrea."""
    init()
    with _LOCK, get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT id FROM cost_lote WHERE LOWER(lote) = LOWER(%s)",
            (lote,),
        )
        existing = cur.fetchone()
        replaced = False
        if existing:
            cur.execute("DELETE FROM cost_lote WHERE id = %s", (existing["id"],))
            replaced = True
        cur.execute(
            """
            INSERT INTO cost_lote
              (lote, proveedor, fecha_ingreso, origen, envio, moneda, source_file, imported_by, items_count)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
            """,
            (lote, proveedor, fecha_ingreso, origen, envio, moneda, source_file, imported_by, len(items)),
        )
        lote_id = cur.fetchone()["id"]

        for it in items:
            cur.execute(
                """
                INSERT INTO cost_item
                  (lote_id, sku, producto, categoria, sub_categoria, ncm, cantidad,
                   valor_max_usd, valor_min_usd,
                   costo_total_sin_iva_usd, costo_con_iva_usd,
                   costo_unit_usd_max, costo_unit_usd_min,
                   costo_unit_ars, costo_con_iva_unit_ars,
                   precio_ars, rentabilidad_ars, pct_rentabilidad,
                   rent_neta_lote_ars, facturacion_ars,
                   alto_m, largo_m, ancho_m, peso_kg, cbm_un,
                   raw_payload)
                VALUES (%s,%s,%s,%s,%s,%s,%s,
                        %s,%s,
                        %s,%s,
                        %s,%s,
                        %s,%s,
                        %s,%s,%s,
                        %s,%s,
                        %s,%s,%s,%s,%s,
                        %s)
                """,
                (
                    lote_id,
                    (it.get("sku") or "").strip(),
                    it.get("producto"),
                    it.get("categoria"),
                    it.get("sub_categoria"),
                    it.get("ncm"),
                    it.get("cantidad"),
                    it.get("valor_max_usd"),
                    it.get("valor_min_usd"),
                    it.get("costo_total_sin_iva_usd"),
                    it.get("costo_con_iva_usd"),
                    it.get("costo_unit_usd_max"),
                    it.get("costo_unit_usd_min"),
                    it.get("costo_unit_ars"),
                    it.get("costo_con_iva_unit_ars"),
                    it.get("precio_ars"),
                    it.get("rentabilidad_ars"),
                    it.get("pct_rentabilidad"),
                    it.get("rent_neta_lote_ars"),
                    it.get("facturacion_ars"),
                    it.get("alto_m"), it.get("largo_m"), it.get("ancho_m"),
                    it.get("peso_kg"), it.get("cbm_un"),
                    json.dumps(it.get("raw_payload") or {}, ensure_ascii=False),
                ),
            )
        return {"lote_id": lote_id, "replaced": replaced, "items_count": len(items)}


def list_lotes() -> list[dict]:
    init()
    with _LOCK, get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT l.*,
                   (SELECT COUNT(DISTINCT sku) FROM cost_item WHERE lote_id = l.id) AS skus
            FROM cost_lote l
            ORDER BY l.imported_at DESC
        """)
        rows = cur.fetchall()
    return [_normalize(r) for r in rows]


def get_lote(lote_id: int) -> dict | None:
    init()
    with _LOCK, get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM cost_lote WHERE id = %s", (lote_id,))
        l = cur.fetchone()
        if not l:
            return None
        cur.execute("SELECT * FROM cost_item WHERE lote_id = %s ORDER BY sku", (lote_id,))
        items = cur.fetchall()
    return {"lote": _normalize(l), "items": [_normalize(i) for i in items]}


def delete_lote(lote_id: int) -> bool:
    init()
    with _LOCK, get_conn() as c, c.cursor() as cur:
        cur.execute("DELETE FROM cost_lote WHERE id = %s", (lote_id,))
        return cur.rowcount > 0


# ============================================================
# COSTOS VIGENTES POR SKU (ultimo lote por SKU)
# ============================================================

def current_costs(search: str | None = None, limit: int = 500) -> list[dict]:
    """Costo vigente = lote mas reciente por SKU (por imported_at)."""
    init()
    sql = """
        WITH ranked AS (
            SELECT i.*, l.lote, l.proveedor, l.fecha_ingreso, l.imported_at,
                   ROW_NUMBER() OVER (PARTITION BY LOWER(i.sku) ORDER BY l.imported_at DESC, i.id DESC) AS rn
            FROM cost_item i
            JOIN cost_lote l ON l.id = i.lote_id
        )
        SELECT * FROM ranked WHERE rn = 1
    """
    params: list = []
    if search:
        sql += " AND (sku ILIKE %s OR producto ILIKE %s) "
        params.extend([f"%{search}%", f"%{search}%"])
    sql += " ORDER BY sku LIMIT %s"
    params.append(limit)
    with _LOCK, get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return [_normalize(r) for r in rows]


def cost_by_sku(sku: str) -> dict | None:
    """Costo vigente + historial completo por SKU."""
    init()
    with _LOCK, get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT i.*, l.lote, l.proveedor, l.fecha_ingreso, l.imported_at
            FROM cost_item i
            JOIN cost_lote l ON l.id = i.lote_id
            WHERE LOWER(i.sku) = LOWER(%s)
            ORDER BY l.imported_at DESC
        """, (sku,))
        rows = cur.fetchall()
    if not rows:
        return None
    items = [_normalize(r) for r in rows]
    return {"sku": sku, "current": items[0], "history": items}


# ============================================================
# USD RATE CACHE
# ============================================================

def get_cached_rate() -> dict | None:
    init()
    with _LOCK, get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM usd_rate_cache WHERE id = 1")
        r = cur.fetchone()
    return _normalize(r) if r else None


def set_cached_rate(*, venta: float, compra: float | None, source: str) -> None:
    init()
    with _LOCK, get_conn() as c, c.cursor() as cur:
        cur.execute("""
            INSERT INTO usd_rate_cache (id, venta, compra, source, fetched_at)
            VALUES (1, %s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                venta = EXCLUDED.venta,
                compra = EXCLUDED.compra,
                source = EXCLUDED.source,
                fetched_at = EXCLUDED.fetched_at
        """, (venta, compra, source))


# ============================================================
# Helpers
# ============================================================

def _normalize(row: dict | None) -> dict:
    """Convierte timestamps a ISO string para serializar a JSON."""
    if row is None:
        return {}
    d = dict(row)
    for k, v in list(d.items()):
        if isinstance(v, dt.datetime):
            d[k] = v.isoformat()
    return d

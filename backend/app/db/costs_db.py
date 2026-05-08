"""
Costos de importacion (lote + item por SKU). SQLite local.
Auto-migra al boot. Replace-on-import por (lote): si subis el mismo lote
otra vez, se reemplazan todos sus items.
"""
from __future__ import annotations

import datetime as dt
import json
import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "costs.db"
_LOCK = threading.RLock()
_INITIALIZED = False


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    return c


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with _conn() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS cost_lote (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    lote          TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    proveedor     TEXT,
                    fecha_ingreso TEXT,
                    origen        TEXT,
                    envio         TEXT,
                    moneda        TEXT,
                    source_file   TEXT,
                    imported_at   TEXT NOT NULL,
                    imported_by   TEXT NOT NULL,
                    items_count   INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS cost_item (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    lote_id       INTEGER NOT NULL REFERENCES cost_lote(id) ON DELETE CASCADE,
                    sku           TEXT NOT NULL COLLATE NOCASE,
                    producto      TEXT,
                    categoria     TEXT,
                    sub_categoria TEXT,
                    ncm           TEXT,
                    cantidad      INTEGER,
                    valor_max_usd REAL,
                    valor_min_usd REAL,
                    costo_total_sin_iva_usd REAL,
                    costo_con_iva_usd       REAL,
                    precio_ars              REAL,
                    rentabilidad_ars        REAL,
                    pct_rentabilidad        REAL,
                    alto_m REAL, largo_m REAL, ancho_m REAL,
                    peso_kg REAL, cbm_un REAL,
                    raw_payload   TEXT,
                    created_at    TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_costitem_sku ON cost_item(sku);
                CREATE INDEX IF NOT EXISTS idx_costitem_lote ON cost_item(lote_id);

                CREATE TABLE IF NOT EXISTS usd_rate_cache (
                    id          INTEGER PRIMARY KEY CHECK (id = 1),
                    venta       REAL NOT NULL,
                    compra      REAL,
                    source      TEXT NOT NULL,
                    fetched_at  TEXT NOT NULL
                );
            """)
            c.commit()
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
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with _LOCK, _conn() as c:
        existing = c.execute("SELECT id FROM cost_lote WHERE lote = ? COLLATE NOCASE", (lote,)).fetchone()
        replaced = False
        if existing:
            c.execute("DELETE FROM cost_lote WHERE id = ?", (existing["id"],))
            replaced = True
        cur = c.execute(
            """
            INSERT INTO cost_lote
              (lote, proveedor, fecha_ingreso, origen, envio, moneda, source_file, imported_at, imported_by, items_count)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            """,
            (lote, proveedor, fecha_ingreso, origen, envio, moneda, source_file, now, imported_by, len(items)),
        )
        lote_id = cur.lastrowid

        for it in items:
            c.execute(
                """
                INSERT INTO cost_item
                  (lote_id, sku, producto, categoria, sub_categoria, ncm, cantidad,
                   valor_max_usd, valor_min_usd, costo_total_sin_iva_usd, costo_con_iva_usd,
                   precio_ars, rentabilidad_ars, pct_rentabilidad,
                   alto_m, largo_m, ancho_m, peso_kg, cbm_un,
                   raw_payload, created_at)
                VALUES (?,?,?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?,?, ?,?)
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
                    it.get("precio_ars"),
                    it.get("rentabilidad_ars"),
                    it.get("pct_rentabilidad"),
                    it.get("alto_m"), it.get("largo_m"), it.get("ancho_m"),
                    it.get("peso_kg"), it.get("cbm_un"),
                    json.dumps(it.get("raw_payload") or {}, ensure_ascii=False),
                    now,
                ),
            )
        c.commit()
        return {"lote_id": lote_id, "replaced": replaced, "items_count": len(items)}


def list_lotes() -> list[dict]:
    init()
    with _LOCK, _conn() as c:
        rows = c.execute("""
            SELECT l.*,
                   (SELECT COUNT(DISTINCT sku) FROM cost_item WHERE lote_id = l.id) AS skus
            FROM cost_lote l
            ORDER BY l.imported_at DESC
        """).fetchall()
    return [dict(r) for r in rows]


def get_lote(lote_id: int) -> dict | None:
    init()
    with _LOCK, _conn() as c:
        l = c.execute("SELECT * FROM cost_lote WHERE id = ?", (lote_id,)).fetchone()
        if not l:
            return None
        items = c.execute("SELECT * FROM cost_item WHERE lote_id = ? ORDER BY sku", (lote_id,)).fetchall()
    return {"lote": dict(l), "items": [dict(i) for i in items]}


def delete_lote(lote_id: int) -> bool:
    init()
    with _LOCK, _conn() as c:
        cur = c.execute("DELETE FROM cost_lote WHERE id = ?", (lote_id,))
        c.commit()
        return cur.rowcount > 0


# ============================================================
# COSTOS VIGENTES POR SKU (último lote por SKU)
# ============================================================

def current_costs(search: str | None = None, limit: int = 500) -> list[dict]:
    """Costo vigente = lote más reciente por SKU (por imported_at)."""
    init()
    sql = """
        WITH ranked AS (
            SELECT i.*, l.lote, l.proveedor, l.fecha_ingreso, l.imported_at,
                   ROW_NUMBER() OVER (PARTITION BY i.sku ORDER BY l.imported_at DESC, i.id DESC) AS rn
            FROM cost_item i
            JOIN cost_lote l ON l.id = i.lote_id
        )
        SELECT * FROM ranked WHERE rn = 1
    """
    params: list = []
    if search:
        sql += " AND (sku LIKE ? COLLATE NOCASE OR producto LIKE ? COLLATE NOCASE) "
        params.extend([f"%{search}%", f"%{search}%"])
    sql += " ORDER BY sku LIMIT ?"
    params.append(limit)
    with _LOCK, _conn() as c:
        rows = c.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def cost_by_sku(sku: str) -> dict | None:
    """Costo vigente + historial completo por SKU."""
    init()
    with _LOCK, _conn() as c:
        rows = c.execute("""
            SELECT i.*, l.lote, l.proveedor, l.fecha_ingreso, l.imported_at
            FROM cost_item i
            JOIN cost_lote l ON l.id = i.lote_id
            WHERE i.sku = ? COLLATE NOCASE
            ORDER BY l.imported_at DESC
        """, (sku,)).fetchall()
    if not rows:
        return None
    items = [dict(r) for r in rows]
    return {"sku": sku, "current": items[0], "history": items}


# ============================================================
# USD RATE CACHE
# ============================================================

def get_cached_rate() -> dict | None:
    init()
    with _LOCK, _conn() as c:
        r = c.execute("SELECT * FROM usd_rate_cache WHERE id = 1").fetchone()
    return dict(r) if r else None


def set_cached_rate(*, venta: float, compra: float | None, source: str) -> None:
    init()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with _LOCK, _conn() as c:
        c.execute("""
            INSERT INTO usd_rate_cache (id, venta, compra, source, fetched_at)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET venta=excluded.venta, compra=excluded.compra,
                                          source=excluded.source, fetched_at=excluded.fetched_at
        """, (venta, compra, source, now))
        c.commit()

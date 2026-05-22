"""
Ejecuta create_perf_indexes.sql en los RDS correctos (unistore + unidrop).

UN SOLO COMANDO:
    railway.cmd run --service backend python backend/scripts/run_perf_indexes.py

Que hace:
  1. Abre los SSH tunnels via app.db.engines (mismo path que la app).
  2. Routea cada CREATE INDEX a la unidad correcta segun el schema.
  3. Corre con AUTOCOMMIT (requisito de CREATE INDEX CONCURRENTLY).
  4. Reporta OK / SKIP / ERROR por cada index. Idempotente (IF NOT EXISTS).

Tiempo esperado: 1-5 min por unidad segun tamano de las tablas. Los indexes
se crean en background sin lockear (CONCURRENTLY).
"""
from __future__ import annotations

import logging
import os
import re
import sys
import time

# Permite correr desde backend/ o desde la raiz del repo
HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(HERE)
sys.path.insert(0, BACKEND_DIR)

from sqlalchemy import text

from app.db.engines import get_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
log = logging.getLogger("perf-indexes")


# Mapeo schema -> unidad. La unica ambiguedad es "public" pero todas las
# tablas public.* del SQL son de unidrop (PaymentIntent, User, tienda_nube_*).
SCHEMA_TO_UNIT = {
    "tienda_nube": "unistore",
    "digip": "unistore",
    "meli": "unistore",
    "public": "unidrop",
    "mercado_libre_dev": "unidrop",
}


def _parse_statements(sql_text: str) -> list[tuple[str, str, str]]:
    """Devuelve lista de (unit, index_name, statement) parseando el SQL.
    Omite comentarios y stamements vacios."""
    # Quitar comentarios SQL (-- ... fin de linea)
    cleaned = re.sub(r"--[^\n]*", "", sql_text)
    raw_statements = [s.strip() for s in cleaned.split(";") if s.strip()]
    parsed: list[tuple[str, str, str]] = []
    for stmt in raw_statements:
        if not stmt.upper().startswith("CREATE INDEX"):
            continue
        # Extraer index_name y schema target
        m = re.search(r"CREATE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\.", stmt, re.I)
        if not m:
            log.warning("No pude parsear statement: %s", stmt[:80])
            continue
        index_name = m.group(1)
        schema = m.group(2)
        unit = SCHEMA_TO_UNIT.get(schema)
        if not unit:
            log.warning("Schema desconocido '%s' en index %s - SKIP", schema, index_name)
            continue
        parsed.append((unit, index_name, stmt))
    return parsed


def _run_one(unit: str, index_name: str, sql: str) -> str:
    """Devuelve 'OK', 'EXISTS' (ya estaba), o el mensaje de error."""
    eng = get_engine(unit)
    # CREATE INDEX CONCURRENTLY NO puede ir dentro de transaccion: forzamos AUTOCOMMIT.
    with eng.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        try:
            t0 = time.monotonic()
            c.execute(text(sql))
            elapsed = time.monotonic() - t0
            return f"OK ({elapsed:.1f}s)"
        except Exception as e:
            msg = str(e)
            # IF NOT EXISTS hace que no falle si ya existe - pero algunos errores
            # benignos (relation already exists con nombre distinto) los degradamos.
            if "already exists" in msg.lower():
                return "EXISTS"
            return f"ERROR: {msg[:200]}"


def main() -> int:
    sql_path = os.path.join(HERE, "create_perf_indexes.sql")
    if not os.path.isfile(sql_path):
        log.error("No encuentro %s", sql_path)
        return 1
    with open(sql_path, encoding="utf-8") as f:
        sql_text = f.read()

    statements = _parse_statements(sql_text)
    if not statements:
        log.error("No se parseo ningun CREATE INDEX. Verificar el .sql")
        return 1

    by_unit: dict[str, list[tuple[str, str]]] = {}
    for unit, name, stmt in statements:
        by_unit.setdefault(unit, []).append((name, stmt))

    log.info("Ejecutando %d indexes en %d unidades", len(statements), len(by_unit))
    for unit, items in by_unit.items():
        log.info("  - %s: %d indexes", unit, len(items))

    results: dict[str, list[tuple[str, str]]] = {}
    total = sum(len(v) for v in by_unit.values())
    done = 0
    for unit, items in by_unit.items():
        log.info("=" * 60)
        log.info("Unidad: %s", unit.upper())
        log.info("=" * 60)
        # Forzar apertura del engine + tunnel antes del primer CREATE
        try:
            get_engine(unit)
        except Exception as e:
            log.error("No pude conectar a %s: %s", unit, e)
            for name, _ in items:
                results.setdefault(unit, []).append((name, f"ERROR: conexion {e}"))
                done += 1
            continue
        for name, stmt in items:
            done += 1
            status = _run_one(unit, name, stmt)
            results.setdefault(unit, []).append((name, status))
            tag = "OK" if status.startswith("OK") else ("SKIP" if status == "EXISTS" else "FAIL")
            log.info("[%d/%d] %-6s %s :: %s", done, total, tag, name, status)

    # Resumen
    log.info("=" * 60)
    log.info("RESUMEN")
    log.info("=" * 60)
    total_ok = total_skip = total_fail = 0
    for unit, items in results.items():
        ok = sum(1 for _, s in items if s.startswith("OK"))
        skip = sum(1 for _, s in items if s == "EXISTS")
        fail = sum(1 for _, s in items if s.startswith("ERROR"))
        total_ok += ok
        total_skip += skip
        total_fail += fail
        log.info("  %s: %d creados, %d ya existian, %d fallos", unit, ok, skip, fail)

    log.info("Total: %d OK / %d SKIP / %d FAIL", total_ok, total_skip, total_fail)

    if total_fail:
        log.warning("Hubo fallos. Revisa los mensajes de ERROR arriba.")
        # Mostrar los fallos al final por si la salida fue larga
        for unit, items in results.items():
            for name, status in items:
                if status.startswith("ERROR"):
                    log.warning("  %s/%s: %s", unit, name, status)
        return 2

    log.info("Done. Refrescar la app y verificar que los modales abren rapido.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

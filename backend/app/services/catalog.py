"""
Data catalog: introspection de las 3 BBDD para alimentar el ER interactivo.
Exporta tablas, columnas, FKs y un grafo de relaciones para que el equipo
de desarrollo entienda la estructura de las datos.
"""
from __future__ import annotations

from app.db.engines import get_engine
from app.services._utils import q

UNITS = ("unistore", "unidrop", "unidev")


def list_tables(unit: str) -> list[dict]:
    eng = get_engine(unit)
    rows = q(eng, """
        SELECT n.nspname AS schema, c.relname AS table_name,
               c.reltuples::bigint AS approx_rows,
               pg_size_pretty(pg_total_relation_size(c.oid)) AS size_pretty,
               obj_description(c.oid) AS description
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema','aws_dms_internal','rdsadmin')
          AND n.nspname NOT LIKE 'pg_%'
          AND c.relkind = 'r'
        ORDER BY n.nspname, c.relname
    """) or []
    return [{
        "schema": r[0], "table": r[1],
        "approx_rows": int(r[2] or 0),
        "size": r[3] or "",
        "description": r[4] or "",
    } for r in rows]


def list_columns(unit: str, schema: str | None = None, table: str | None = None) -> list[dict]:
    eng = get_engine(unit)
    where = []
    params: dict = {}
    if schema:
        where.append('c.table_schema = :schema')
        params["schema"] = schema
    if table:
        where.append('c.table_name = :table')
        params["table"] = table
    where.append("c.table_schema NOT IN ('pg_catalog','information_schema')")
    where.append("c.table_schema NOT LIKE 'pg_%'")
    sql = f"""
        SELECT c.table_schema, c.table_name, c.column_name, c.data_type,
               c.is_nullable, c.column_default,
               CASE WHEN pk.column_name IS NOT NULL THEN 'YES' ELSE '' END AS pk,
               col_description(format('%I.%I', c.table_schema, c.table_name)::regclass::oid, c.ordinal_position) AS description
        FROM information_schema.columns c
        LEFT JOIN (
            SELECT kcu.table_schema, kcu.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_name = tc.constraint_name
             AND kcu.table_schema = tc.table_schema
             AND kcu.table_name = tc.table_name
            WHERE tc.constraint_type = 'PRIMARY KEY'
        ) pk
          ON pk.table_schema = c.table_schema
         AND pk.table_name = c.table_name
         AND pk.column_name = c.column_name
        WHERE {' AND '.join(where)}
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
    """
    rows = q(eng, sql, params) or []
    return [{
        "schema": r[0], "table": r[1], "column": r[2],
        "data_type": r[3], "is_nullable": r[4],
        "default": r[5], "pk": r[6] == "YES",
        "description": r[7] or "",
    } for r in rows]


def list_foreign_keys(unit: str) -> list[dict]:
    """Foreign keys explicitas registradas en information_schema."""
    eng = get_engine(unit)
    rows = q(eng, """
        SELECT
          tc.table_schema AS from_schema,
          tc.table_name AS from_table,
          kcu.column_name AS from_column,
          ccu.table_schema AS to_schema,
          ccu.table_name AS to_table,
          ccu.column_name AS to_column,
          tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
        ORDER BY 1,2,3
    """) or []
    return [{
        "from_schema": r[0], "from_table": r[1], "from_column": r[2],
        "to_schema": r[3], "to_table": r[4], "to_column": r[5],
        "constraint": r[6],
    } for r in rows]


def implicit_relations(unit: str) -> list[dict]:
    """
    Heuristica para detectar relaciones implicitas (sin FK declarada): columnas
    cuyo nombre es 'XId' o 'X_id' apuntando a tablas con nombre similar.
    """
    eng = get_engine(unit)
    rows = q(eng, """
        WITH cols AS (
            SELECT c.table_schema, c.table_name, c.column_name
            FROM information_schema.columns c
            WHERE c.table_schema NOT IN ('pg_catalog','information_schema')
              AND c.table_schema NOT LIKE 'pg_%'
              AND (
                  c.column_name ~ '^[a-zA-Z]+(Id|_id)$'
              )
        ),
        tables AS (
            SELECT DISTINCT n.nspname AS schema, c.relname AS table_name
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r'
              AND n.nspname NOT IN ('pg_catalog','information_schema')
              AND n.nspname NOT LIKE 'pg_%'
        )
        SELECT cols.table_schema, cols.table_name, cols.column_name,
               t.schema AS to_schema, t.table_name AS to_table
        FROM cols
        JOIN tables t
          ON LOWER(REPLACE(REPLACE(cols.column_name,'_id',''),'Id','')) = LOWER(REGEXP_REPLACE(t.table_name,'s$',''))
          OR LOWER(REPLACE(REPLACE(cols.column_name,'_id',''),'Id','')) = LOWER(t.table_name)
        WHERE NOT (cols.table_schema = t.schema AND cols.table_name = t.table_name)
        ORDER BY 1,2,3
    """) or []
    return [{
        "from_schema": r[0], "from_table": r[1], "from_column": r[2],
        "to_schema": r[3], "to_table": r[4], "to_column": "id",
        "implicit": True,
    } for r in rows]


def graph(unit: str) -> dict:
    """Estructura para visualizar - nodos (tablas) + edges (FKs declaradas + implicitas)."""
    tables = list_tables(unit)
    fks = list_foreign_keys(unit)
    impl = implicit_relations(unit)
    nodes = [
        {
            "id": f"{t['schema']}.{t['table']}",
            "schema": t["schema"],
            "label": t["table"],
            "rows": t["approx_rows"],
            "size": t["size"],
            "description": t["description"],
        }
        for t in tables
    ]
    edges = []
    seen = set()
    for f in fks:
        eid = f"{f['from_schema']}.{f['from_table']}.{f['from_column']}->{f['to_schema']}.{f['to_table']}.{f['to_column']}"
        if eid in seen: continue
        seen.add(eid)
        edges.append({
            "id": eid,
            "source": f"{f['from_schema']}.{f['from_table']}",
            "target": f"{f['to_schema']}.{f['to_table']}",
            "from_column": f["from_column"], "to_column": f["to_column"],
            "type": "explicit",
        })
    for f in impl:
        eid = f"{f['from_schema']}.{f['from_table']}.{f['from_column']}->{f['to_schema']}.{f['to_table']}.{f['to_column']}"
        if eid in seen: continue
        seen.add(eid)
        edges.append({
            "id": eid,
            "source": f"{f['from_schema']}.{f['from_table']}",
            "target": f"{f['to_schema']}.{f['to_table']}",
            "from_column": f["from_column"], "to_column": f["to_column"],
            "type": "implicit",
        })
    return {"unit": unit, "nodes": nodes, "edges": edges,
            "stats": {"tables": len(nodes), "edges": len(edges)}}


def graph_with_columns(unit: str) -> dict:
    """Igual que graph() pero incluye las columnas de cada tabla en cada nodo,
    con description (Postgres comment + heuristica) y fk_target cuando aplica."""
    from app.services.column_dict import describe_column

    g = graph(unit)
    cols = list_columns(unit)
    by_table: dict[str, list[dict]] = {}
    for c in cols:
        key = f"{c['schema']}.{c['table']}"
        by_table.setdefault(key, []).append({
            "name": c["column"],
            "type": c["data_type"],
            "pk": c["pk"],
            "nullable": c["is_nullable"] == "YES",
            "default": c.get("default"),
            "description": c.get("description") or "",
        })

    # Mapa FK: (source_table, from_col) -> {to_table, to_col, type}
    fk_map: dict[tuple[str, str], dict] = {}
    for e in g["edges"]:
        fk_map[(e["source"], e["from_column"])] = {
            "to_table": e["target"],
            "to_column": e["to_column"],
            "type": e["type"],
        }

    for n in g["nodes"]:
        n_cols = by_table.get(n["id"], [])
        for c in n_cols:
            fk_info = fk_map.get((n["id"], c["name"]))
            c["fk"] = fk_info is not None
            if fk_info:
                c["fk_target"] = fk_info
            if not c.get("description"):
                heuristic = describe_column(c["name"], c.get("type"), n.get("label"))
                if heuristic:
                    c["description"] = heuristic
                    c["description_source"] = "heuristic"
            else:
                c["description_source"] = "postgres_comment"
        n["columns"] = n_cols
    return g


# Heuristicas conocidas para detectar relaciones cross-database
CROSS_DB_HINTS: list[tuple[str, str, str, str, str, str]] = [
    # (from_unit, from_col, to_unit, to_schema, to_table, to_col)
    ("unidev", "unistore_order_id", "unistore", "tienda_nube", "Order", "id"),
    ("unidev", "unistore_orden_id", "unistore", "tienda_nube", "Order", "id"),
    ("unidev", "unistore_item_orden_id", "unistore", "tienda_nube", "OrderItem", "id"),
    ("unidev", "factura_id", "unistore", "contabilium", "SalesOrder", "id"),
    ("unidev", "sku", "unistore", "tienda_nube", "OrderItem", "sku"),
    ("unidrop", "tienda_nube_id", "unistore", "tienda_nube", "Order", "id"),
    ("unidrop", "external_id", "unistore", "tienda_nube", "Product", "id"),
    ("unidrop", "mercadoLibreAccountId", "unistore", "meli", "meli_orders", "seller_meli_id"),
]


def cross_db_edges() -> list[dict]:
    """Detecta lazos entre las 3 BBDD usando hints + busqueda por nombre."""
    edges: list[dict] = []
    seen: set[str] = set()
    for from_unit, from_col, to_unit, to_schema, to_table, to_col in CROSS_DB_HINTS:
        try:
            from_eng = get_engine(from_unit)
        except Exception:
            continue
        rows = q(from_eng, """
            SELECT c.table_schema, c.table_name
            FROM information_schema.columns c
            WHERE c.table_schema NOT IN ('pg_catalog','information_schema')
              AND c.table_schema NOT LIKE 'pg_%'
              AND c.column_name = :col
        """, {"col": from_col}) or []
        try:
            to_eng = get_engine(to_unit)
            tgt_exists = q(to_eng, """
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = :s AND table_name = :t LIMIT 1
            """, {"s": to_schema, "t": to_table})
            if not tgt_exists:
                continue
        except Exception:
            continue
        for r in rows:
            from_schema, from_table = r[0], r[1]
            eid = f"{from_unit}.{from_schema}.{from_table}.{from_col}->{to_unit}.{to_schema}.{to_table}.{to_col}"
            if eid in seen:
                continue
            seen.add(eid)
            edges.append({
                "id": eid,
                "source": f"{from_unit}::{from_schema}.{from_table}",
                "target": f"{to_unit}::{to_schema}.{to_table}",
                "from_column": from_col,
                "to_column": to_col,
                "type": "cross_db",
                "from_unit": from_unit,
                "to_unit": to_unit,
            })
    return edges


def global_graph() -> dict:
    """Grafo con las 3 BBDD juntas + cross-DB edges detectadas."""
    all_nodes: list[dict] = []
    all_edges: list[dict] = []
    for unit in UNITS:
        try:
            g = graph_with_columns(unit)
        except Exception:
            continue
        for n in g["nodes"]:
            n2 = dict(n)
            n2["id"] = f"{unit}::{n['id']}"
            n2["unit"] = unit
            all_nodes.append(n2)
        for e in g["edges"]:
            e2 = dict(e)
            e2["id"] = f"{unit}::{e['id']}"
            e2["source"] = f"{unit}::{e['source']}"
            e2["target"] = f"{unit}::{e['target']}"
            e2["from_unit"] = unit
            e2["to_unit"] = unit
            all_edges.append(e2)
    cross = cross_db_edges()
    all_edges.extend(cross)
    return {
        "unit": "global",
        "nodes": all_nodes,
        "edges": all_edges,
        "stats": {
            "tables": len(all_nodes),
            "edges": len(all_edges),
            "cross_db_edges": len(cross),
        },
    }


def schemas_overview() -> dict:
    """Overview a nivel schema: 1 nodo por schema (con stats agregados),
    edges = cantidad de FKs entre schemas. Mucho mas digerible que ver
    162 tablas en pantalla."""
    schema_nodes: dict[str, dict] = {}
    schema_edges: dict[tuple[str, str], dict] = {}

    for unit in UNITS:
        try:
            g = graph(unit)
        except Exception:
            continue
        # Aggregar tablas por schema
        for n in g["nodes"]:
            sid = f"{unit}::{n['schema']}"
            if sid not in schema_nodes:
                schema_nodes[sid] = {
                    "id": sid,
                    "unit": unit,
                    "schema": n["schema"],
                    "label": n["schema"],
                    "tables": 0,
                    "rows": 0,
                    "edges_in": 0,
                    "edges_out": 0,
                }
            schema_nodes[sid]["tables"] += 1
            schema_nodes[sid]["rows"] += max(0, n.get("rows", 0))
        # Aggregar edges entre schemas (intra-DB)
        for e in g["edges"]:
            from_schema = e["source"].split(".")[0]
            to_schema = e["target"].split(".")[0]
            from_sid = f"{unit}::{from_schema}"
            to_sid = f"{unit}::{to_schema}"
            if from_sid == to_sid:
                continue  # ignoramos intra-schema (el nodo es el schema)
            key = (from_sid, to_sid)
            if key not in schema_edges:
                schema_edges[key] = {
                    "id": f"{from_sid}->{to_sid}",
                    "source": from_sid, "target": to_sid,
                    "type": "explicit" if e["type"] == "explicit" else "implicit",
                    "weight": 0,
                }
            schema_edges[key]["weight"] += 1
            if schema_edges[key]["type"] == "implicit" and e["type"] == "explicit":
                schema_edges[key]["type"] = "explicit"

    # Aggregar cross-DB edges al nivel schema
    for e in cross_db_edges():
        # source ya viene como "unit::schema.table"
        from_unit_schema = e["source"].split(".")[0]  # "unidev::public"
        to_unit_schema = e["target"].split(".")[0]    # "unistore::tienda_nube"
        key = (from_unit_schema, to_unit_schema)
        if key not in schema_edges:
            schema_edges[key] = {
                "id": f"{from_unit_schema}->{to_unit_schema}::cross",
                "source": from_unit_schema, "target": to_unit_schema,
                "type": "cross_db",
                "weight": 0,
            }
        schema_edges[key]["weight"] += 1
        if schema_edges[key]["type"] != "cross_db":
            schema_edges[key]["type"] = "cross_db"  # cross-DB tiene prioridad visual

    # Calcular edges_in / edges_out por schema
    for (src, tgt), e in schema_edges.items():
        if src in schema_nodes:
            schema_nodes[src]["edges_out"] += e["weight"]
        if tgt in schema_nodes:
            schema_nodes[tgt]["edges_in"] += e["weight"]

    return {
        "level": "schemas",
        "nodes": list(schema_nodes.values()),
        "edges": list(schema_edges.values()),
        "stats": {
            "schemas": len(schema_nodes),
            "edges": len(schema_edges),
            "cross_db_edges": sum(1 for e in schema_edges.values() if e["type"] == "cross_db"),
        },
    }


def cross_db_subgraph() -> dict:
    """Solo las tablas involucradas en relaciones cross-DB + sus vecinas inmediatas
    intra-DB (las que linkean directamente a estas). Util para entender el 'puente'
    entre las 3 BBDD sin saturarse con todo el catalogo."""
    cross = cross_db_edges()
    # Set de tablas que participan en cross-DB
    cross_table_ids: set[str] = set()
    for e in cross:
        cross_table_ids.add(e["source"])
        cross_table_ids.add(e["target"])

    # Cargar grafos completos por unit
    full_nodes: list[dict] = []
    full_edges: list[dict] = []
    for unit in UNITS:
        try:
            g = graph_with_columns(unit)
        except Exception:
            continue
        for n in g["nodes"]:
            n2 = dict(n)
            n2["id"] = f"{unit}::{n['id']}"
            n2["unit"] = unit
            full_nodes.append(n2)
        for e in g["edges"]:
            e2 = dict(e)
            e2["id"] = f"{unit}::{e['id']}"
            e2["source"] = f"{unit}::{e['source']}"
            e2["target"] = f"{unit}::{e['target']}"
            full_edges.append(e2)

    # Sumar tablas vecinas (1 hop) de cada tabla cross
    neighbors: set[str] = set(cross_table_ids)
    for e in full_edges:
        if e["source"] in cross_table_ids:
            neighbors.add(e["target"])
        if e["target"] in cross_table_ids:
            neighbors.add(e["source"])

    nodes = [n for n in full_nodes if n["id"] in neighbors]
    edges_filtered = [e for e in full_edges if e["source"] in neighbors and e["target"] in neighbors]
    edges_filtered.extend(cross)

    return {
        "level": "cross_db",
        "nodes": nodes,
        "edges": edges_filtered,
        "stats": {
            "tables": len(nodes),
            "edges": len(edges_filtered),
            "cross_db_edges": len(cross),
        },
    }


def search_columns(unit: str, query: str, limit: int = 100) -> list[dict]:
    """Busqueda case-insensitive de columnas + tablas."""
    eng = get_engine(unit)
    rows = q(eng, """
        SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable
        FROM information_schema.columns c
        WHERE c.table_schema NOT IN ('pg_catalog','information_schema')
          AND c.table_schema NOT LIKE 'pg_%'
          AND (
              c.column_name ILIKE :q
              OR c.table_name ILIKE :q
          )
        ORDER BY (c.column_name ILIKE :exact_q) DESC,
                 c.table_schema, c.table_name, c.column_name
        LIMIT :lim
    """, {"q": f"%{query}%", "exact_q": query, "lim": limit}) or []
    return [{
        "schema": r[0], "table": r[1], "column": r[2],
        "data_type": r[3], "is_nullable": r[4],
    } for r in rows]

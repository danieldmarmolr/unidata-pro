"""
DB layer del modulo Flujo de Fondos.

Las 11 tablas viven en `public` del Supabase UNIDATA, migradas desde el
Supabase de Pedro el 2026-05-21.
"""
from __future__ import annotations

from typing import Any

import psycopg2.extras

from app.db.local_persistence import get_conn


def _to_dict(row: dict | None) -> dict | None:
    if not row:
        return None
    d = dict(row)
    for k, v in d.items():
        if v is None:
            continue
        if hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    return d


def _to_list(rows: list[dict]) -> list[dict]:
    return [_to_dict(r) for r in rows]


def _adapt(v):
    if isinstance(v, (dict, list)):
        return psycopg2.extras.Json(v)
    return v


BANCO_CONSOLIDADO_NOMBRE = "Total consolidado"


# ============================================================
# Maestros - Empresas
# ============================================================

def list_empresas(only_active: bool = True) -> list[dict]:
    sql = 'SELECT * FROM public."empresas"'
    if only_active:
        sql += " WHERE activa = TRUE"
    sql += " ORDER BY nombre"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql)
        return _to_list(cur.fetchall())


def create_empresa(data: dict) -> dict:
    if not data.get("nombre", "").strip():
        raise ValueError("nombre requerido")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            'INSERT INTO public."empresas" (nombre, cuit, activa) VALUES (%s, %s, %s) RETURNING *',
            (data["nombre"].strip(), data.get("cuit"), data.get("activa", True)),
        )
        return _to_dict(cur.fetchone())


def update_empresa(eid: int, data: dict) -> dict | None:
    sets, params = [], []
    for k in ("nombre", "cuit", "activa"):
        if k in data:
            sets.append(f'"{k}" = %s')
            params.append(data[k])
    if not sets:
        return None
    params.append(eid)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f'UPDATE public."empresas" SET {", ".join(sets)} WHERE id = %s RETURNING *', params)
        return _to_dict(cur.fetchone())


def delete_empresa(eid: int) -> bool:
    with get_conn() as c, c.cursor() as cur:
        cur.execute('DELETE FROM public."empresas" WHERE id = %s', (eid,))
        return cur.rowcount > 0


# ============================================================
# Maestros - Unidades de negocio
# ============================================================

def list_unidades_negocio(only_active: bool = True) -> list[dict]:
    sql = 'SELECT * FROM public."unidades_negocio"'
    if only_active:
        sql += " WHERE activa = TRUE"
    sql += " ORDER BY nombre"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql)
        return _to_list(cur.fetchall())


def create_unidad_negocio(data: dict) -> dict:
    if not data.get("nombre", "").strip():
        raise ValueError("nombre requerido")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            'INSERT INTO public."unidades_negocio" (nombre, canal, activa, config_ingesta) VALUES (%s, %s, %s, %s) RETURNING *',
            (data["nombre"].strip(), data.get("canal", "otro"), data.get("activa", True), _adapt(data.get("config_ingesta", {}))),
        )
        return _to_dict(cur.fetchone())


def update_unidad_negocio(uid: int, data: dict) -> dict | None:
    sets, params = [], []
    for k in ("nombre", "canal", "activa", "config_ingesta"):
        if k in data:
            sets.append(f'"{k}" = %s')
            params.append(_adapt(data[k]) if k == "config_ingesta" else data[k])
    if not sets:
        return None
    params.append(uid)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f'UPDATE public."unidades_negocio" SET {", ".join(sets)} WHERE id = %s RETURNING *', params)
        return _to_dict(cur.fetchone())


def delete_unidad_negocio(uid: int) -> bool:
    with get_conn() as c, c.cursor() as cur:
        cur.execute('DELETE FROM public."unidades_negocio" WHERE id = %s', (uid,))
        return cur.rowcount > 0


# ============================================================
# Maestros - Bancos
# ============================================================

def list_bancos(only_active: bool = True, exclude_consolidado: bool = False) -> list[dict]:
    sql = 'SELECT * FROM public."bancos_medios_pago" WHERE 1=1'
    if only_active:
        sql += " AND activo = TRUE"
    if exclude_consolidado:
        sql += f" AND nombre != '{BANCO_CONSOLIDADO_NOMBRE}'"
    sql += " ORDER BY nombre"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql)
        return _to_list(cur.fetchall())


def create_banco(data: dict) -> dict:
    if not data.get("nombre", "").strip():
        raise ValueError("nombre requerido")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            'INSERT INTO public."bancos_medios_pago" (nombre, tipo, saldo_actual, moneda, activo) VALUES (%s, %s, %s, %s, %s) RETURNING *',
            (data["nombre"].strip(), data.get("tipo", "banco"), data.get("saldo_actual"), data.get("moneda", "ARS"), data.get("activo", True)),
        )
        return _to_dict(cur.fetchone())


def update_banco(bid: int, data: dict) -> dict | None:
    sets, params = [], []
    for k in ("nombre", "tipo", "saldo_actual", "moneda", "activo"):
        if k in data:
            sets.append(f'"{k}" = %s'); params.append(data[k])
    if not sets:
        return None
    params.append(bid)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f'UPDATE public."bancos_medios_pago" SET {", ".join(sets)} WHERE id = %s RETURNING *', params)
        return _to_dict(cur.fetchone())


def delete_banco(bid: int) -> bool:
    with get_conn() as c, c.cursor() as cur:
        cur.execute('DELETE FROM public."bancos_medios_pago" WHERE id = %s', (bid,))
        return cur.rowcount > 0


# ============================================================
# Maestros - Proveedores
# ============================================================

def list_proveedores() -> list[dict]:
    with get_conn() as c, c.cursor() as cur:
        cur.execute('SELECT * FROM public."proveedores" ORDER BY nombre')
        return _to_list(cur.fetchall())


def create_proveedor(data: dict) -> dict:
    if not data.get("nombre", "").strip():
        raise ValueError("nombre requerido")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public."proveedores"
              (nombre, cuit, prioridad, saldo_pendiente, notas, tags, contacto)
            VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *
            """,
            (data["nombre"].strip(), data.get("cuit"), data.get("prioridad", "media"),
             data.get("saldo_pendiente", 0), data.get("notas"), data.get("tags", []),
             _adapt(data.get("contacto", {}))),
        )
        return _to_dict(cur.fetchone())


def update_proveedor(pid: int, data: dict) -> dict | None:
    sets, params = [], []
    for k in ("nombre", "cuit", "prioridad", "saldo_pendiente", "notas", "tags", "contacto"):
        if k in data:
            sets.append(f'"{k}" = %s')
            params.append(_adapt(data[k]) if k == "contacto" else data[k])
    if not sets:
        return None
    sets.append('"updated_at" = NOW()')
    params.append(pid)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f'UPDATE public."proveedores" SET {", ".join(sets)} WHERE id = %s RETURNING *', params)
        return _to_dict(cur.fetchone())


def delete_proveedor(pid: int) -> bool:
    with get_conn() as c, c.cursor() as cur:
        cur.execute('DELETE FROM public."proveedores" WHERE id = %s', (pid,))
        return cur.rowcount > 0


# ============================================================
# Erogaciones
# ============================================================

def list_erogaciones(
    *, estado: str | None = None, empresa_id: int | None = None, banco_id: int | None = None,
    proveedor_id: int | None = None, fecha_desde: str | None = None, fecha_hasta: str | None = None,
    query: str | None = None, incluir_ocultas: bool = False, solo_atrasadas: bool = False,
    limit: int = 100, offset: int = 0,
) -> dict:
    where, params = [], []
    if estado: where.append("e.estado::text = %s"); params.append(estado)
    if empresa_id: where.append("e.empresa_id = %s"); params.append(empresa_id)
    if banco_id: where.append("e.banco_id = %s"); params.append(banco_id)
    if proveedor_id: where.append("e.proveedor_id = %s"); params.append(proveedor_id)
    if fecha_desde: where.append("e.fecha_pago >= %s"); params.append(fecha_desde)
    if fecha_hasta: where.append("e.fecha_pago <= %s"); params.append(fecha_hasta)
    if query:
        where.append("(e.descripcion ILIKE %s OR e.notas ILIKE %s OR e.categoria ILIKE %s)")
        q = f"%{query}%"; params.extend([q, q, q])
    if not incluir_ocultas: where.append("e.oculto = FALSE")
    if solo_atrasadas: where.append("e.fecha_pago < CURRENT_DATE AND e.estado::text IN ('pendiente','en_curso')")

    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    list_sql = f"""
        SELECT e.*, em.nombre AS empresa_nombre, b.nombre AS banco_nombre, p.nombre AS proveedor_nombre
        FROM public."erogaciones" e
        LEFT JOIN public."empresas" em ON em.id = e.empresa_id
        LEFT JOIN public."bancos_medios_pago" b ON b.id = e.banco_id
        LEFT JOIN public."proveedores" p ON p.id = e.proveedor_id
        {where_sql}
        ORDER BY e.fecha_pago DESC, e.id DESC LIMIT %s OFFSET %s
    """
    count_sql = f'SELECT COUNT(*) AS total FROM public."erogaciones" e {where_sql}'
    with get_conn() as c, c.cursor() as cur:
        cur.execute(list_sql, params + [limit, offset])
        items = _to_list(cur.fetchall())
        cur.execute(count_sql, params)
        total = cur.fetchone()["total"]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


def get_erogacion(eid: int) -> dict | None:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT e.*, em.nombre AS empresa_nombre, b.nombre AS banco_nombre, p.nombre AS proveedor_nombre
            FROM public."erogaciones" e
            LEFT JOIN public."empresas" em ON em.id = e.empresa_id
            LEFT JOIN public."bancos_medios_pago" b ON b.id = e.banco_id
            LEFT JOIN public."proveedores" p ON p.id = e.proveedor_id
            WHERE e.id = %s
            """,
            (eid,),
        )
        return _to_dict(cur.fetchone())


def create_erogacion(data: dict) -> dict:
    required = ("fecha_pago", "descripcion", "monto", "empresa_id", "banco_id")
    missing = [k for k in required if data.get(k) in (None, "")]
    if missing:
        raise ValueError(f"Faltan campos: {missing}")
    cols = ("fecha_pago", "descripcion", "monto", "moneda", "tipo_cambio", "empresa_id",
            "proveedor_id", "banco_id", "estado", "categoria", "subcategoria",
            "recurrencia_id", "es_recurrente", "es_critico", "notas", "prioridad_atraso", "oculto")
    values = [data["fecha_pago"], data["descripcion"], data["monto"], data.get("moneda", "ARS"),
              data.get("tipo_cambio"), data["empresa_id"], data.get("proveedor_id"), data["banco_id"],
              data.get("estado", "pendiente"), data.get("categoria"), data.get("subcategoria"),
              data.get("recurrencia_id"), bool(data.get("es_recurrente", False)),
              bool(data.get("es_critico", False)), data.get("notas"),
              data.get("prioridad_atraso", "normal"), bool(data.get("oculto", False))]
    ph = ",".join(["%s"] * len(cols))
    cols_sql = ", ".join(f'"{c}"' for c in cols)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f'INSERT INTO public."erogaciones" ({cols_sql}) VALUES ({ph}) RETURNING *', values)
        return _to_dict(cur.fetchone())


_EROG_UPD = {"fecha_pago", "descripcion", "monto", "moneda", "tipo_cambio", "empresa_id",
             "proveedor_id", "banco_id", "estado", "categoria", "subcategoria", "es_critico",
             "notas", "prioridad_atraso", "fecha_sugerida_tentativa", "oculto"}


def update_erogacion(eid: int, data: dict) -> dict | None:
    sets, params = [], []
    for k, v in data.items():
        if k not in _EROG_UPD: continue
        sets.append(f'"{k}" = %s'); params.append(v)
    if not sets:
        return get_erogacion(eid)
    sets.append('"updated_at" = NOW()')
    if data.get("estado") == "pagado":
        sets.append('"pagado_at" = COALESCE("pagado_at", NOW())')
    params.append(eid)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f'UPDATE public."erogaciones" SET {", ".join(sets)} WHERE id = %s RETURNING *', params)
        return _to_dict(cur.fetchone())


def delete_erogacion(eid: int) -> bool:
    with get_conn() as c, c.cursor() as cur:
        cur.execute('DELETE FROM public."erogaciones" WHERE id = %s', (eid,))
        return cur.rowcount > 0


# ============================================================
# Recurrencias
# ============================================================

def list_recurrencias(only_active: bool = False) -> list[dict]:
    sql = """
        SELECT r.*, p.nombre AS proveedor_nombre, e.nombre AS empresa_nombre, b.nombre AS banco_nombre
        FROM public."recurrencias" r
        LEFT JOIN public."proveedores" p ON p.id = r.proveedor_id
        LEFT JOIN public."empresas" e ON e.id = r.empresa_id
        LEFT JOIN public."bancos_medios_pago" b ON b.id = r.banco_id
    """
    if only_active:
        sql += " WHERE r.activa = TRUE"
    sql += " ORDER BY r.fecha_inicio DESC"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql)
        return _to_list(cur.fetchall())


def create_recurrencia(data: dict) -> dict:
    if not data.get("descripcion", "").strip() or not data.get("frecuencia") or not data.get("fecha_inicio"):
        raise ValueError("descripcion, frecuencia, fecha_inicio requeridos")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public."recurrencias"
              (descripcion, monto_base, frecuencia, fecha_inicio, fecha_fin, cuotas_totales,
               proveedor_id, empresa_id, banco_id, indexacion, activa)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *
            """,
            (data["descripcion"].strip(), data.get("monto_base"), data["frecuencia"],
             data["fecha_inicio"], data.get("fecha_fin"), data.get("cuotas_totales"),
             data.get("proveedor_id"), data.get("empresa_id"), data.get("banco_id"),
             _adapt(data.get("indexacion", {})), bool(data.get("activa", True))),
        )
        return _to_dict(cur.fetchone())


def update_recurrencia(rid: int, data: dict) -> dict | None:
    sets, params = [], []
    for k in ("descripcion", "monto_base", "frecuencia", "fecha_inicio", "fecha_fin",
              "cuotas_totales", "proveedor_id", "empresa_id", "banco_id", "indexacion", "activa"):
        if k in data:
            sets.append(f'"{k}" = %s')
            params.append(_adapt(data[k]) if k == "indexacion" else data[k])
    if not sets:
        return None
    params.append(rid)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f'UPDATE public."recurrencias" SET {", ".join(sets)} WHERE id = %s RETURNING *', params)
        return _to_dict(cur.fetchone())


def delete_recurrencia(rid: int) -> bool:
    with get_conn() as c, c.cursor() as cur:
        cur.execute('DELETE FROM public."recurrencias" WHERE id = %s', (rid,))
        return cur.rowcount > 0


# ============================================================
# Acuerdos
# ============================================================

def list_acuerdos(estado: str | None = None) -> list[dict]:
    sql = """
        SELECT a.*, p.nombre AS proveedor_nombre, e.id AS erogacion_id_ref, e.descripcion AS erogacion_descripcion
        FROM public."acuerdos" a
        LEFT JOIN public."proveedores" p ON p.id = a.proveedor_id
        LEFT JOIN public."erogaciones" e ON e.id = a.erogacion_id
    """
    params: list = []
    if estado:
        sql += " WHERE a.estado::text = %s"
        params.append(estado)
    sql += " ORDER BY a.created_at DESC"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return _to_list(cur.fetchall())


def create_acuerdo(data: dict) -> dict:
    if not data.get("proveedor_id") or not data.get("tipo") or not data.get("compromiso", "").strip():
        raise ValueError("proveedor_id, tipo, compromiso requeridos")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public."acuerdos"
              (proveedor_id, tipo, compromiso, fecha_compromiso, monto_compromiso, estado, contexto, erogacion_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *
            """,
            (data["proveedor_id"], data["tipo"], data["compromiso"].strip(),
             data.get("fecha_compromiso"), data.get("monto_compromiso"),
             data.get("estado", "pendiente"), data.get("contexto"), data.get("erogacion_id")),
        )
        return _to_dict(cur.fetchone())


def update_acuerdo(aid: int, data: dict) -> dict | None:
    sets, params = [], []
    for k in ("tipo", "compromiso", "fecha_compromiso", "monto_compromiso", "estado", "contexto", "erogacion_id", "fecha_resolucion"):
        if k in data:
            sets.append(f'"{k}" = %s'); params.append(data[k])
    if not sets:
        return None
    params.append(aid)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f'UPDATE public."acuerdos" SET {", ".join(sets)} WHERE id = %s RETURNING *', params)
        return _to_dict(cur.fetchone())


def delete_acuerdo(aid: int) -> bool:
    with get_conn() as c, c.cursor() as cur:
        cur.execute('DELETE FROM public."acuerdos" WHERE id = %s', (aid,))
        return cur.rowcount > 0


# ============================================================
# Ingresos puntuales
# ============================================================

def list_ingresos_puntuales(fecha_desde: str | None = None, fecha_hasta: str | None = None) -> list[dict]:
    sql = """
        SELECT i.*, e.nombre AS empresa_nombre, b.nombre AS banco_nombre
        FROM public."ingresos_puntuales" i
        LEFT JOIN public."empresas" e ON e.id = i.empresa_id
        LEFT JOIN public."bancos_medios_pago" b ON b.id = i.banco_id
    """
    where, params = [], []
    if fecha_desde: where.append("i.fecha >= %s"); params.append(fecha_desde)
    if fecha_hasta: where.append("i.fecha <= %s"); params.append(fecha_hasta)
    if where: sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY i.fecha DESC, i.id DESC"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return _to_list(cur.fetchall())


def create_ingreso_puntual(data: dict) -> dict:
    if not all(data.get(k) for k in ("fecha", "descripcion", "monto", "empresa_id")):
        raise ValueError("fecha, descripcion, monto, empresa_id requeridos")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public."ingresos_puntuales"
              (fecha, descripcion, monto, empresa_id, banco_id, categoria, notas, origen)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *
            """,
            (data["fecha"], data["descripcion"], data["monto"], data["empresa_id"],
             data.get("banco_id"), data.get("categoria"), data.get("notas"), data.get("origen", "manual")),
        )
        return _to_dict(cur.fetchone())


def update_ingreso_puntual(iid: int, data: dict) -> dict | None:
    sets, params = [], []
    for k in ("fecha", "descripcion", "monto", "empresa_id", "banco_id", "categoria", "notas"):
        if k in data:
            sets.append(f'"{k}" = %s'); params.append(data[k])
    if not sets:
        return None
    sets.append('"updated_at" = NOW()')
    params.append(iid)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f'UPDATE public."ingresos_puntuales" SET {", ".join(sets)} WHERE id = %s RETURNING *', params)
        return _to_dict(cur.fetchone())


def delete_ingreso_puntual(iid: int) -> bool:
    with get_conn() as c, c.cursor() as cur:
        cur.execute('DELETE FROM public."ingresos_puntuales" WHERE id = %s', (iid,))
        return cur.rowcount > 0


# ============================================================
# Saldos iniciales
# ============================================================

def list_saldos_iniciales(banco_id: int | None = None, limit: int = 100) -> list[dict]:
    sql = """
        SELECT s.*, b.nombre AS banco_nombre, b.tipo::text AS banco_tipo
        FROM public."saldos_iniciales" s
        LEFT JOIN public."bancos_medios_pago" b ON b.id = s.banco_id
    """
    where, params = [], []
    if banco_id: where.append("s.banco_id = %s"); params.append(banco_id)
    if where: sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY s.fecha DESC, s.id DESC LIMIT %s"
    params.append(limit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return _to_list(cur.fetchall())


def get_saldos_actuales_por_banco() -> list[dict]:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"""
            SELECT DISTINCT ON (s.banco_id) s.banco_id, s.fecha::text AS fecha, s.saldo, b.nombre, b.tipo::text AS tipo
            FROM public."saldos_iniciales" s
            JOIN public."bancos_medios_pago" b ON b.id = s.banco_id
            WHERE b.nombre != '{BANCO_CONSOLIDADO_NOMBRE}'
            ORDER BY s.banco_id, s.fecha DESC
            """
        )
        return _to_list(cur.fetchall())


def create_saldo_inicial(data: dict) -> dict:
    if not all(data.get(k) is not None for k in ("fecha", "banco_id", "saldo")):
        raise ValueError("fecha, banco_id, saldo requeridos")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            'INSERT INTO public."saldos_iniciales" (fecha, banco_id, saldo, fuente) VALUES (%s, %s, %s, %s) RETURNING *',
            (data["fecha"], data["banco_id"], data["saldo"], data.get("fuente", "manual")),
        )
        return _to_dict(cur.fetchone())


def get_saldo_inicial_total(*, fecha_hasta: str | None = None) -> float:
    sql = f"""
        SELECT COALESCE(SUM(saldo_ultimo), 0) AS total FROM (
          SELECT DISTINCT ON (banco_id) banco_id, saldo AS saldo_ultimo
          FROM public."saldos_iniciales" s
          WHERE banco_id IN (SELECT id FROM public."bancos_medios_pago" WHERE nombre != '{BANCO_CONSOLIDADO_NOMBRE}')
    """
    params = []
    if fecha_hasta:
        sql += " AND fecha <= %s"; params.append(fecha_hasta)
    sql += " ORDER BY banco_id, fecha DESC) sub"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return float(cur.fetchone()["total"])


# ============================================================
# Facturacion diaria
# ============================================================

def list_facturacion(fecha_desde: str | None = None, fecha_hasta: str | None = None,
                     unidad_id: int | None = None, limit: int = 500) -> list[dict]:
    sql = """
        SELECT f.*, u.nombre AS unidad_nombre, u.canal::text AS unidad_canal,
               e.nombre AS empresa_nombre
        FROM public."facturacion_diaria" f
        LEFT JOIN public."unidades_negocio" u ON u.id = f.unidad_negocio_id
        LEFT JOIN public."empresas" e ON e.id = f.empresa_id
    """
    where, params = [], []
    if fecha_desde: where.append("f.fecha >= %s"); params.append(fecha_desde)
    if fecha_hasta: where.append("f.fecha <= %s"); params.append(fecha_hasta)
    if unidad_id: where.append("f.unidad_negocio_id = %s"); params.append(unidad_id)
    if where: sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY f.fecha DESC LIMIT %s"
    params.append(limit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return _to_list(cur.fetchall())


def create_facturacion(data: dict) -> dict:
    if not all(data.get(k) is not None for k in ("fecha", "monto", "unidad_negocio_id")):
        raise ValueError("fecha, monto, unidad_negocio_id requeridos")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public."facturacion_diaria"
              (fecha, monto, unidad_negocio_id, empresa_id, es_real, es_evento_puntual, origen)
            VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *
            """,
            (data["fecha"], data["monto"], data["unidad_negocio_id"], data.get("empresa_id"),
             bool(data.get("es_real", True)), bool(data.get("es_evento_puntual", False)),
             data.get("origen", "manual")),
        )
        return _to_dict(cur.fetchone())


def update_facturacion(fid: int, data: dict) -> dict | None:
    sets, params = [], []
    for k in ("fecha", "monto", "unidad_negocio_id", "empresa_id", "es_real", "es_evento_puntual"):
        if k in data:
            sets.append(f'"{k}" = %s'); params.append(data[k])
    if not sets:
        return None
    params.append(fid)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f'UPDATE public."facturacion_diaria" SET {", ".join(sets)} WHERE id = %s RETURNING *', params)
        return _to_dict(cur.fetchone())


def delete_facturacion(fid: int) -> bool:
    with get_conn() as c, c.cursor() as cur:
        cur.execute('DELETE FROM public."facturacion_diaria" WHERE id = %s', (fid,))
        return cur.rowcount > 0


# ============================================================
# KPIs
# ============================================================

def kpis(*, fecha_hoy: str | None = None) -> dict:
    with get_conn() as c, c.cursor() as cur:
        if fecha_hoy is None:
            cur.execute("SELECT CURRENT_DATE::text AS hoy")
            fecha_hoy = cur.fetchone()["hoy"]
        cur.execute('SELECT estado::text AS estado, COUNT(*) AS count, COALESCE(SUM(monto), 0) AS total FROM public."erogaciones" WHERE oculto = FALSE GROUP BY estado')
        por_estado = {r["estado"]: {"count": int(r["count"]), "total": float(r["total"])} for r in cur.fetchall()}
        cur.execute(
            'SELECT COUNT(*) AS count, COALESCE(SUM(monto), 0) AS total FROM public."erogaciones" '
            "WHERE oculto = FALSE AND estado::text IN ('pendiente','en_curso') AND fecha_pago < %s",
            (fecha_hoy,),
        )
        r = cur.fetchone()
        atrasadas = {"count": int(r["count"]), "total": float(r["total"])}
        cur.execute(
            'SELECT COUNT(*) AS count, COALESCE(SUM(monto), 0) AS total FROM public."erogaciones" '
            "WHERE oculto = FALSE AND estado::text IN ('pendiente','en_curso') AND fecha_pago >= %s AND fecha_pago <= (%s::date + 7)",
            (fecha_hoy, fecha_hoy),
        )
        r = cur.fetchone()
        proximas_7d = {"count": int(r["count"]), "total": float(r["total"])}
        cur.execute(
            'SELECT p.id, p.nombre, COALESCE(SUM(e.monto), 0) AS pendiente FROM public."proveedores" p '
            'JOIN public."erogaciones" e ON e.proveedor_id = p.id '
            "WHERE e.oculto = FALSE AND e.estado::text IN ('pendiente','en_curso') "
            "GROUP BY p.id, p.nombre ORDER BY pendiente DESC LIMIT 5"
        )
        top_proveedores = [
            {"id": int(r["id"]), "nombre": r["nombre"], "pendiente": float(r["pendiente"])}
            for r in cur.fetchall()
        ]
    return {"fecha_hoy": fecha_hoy, "por_estado": por_estado, "atrasadas": atrasadas,
            "proximas_7d": proximas_7d, "top_proveedores": top_proveedores}


# ============================================================
# Inputs para motor
# ============================================================

def get_facturacion_window(fecha_referencia: str, semanas: int) -> list[dict]:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            'SELECT fecha::text AS fecha, monto, unidad_negocio_id, es_evento_puntual '
            'FROM public."facturacion_diaria" '
            "WHERE fecha >= (%s::date - (%s * INTERVAL '1 week')) AND fecha <= %s ORDER BY fecha ASC",
            (fecha_referencia, semanas, fecha_referencia),
        )
        return [
            {"fecha": r["fecha"], "monto": float(r["monto"]),
             "unidad_negocio_id": int(r["unidad_negocio_id"]),
             "es_evento_puntual": bool(r["es_evento_puntual"])}
            for r in cur.fetchall()
        ]


def get_erogaciones_window(fecha_desde: str, fecha_hasta: str) -> list[dict]:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            'SELECT id, fecha_pago::text AS fecha_pago, monto, estado::text AS estado '
            'FROM public."erogaciones" '
            "WHERE oculto = FALSE AND estado::text != 'cancelado' "
            "AND fecha_pago >= %s AND fecha_pago <= %s",
            (fecha_desde, fecha_hasta),
        )
        return [{"id": int(r["id"]), "fecha_pago": r["fecha_pago"], "monto": float(r["monto"]), "estado": r["estado"]} for r in cur.fetchall()]


def get_ingresos_puntuales_window(fecha_desde: str, fecha_hasta: str) -> list[dict]:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            'SELECT id, fecha::text AS fecha, monto, descripcion FROM public."ingresos_puntuales" WHERE fecha >= %s AND fecha <= %s',
            (fecha_desde, fecha_hasta),
        )
        return [{"id": int(r["id"]), "fecha": r["fecha"], "monto": float(r["monto"]), "descripcion": r["descripcion"]} for r in cur.fetchall()]


def get_pagos_atrasados_list(fecha_hoy: str | None = None) -> list[dict]:
    with get_conn() as c, c.cursor() as cur:
        if fecha_hoy is None:
            cur.execute("SELECT CURRENT_DATE::text AS hoy")
            fecha_hoy = cur.fetchone()["hoy"]
        cur.execute(
            """
            SELECT e.id, e.fecha_pago::text AS fecha_pago, e.monto, e.prioridad_atraso,
                   e.descripcion, e.estado::text AS estado,
                   e.fecha_sugerida_tentativa::text AS fecha_sugerida_tentativa,
                   em.nombre AS empresa_nombre, b.nombre AS banco_nombre, p.nombre AS proveedor_nombre,
                   (%s::date - e.fecha_pago) AS dias_atraso
            FROM public."erogaciones" e
            LEFT JOIN public."empresas" em ON em.id = e.empresa_id
            LEFT JOIN public."bancos_medios_pago" b ON b.id = e.banco_id
            LEFT JOIN public."proveedores" p ON p.id = e.proveedor_id
            WHERE e.oculto = FALSE AND e.estado::text IN ('pendiente','en_curso')
              AND e.fecha_pago < %s::date
            ORDER BY e.prioridad_atraso, e.fecha_pago ASC
            """,
            (fecha_hoy, fecha_hoy),
        )
        return [
            {"id": int(r["id"]), "fecha_pago": r["fecha_pago"], "monto": float(r["monto"]),
             "prioridad_atraso": r["prioridad_atraso"], "descripcion": r["descripcion"],
             "estado": r["estado"], "fecha_sugerida_tentativa": r["fecha_sugerida_tentativa"],
             "empresa_nombre": r["empresa_nombre"], "banco_nombre": r["banco_nombre"],
             "proveedor_nombre": r["proveedor_nombre"], "dias_atraso": int(r["dias_atraso"])}
            for r in cur.fetchall()
        ]


def get_erogaciones_futuras_efectivas(fecha_desde: str, fecha_hasta: str) -> list[dict]:
    """Erogaciones con fecha efectiva (tentativa si la hay, sino real)."""
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT id, COALESCE(fecha_sugerida_tentativa, fecha_pago)::text AS fecha_pago,
                   monto, estado::text AS estado
            FROM public."erogaciones"
            WHERE oculto = FALSE AND estado::text NOT IN ('pagado','cancelado','rechazado')
              AND COALESCE(fecha_sugerida_tentativa, fecha_pago) >= %s::date
              AND COALESCE(fecha_sugerida_tentativa, fecha_pago) <= %s::date
            """,
            (fecha_desde, fecha_hasta),
        )
        return [{"id": int(r["id"]), "fecha_pago": r["fecha_pago"], "monto": float(r["monto"]), "estado": r["estado"]} for r in cur.fetchall()]


# ============================================================
# Analisis de gastos
# ============================================================

def analisis_gastos(fecha_desde: str, fecha_hasta: str) -> dict:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(categoria, '(sin categoria)') AS categoria,
                   COUNT(*) AS count, SUM(monto) AS total
            FROM public."erogaciones"
            WHERE oculto = FALSE AND estado::text NOT IN ('cancelado','rechazado')
              AND fecha_pago >= %s AND fecha_pago <= %s
            GROUP BY categoria ORDER BY total DESC
            """,
            (fecha_desde, fecha_hasta),
        )
        por_categoria = [{"categoria": r["categoria"], "count": int(r["count"]), "total": float(r["total"])} for r in cur.fetchall()]
        cur.execute(
            """
            SELECT em.nombre AS empresa, COUNT(*) AS count, SUM(e.monto) AS total
            FROM public."erogaciones" e JOIN public."empresas" em ON em.id = e.empresa_id
            WHERE e.oculto = FALSE AND e.estado::text NOT IN ('cancelado','rechazado')
              AND e.fecha_pago >= %s AND e.fecha_pago <= %s
            GROUP BY em.nombre ORDER BY total DESC
            """,
            (fecha_desde, fecha_hasta),
        )
        por_empresa = [{"empresa": r["empresa"], "count": int(r["count"]), "total": float(r["total"])} for r in cur.fetchall()]
        cur.execute(
            """
            SELECT b.nombre AS banco, COUNT(*) AS count, SUM(e.monto) AS total
            FROM public."erogaciones" e JOIN public."bancos_medios_pago" b ON b.id = e.banco_id
            WHERE e.oculto = FALSE AND e.estado::text NOT IN ('cancelado','rechazado')
              AND e.fecha_pago >= %s AND e.fecha_pago <= %s
            GROUP BY b.nombre ORDER BY total DESC
            """,
            (fecha_desde, fecha_hasta),
        )
        por_banco = [{"banco": r["banco"], "count": int(r["count"]), "total": float(r["total"])} for r in cur.fetchall()]
        cur.execute(
            """
            SELECT TO_CHAR(fecha_pago, 'YYYY-MM') AS mes, SUM(monto) AS total
            FROM public."erogaciones"
            WHERE oculto = FALSE AND estado::text NOT IN ('cancelado','rechazado')
              AND fecha_pago >= %s AND fecha_pago <= %s
            GROUP BY mes ORDER BY mes ASC
            """,
            (fecha_desde, fecha_hasta),
        )
        por_mes = [{"mes": r["mes"], "total": float(r["total"])} for r in cur.fetchall()]
    return {"fecha_desde": fecha_desde, "fecha_hasta": fecha_hasta,
            "por_categoria": por_categoria, "por_empresa": por_empresa,
            "por_banco": por_banco, "por_mes": por_mes}


# ============================================================
# Sugerencias - detector de patrones simple
# ============================================================

def detectar_candidatos_recurrencia() -> list[dict]:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT
              LOWER(TRIM(descripcion)) AS desc_norm,
              MIN(descripcion) AS descripcion_sample,
              proveedor_id,
              COUNT(*) AS ocurrencias,
              MIN(fecha_pago)::text AS primer_pago,
              MAX(fecha_pago)::text AS ultimo_pago,
              ROUND(AVG(monto)::numeric, 2) AS monto_promedio,
              MIN(monto) AS monto_min,
              MAX(monto) AS monto_max
            FROM public."erogaciones"
            WHERE oculto = FALSE
              AND es_recurrente = FALSE
              AND recurrencia_id IS NULL
              AND fecha_carga > NOW() - INTERVAL '12 months'
            GROUP BY LOWER(TRIM(descripcion)), proveedor_id
            HAVING COUNT(*) >= 3
            ORDER BY ocurrencias DESC, monto_promedio DESC
            LIMIT 50
            """
        )
        return [
            {"descripcion": r["descripcion_sample"],
             "proveedor_id": r["proveedor_id"],
             "ocurrencias": int(r["ocurrencias"]),
             "primer_pago": r["primer_pago"],
             "ultimo_pago": r["ultimo_pago"],
             "monto_promedio": float(r["monto_promedio"]) if r["monto_promedio"] else 0,
             "monto_min": float(r["monto_min"]) if r["monto_min"] else 0,
             "monto_max": float(r["monto_max"]) if r["monto_max"] else 0}
            for r in cur.fetchall()
        ]


# ============================================================
# Calendario mensual
# ============================================================

def calendario_mensual(year: int, month: int) -> dict:
    fecha_desde = f"{year:04d}-{month:02d}-01"
    if month == 12:
        fecha_hasta = f"{year + 1:04d}-01-01"
    else:
        fecha_hasta = f"{year:04d}-{month + 1:02d}-01"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT fecha_pago::text AS fecha, COUNT(*) AS count, SUM(monto) AS total,
                   COUNT(*) FILTER (WHERE fecha_sugerida_tentativa IS NOT NULL) AS con_tentativa
            FROM public."erogaciones"
            WHERE oculto = FALSE AND estado::text NOT IN ('cancelado','rechazado')
              AND fecha_pago >= %s::date AND fecha_pago < %s::date
            GROUP BY fecha_pago
            """,
            (fecha_desde, fecha_hasta),
        )
        egresos_por_dia = {r["fecha"]: {"count": int(r["count"]), "total": float(r["total"]), "con_tentativa": int(r["con_tentativa"])} for r in cur.fetchall()}
        cur.execute(
            'SELECT fecha::text AS fecha, COUNT(*) AS count, SUM(monto) AS total FROM public."ingresos_puntuales" '
            "WHERE fecha >= %s::date AND fecha < %s::date GROUP BY fecha",
            (fecha_desde, fecha_hasta),
        )
        ingresos_por_dia = {r["fecha"]: {"count": int(r["count"]), "total": float(r["total"])} for r in cur.fetchall()}
    return {"year": year, "month": month, "fecha_desde": fecha_desde, "fecha_hasta": fecha_hasta,
            "egresos_por_dia": egresos_por_dia, "ingresos_por_dia": ingresos_por_dia}


# ============================================================
# Precision (real vs proyectado en facturacion)
# ============================================================

def precision_facturacion(fecha_desde: str, fecha_hasta: str) -> list[dict]:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT fecha::text AS fecha,
                   COALESCE(SUM(monto) FILTER (WHERE es_real = TRUE), 0) AS real,
                   COALESCE(SUM(monto) FILTER (WHERE es_real = FALSE), 0) AS proyectado,
                   COUNT(*) FILTER (WHERE es_real = TRUE) AS count_real,
                   COUNT(*) FILTER (WHERE es_real = FALSE) AS count_proyectado
            FROM public."facturacion_diaria"
            WHERE fecha >= %s AND fecha <= %s
            GROUP BY fecha ORDER BY fecha ASC
            """,
            (fecha_desde, fecha_hasta),
        )
        return [
            {"fecha": r["fecha"], "real": float(r["real"]), "proyectado": float(r["proyectado"]),
             "delta": float(r["real"]) - float(r["proyectado"]),
             "count_real": int(r["count_real"]), "count_proyectado": int(r["count_proyectado"])}
            for r in cur.fetchall()
        ]

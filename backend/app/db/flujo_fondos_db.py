"""
DB layer del modulo Flujo de Fondos.

Las 11 tablas viven en `public` del Supabase UNIDATA (project pmeuexynoftqyyoeyhyn),
migradas desde el Supabase de Pedro el 2026-05-21. Mantiene los nombres originales
(empresas, erogaciones, etc) y los enums custom (estado_erogacion, tipo_banco, etc).

Conectamos via psycopg2 del pool de UNIDATA (`get_conn`), no SQLAlchemy.
"""
from __future__ import annotations

from typing import Any

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


# ============================================================
# Maestros (read-only en Fase 1)
# ============================================================

def list_empresas(only_active: bool = True) -> list[dict]:
    sql = 'SELECT * FROM public."empresas"'
    if only_active:
        sql += " WHERE activa = TRUE"
    sql += " ORDER BY nombre"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql)
        return _to_list(cur.fetchall())


def list_unidades_negocio(only_active: bool = True) -> list[dict]:
    sql = 'SELECT * FROM public."unidades_negocio"'
    if only_active:
        sql += " WHERE activa = TRUE"
    sql += " ORDER BY nombre"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql)
        return _to_list(cur.fetchall())


def list_bancos(only_active: bool = True) -> list[dict]:
    sql = 'SELECT * FROM public."bancos_medios_pago"'
    if only_active:
        sql += " WHERE activo = TRUE"
    sql += " ORDER BY nombre"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql)
        return _to_list(cur.fetchall())


def list_proveedores() -> list[dict]:
    with get_conn() as c, c.cursor() as cur:
        cur.execute('SELECT * FROM public."proveedores" ORDER BY nombre')
        return _to_list(cur.fetchall())


# ============================================================
# Erogaciones (CRUD core)
# ============================================================

EROGACION_COLS_INSERT = (
    "fecha_pago, descripcion, monto, moneda, tipo_cambio, empresa_id, "
    "proveedor_id, banco_id, estado, categoria, subcategoria, recurrencia_id, "
    "es_recurrente, es_critico, notas, prioridad_atraso, oculto"
)


def list_erogaciones(
    *,
    estado: str | None = None,
    empresa_id: int | None = None,
    banco_id: int | None = None,
    proveedor_id: int | None = None,
    fecha_desde: str | None = None,
    fecha_hasta: str | None = None,
    query: str | None = None,
    incluir_ocultas: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    """List + count en una sola query con LATERAL para paginacion eficiente."""
    where: list[str] = []
    params: list[Any] = []

    if estado:
        where.append("e.estado::text = %s")
        params.append(estado)
    if empresa_id:
        where.append("e.empresa_id = %s")
        params.append(empresa_id)
    if banco_id:
        where.append("e.banco_id = %s")
        params.append(banco_id)
    if proveedor_id:
        where.append("e.proveedor_id = %s")
        params.append(proveedor_id)
    if fecha_desde:
        where.append("e.fecha_pago >= %s")
        params.append(fecha_desde)
    if fecha_hasta:
        where.append("e.fecha_pago <= %s")
        params.append(fecha_hasta)
    if query:
        where.append("(e.descripcion ILIKE %s OR e.notas ILIKE %s OR e.categoria ILIKE %s)")
        q = f"%{query}%"
        params.extend([q, q, q])
    if not incluir_ocultas:
        where.append("e.oculto = FALSE")

    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    list_sql = f"""
        SELECT
          e.*,
          em.nombre AS empresa_nombre,
          b.nombre  AS banco_nombre,
          p.nombre  AS proveedor_nombre
        FROM public."erogaciones" e
        LEFT JOIN public."empresas" em ON em.id = e.empresa_id
        LEFT JOIN public."bancos_medios_pago" b ON b.id = e.banco_id
        LEFT JOIN public."proveedores" p ON p.id = e.proveedor_id
        {where_sql}
        ORDER BY e.fecha_pago DESC, e.id DESC
        LIMIT %s OFFSET %s
    """
    count_sql = f'SELECT COUNT(*) AS total FROM public."erogaciones" e {where_sql}'

    with get_conn() as c, c.cursor() as cur:
        cur.execute(list_sql, params + [limit, offset])
        items = _to_list(cur.fetchall())
        cur.execute(count_sql, params)
        total = cur.fetchone()["total"]

    return {"items": items, "total": total, "limit": limit, "offset": offset}


def get_erogacion(erogacion_id: int) -> dict | None:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT e.*,
              em.nombre AS empresa_nombre,
              b.nombre  AS banco_nombre,
              p.nombre  AS proveedor_nombre
            FROM public."erogaciones" e
            LEFT JOIN public."empresas" em ON em.id = e.empresa_id
            LEFT JOIN public."bancos_medios_pago" b ON b.id = e.banco_id
            LEFT JOIN public."proveedores" p ON p.id = e.proveedor_id
            WHERE e.id = %s
            """,
            (erogacion_id,),
        )
        return _to_dict(cur.fetchone())


def create_erogacion(data: dict) -> dict:
    """Crea una erogacion. Requiere fecha_pago, descripcion, monto, empresa_id, banco_id."""
    required = ("fecha_pago", "descripcion", "monto", "empresa_id", "banco_id")
    missing = [k for k in required if data.get(k) in (None, "")]
    if missing:
        raise ValueError(f"Faltan campos requeridos: {missing}")

    cols = (
        "fecha_pago", "descripcion", "monto", "moneda", "tipo_cambio",
        "empresa_id", "proveedor_id", "banco_id", "estado", "categoria",
        "subcategoria", "recurrencia_id", "es_recurrente", "es_critico",
        "notas", "prioridad_atraso", "oculto",
    )
    values = [
        data.get("fecha_pago"),
        data.get("descripcion"),
        data.get("monto"),
        data.get("moneda", "ARS"),
        data.get("tipo_cambio"),
        data.get("empresa_id"),
        data.get("proveedor_id"),
        data.get("banco_id"),
        data.get("estado", "pendiente"),
        data.get("categoria"),
        data.get("subcategoria"),
        data.get("recurrencia_id"),
        bool(data.get("es_recurrente", False)),
        bool(data.get("es_critico", False)),
        data.get("notas"),
        data.get("prioridad_atraso", "normal"),
        bool(data.get("oculto", False)),
    ]
    placeholders = ", ".join(["%s"] * len(cols))
    cols_sql = ", ".join(f'"{c}"' for c in cols)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f'INSERT INTO public."erogaciones" ({cols_sql}) VALUES ({placeholders}) RETURNING *',
            values,
        )
        return _to_dict(cur.fetchone())


_UPDATABLE_FIELDS = {
    "fecha_pago", "descripcion", "monto", "moneda", "tipo_cambio",
    "empresa_id", "proveedor_id", "banco_id", "estado", "categoria",
    "subcategoria", "es_critico", "notas", "prioridad_atraso",
    "fecha_sugerida_tentativa", "oculto",
}


def update_erogacion(erogacion_id: int, data: dict) -> dict | None:
    sets: list[str] = []
    params: list[Any] = []
    for k, v in data.items():
        if k not in _UPDATABLE_FIELDS:
            continue
        sets.append(f'"{k}" = %s')
        params.append(v)
    if not sets:
        return get_erogacion(erogacion_id)
    sets.append('"updated_at" = NOW()')
    if data.get("estado") == "pagado":
        sets.append('"pagado_at" = COALESCE("pagado_at", NOW())')
    params.append(erogacion_id)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f'UPDATE public."erogaciones" SET {", ".join(sets)} WHERE id = %s RETURNING *',
            params,
        )
        return _to_dict(cur.fetchone())


def delete_erogacion(erogacion_id: int) -> bool:
    with get_conn() as c, c.cursor() as cur:
        cur.execute('DELETE FROM public."erogaciones" WHERE id = %s', (erogacion_id,))
        return cur.rowcount > 0


# ============================================================
# KPIs para home
# ============================================================

def kpis(*, fecha_hoy: str | None = None) -> dict:
    """
    Devuelve agregados para el home:
      - counts y sums por estado
      - atrasadas (fecha_pago < hoy y estado pendiente/en_curso)
      - proximas (fecha_pago entre hoy y hoy+7d, pendiente/en_curso)
      - top 5 proveedores con saldo pendiente
    """
    with get_conn() as c, c.cursor() as cur:
        if fecha_hoy is None:
            cur.execute("SELECT CURRENT_DATE::text AS hoy")
            fecha_hoy = cur.fetchone()["hoy"]

        cur.execute(
            """
            SELECT estado::text AS estado, COUNT(*) AS count,
                   COALESCE(SUM(monto), 0) AS total
            FROM public."erogaciones"
            WHERE oculto = FALSE
            GROUP BY estado
            """
        )
        por_estado = {r["estado"]: {"count": int(r["count"]), "total": float(r["total"])} for r in cur.fetchall()}

        cur.execute(
            """
            SELECT COUNT(*) AS count, COALESCE(SUM(monto), 0) AS total
            FROM public."erogaciones"
            WHERE oculto = FALSE
              AND estado::text IN ('pendiente','en_curso')
              AND fecha_pago < %s
            """,
            (fecha_hoy,),
        )
        r = cur.fetchone()
        atrasadas = {"count": int(r["count"]), "total": float(r["total"])}

        cur.execute(
            """
            SELECT COUNT(*) AS count, COALESCE(SUM(monto), 0) AS total
            FROM public."erogaciones"
            WHERE oculto = FALSE
              AND estado::text IN ('pendiente','en_curso')
              AND fecha_pago >= %s AND fecha_pago <= (%s::date + 7)
            """,
            (fecha_hoy, fecha_hoy),
        )
        r = cur.fetchone()
        proximas_7d = {"count": int(r["count"]), "total": float(r["total"])}

        cur.execute(
            """
            SELECT p.id, p.nombre, COALESCE(SUM(e.monto), 0) AS pendiente
            FROM public."proveedores" p
            JOIN public."erogaciones" e ON e.proveedor_id = p.id
            WHERE e.oculto = FALSE AND e.estado::text IN ('pendiente','en_curso')
            GROUP BY p.id, p.nombre
            ORDER BY pendiente DESC
            LIMIT 5
            """
        )
        top_proveedores = [
            {"id": int(r["id"]), "nombre": r["nombre"], "pendiente": float(r["pendiente"])}
            for r in cur.fetchall()
        ]

    return {
        "fecha_hoy": fecha_hoy,
        "por_estado": por_estado,
        "atrasadas": atrasadas,
        "proximas_7d": proximas_7d,
        "top_proveedores": top_proveedores,
    }


# ============================================================
# Inputs para el motor de proyeccion
# ============================================================

def get_saldo_inicial_total(*, fecha_hasta: str | None = None) -> float:
    """Saldo total mas reciente sumando bancos NO consolidado. Si fecha_hasta dado, hasta esa."""
    sql = """
        SELECT COALESCE(SUM(saldo_ultimo), 0) AS total FROM (
          SELECT DISTINCT ON (banco_id) banco_id, saldo AS saldo_ultimo
          FROM public."saldos_iniciales" s
          WHERE banco_id IN (SELECT id FROM public."bancos_medios_pago" WHERE nombre != 'Total consolidado')
    """
    params: list[Any] = []
    if fecha_hasta:
        sql += " AND fecha <= %s"
        params.append(fecha_hasta)
    sql += " ORDER BY banco_id, fecha DESC) sub"
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return float(cur.fetchone()["total"])


def get_facturacion_window(fecha_referencia: str, semanas: int) -> list[dict]:
    """Filas de facturacion en los ultimos N semanas hasta fecha_referencia."""
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT fecha::text AS fecha, monto, unidad_negocio_id, es_evento_puntual
            FROM public."facturacion_diaria"
            WHERE fecha >= (%s::date - (%s * INTERVAL '1 week'))
              AND fecha <= %s
            ORDER BY fecha ASC
            """,
            (fecha_referencia, semanas, fecha_referencia),
        )
        return [
            {
                "fecha": r["fecha"],
                "monto": float(r["monto"]),
                "unidad_negocio_id": int(r["unidad_negocio_id"]),
                "es_evento_puntual": bool(r["es_evento_puntual"]),
            }
            for r in cur.fetchall()
        ]


def get_erogaciones_window(fecha_desde: str, fecha_hasta: str) -> list[dict]:
    """Erogaciones pendientes/en_curso/pagado dentro del rango (no ocultas)."""
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT id, fecha_pago::text AS fecha_pago, monto, estado::text AS estado
            FROM public."erogaciones"
            WHERE oculto = FALSE
              AND estado::text != 'cancelado'
              AND fecha_pago >= %s AND fecha_pago <= %s
            """,
            (fecha_desde, fecha_hasta),
        )
        return [
            {"id": int(r["id"]), "fecha_pago": r["fecha_pago"], "monto": float(r["monto"]), "estado": r["estado"]}
            for r in cur.fetchall()
        ]


def get_ingresos_puntuales_window(fecha_desde: str, fecha_hasta: str) -> list[dict]:
    """Ingresos puntuales esperados dentro del rango."""
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT id, fecha::text AS fecha, monto, descripcion
            FROM public."ingresos_puntuales"
            WHERE fecha >= %s AND fecha <= %s
            """,
            (fecha_desde, fecha_hasta),
        )
        return [
            {"id": int(r["id"]), "fecha": r["fecha"], "monto": float(r["monto"]), "descripcion": r["descripcion"]}
            for r in cur.fetchall()
        ]

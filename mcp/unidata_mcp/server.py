"""FastMCP server con tools read-only sobre la API UNIDATA.

Tools disponibles (todas read-only):

- whoami                          → usuario actual + permisos
- list_dropshippers               → listado con search/sort
- get_dropshipper                 → 360 view (KPIs, ventas, pagos, suscripcion)
- get_dropshipper_unified_orders  → órdenes ML+TN combinadas por fecha
- get_executive_dashboard         → KPIs gerenciales cross-unidad
- get_unit_dashboard              → ventas/finanzas/marketing/logistica por unidad
- list_orders                     → drilldown de órdenes (paid/cancelled/all/stuck)
- run_sql                         → SELECT libre (solo lectura, statement_timeout 30s)
- list_tables                     → schema browser de una unidad
- preview_table                   → primeras N filas de una tabla

Las llamadas usan el JWT del usuario, así que respetan RBAC por rol+área.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from .client import UnidataClient, UnidataError
from .config import Config

Unit = Literal["unistore", "unidrop", "unidev"]
Period = Literal["7d", "30d", "90d", "1y", "all"]

# Singleton client — FastMCP no nos da hooks de lifecycle limpios para stdio,
# pero httpx.AsyncClient reusa connections y se cierra cuando el process termina.
_cfg = Config.load()
_client = UnidataClient(_cfg)

mcp = FastMCP("unidata")


def _err(e: Exception) -> dict[str, Any]:
    """Convierte excepción en payload legible por el LLM."""
    return {"error": str(e), "type": type(e).__name__}


# ─── Identidad y permisos ──────────────────────────────────────────────────────


@mcp.tool()
async def whoami() -> dict[str, Any]:
    """Devuelve el usuario autenticado: id, email, rol, área, flag is_admin.

    Útil para que el modelo entienda qué permisos tiene la sesión antes de
    invocar otras tools (algunos endpoints requieren rol admin/analista/gerencia).
    """
    try:
        return await _client.get("/api/users/me")
    except UnidataError as e:
        return _err(e)


# ─── Dropshippers ──────────────────────────────────────────────────────────────


@mcp.tool()
async def list_dropshippers(
    search: Annotated[str, Field(description="Texto a buscar en nombre, email, DNI, fantasy_name o nickname ML.")] = "",
    period: Annotated[Period, Field(description="Ventana temporal para los KPIs (ventas, profit).")] = "30d",
    sort: Annotated[
        Literal["gmv", "profit", "orders", "recency", "name"],
        Field(description="Métrica de ordenamiento descendente."),
    ] = "gmv",
    limit: Annotated[int, Field(ge=1, le=500, description="Máximo de filas a devolver.")] = 50,
) -> dict[str, Any]:
    """Lista dropshippers de Unidrop con KPIs (GMV, profit, ordenes, ticket prom, recencia)."""
    try:
        return await _client.get(
            "/api/dashboards/dropshippers",
            params={"search": search, "period": period, "sort": sort, "limit": limit},
        )
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def get_dropshipper(
    user_id: Annotated[int, Field(description="ID del dropshipper en Unidrop (columna User.id).")],
    period: Annotated[Period, Field(description="Ventana temporal para los KPIs.")] = "90d",
) -> dict[str, Any]:
    """Vista 360 de un dropshipper: identidad, suscripción, ventas ML+TN, pagos Talo, referidos, top clientes finales."""
    try:
        return await _client.get(
            f"/api/dashboards/dropshippers/{int(user_id)}",
            params={"period": period},
        )
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def get_dropshipper_unified_orders(
    user_id: Annotated[int, Field(description="ID del dropshipper.")],
    intent_id: Annotated[int | None, Field(description="Filtra a las órdenes de un PaymentIntent específico.")] = None,
    limit: Annotated[int, Field(ge=1, le=500)] = 100,
) -> dict[str, Any]:
    """Órdenes unificadas ML+TN del dropshipper, estilo panel Unidrop.

    Cada fila representa UNA orden con datos enriquecidos: producto, cliente,
    envío, estado, costo, profit. Si se pasa intent_id, devuelve solo las
    órdenes de ese pago Talo.
    """
    params: dict[str, Any] = {"limit": limit}
    if intent_id is not None:
        params["intent_id"] = int(intent_id)
    try:
        return await _client.get(
            f"/api/dashboards/dropshippers/{int(user_id)}/unified-orders",
            params=params,
        )
    except UnidataError as e:
        return _err(e)


# ─── Dashboards ────────────────────────────────────────────────────────────────


@mcp.tool()
async def get_executive_dashboard(
    period: Annotated[Period, Field(description="Ventana para los KPIs.")] = "30d",
) -> dict[str, Any]:
    """Dashboard ejecutivo (gerencia): GMV, profit, churn, salud por unidad.

    Cruza Unistore, Unidrop y Unidev en una sola vista. Requiere role
    admin o gerencia.
    """
    try:
        return await _client.get("/api/dashboards/executive", params={"period": period})
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def get_unit_dashboard(
    section: Annotated[
        Literal["ventas", "finanzas", "marketing", "logistica", "cs"],
        Field(description="Sección del dashboard."),
    ],
    unit: Annotated[Unit, Field(description="Unidad de negocio.")],
    period: Annotated[Period, Field()] = "30d",
) -> dict[str, Any]:
    """Dashboard de una unidad (ventas, finanzas, marketing, logística, CS).

    Ejemplos:
    - section="ventas", unit="unistore" → GMV TN+ML, conversión, AOV, top SKUs
    - section="finanzas", unit="unidrop" → ingresos suscripción, cobros Talo, deuda
    """
    try:
        return await _client.get(f"/api/dashboards/{section}/{unit}", params={"period": period})
    except UnidataError as e:
        return _err(e)


# ─── Drilldowns / órdenes ──────────────────────────────────────────────────────


@mcp.tool()
async def list_orders(
    state: Annotated[
        Literal["paid", "cancelled", "all", "stuck"],
        Field(description="Estado del pedido."),
    ] = "paid",
    period: Annotated[Period, Field()] = "30d",
    unit: Annotated[Unit, Field()] = "unistore",
    limit: Annotated[int, Field(ge=1, le=1000)] = 100,
) -> dict[str, Any]:
    """Listado plano de órdenes con drilldown (cliente, total, fecha, estado, canal).

    Útil para análisis ad-hoc: "dame las 50 últimas órdenes canceladas de Unistore",
    "órdenes trabadas de Unidrop en los últimos 7 días", etc.
    """
    try:
        return await _client.get(
            f"/api/drilldowns/orders/{state}",
            params={"period": period, "unit": unit, "limit": limit},
        )
    except UnidataError as e:
        return _err(e)


# ─── SQL + schema browser ──────────────────────────────────────────────────────


@mcp.tool()
async def run_sql(
    sql: Annotated[str, Field(description="Query SELECT (solo lectura). Empieza con SELECT o WITH.")],
    unit: Annotated[Unit, Field(description="Unidad cuyo engine usar.")] = "unistore",
    max_rows: Annotated[int, Field(ge=1, le=5000, description="Tope de filas devueltas.")] = 1000,
) -> dict[str, Any]:
    """Corre una query SELECT contra la BD de la unidad indicada.

    Restricciones de seguridad:
    - Solo SELECT/WITH. DML/DDL bloqueado a nivel parser.
    - statement_timeout=30s.
    - Resultados limitados a max_rows.
    - Requiere role admin o analista.
    """
    try:
        return await _client.post(
            f"/api/queries/{unit}/run",
            json={"sql": sql, "max_rows": int(max_rows)},
        )
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def list_tables(
    unit: Annotated[Unit, Field()] = "unistore",
    schema: Annotated[str, Field(description="Schema PG. Default: public.")] = "public",
) -> dict[str, Any]:
    """Lista tablas de un schema en la unidad indicada con cantidad aproximada de filas."""
    try:
        return await _client.get(f"/api/sources/{unit}/schemas/{schema}/tables")
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def preview_table(
    table: Annotated[str, Field(description="Nombre de la tabla.")],
    unit: Annotated[Unit, Field()] = "unistore",
    schema: Annotated[str, Field()] = "public",
    limit: Annotated[int, Field(ge=1, le=1000)] = 50,
) -> dict[str, Any]:
    """Devuelve las primeras N filas + definición de columnas de una tabla.

    Útil para que el modelo entienda el shape de una tabla antes de armar
    un run_sql más complejo.
    """
    try:
        return await _client.get(
            f"/api/sources/{unit}/schemas/{schema}/tables/{table}/preview",
            params={"limit": limit},
        )
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def describe_table(
    table: Annotated[str, Field()],
    unit: Annotated[Unit, Field()] = "unistore",
    schema: Annotated[str, Field()] = "public",
) -> dict[str, Any]:
    """Devuelve las columnas (nombre, tipo, nullable, default, PK) de una tabla."""
    try:
        return await _client.get(f"/api/sources/{unit}/schemas/{schema}/tables/{table}/columns")
    except UnidataError as e:
        return _err(e)

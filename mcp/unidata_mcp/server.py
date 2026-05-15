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


# ═══════════════════════════════════════════════════════════════════════════════
# WRITE TOOLS · cada accion queda registrada con user_id + timestamp.
# El JWT del user determina permisos via RBAC (rol + area).
# ═══════════════════════════════════════════════════════════════════════════════


# ─── CS Actions ────────────────────────────────────────────────────────────────


@mcp.tool()
async def list_cs_actions(
    status: Annotated[
        Literal["pending", "doing", "done", "cancelled"] | None,
        Field(description="Filtra por estado de la accion."),
    ] = None,
    unit: Annotated[Literal["unistore", "unidrop"] | None, Field()] = None,
    assigned_to_me: Annotated[bool, Field(description="Si True, solo las asignadas al user actual.")] = False,
    limit: Annotated[int, Field(ge=1, le=500)] = 100,
) -> dict[str, Any]:
    """Lista CS actions (cola de tareas para Customer Success).

    Pair de lectura para las tools de write — usar primero para encontrar IDs
    sobre los que actuar. Requiere area=cs o area=marketing.
    """
    params: dict[str, Any] = {"limit": limit}
    if status:
        params["status"] = status
    if unit:
        params["unit"] = unit
    if assigned_to_me:
        try:
            me = await _client.get("/api/users/me")
            params["assigned_to"] = me["id"]
        except UnidataError as e:
            return _err(e)
    try:
        return await _client.get("/api/cs-actions", params=params)
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def take_cs_action(
    action_id: Annotated[int, Field(description="ID de la CS action.")],
) -> dict[str, Any]:
    """Toma una CS action pendiente y la asigna al user actual (pending → doing)."""
    try:
        return await _client.post(f"/api/cs-actions/{int(action_id)}/take")
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def complete_cs_action(
    action_id: Annotated[int, Field()],
    note: Annotated[str, Field(description="Nota describiendo que se resolvio.")] = "",
) -> dict[str, Any]:
    """Marca una CS action como completada con una nota de cierre."""
    try:
        return await _client.post(f"/api/cs-actions/{int(action_id)}/complete", json={"note": note})
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def cancel_cs_action(
    action_id: Annotated[int, Field()],
    reason: Annotated[str, Field(description="Razon de la cancelacion.")],
) -> dict[str, Any]:
    """Cancela una CS action (no aplica, duplicada, decision de management, etc)."""
    try:
        return await _client.post(f"/api/cs-actions/{int(action_id)}/cancel", json={"note": reason})
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def update_cs_action_note(
    action_id: Annotated[int, Field()],
    note: Annotated[str, Field(description="Nuevo contenido de la nota libre.")],
) -> dict[str, Any]:
    """Actualiza la nota libre de una CS action sin cambiar su estado."""
    try:
        return await _client.patch(f"/api/cs-actions/{int(action_id)}/note", json={"note": note})
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def create_cs_action(
    unit: Annotated[Literal["unistore", "unidrop"], Field()],
    title: Annotated[str, Field(description="Titulo corto (max 100 chars).")],
    suggested_action: Annotated[str, Field(description="Que tendria que hacer el CS (1-3 frases).")],
    target_ids: Annotated[list[int], Field(description="IDs de los users/customers/dropshippers afectados.")],
    source_key: Annotated[str, Field(description="Identificador del origen (ej: 'mcp-claude').")] = "mcp",
) -> dict[str, Any]:
    """Crea una nueva CS action manual. Aparece en la bandeja CS para que la tomen."""
    payload = {
        "source_type": "manual",
        "source_key": source_key,
        "unit": unit,
        "title": title,
        "suggested_action": suggested_action,
        "target_ids": target_ids,
    }
    try:
        return await _client.post("/api/cs-actions", json=payload)
    except UnidataError as e:
        return _err(e)


# ─── IT Alerts ─────────────────────────────────────────────────────────────────


@mcp.tool()
async def list_alerts(
    only_pending: Annotated[bool, Field(description="Si True, solo las no resueltas.")] = True,
    severity: Annotated[Literal["info", "warning", "critical"] | None, Field()] = None,
    limit: Annotated[int, Field(ge=1, le=500)] = 50,
) -> dict[str, Any]:
    """Lista alertas IT (it_alerts): integraciones caidas, pedidos atascados, tokens vencidos."""
    params: dict[str, Any] = {"only_pending": only_pending, "limit": limit}
    if severity:
        params["severity"] = severity
    try:
        return await _client.get("/api/notifications", params=params)
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def resolve_alert(
    alert_id: Annotated[int, Field(description="ID de la alerta a marcar como revisada.")],
) -> dict[str, Any]:
    """Marca una alerta IT como revisada/resuelta."""
    try:
        return await _client.post(f"/api/notifications/{int(alert_id)}/resolve")
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def unresolve_alert(
    alert_id: Annotated[int, Field()],
) -> dict[str, Any]:
    """Reabre una alerta previamente resuelta. Requiere rol admin."""
    try:
        return await _client.post(f"/api/notifications/{int(alert_id)}/unresolve")
    except UnidataError as e:
        return _err(e)


# ─── Dropshipper Notes ─────────────────────────────────────────────────────────


@mcp.tool()
async def list_dropshipper_notes(
    dropshipper_id: Annotated[int, Field()],
    unit: Annotated[Unit, Field()] = "unidrop",
    include_archived: Annotated[bool, Field()] = False,
    limit: Annotated[int, Field(ge=1, le=200)] = 50,
) -> dict[str, Any]:
    """Lista las notas atadas a un dropshipper o user de unistore.

    Las notas son la 'source of truth' del equipo sobre cada user: por que
    se le redujo el plan, en que estado esta la cobranza, anotaciones de CS,
    flags de retencion, etc.
    """
    try:
        return await _client.get(
            "/api/dropshipper-notes",
            params={
                "dropshipper_id": int(dropshipper_id),
                "unit": unit,
                "include_archived": include_archived,
                "limit": limit,
            },
        )
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def add_dropshipper_note(
    dropshipper_id: Annotated[int, Field(description="ID del user en Unidrop o Unistore.")],
    note: Annotated[str, Field(description="Contenido de la nota.")],
    unit: Annotated[Unit, Field()] = "unidrop",
    category: Annotated[
        Literal["general", "cs", "billing", "support", "retention", "flag", "ops"],
        Field(description="Categoria de la nota para filtrar despues."),
    ] = "general",
) -> dict[str, Any]:
    """Agrega una nota a un dropshipper. Queda registrado quien la creo y cuando.

    Usar para anotaciones operativas que el equipo necesita ver despues:
    'llamamos por whatsapp, no responde', 'pidio aplazar pago hasta fin de mes',
    'cliente VIP, priorizar siempre', etc.
    """
    try:
        return await _client.post(
            "/api/dropshipper-notes",
            json={
                "dropshipper_id": int(dropshipper_id),
                "unit": unit,
                "note": note,
                "category": category,
            },
        )
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def archive_dropshipper_note(
    note_id: Annotated[int, Field()],
) -> dict[str, Any]:
    """Archiva (soft-delete) una nota. Sigue existiendo en la BD pero no se muestra."""
    try:
        return await _client.post(f"/api/dropshipper-notes/{int(note_id)}/archive")
    except UnidataError as e:
        return _err(e)


# ─── Recordatorios ─────────────────────────────────────────────────────────────


@mcp.tool()
async def list_my_reminders(
    status: Annotated[
        Literal["pending", "overdue", "upcoming", "done"],
        Field(description="pending=no completados | overdue=vencidos sin completar | upcoming=futuros | done=completados"),
    ] = "pending",
    limit: Annotated[int, Field(ge=1, le=500)] = 100,
) -> dict[str, Any]:
    """Lista los recordatorios personales del user actual."""
    try:
        return await _client.get("/api/reminders", params={"status": status, "limit": limit})
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def create_reminder(
    due_at: Annotated[str, Field(description="Fecha en ISO 8601 (ej: '2026-05-22T15:00:00Z').")],
    note: Annotated[str, Field(description="Que se quiere recordar.")],
    target_type: Annotated[
        Literal["dropshipper", "order", "customer", "cs_action", "alert", "general"],
        Field(),
    ] = "general",
    target_id: Annotated[str | None, Field(description="ID del target si target_type != general.")] = None,
    target_unit: Annotated[Unit | None, Field()] = None,
) -> dict[str, Any]:
    """Crea un recordatorio personal con fecha de vencimiento.

    Util para 'revisar al dropshipper X en 7 dias', 'confirmar que el pago llego
    el viernes', 'seguir el caso de la orden Y manana'. Solo el creador lo ve.
    """
    payload: dict[str, Any] = {
        "target_type": target_type,
        "due_at": due_at,
        "note": note,
    }
    if target_id is not None:
        payload["target_id"] = target_id
    if target_unit is not None:
        payload["target_unit"] = target_unit
    try:
        return await _client.post("/api/reminders", json=payload)
    except UnidataError as e:
        return _err(e)


@mcp.tool()
async def complete_reminder(
    reminder_id: Annotated[int, Field()],
    note: Annotated[str, Field(description="Nota opcional de cierre.")] = "",
) -> dict[str, Any]:
    """Marca un recordatorio como completado."""
    try:
        return await _client.post(f"/api/reminders/{int(reminder_id)}/complete", json={"note": note})
    except UnidataError as e:
        return _err(e)

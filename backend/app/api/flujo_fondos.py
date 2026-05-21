"""
Router REST del modulo Flujo de Fondos (tesoreria del grupo).

Port nativo a UNIDATA del repo pedroabba123/flujo-fondos. Ver
docs/FLUJO_FONDOS_INTEGRATION.md.

Endpoints (Fase 1):
  GET    /api/flujo-fondos/health
  GET    /api/flujo-fondos/kpis
  GET    /api/flujo-fondos/erogaciones
  GET    /api/flujo-fondos/erogaciones/{id}
  POST   /api/flujo-fondos/erogaciones
  PATCH  /api/flujo-fondos/erogaciones/{id}
  DELETE /api/flujo-fondos/erogaciones/{id}
  GET    /api/flujo-fondos/proyeccion?dias=30
  GET    /api/flujo-fondos/empresas
  GET    /api/flujo-fondos/bancos
  GET    /api/flujo-fondos/proveedores
  GET    /api/flujo-fondos/unidades-negocio

Todos requieren JWT UNIDATA + area `finanzas` o `administracion` (admin/gerencia
bypass automatico).
"""
from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth.security import current_user, require_area
from app.db import flujo_fondos_db
from app.services.flujo_fondos.proyeccion import construir_proyeccion

router = APIRouter(prefix="/api/flujo-fondos", tags=["flujo-fondos"])

EstadoErogacion = Literal["pendiente", "en_curso", "pagado", "cancelado", "rechazado"]
PrioridadAtraso = Literal["normal", "laxo"]


def _guard(user: dict) -> None:
    """Solo users con area finanzas/administracion (admin/gerencia bypass)."""
    require_area(user, ["finanzas", "administracion"])


# ============================================================
# Health
# ============================================================

@router.get("/health")
def health(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    return {"status": "ok", "module": "flujo-fondos"}


# ============================================================
# KPIs (home)
# ============================================================

@router.get("/kpis")
def get_kpis(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    return flujo_fondos_db.kpis()


# ============================================================
# Erogaciones (tabla central, CRUD)
# ============================================================

class ErogacionCreate(BaseModel):
    fecha_pago: str = Field(..., description="ISO YYYY-MM-DD")
    descripcion: str
    monto: float = Field(..., gt=0)
    moneda: str = "ARS"
    tipo_cambio: float | None = None
    empresa_id: int
    proveedor_id: int | None = None
    banco_id: int
    estado: EstadoErogacion = "pendiente"
    categoria: str | None = None
    subcategoria: str | None = None
    es_critico: bool = False
    notas: str | None = None
    prioridad_atraso: PrioridadAtraso = "normal"


class ErogacionUpdate(BaseModel):
    fecha_pago: str | None = None
    descripcion: str | None = None
    monto: float | None = None
    moneda: str | None = None
    tipo_cambio: float | None = None
    empresa_id: int | None = None
    proveedor_id: int | None = None
    banco_id: int | None = None
    estado: EstadoErogacion | None = None
    categoria: str | None = None
    subcategoria: str | None = None
    es_critico: bool | None = None
    notas: str | None = None
    prioridad_atraso: PrioridadAtraso | None = None
    fecha_sugerida_tentativa: str | None = None
    oculto: bool | None = None


@router.get("/erogaciones")
def list_erogaciones(
    user: Annotated[dict, Depends(current_user)],
    estado: EstadoErogacion | None = None,
    empresa_id: int | None = None,
    banco_id: int | None = None,
    proveedor_id: int | None = None,
    fecha_desde: str | None = None,
    fecha_hasta: str | None = None,
    q: str | None = None,
    incluir_ocultas: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    _guard(user)
    return flujo_fondos_db.list_erogaciones(
        estado=estado,
        empresa_id=empresa_id,
        banco_id=banco_id,
        proveedor_id=proveedor_id,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        query=q,
        incluir_ocultas=incluir_ocultas,
        limit=limit,
        offset=offset,
    )


@router.get("/erogaciones/{erogacion_id}")
def get_erogacion(
    erogacion_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    e = flujo_fondos_db.get_erogacion(erogacion_id)
    if not e:
        raise HTTPException(404, "Erogacion no encontrada")
    return e


@router.post("/erogaciones", status_code=201)
def create_erogacion(
    body: ErogacionCreate,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    try:
        return flujo_fondos_db.create_erogacion(body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/erogaciones/{erogacion_id}")
def update_erogacion(
    erogacion_id: int,
    body: ErogacionUpdate,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "Sin campos para actualizar")
    res = flujo_fondos_db.update_erogacion(erogacion_id, data)
    if not res:
        raise HTTPException(404, "Erogacion no encontrada")
    return res


@router.delete("/erogaciones/{erogacion_id}", status_code=204)
def delete_erogacion(
    erogacion_id: int,
    user: Annotated[dict, Depends(current_user)],
):
    _guard(user)
    ok = flujo_fondos_db.delete_erogacion(erogacion_id)
    if not ok:
        raise HTTPException(404, "Erogacion no encontrada")
    return None


# ============================================================
# Proyeccion (motor central)
# ============================================================

@router.get("/proyeccion")
def get_proyeccion(
    user: Annotated[dict, Depends(current_user)],
    dias: Annotated[int, Query(ge=1, le=180)] = 30,
    saldo_inicial: float | None = None,
    semanas_ventana: Annotated[int, Query(ge=1, le=52)] = 12,
    decay: Annotated[float, Query(ge=0.1, le=1.0)] = 0.85,
) -> dict:
    """
    Proyeccion de saldo dia a dia.

    Si `saldo_inicial` no se pasa, se usa la suma de los ultimos saldos de
    todos los bancos (excluyendo el banco virtual "Total consolidado").
    """
    _guard(user)
    today = date.today()
    fin = (today.replace(day=1)) if False else today  # placeholder

    if saldo_inicial is None:
        saldo_inicial = flujo_fondos_db.get_saldo_inicial_total(fecha_hasta=today.isoformat())

    unidades = flujo_fondos_db.list_unidades_negocio(only_active=True)
    facturacion = flujo_fondos_db.get_facturacion_window(today.isoformat(), semanas_ventana)
    fecha_fin = today.replace(day=today.day)  # noqa: F841
    from datetime import timedelta as _td
    fecha_fin_real = today + _td(days=dias - 1)
    erogaciones = flujo_fondos_db.get_erogaciones_window(today.isoformat(), fecha_fin_real.isoformat())
    ingresos_puntuales = flujo_fondos_db.get_ingresos_puntuales_window(today.isoformat(), fecha_fin_real.isoformat())

    return construir_proyeccion(
        fecha_inicio=today,
        dias=dias,
        saldo_inicial_total=float(saldo_inicial),
        unidades_activas=unidades,
        facturacion_filas=facturacion,
        erogaciones=erogaciones,
        ingresos_puntuales=ingresos_puntuales,
        semanas_ventana=semanas_ventana,
        decay=decay,
    )


# ============================================================
# Maestros (read-only en Fase 1)
# ============================================================

@router.get("/empresas")
def list_empresas(
    user: Annotated[dict, Depends(current_user)],
    only_active: bool = True,
) -> dict:
    _guard(user)
    items = flujo_fondos_db.list_empresas(only_active=only_active)
    return {"items": items, "count": len(items)}


@router.get("/bancos")
def list_bancos(
    user: Annotated[dict, Depends(current_user)],
    only_active: bool = True,
) -> dict:
    _guard(user)
    items = flujo_fondos_db.list_bancos(only_active=only_active)
    return {"items": items, "count": len(items)}


@router.get("/proveedores")
def list_proveedores(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    items = flujo_fondos_db.list_proveedores()
    return {"items": items, "count": len(items)}


@router.get("/unidades-negocio")
def list_unidades_negocio(
    user: Annotated[dict, Depends(current_user)],
    only_active: bool = True,
) -> dict:
    _guard(user)
    items = flujo_fondos_db.list_unidades_negocio(only_active=only_active)
    return {"items": items, "count": len(items)}

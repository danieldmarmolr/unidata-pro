"""
Router REST del modulo Flujo de Fondos. Port nativo a UNIDATA.

Ver docs/FLUJO_FONDOS_INTEGRATION.md. RBAC: area finanzas/administracion
(admin/gerencia bypass).
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth.security import current_user, require_area
from app.db import flujo_fondos_db as ff
from app.services.flujo_fondos.proyeccion import (
    construir_proyeccion,
    sugerir_fechas_pagos_atrasados,
    calcular_promedios_unidad,
    diferimiento_de_unidad,
    COLCHON_DEFAULT,
    HORIZONTE_BUSQUEDA_DIAS,
)

router = APIRouter(prefix="/api/flujo-fondos", tags=["flujo-fondos"])

EstadoErogacion = Literal["pendiente", "en_curso", "pagado", "cancelado", "rechazado"]
PrioridadAtraso = Literal["normal", "laxo"]
CanalUnidad = Literal["directo", "marketplace", "dropshipping", "otro"]
TipoBanco = Literal["banco", "billetera_digital", "efectivo", "otro"]
PrioridadProveedor = Literal["alta", "media", "baja"]
FrecuenciaRec = Literal["mensual", "semanal", "quincenal", "trimestral", "anual", "custom"]
TipoAcuerdo = Literal["diferimiento", "pago_parcial", "plan_cuotas", "otro"]
EstadoAcuerdo = Literal["pendiente", "cumplido", "incumplido"]
FuenteSaldo = Literal["manual", "api_banco", "extracto_csv"]


def _guard(user: dict) -> None:
    require_area(user, ["finanzas", "administracion"])


# ============================================================
# Health + KPIs
# ============================================================

@router.get("/health")
def health(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    return {"status": "ok", "module": "flujo-fondos"}


@router.get("/kpis")
def get_kpis(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    return ff.kpis()


# ============================================================
# Erogaciones
# ============================================================

class ErogacionCreate(BaseModel):
    fecha_pago: str
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
    empresa_id: int | None = None, banco_id: int | None = None, proveedor_id: int | None = None,
    fecha_desde: str | None = None, fecha_hasta: str | None = None,
    q: str | None = None, incluir_ocultas: bool = False, solo_atrasadas: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    _guard(user)
    return ff.list_erogaciones(estado=estado, empresa_id=empresa_id, banco_id=banco_id,
                                 proveedor_id=proveedor_id, fecha_desde=fecha_desde,
                                 fecha_hasta=fecha_hasta, query=q, incluir_ocultas=incluir_ocultas,
                                 solo_atrasadas=solo_atrasadas, limit=limit, offset=offset)


@router.get("/erogaciones/{eid}")
def get_erogacion(eid: int, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    e = ff.get_erogacion(eid)
    if not e:
        raise HTTPException(404, "Erogacion no encontrada")
    return e


@router.post("/erogaciones", status_code=201)
def create_erogacion(body: ErogacionCreate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    try:
        return ff.create_erogacion(body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/erogaciones/{eid}")
def update_erogacion(eid: int, body: ErogacionUpdate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "Sin campos para actualizar")
    res = ff.update_erogacion(eid, data)
    if not res:
        raise HTTPException(404, "Erogacion no encontrada")
    return res


@router.delete("/erogaciones/{eid}", status_code=204)
def delete_erogacion(eid: int, user: Annotated[dict, Depends(current_user)]):
    _guard(user)
    if not ff.delete_erogacion(eid):
        raise HTTPException(404, "Erogacion no encontrada")


# ============================================================
# Proyeccion
# ============================================================

@router.get("/proyeccion")
def get_proyeccion(
    user: Annotated[dict, Depends(current_user)],
    dias: Annotated[int, Query(ge=1, le=180)] = 30,
    saldo_inicial: float | None = None,
    semanas_ventana: Annotated[int, Query(ge=1, le=52)] = 12,
    decay: Annotated[float, Query(ge=0.1, le=1.0)] = 0.85,
) -> dict:
    _guard(user)
    today = date.today()
    if saldo_inicial is None:
        saldo_inicial = ff.get_saldo_inicial_total(fecha_hasta=today.isoformat())
    unidades = ff.list_unidades_negocio(only_active=True)
    facturacion = ff.get_facturacion_window(today.isoformat(), semanas_ventana)
    fecha_fin = today + timedelta(days=dias - 1)
    erogaciones = ff.get_erogaciones_window(today.isoformat(), fecha_fin.isoformat())
    ingresos_puntuales = ff.get_ingresos_puntuales_window(today.isoformat(), fecha_fin.isoformat())
    return construir_proyeccion(
        fecha_inicio=today, dias=dias, saldo_inicial_total=float(saldo_inicial),
        unidades_activas=unidades, facturacion_filas=facturacion,
        erogaciones=erogaciones, ingresos_puntuales=ingresos_puntuales,
        semanas_ventana=semanas_ventana, decay=decay,
    )


# ============================================================
# Pagos atrasados (lista + sugerencias)
# ============================================================

class AplicarTentativaBody(BaseModel):
    fecha_sugerida_tentativa: str | None = None


@router.get("/pagos-atrasados")
def list_pagos_atrasados(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    items = ff.get_pagos_atrasados_list()
    return {"items": items, "count": len(items),
            "total_monto": sum(p["monto"] for p in items)}


@router.post("/pagos-atrasados/sugerir")
def sugerir_pagos_atrasados(
    user: Annotated[dict, Depends(current_user)],
    colchon: Annotated[float, Query(ge=0)] = COLCHON_DEFAULT,
    saldo_inicial: float | None = None,
    semanas_ventana: Annotated[int, Query(ge=1, le=52)] = 12,
    decay: Annotated[float, Query(ge=0.1, le=1.0)] = 0.85,
) -> dict:
    """Calcula sugerencias de re-fecha y devuelve sin aplicarlas (no escribe)."""
    _guard(user)
    today = date.today()
    pagos = ff.get_pagos_atrasados_list()
    if saldo_inicial is None:
        saldo_inicial = ff.get_saldo_inicial_total(fecha_hasta=today.isoformat())
    unidades = ff.list_unidades_negocio(only_active=True)
    fecha_fin = today + timedelta(days=HORIZONTE_BUSQUEDA_DIAS)
    facturacion = ff.get_facturacion_window(today.isoformat(), semanas_ventana)
    erogs_futuras = ff.get_erogaciones_futuras_efectivas(today.isoformat(), fecha_fin.isoformat())
    ingresos_puntuales = ff.get_ingresos_puntuales_window(today.isoformat(), fecha_fin.isoformat())

    # Calcular promedios por unidad para el motor
    from app.services.flujo_fondos.proyeccion import calcular_promedios_unidad, diferimiento_de_unidad
    promedios = []
    for u in unidades:
        p = calcular_promedios_unidad(u["id"], facturacion, semanas_ventana=semanas_ventana, decay=decay, referencia=today)
        p.unidad_nombre = u.get("nombre")
        p.dias_diferimiento = diferimiento_de_unidad(u.get("nombre"))
        promedios.append(p)

    sugerencias = sugerir_fechas_pagos_atrasados(
        pagos_atrasados=pagos, saldo_inicial=float(saldo_inicial), hoy=today,
        promedios=promedios, erogaciones_futuras=erogs_futuras,
        ingresos_puntuales=ingresos_puntuales, colchon=colchon,
    )
    return {"sugerencias": sugerencias, "colchon": colchon, "horizonte_dias": HORIZONTE_BUSQUEDA_DIAS,
            "saldo_inicial": saldo_inicial, "fecha_hoy": today.isoformat()}


@router.post("/pagos-atrasados/{eid}/aplicar-tentativa")
def aplicar_tentativa(eid: int, body: AplicarTentativaBody, user: Annotated[dict, Depends(current_user)]) -> dict:
    """Setea fecha_sugerida_tentativa (no toca fecha_pago real). Null para limpiar."""
    _guard(user)
    res = ff.update_erogacion(eid, {"fecha_sugerida_tentativa": body.fecha_sugerida_tentativa})
    if not res:
        raise HTTPException(404, "Erogacion no encontrada")
    return res


@router.post("/pagos-atrasados/{eid}/confirmar")
def confirmar_tentativa(eid: int, user: Annotated[dict, Depends(current_user)]) -> dict:
    """Copia fecha_sugerida_tentativa a fecha_pago y limpia tentativa."""
    _guard(user)
    e = ff.get_erogacion(eid)
    if not e:
        raise HTTPException(404, "Erogacion no encontrada")
    if not e.get("fecha_sugerida_tentativa"):
        raise HTTPException(400, "No hay fecha tentativa para confirmar")
    return ff.update_erogacion(eid, {"fecha_pago": e["fecha_sugerida_tentativa"], "fecha_sugerida_tentativa": None})


# ============================================================
# Ingresos puntuales
# ============================================================

class IngresoPuntualCreate(BaseModel):
    fecha: str
    descripcion: str
    monto: float = Field(..., gt=0)
    empresa_id: int
    banco_id: int | None = None
    categoria: str | None = None
    notas: str | None = None
    origen: str = "manual"


class IngresoPuntualUpdate(BaseModel):
    fecha: str | None = None
    descripcion: str | None = None
    monto: float | None = None
    empresa_id: int | None = None
    banco_id: int | None = None
    categoria: str | None = None
    notas: str | None = None


@router.get("/ingresos-puntuales")
def list_ingresos(user: Annotated[dict, Depends(current_user)],
                  fecha_desde: str | None = None, fecha_hasta: str | None = None) -> dict:
    _guard(user)
    items = ff.list_ingresos_puntuales(fecha_desde, fecha_hasta)
    return {"items": items, "count": len(items)}


@router.post("/ingresos-puntuales", status_code=201)
def create_ingreso(body: IngresoPuntualCreate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    try:
        return ff.create_ingreso_puntual(body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/ingresos-puntuales/{iid}")
def update_ingreso(iid: int, body: IngresoPuntualUpdate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "Sin campos")
    res = ff.update_ingreso_puntual(iid, data)
    if not res:
        raise HTTPException(404, "No encontrado")
    return res


@router.delete("/ingresos-puntuales/{iid}", status_code=204)
def delete_ingreso(iid: int, user: Annotated[dict, Depends(current_user)]):
    _guard(user)
    if not ff.delete_ingreso_puntual(iid):
        raise HTTPException(404, "No encontrado")


# ============================================================
# Recurrencias
# ============================================================

class RecurrenciaCreate(BaseModel):
    descripcion: str
    monto_base: float | None = None
    frecuencia: FrecuenciaRec
    fecha_inicio: str
    fecha_fin: str | None = None
    cuotas_totales: int | None = None
    proveedor_id: int | None = None
    empresa_id: int | None = None
    banco_id: int | None = None
    indexacion: dict[str, Any] = {}
    activa: bool = True


class RecurrenciaUpdate(BaseModel):
    descripcion: str | None = None
    monto_base: float | None = None
    frecuencia: FrecuenciaRec | None = None
    fecha_inicio: str | None = None
    fecha_fin: str | None = None
    cuotas_totales: int | None = None
    proveedor_id: int | None = None
    empresa_id: int | None = None
    banco_id: int | None = None
    indexacion: dict[str, Any] | None = None
    activa: bool | None = None


@router.get("/recurrencias")
def list_recurrencias(user: Annotated[dict, Depends(current_user)], only_active: bool = False) -> dict:
    _guard(user)
    items = ff.list_recurrencias(only_active=only_active)
    return {"items": items, "count": len(items)}


@router.post("/recurrencias", status_code=201)
def create_recurrencia(body: RecurrenciaCreate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    try:
        return ff.create_recurrencia(body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/recurrencias/{rid}")
def update_recurrencia(rid: int, body: RecurrenciaUpdate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    data = body.model_dump(exclude_unset=True)
    if not data: raise HTTPException(400, "Sin campos")
    res = ff.update_recurrencia(rid, data)
    if not res: raise HTTPException(404, "No encontrada")
    return res


@router.delete("/recurrencias/{rid}", status_code=204)
def delete_recurrencia(rid: int, user: Annotated[dict, Depends(current_user)]):
    _guard(user)
    if not ff.delete_recurrencia(rid):
        raise HTTPException(404, "No encontrada")


# ============================================================
# Acuerdos
# ============================================================

class AcuerdoCreate(BaseModel):
    proveedor_id: int
    tipo: TipoAcuerdo
    compromiso: str
    fecha_compromiso: str | None = None
    monto_compromiso: float | None = None
    estado: EstadoAcuerdo = "pendiente"
    contexto: str | None = None
    erogacion_id: int | None = None


class AcuerdoUpdate(BaseModel):
    tipo: TipoAcuerdo | None = None
    compromiso: str | None = None
    fecha_compromiso: str | None = None
    monto_compromiso: float | None = None
    estado: EstadoAcuerdo | None = None
    contexto: str | None = None
    erogacion_id: int | None = None
    fecha_resolucion: str | None = None


@router.get("/acuerdos")
def list_acuerdos(user: Annotated[dict, Depends(current_user)], estado: EstadoAcuerdo | None = None) -> dict:
    _guard(user)
    items = ff.list_acuerdos(estado=estado)
    return {"items": items, "count": len(items)}


@router.post("/acuerdos", status_code=201)
def create_acuerdo(body: AcuerdoCreate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    try:
        return ff.create_acuerdo(body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/acuerdos/{aid}")
def update_acuerdo(aid: int, body: AcuerdoUpdate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    data = body.model_dump(exclude_unset=True)
    if not data: raise HTTPException(400, "Sin campos")
    res = ff.update_acuerdo(aid, data)
    if not res: raise HTTPException(404, "No encontrado")
    return res


@router.delete("/acuerdos/{aid}", status_code=204)
def delete_acuerdo(aid: int, user: Annotated[dict, Depends(current_user)]):
    _guard(user)
    if not ff.delete_acuerdo(aid):
        raise HTTPException(404, "No encontrado")


# ============================================================
# Saldos iniciales
# ============================================================

class SaldoInicialCreate(BaseModel):
    fecha: str
    banco_id: int
    saldo: float
    fuente: FuenteSaldo = "manual"


@router.get("/saldos")
def list_saldos(user: Annotated[dict, Depends(current_user)], banco_id: int | None = None) -> dict:
    _guard(user)
    items = ff.list_saldos_iniciales(banco_id=banco_id)
    return {"items": items, "count": len(items)}


@router.get("/saldos/actual")
def saldo_actual(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    por_banco = ff.get_saldos_actuales_por_banco()
    total = sum(float(b["saldo"]) for b in por_banco)
    return {"por_banco": por_banco, "total": total}


@router.post("/saldos", status_code=201)
def create_saldo(body: SaldoInicialCreate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    try:
        return ff.create_saldo_inicial(body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


# ============================================================
# Facturacion diaria
# ============================================================

class FacturacionCreate(BaseModel):
    fecha: str
    monto: float = Field(..., ge=0)
    unidad_negocio_id: int
    empresa_id: int | None = None
    es_real: bool = True
    es_evento_puntual: bool = False
    origen: str = "manual"


class FacturacionUpdate(BaseModel):
    fecha: str | None = None
    monto: float | None = None
    unidad_negocio_id: int | None = None
    empresa_id: int | None = None
    es_real: bool | None = None
    es_evento_puntual: bool | None = None


@router.get("/facturacion")
def list_facturacion(user: Annotated[dict, Depends(current_user)],
                     fecha_desde: str | None = None, fecha_hasta: str | None = None,
                     unidad_id: int | None = None, limit: int = 500) -> dict:
    _guard(user)
    items = ff.list_facturacion(fecha_desde, fecha_hasta, unidad_id, limit)
    return {"items": items, "count": len(items)}


@router.post("/facturacion", status_code=201)
def create_facturacion(body: FacturacionCreate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    try:
        return ff.create_facturacion(body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/facturacion/{fid}")
def update_facturacion(fid: int, body: FacturacionUpdate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    data = body.model_dump(exclude_unset=True)
    if not data: raise HTTPException(400, "Sin campos")
    res = ff.update_facturacion(fid, data)
    if not res: raise HTTPException(404, "No encontrada")
    return res


@router.delete("/facturacion/{fid}", status_code=204)
def delete_facturacion(fid: int, user: Annotated[dict, Depends(current_user)]):
    _guard(user)
    if not ff.delete_facturacion(fid):
        raise HTTPException(404, "No encontrada")


# ============================================================
# Promedios
# ============================================================

@router.get("/promedios")
def get_promedios(
    user: Annotated[dict, Depends(current_user)],
    semanas_ventana: Annotated[int, Query(ge=1, le=52)] = 12,
    decay: Annotated[float, Query(ge=0.1, le=1.0)] = 0.85,
) -> dict:
    _guard(user)
    today = date.today()
    unidades = ff.list_unidades_negocio(only_active=True)
    facturacion = ff.get_facturacion_window(today.isoformat(), semanas_ventana)
    items = []
    for u in unidades:
        p = calcular_promedios_unidad(u["id"], facturacion, semanas_ventana=semanas_ventana, decay=decay, referencia=today)
        items.append({
            "unidad_negocio_id": u["id"], "unidad_nombre": u["nombre"],
            "dias_diferimiento": diferimiento_de_unidad(u["nombre"]),
            "total_semanal_ponderado": round(p.total_semanal_ponderado, 2),
            "total_semanal_simple": round(p.total_semanal_simple, 2),
            "filas_usadas": p.filas_usadas,
            "filas_excluidas_evento_puntual": p.filas_excluidas_evento_puntual,
            "por_dow": {
                str(d): {"ponderado": round(p.por_dow[d].ponderado, 2),
                         "simple": round(p.por_dow[d].simple, 2),
                         "n": p.por_dow[d].n,
                         "desvio_pct": round(p.por_dow[d].desvio_pct, 1)}
                for d in range(7)
            },
        })
    return {"items": items, "fecha_referencia": today.isoformat(),
            "semanas_ventana": semanas_ventana, "decay": decay}


# ============================================================
# Analisis + Precision + Sugerencias + Calendario
# ============================================================

@router.get("/analisis")
def get_analisis(user: Annotated[dict, Depends(current_user)],
                 fecha_desde: str | None = None, fecha_hasta: str | None = None) -> dict:
    _guard(user)
    if not fecha_desde:
        fecha_desde = (date.today() - timedelta(days=90)).isoformat()
    if not fecha_hasta:
        fecha_hasta = date.today().isoformat()
    return ff.analisis_gastos(fecha_desde, fecha_hasta)


@router.get("/precision")
def get_precision(user: Annotated[dict, Depends(current_user)],
                  fecha_desde: str | None = None, fecha_hasta: str | None = None) -> dict:
    _guard(user)
    if not fecha_desde:
        fecha_desde = (date.today() - timedelta(days=60)).isoformat()
    if not fecha_hasta:
        fecha_hasta = date.today().isoformat()
    items = ff.precision_facturacion(fecha_desde, fecha_hasta)
    return {"items": items, "fecha_desde": fecha_desde, "fecha_hasta": fecha_hasta,
            "count": len(items)}


@router.get("/sugerencias")
def get_sugerencias(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    items = ff.detectar_candidatos_recurrencia()
    return {"items": items, "count": len(items)}


@router.get("/calendario")
def get_calendario(
    user: Annotated[dict, Depends(current_user)],
    year: int | None = None, month: int | None = None,
) -> dict:
    _guard(user)
    today = date.today()
    y = year or today.year
    m = month or today.month
    return ff.calendario_mensual(y, m)


# ============================================================
# Maestros: Empresas
# ============================================================

class EmpresaCreate(BaseModel):
    nombre: str
    cuit: str | None = None
    activa: bool = True


class EmpresaUpdate(BaseModel):
    nombre: str | None = None
    cuit: str | None = None
    activa: bool | None = None


@router.get("/empresas")
def list_empresas(user: Annotated[dict, Depends(current_user)], only_active: bool = True) -> dict:
    _guard(user)
    items = ff.list_empresas(only_active=only_active)
    return {"items": items, "count": len(items)}


@router.post("/empresas", status_code=201)
def create_empresa(body: EmpresaCreate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    try: return ff.create_empresa(body.model_dump())
    except ValueError as e: raise HTTPException(400, str(e))


@router.patch("/empresas/{eid}")
def update_empresa(eid: int, body: EmpresaUpdate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    data = body.model_dump(exclude_unset=True)
    if not data: raise HTTPException(400, "Sin campos")
    res = ff.update_empresa(eid, data)
    if not res: raise HTTPException(404, "No encontrada")
    return res


@router.delete("/empresas/{eid}", status_code=204)
def delete_empresa(eid: int, user: Annotated[dict, Depends(current_user)]):
    _guard(user)
    if not ff.delete_empresa(eid): raise HTTPException(404, "No encontrada")


# ============================================================
# Maestros: Unidades de negocio
# ============================================================

class UnidadCreate(BaseModel):
    nombre: str
    canal: CanalUnidad = "otro"
    activa: bool = True
    config_ingesta: dict[str, Any] = {}


class UnidadUpdate(BaseModel):
    nombre: str | None = None
    canal: CanalUnidad | None = None
    activa: bool | None = None
    config_ingesta: dict[str, Any] | None = None


@router.get("/unidades-negocio")
def list_unidades(user: Annotated[dict, Depends(current_user)], only_active: bool = True) -> dict:
    _guard(user)
    items = ff.list_unidades_negocio(only_active=only_active)
    return {"items": items, "count": len(items)}


@router.post("/unidades-negocio", status_code=201)
def create_unidad(body: UnidadCreate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    try: return ff.create_unidad_negocio(body.model_dump())
    except ValueError as e: raise HTTPException(400, str(e))


@router.patch("/unidades-negocio/{uid}")
def update_unidad(uid: int, body: UnidadUpdate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    data = body.model_dump(exclude_unset=True)
    if not data: raise HTTPException(400, "Sin campos")
    res = ff.update_unidad_negocio(uid, data)
    if not res: raise HTTPException(404, "No encontrada")
    return res


@router.delete("/unidades-negocio/{uid}", status_code=204)
def delete_unidad(uid: int, user: Annotated[dict, Depends(current_user)]):
    _guard(user)
    if not ff.delete_unidad_negocio(uid): raise HTTPException(404, "No encontrada")


# ============================================================
# Maestros: Bancos
# ============================================================

class BancoCreate(BaseModel):
    nombre: str
    tipo: TipoBanco = "banco"
    saldo_actual: float | None = None
    moneda: str = "ARS"
    activo: bool = True


class BancoUpdate(BaseModel):
    nombre: str | None = None
    tipo: TipoBanco | None = None
    saldo_actual: float | None = None
    moneda: str | None = None
    activo: bool | None = None


@router.get("/bancos")
def list_bancos(user: Annotated[dict, Depends(current_user)],
                only_active: bool = True, exclude_consolidado: bool = False) -> dict:
    _guard(user)
    items = ff.list_bancos(only_active=only_active, exclude_consolidado=exclude_consolidado)
    return {"items": items, "count": len(items)}


@router.post("/bancos", status_code=201)
def create_banco(body: BancoCreate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    try: return ff.create_banco(body.model_dump())
    except ValueError as e: raise HTTPException(400, str(e))


@router.patch("/bancos/{bid}")
def update_banco(bid: int, body: BancoUpdate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    data = body.model_dump(exclude_unset=True)
    if not data: raise HTTPException(400, "Sin campos")
    res = ff.update_banco(bid, data)
    if not res: raise HTTPException(404, "No encontrado")
    return res


@router.delete("/bancos/{bid}", status_code=204)
def delete_banco(bid: int, user: Annotated[dict, Depends(current_user)]):
    _guard(user)
    if not ff.delete_banco(bid): raise HTTPException(404, "No encontrado")


# ============================================================
# Maestros: Proveedores
# ============================================================

class ProveedorCreate(BaseModel):
    nombre: str
    cuit: str | None = None
    prioridad: PrioridadProveedor = "media"
    saldo_pendiente: float = 0
    notas: str | None = None
    tags: list[str] = []
    contacto: dict[str, Any] = {}


class ProveedorUpdate(BaseModel):
    nombre: str | None = None
    cuit: str | None = None
    prioridad: PrioridadProveedor | None = None
    saldo_pendiente: float | None = None
    notas: str | None = None
    tags: list[str] | None = None
    contacto: dict[str, Any] | None = None


@router.get("/proveedores")
def list_proveedores(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    items = ff.list_proveedores()
    return {"items": items, "count": len(items)}


@router.post("/proveedores", status_code=201)
def create_proveedor(body: ProveedorCreate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    try: return ff.create_proveedor(body.model_dump())
    except ValueError as e: raise HTTPException(400, str(e))


@router.patch("/proveedores/{pid}")
def update_proveedor(pid: int, body: ProveedorUpdate, user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    data = body.model_dump(exclude_unset=True)
    if not data: raise HTTPException(400, "Sin campos")
    res = ff.update_proveedor(pid, data)
    if not res: raise HTTPException(404, "No encontrado")
    return res


@router.delete("/proveedores/{pid}", status_code=204)
def delete_proveedor(pid: int, user: Annotated[dict, Depends(current_user)]):
    _guard(user)
    if not ff.delete_proveedor(pid): raise HTTPException(404, "No encontrado")

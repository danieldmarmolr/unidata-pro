"""
Motor de proyeccion de saldos dia a dia (port de
services/flujo-fondos/src/lib/proyeccion.ts + promedios/calcular.ts).

Logica:
 1. Cargar facturacion real de los ultimos N semanas hasta una fecha referencia.
 2. Para cada unidad de negocio, calcular promedio ponderado por DOW (dia de
    semana), con peso decay^semanas_atras (default 0.85^N).
 3. Para proyectar el monto de un dia futuro de una unidad: aplicar el
    diferimiento (Unistore Mayorista cobra el dia X+1 lo facturado el dia X),
    mirar el DOW del dia origen, devolver el promedio ponderado.
 4. Construir una serie dia a dia desde fecha referencia con:
       saldo_dia = saldo_dia_previo
                 + ingresos_proyectados (suma sobre todas las unidades)
                 + ingresos_puntuales del dia
                 - egresos del dia (erogaciones no canceladas, no ocultas)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Iterable

# DOW: 0=Lunes ... 6=Domingo. Distinto de Python's weekday() que ya es asi (0=Mon).
# Si usamos isoweekday() es 1..7. Mantenemos weekday() (0..6 Mon-Sun).

DIFERIMIENTO_POR_UNIDAD: dict[str, int] = {
    "unistore mayorista": 1,
}


def diferimiento_de_unidad(nombre: str | None) -> int:
    """Dias entre facturacion y cobro. 0 si no aplica."""
    if not nombre:
        return 0
    return DIFERIMIENTO_POR_UNIDAD.get(nombre.strip().lower(), 0)


@dataclass
class EstadisticaDow:
    ponderado: float = 0.0
    simple: float = 0.0
    n: int = 0
    desvio_pct: float = 0.0


@dataclass
class PromediosUnidad:
    unidad_negocio_id: int
    unidad_nombre: str | None = None
    dias_diferimiento: int = 0
    por_dow: dict[int, EstadisticaDow] = field(default_factory=dict)
    total_semanal_ponderado: float = 0.0
    total_semanal_simple: float = 0.0
    filas_usadas: int = 0
    filas_excluidas_evento_puntual: int = 0
    filas_fuera_de_ventana: int = 0


def _parse_iso(s: str) -> date:
    return date.fromisoformat(s)


def _semanas_atras(fecha: date, referencia: date) -> int:
    """Numero de semanas entre fecha y referencia (basado en lunes de cada semana)."""
    # Llevar a lunes (weekday=0)
    monday_fecha = fecha - timedelta(days=fecha.weekday())
    monday_ref = referencia - timedelta(days=referencia.weekday())
    diff_days = (monday_ref - monday_fecha).days
    return diff_days // 7


def calcular_promedios_unidad(
    unidad_negocio_id: int,
    filas: Iterable[dict],
    *,
    semanas_ventana: int = 12,
    decay: float = 0.85,
    referencia: date | None = None,
) -> PromediosUnidad:
    """
    `filas`: dicts con {fecha (YYYY-MM-DD), monto (float), unidad_negocio_id, es_evento_puntual}
    """
    if referencia is None:
        referencia = date.today()

    buckets: dict[int, dict[str, list[float]]] = {
        i: {"montos": [], "pesos": []} for i in range(7)
    }
    filas_usadas = 0
    filas_excluidas_evento_puntual = 0
    filas_fuera_de_ventana = 0

    for fila in filas:
        if fila["unidad_negocio_id"] != unidad_negocio_id:
            continue
        if fila["es_evento_puntual"]:
            filas_excluidas_evento_puntual += 1
            continue
        fecha = _parse_iso(fila["fecha"])
        semanas = _semanas_atras(fecha, referencia)
        if semanas < 0 or semanas >= semanas_ventana:
            filas_fuera_de_ventana += 1
            continue
        dow = fecha.weekday()
        monto = float(fila["monto"])
        if not math.isfinite(monto) or monto < 0:
            continue
        peso = decay ** semanas
        buckets[dow]["montos"].append(monto)
        buckets[dow]["pesos"].append(peso)
        filas_usadas += 1

    por_dow: dict[int, EstadisticaDow] = {i: EstadisticaDow() for i in range(7)}
    total_pond = 0.0
    total_simple = 0.0

    for dow in range(7):
        montos = buckets[dow]["montos"]
        pesos = buckets[dow]["pesos"]
        if not montos:
            continue
        simple = sum(montos) / len(montos)
        suma_peso = sum(pesos)
        ponderado = sum(m * p for m, p in zip(montos, pesos)) / suma_peso if suma_peso > 0 else 0.0
        varianza = sum((m - simple) ** 2 for m in montos) / len(montos)
        desvio = math.sqrt(varianza)
        desvio_pct = (desvio / simple) * 100 if simple > 0 else 0.0
        por_dow[dow] = EstadisticaDow(ponderado=ponderado, simple=simple, n=len(montos), desvio_pct=desvio_pct)
        total_pond += ponderado
        total_simple += simple

    return PromediosUnidad(
        unidad_negocio_id=unidad_negocio_id,
        por_dow=por_dow,
        total_semanal_ponderado=total_pond,
        total_semanal_simple=total_simple,
        filas_usadas=filas_usadas,
        filas_excluidas_evento_puntual=filas_excluidas_evento_puntual,
        filas_fuera_de_ventana=filas_fuera_de_ventana,
    )


def proyectar_monto_unidad(promedios: PromediosUnidad, fecha_destino: date) -> float:
    """Monto esperado para una unidad en una fecha futura aplicando diferimiento."""
    d = promedios.dias_diferimiento
    fecha_facturacion = fecha_destino - timedelta(days=d) if d > 0 else fecha_destino
    dow = fecha_facturacion.weekday()
    return promedios.por_dow.get(dow, EstadisticaDow()).ponderado


@dataclass
class DiaProyeccion:
    fecha: str  # YYYY-MM-DD
    saldo_inicial: float
    ingresos_proyectados: float
    ingresos_puntuales: float
    egresos: float
    neto: float
    saldo_final: float
    detalle_ingresos: list[dict] = field(default_factory=list)  # por unidad
    detalle_egresos: list[dict] = field(default_factory=list)


def construir_proyeccion(
    *,
    fecha_inicio: date,
    dias: int,
    saldo_inicial_total: float,
    unidades_activas: list[dict],
    facturacion_filas: list[dict],
    erogaciones: list[dict],
    ingresos_puntuales: list[dict],
    semanas_ventana: int = 12,
    decay: float = 0.85,
) -> dict:
    """
    Construye la serie dia-a-dia de saldo proyectado.

    `unidades_activas`: list of {id, nombre, activa}
    `facturacion_filas`: ya filtradas a la ventana relevante
    `erogaciones`: list of {id, fecha_pago (str), monto, estado}
    `ingresos_puntuales`: list of {id, fecha (str), monto, descripcion}

    Returns dict con:
      - dias: list[DiaProyeccion as dict]
      - resumen: totales
      - promedios: list[PromediosUnidad as dict] (para debug/visualizacion)
    """
    # 1) Calcular promedios por unidad
    promedios_por_unidad: dict[int, PromediosUnidad] = {}
    for u in unidades_activas:
        p = calcular_promedios_unidad(
            u["id"],
            facturacion_filas,
            semanas_ventana=semanas_ventana,
            decay=decay,
            referencia=fecha_inicio,
        )
        p.unidad_nombre = u.get("nombre")
        p.dias_diferimiento = diferimiento_de_unidad(u.get("nombre"))
        promedios_por_unidad[u["id"]] = p

    # 2) Indexar erogaciones e ingresos puntuales por fecha
    egr_por_fecha: dict[str, list[dict]] = {}
    for e in erogaciones:
        egr_por_fecha.setdefault(e["fecha_pago"], []).append(e)
    ing_por_fecha: dict[str, list[dict]] = {}
    for i in ingresos_puntuales:
        ing_por_fecha.setdefault(i["fecha"], []).append(i)

    # 3) Iterar dia a dia
    dias_proy: list[DiaProyeccion] = []
    saldo_actual = saldo_inicial_total
    total_ingresos = 0.0
    total_egresos = 0.0
    total_ingresos_puntuales = 0.0

    for offset in range(dias):
        fecha_dia = fecha_inicio + timedelta(days=offset)
        fecha_str = fecha_dia.isoformat()

        # Ingresos proyectados por unidad
        detalle_ingresos: list[dict] = []
        ingresos_dia = 0.0
        for u in unidades_activas:
            p = promedios_por_unidad[u["id"]]
            monto = proyectar_monto_unidad(p, fecha_dia)
            if monto > 0:
                detalle_ingresos.append({"unidad_negocio_id": u["id"], "unidad_nombre": u.get("nombre"), "monto": round(monto, 2)})
                ingresos_dia += monto

        # Ingresos puntuales del dia
        ing_puntuales_dia = sum(float(i["monto"]) for i in ing_por_fecha.get(fecha_str, []))

        # Egresos del dia
        detalle_egresos = [
            {"id": e["id"], "monto": e["monto"], "estado": e["estado"]}
            for e in egr_por_fecha.get(fecha_str, [])
        ]
        egresos_dia = sum(e["monto"] for e in detalle_egresos)

        neto = ingresos_dia + ing_puntuales_dia - egresos_dia
        saldo_final = saldo_actual + neto

        dias_proy.append(DiaProyeccion(
            fecha=fecha_str,
            saldo_inicial=round(saldo_actual, 2),
            ingresos_proyectados=round(ingresos_dia, 2),
            ingresos_puntuales=round(ing_puntuales_dia, 2),
            egresos=round(egresos_dia, 2),
            neto=round(neto, 2),
            saldo_final=round(saldo_final, 2),
            detalle_ingresos=detalle_ingresos,
            detalle_egresos=detalle_egresos,
        ))

        saldo_actual = saldo_final
        total_ingresos += ingresos_dia
        total_ingresos_puntuales += ing_puntuales_dia
        total_egresos += egresos_dia

    return {
        "dias": [d.__dict__ for d in dias_proy],
        "resumen": {
            "saldo_inicial": round(saldo_inicial_total, 2),
            "saldo_final": round(saldo_actual, 2),
            "total_ingresos_proyectados": round(total_ingresos, 2),
            "total_ingresos_puntuales": round(total_ingresos_puntuales, 2),
            "total_egresos": round(total_egresos, 2),
            "neto_periodo": round(saldo_actual - saldo_inicial_total, 2),
            "fecha_inicio": fecha_inicio.isoformat(),
            "fecha_fin": (fecha_inicio + timedelta(days=dias - 1)).isoformat(),
            "dias": dias,
        },
        "promedios": [
            {
                "unidad_negocio_id": p.unidad_negocio_id,
                "unidad_nombre": p.unidad_nombre,
                "dias_diferimiento": p.dias_diferimiento,
                "total_semanal_ponderado": round(p.total_semanal_ponderado, 2),
                "total_semanal_simple": round(p.total_semanal_simple, 2),
                "filas_usadas": p.filas_usadas,
            }
            for p in promedios_por_unidad.values()
        ],
    }

"""
Motor de ganancia neta para Unistore (TN + MELI).

Calcula la ganancia REAL que queda en caja por cada item / orden, no la
facturacion bruta. Descuenta:

  - costo de mercaderia (con IVA, lo que efectivamente pagaste al proveedor)
  - IVA neto a pagar al fisco = max(0, IVA_ventas - IVA_compras)
  - Ingresos Brutos = 5% sobre base imponible de la venta
  - Fee de gateway de pago (TaloPay 0.5% por defecto; 0 para efectivo presencial)

La alicuota de IVA por SKU se DERIVA del lote (no hay campo en TN):
  alicuota = (costo_con_iva_unit_ars / costo_unit_ars) - 1
  -> da 0.21 (21%) o 0.105 (10.5%) automaticamente segun lo cargado en el CSV.

Si el SKU no tiene costo cargado, devolvemos ganancia=None con un motivo.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Iterable

# ---- Defaults ----
DEFAULT_IVA = 0.21
IIBB_RATE = 0.05  # Ingresos Brutos CABA / PBA (5% sobre base imponible)
TALOPAY_FEE_RATE = 0.005  # 0.5% sobre ingreso bruto

# En tienda_nube."Order".gateway TN guarda el id canónico del medio de pago.
# 'offline' = efectivo / transferencia / deposito (cobro fuera del gateway,
# generalmente queda paymentStatus='pending' hasta que se cobra presencial).
# 'pago-nube' / 'gocuotas' / 'mercadopago' etc. = gateway online (con fee).
OFFLINE_GATEWAY_IDS = ("offline",)


def is_cash_payment(gateway: str | None, payment_status: str | None = None) -> bool:
    """True si la venta NO se cobra a traves de un gateway online.

    `gateway` es el id canonico (tienda_nube."Order".gateway) — 'offline' para
    cobros presenciales / transferencia / deposito; el resto son gateways online.
    """
    if gateway:
        return gateway.strip().lower() in OFFLINE_GATEWAY_IDS
    # Sin gateway pero pending → tratamos como efectivo presencial pendiente
    return (payment_status or "").lower() == "pending"


def derive_iva_aliquot(costo_sin_iva: float | None, costo_con_iva: float | None) -> float | None:
    """Deriva la alicuota de IVA del lote del SKU. None si no se puede inferir."""
    if not costo_sin_iva or not costo_con_iva or costo_sin_iva <= 0:
        return None
    ratio = costo_con_iva / costo_sin_iva - 1.0
    if ratio < 0:
        return None
    # Snap a las alicuotas argentinas tipicas si esta cerca (tolerancia 1pp)
    for std in (0.21, 0.105, 0.27, 0.0):
        if abs(ratio - std) < 0.01:
            return std
    return ratio


@dataclass
class ProfitBreakdown:
    """Desglose completo de ganancia para una linea o agregado de orden."""
    # Inputs
    ingreso_bruto: float
    costo_con_iva: float
    costo_sin_iva: float
    iva_aliquot: float          # tasa derivada (0.21, 0.105, etc.)
    iva_aliquot_source: str     # "derived" | "default" | "override"
    gateway_fee_rate: float     # 0.005 = TaloPay; 0 = efectivo

    # Computados (caja real)
    base_imponible_venta: float
    iva_ventas: float
    iva_compras: float
    iva_neto_a_pagar: float
    iibb: float
    gateway_fee: float
    ganancia_neta: float
    margen_pct: float
    # Flags
    has_cost: bool              # True si tenemos costo cargado para todos los items
    is_cash: bool               # True si es cobro presencial / pendiente

    def to_dict(self) -> dict:
        return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in asdict(self).items()}


def calc_profit(
    *,
    ingreso_bruto: float,
    costo_sin_iva: float,
    costo_con_iva: float,
    is_cash: bool = False,
    iva_aliquot_override: float | None = None,
    iibb_rate: float = IIBB_RATE,
    talopay_fee_rate: float = TALOPAY_FEE_RATE,
) -> ProfitBreakdown:
    """
    Calcula la ganancia neta de una linea (o suma de lineas de una orden).

    - ingreso_bruto: lo que paga el cliente (precio × qty, antes de descuentos)
    - costo_sin_iva / costo_con_iva: ya multiplicado por qty
    - is_cash: True para efectivo presencial → fee gateway = 0
    """
    # Alicuota IVA: override > derivado del lote > default 21%
    if iva_aliquot_override is not None:
        iva_aliq = iva_aliquot_override
        src = "override"
    else:
        derived = derive_iva_aliquot(costo_sin_iva, costo_con_iva)
        if derived is not None:
            iva_aliq = derived
            src = "derived"
        else:
            iva_aliq = DEFAULT_IVA
            src = "default"

    base_imp = ingreso_bruto / (1.0 + iva_aliq) if iva_aliq >= 0 else ingreso_bruto
    iva_ventas = ingreso_bruto - base_imp
    iva_compras = max(0.0, (costo_con_iva or 0.0) - (costo_sin_iva or 0.0))
    iva_neto = max(0.0, iva_ventas - iva_compras)
    iibb = base_imp * iibb_rate
    gw_rate = 0.0 if is_cash else talopay_fee_rate
    gw_fee = ingreso_bruto * gw_rate

    ganancia = ingreso_bruto - (costo_con_iva or 0.0) - iva_neto - iibb - gw_fee
    margen = (ganancia / ingreso_bruto * 100.0) if ingreso_bruto else 0.0

    return ProfitBreakdown(
        ingreso_bruto=ingreso_bruto,
        costo_con_iva=costo_con_iva or 0.0,
        costo_sin_iva=costo_sin_iva or 0.0,
        iva_aliquot=iva_aliq,
        iva_aliquot_source=src,
        gateway_fee_rate=gw_rate,
        base_imponible_venta=base_imp,
        iva_ventas=iva_ventas,
        iva_compras=iva_compras,
        iva_neto_a_pagar=iva_neto,
        iibb=iibb,
        gateway_fee=gw_fee,
        ganancia_neta=ganancia,
        margen_pct=margen,
        has_cost=bool(costo_con_iva and costo_con_iva > 0),
        is_cash=is_cash,
    )


# ---------------------------------------------------------------------------
# Helpers para integrar con el flujo actual (drilldowns / today_snapshot)
# ---------------------------------------------------------------------------

def cost_index_unistore() -> dict[str, dict]:
    """Indice SKU.lower() -> {costo_sin_iva, costo_con_iva, iva_aliq_derived}.

    Pensado para cachear una sola vez por request y reutilizar.
    """
    from app.db import costs_db
    idx: dict[str, dict] = {}
    for c in (costs_db.current_costs(limit=20000) or []):
        sku = (c.get("sku") or "").strip().lower()
        if not sku:
            continue
        sin_iva = c.get("costo_unit_ars")
        con_iva = c.get("costo_con_iva_unit_ars")
        idx[sku] = {
            "costo_sin_iva": sin_iva,
            "costo_con_iva": con_iva,
            "iva_aliquot": derive_iva_aliquot(sin_iva, con_iva),
        }
    return idx


def profit_for_order_items(
    items: Iterable[tuple[str, int, float]],
    *,
    cost_idx: dict[str, dict],
    is_cash: bool = False,
) -> ProfitBreakdown:
    """Agrega ganancia neta de una orden a partir de sus items.

    items: iterable de (sku, qty, precio_unit). Suma costos del indice
    `cost_idx` (precomputado con cost_index_unistore()).
    """
    ingreso_total = 0.0
    costo_sin_iva_total = 0.0
    costo_con_iva_total = 0.0
    have_costs = True

    # Tomamos la alicuota del primer item con costo cargado (orden multi-IVA
    # es raro en Unistore; si aparece despues lo refinamos por linea).
    iva_aliq: float | None = None

    for sku, qty, price in items:
        ingreso_total += float(price or 0) * int(qty or 0)
        cost = cost_idx.get((sku or "").strip().lower())
        if not cost or not cost.get("costo_con_iva"):
            have_costs = False
            continue
        sin_iva_unit = float(cost.get("costo_sin_iva") or 0)
        con_iva_unit = float(cost.get("costo_con_iva") or 0)
        costo_sin_iva_total += sin_iva_unit * int(qty or 0)
        costo_con_iva_total += con_iva_unit * int(qty or 0)
        if iva_aliq is None:
            iva_aliq = cost.get("iva_aliquot")

    pb = calc_profit(
        ingreso_bruto=ingreso_total,
        costo_sin_iva=costo_sin_iva_total,
        costo_con_iva=costo_con_iva_total,
        is_cash=is_cash,
        iva_aliquot_override=iva_aliq,
    )
    pb.has_cost = have_costs
    return pb

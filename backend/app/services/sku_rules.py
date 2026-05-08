"""
Reglas de negocio para clasificacion de SKUs en UNIDATA.

Convencion del grupo Unistore:
- Cualquier SKU que contenga "PVA" es un SERVICIO (no un producto fisico).
  Son servicios de Unidrop (Primera Venta Asistida, Capacitaciones MELI, etc)
  que se venden a traves de la Tienda Nube de Unistore porque Unidrop no
  tiene tienda propia.
- Estos SKUs deben ser EXCLUIDOS de rankings y vistas de PRODUCTOS fisicos.
- Pero SI deben computarse en facturacion / revenue (son ventas reales).
- Una vista futura "Servicios Unidrop" los va a agrupar aparte.

Si el dia de manana surge otra convencion (ej. SKUs que empiezan con "SVC-"),
agregarla aca, en un solo lugar.
"""
from __future__ import annotations

# Patrones que identifican un SKU como servicio (case-insensitive)
SERVICE_SKU_PATTERNS = ["PVA"]


def is_service_sku(sku: str | None) -> bool:
    """True si el SKU corresponde a un servicio (no producto fisico)."""
    if not sku:
        return False
    sku_upper = sku.upper()
    return any(p in sku_upper for p in SERVICE_SKU_PATTERNS)


def sql_exclude_services_clause(sku_column: str) -> str:
    """Devuelve una clausula SQL `AND <col> NOT ILIKE '%PVA%' AND ...` para
    excluir servicios de un query de productos.

    Uso:
        sql = f'''
            SELECT sku, COUNT(*) FROM ventas
            WHERE 1=1 {sql_exclude_services_clause("sku")}
            GROUP BY sku
        '''
    """
    if not SERVICE_SKU_PATTERNS:
        return ""
    parts = [f"AND ({sku_column} IS NULL OR {sku_column} NOT ILIKE '%{p}%')" for p in SERVICE_SKU_PATTERNS]
    return " " + " ".join(parts)


def sql_only_services_clause(sku_column: str) -> str:
    """Inversa: solo SERVICIOS (para una eventual vista 'Servicios Unidrop')."""
    if not SERVICE_SKU_PATTERNS:
        return ""
    parts = [f"{sku_column} ILIKE '%{p}%'" for p in SERVICE_SKU_PATTERNS]
    return " AND (" + " OR ".join(parts) + ")"


def filter_skus_in_python(rows: list[dict], sku_key: str = "sku", exclude_services: bool = True) -> list[dict]:
    """Helper para filtrar resultados en Python (cuando el SQL ya esta hecho
    y agregar la clausula es engorroso)."""
    if exclude_services:
        return [r for r in rows if not is_service_sku(r.get(sku_key))]
    else:
        return [r for r in rows if is_service_sku(r.get(sku_key))]

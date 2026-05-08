"""
Mini diccionario heuristico para describir columnas cuando no hay
col_description en Postgres. Combina patrones por nombre + tipo.
Devuelve None si no aplica ninguna heuristica.
"""
from __future__ import annotations

import re

# Patrones (regex case-insensitive) -> descripcion en es-AR
PATTERNS: list[tuple[str, str]] = [
    # IDs
    (r"^id$", "Identificador unico del registro (clave primaria)"),
    (r"^uuid$", "Identificador unico universal"),
    (r"^(.+)Id$|^(.+)_id$", "Referencia a otro registro (clave foranea)"),

    # Timestamps
    (r"^createdAt$|^created_at$|^creado_en$|^fecha_creacion$|^FechaCreacion$",
     "Fecha y hora de creacion del registro"),
    (r"^updatedAt$|^updated_at$|^actualizado_en$|^fecha_actualizacion|^lastUpdated$|^last_updated$",
     "Fecha y hora de la ultima modificacion"),
    (r"^deletedAt$|^deleted_at$|^cancelled_at$|^cancelledAt$|^closed_at$|^closedAt$",
     "Fecha en que se marco como eliminado/cancelado"),
    (r"^paid_at$|^paidAt$|^date_closed$",
     "Fecha en que la orden fue pagada"),
    (r"^date_created$|^dateCreated$|^date_emit|^fecha_emision|^FechaEmision",
     "Fecha de emision/creacion en el sistema externo"),
    (r"^fecha_vencimiento|^FechaVencimiento|^expir|^end_date",
     "Fecha de vencimiento"),
    (r"^start_date|^startDate|^FechaInicio",
     "Fecha de inicio"),

    # Monetarios
    (r"^total$|^total_amount$|^totalAmount$", "Monto total de la operacion"),
    (r"^subtotal$|^Subtotal$", "Subtotal antes de impuestos / descuentos"),
    (r"^amount$|^monto$|^Importe$|^importe$", "Monto monetario"),
    (r"^paid_amount$|^paidAmount$", "Monto efectivamente pagado"),
    (r"^pending_amount$|^pendingAmount$", "Monto pendiente de cobro"),
    (r"^expected_amount$|^expectedAmount$", "Monto esperado (antes de cobro)"),
    (r"^discount$|^Bonificacion$", "Descuento o bonificacion aplicada"),
    (r"^cost$|^Costo$|^merchandise_cost", "Costo de adquisicion del producto"),
    (r"^price$|^PrecioUnitario$|^unit_price|^unitPrice", "Precio unitario de venta"),
    (r"^commission$|^Comision$", "Comision cobrada por la plataforma"),
    (r"^iva$|^Iva$|^IVA$|^tax_amount$", "Impuesto al valor agregado / impuestos"),
    (r"^shipping_cost|^shippingCost|^costo_envio", "Costo del envio"),

    # Estados
    (r"^status$|^estado$|^Estado$|^estado_general$",
     "Estado actual del registro"),
    (r"^paymentStatus$|^payment_status$",
     "Estado del pago (paid / pending / refunded / etc)"),
    (r"^shippingStatus$|^shipping_status$",
     "Estado del envio (unpacked / shipped / delivered / etc)"),
    (r"^subscription_status$",
     "Estado de la suscripcion (activa / vencida / cancelada)"),
    (r"^cancel_reason$|^cancelReason$",
     "Motivo de cancelacion: customer / inventory / fraud / etc"),

    # Personas / contacto
    (r"^email$|^contactEmail$", "Direccion de correo electronico"),
    (r"^phone$|^contactPhone$|^telefono$|^phone_number", "Telefono de contacto"),
    (r"^name$|^nombre$|^Nombre$|^contactName$", "Nombre"),
    (r"^last_name$|^lastName$|^apellido$", "Apellido"),
    (r"^fantasy_name$", "Nombre de fantasia / razon social comercial"),
    (r"^dni$", "Documento Nacional de Identidad"),
    (r"^cuit$", "CUIT (Argentina)"),
    (r"^cuil$", "CUIL (Argentina)"),

    # Direcciones
    (r"^address$|^direccion$|^street", "Calle / direccion"),
    (r"^city$|^ciudad$|^localidad$", "Ciudad o localidad"),
    (r"^province$|^provincia$", "Provincia"),
    (r"^country$|^pais$", "Pais"),
    (r"^zipcode$|^postal_code$|^cp$|^codigo_postal$", "Codigo postal"),

    # Productos / catalogo
    (r"^sku$|^Codigo$|^codigo$", "Codigo SKU del producto"),
    (r"^ean$|^barcode$", "Codigo de barras EAN"),
    (r"^quantity$|^cantidad$|^Cantidad$|^unidades$", "Cantidad / unidades"),
    (r"^stock$|^stock_actual", "Stock disponible"),
    (r"^variant", "Variante de producto"),
    (r"^category$|^categoria$", "Categoria del producto"),

    # Booleanos
    (r"^is_active$|^isActive$|^activo$", "Indicador de si el registro esta activo"),
    (r"^cancel_by_unidrop$", "Si el cancel fue iniciado por el staff de Unidrop"),
    (r"^manual_packed_marked$|^manual_payment_marked",
     "Marcado manualmente por staff (intervencion humana)"),

    # Tracking
    (r"^trackingCode$|^tracking_code$|^numero_envio", "Codigo de tracking del envio"),
    (r"^trackingUrl$|^tracking_url", "URL para consultar el estado del envio"),

    # JSON / payloads
    (r"^payload$|^raw$|^raw_data$|^extra$|^metadata$",
     "Payload completo de la API externa (JSON crudo)"),
    (r"^attributes$",
     "Atributos adicionales (JSON)"),
]

COMPILED: list[tuple[re.Pattern, str]] = [(re.compile(p, re.IGNORECASE), d) for p, d in PATTERNS]


def describe_column(name: str, data_type: str | None = None, table_name: str | None = None) -> str | None:
    """Devuelve una descripcion heuristica si hay match, None en caso contrario."""
    if not name:
        return None
    for pat, desc in COMPILED:
        if pat.match(name):
            # Para FK genericas, intentar enriquecer con el nombre
            if "Referencia a otro registro" in desc:
                base = re.sub(r"(Id|_id)$", "", name, flags=re.IGNORECASE)
                if base:
                    return f"Referencia (FK) a la entidad '{base}'"
            return desc
    # Hints por tipo
    if data_type:
        dt = data_type.lower()
        if "json" in dt:
            return "Estructura JSON con datos serializados"
        if "array" in dt:
            return "Lista / arreglo de valores"
        if "uuid" in dt:
            return "Identificador unico (UUID)"
        if "boolean" in dt:
            return "Valor verdadero / falso"
    return None

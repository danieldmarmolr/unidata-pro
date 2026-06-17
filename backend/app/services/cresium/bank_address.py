"""Resolucion y verificacion anti-fraude de cuentas bancarias contra Cresium.

Port de cresium-bank-address.service.ts.

GET /v3/bank-address/{value} devuelve el titular real de un CBU/CVU/alias. El
campo `uuid` es el CUIT del titular (11 digitos). El anti-fraude solo habilita
un reembolso si ese CUIT matchea el taxId que cargo el dropshipper.

Shape real (validado en smoke test mayo 2026):
  { "data": { "id": 285120, "type": "CBU"|"CVU"|"ALIAS", "value": "...",
              "bankName": "...", "ownerName": "...", "uuid": "20963010517",
              "currencyId": 1, "currency": {...}, "img": "..." } }
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from urllib.parse import quote

from app.services.cresium import http_client

log = logging.getLogger("unidata.cresium.bank_address")

_TAXID_STRIP = re.compile(r"[\s\-.]")


@dataclass
class BankAddress:
    id: int
    type: str | None = None
    value: str | None = None
    bank_name: str | None = None
    owner_name: str | None = None
    uuid: str | None = None  # CUIT del titular (11 digitos)


@dataclass
class LookupOk:
    data: BankAddress
    ok: bool = True


@dataclass
class LookupFail:
    status: int
    reason: str
    ok: bool = False


def lookup(value: str) -> LookupOk | LookupFail:
    """Resuelve un CBU/CVU/alias contra Cresium. Desempaqueta el wrapper {data:..}."""
    encoded = quote(value, safe="")
    path = f"/v3/bank-address/{encoded}"
    resp = http_client.request(method="GET", path=path)

    log.info("[BankAddress] GET %s -> status=%d", path, resp.status)

    if resp.status == 200 and isinstance(resp.data, dict) and resp.data.get("data"):
        d = resp.data["data"]
        return LookupOk(
            data=BankAddress(
                id=d.get("id"),
                type=d.get("type"),
                value=d.get("value"),
                bank_name=d.get("bankName"),
                owner_name=d.get("ownerName"),
                uuid=d.get("uuid"),
            )
        )

    if resp.status == 404:
        return LookupFail(status=404, reason="Cuenta bancaria no encontrada en Cresium")

    log.warning("Cresium bank-address lookup respondio %d para value=%s", resp.status, value)
    return LookupFail(status=resp.status, reason=f"Cresium respondio {resp.status}")


def normalize_tax_id(value: str) -> str:
    """Remueve guiones, espacios y puntos de un CUIT/DNI."""
    return _TAXID_STRIP.sub("", value or "")


def tax_id_matches(user_tax_id: str, holder_tax_id: str) -> bool:
    """Compara el taxId del usuario contra el del titular devuelto por Cresium.

    Acepta: match exacto; DNI del usuario (7-8 digitos) == digitos centrales del
    CUIT del titular (CUIT = XX-DNI-X); y el caso inverso. Permite al dropshipper
    cargar su DNI sin conocer el CUIT exacto.
    """
    user = normalize_tax_id(user_tax_id).lstrip("0")
    holder = normalize_tax_id(holder_tax_id).lstrip("0")

    if not user or not holder:
        return False
    if user == holder:
        return True

    if len(holder) == 11 and 7 <= len(user) <= 8:
        dni_inside_cuit = holder[2:10].lstrip("0")
        user_padded = user.rjust(8, "0").lstrip("0")
        return dni_inside_cuit == user_padded

    if len(user) == 11 and 7 <= len(holder) <= 8:
        dni_inside_cuit = user[2:10].lstrip("0")
        holder_padded = holder.rjust(8, "0").lstrip("0")
        return dni_inside_cuit == holder_padded

    # Ambos CUIT de 11 digitos: si comparten el nucleo DNI (digitos 2-10) es la
    # MISMA persona; un digito verificador distinto es un typo en la carga (el
    # verificador es derivado del prefijo+DNI). El DNI identifica univocamente.
    if len(user) == 11 and len(holder) == 11:
        if user[2:10] == holder[2:10]:
            return True

    return False

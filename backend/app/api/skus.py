"""
Endpoint de enriquecimiento de SKUs con imagen + EAN.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.security import current_user
from app.services import sku_enrichment

router = APIRouter(prefix="/api/skus", tags=["skus"])


class EnrichBody(BaseModel):
    skus: list[str]


@router.post("/{unit}/enrich")
def enrich_skus(
    unit: str,
    body: EnrichBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict[str, dict]:
    """Devuelve {sku: {image_url, ean, name}} para los SKUs solicitados.

    Cache de 1 hora en memoria por unit+sku.
    """
    if unit != "unistore":
        # Por ahora solo unistore tiene digip + tienda_nube
        raise HTTPException(404, f"Enriquecimiento no disponible para unidad: {unit}")

    if len(body.skus) > 500:
        raise HTTPException(400, "Maximo 500 SKUs por request")

    return sku_enrichment.enrich_skus_unistore(body.skus)

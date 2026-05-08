"""Endpoint de reportes PDF."""
from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.auth.security import current_user
from app.services import reports as reports_svc

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/monthly")
def monthly(
    _: Annotated[dict, Depends(current_user)],
    month: Annotated[str | None, Query(description="YYYY-MM. Default: mes actual")] = None,
):
    if month:
        try:
            dt.datetime.strptime(month, "%Y-%m")
        except ValueError:
            raise HTTPException(400, "month invalido (formato YYYY-MM)")
    pdf_bytes = reports_svc.build_monthly_report(month)
    label = month or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
    fn = f"unidata_reporte_ejecutivo_{label}.pdf"

    def _iter():
        yield pdf_bytes

    return StreamingResponse(
        _iter(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fn}"'},
    )

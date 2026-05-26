"""
Endpoints PUBLICOS (sin JWT) para el formulario de solicitud de devolucion de
suscripcion MELI. Rate-limited por IP para evitar abuso.

POST /api/public/refund-requests/validate  -> valida DNI+email contra public."User"
POST /api/public/refund-requests           -> crea la solicitud
"""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db import refund_requests_db
from app.db import refund_telemetry_db
from app.services.refund_requests.dropshipper_lookup import find_dropshipper

log = logging.getLogger("unidata.api.public_refund_requests")

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/api/public/refund-requests", tags=["public-refund-requests"])


_DNI_RE = re.compile(r"^\d{7,8}$")
_CBU_RE = re.compile(r"^\d{22}$")
_CUIT_RE = re.compile(r"^\d{11}$")

ABANDONMENT_REASONS = (
    "costo_muy_alto",
    "sin_ventas_suficientes",
    "mala_experiencia_meli",
    "solo_tn",
    "cierro_emprendimiento",
    "problemas_tecnicos_unidrop",
    "otra",
)


class ValidateBody(BaseModel):
    dni: str = Field(..., min_length=7, max_length=8)
    email: str = Field(..., min_length=5, max_length=200)

    @field_validator("dni")
    @classmethod
    def _dni(cls, v: str) -> str:
        v = (v or "").strip()
        if not _DNI_RE.match(v):
            raise ValueError("DNI invalido (debe tener 7 u 8 digitos)")
        return v


class SubmitBody(BaseModel):
    dni: str = Field(..., min_length=7, max_length=8)
    email: str = Field(..., min_length=5, max_length=200)
    bank_holder_name: str = Field(..., min_length=2, max_length=200)
    bank_holder_cuit: str = Field(..., min_length=11, max_length=11)
    bank_name: str = Field(..., min_length=2, max_length=100)
    bank_cbu: str = Field(..., min_length=22, max_length=22)
    bank_alias: str | None = Field(default=None, max_length=50)
    refund_amount_arg: float | None = Field(default=None, ge=0)
    abandonment_reason: str = Field(..., min_length=1, max_length=80)
    reason: str | None = Field(default=None, max_length=2000)

    @field_validator("abandonment_reason")
    @classmethod
    def _abandon(cls, v: str) -> str:
        v = (v or "").strip()
        if v not in ABANDONMENT_REASONS:
            raise ValueError(
                f"abandonment_reason invalido. Validos: {', '.join(ABANDONMENT_REASONS)}"
            )
        return v

    @field_validator("dni")
    @classmethod
    def _dni(cls, v: str) -> str:
        v = (v or "").strip()
        if not _DNI_RE.match(v):
            raise ValueError("DNI invalido (debe tener 7 u 8 digitos)")
        return v

    @field_validator("bank_cbu")
    @classmethod
    def _cbu(cls, v: str) -> str:
        v = re.sub(r"\D", "", v or "")
        if not _CBU_RE.match(v):
            raise ValueError("CBU/CVU invalido (debe tener 22 digitos)")
        return v

    @field_validator("bank_holder_cuit")
    @classmethod
    def _cuit(cls, v: str) -> str:
        v = re.sub(r"\D", "", v or "")
        if not _CUIT_RE.match(v):
            raise ValueError("CUIT invalido (debe tener 11 digitos)")
        return v

    @field_validator("bank_alias")
    @classmethod
    def _alias(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) < 6 or len(v) > 20:
            raise ValueError("Alias invalido (debe tener entre 6 y 20 caracteres)")
        return v


@router.post("/validate")
@limiter.limit("10/minute")
def validate(request: Request, body: ValidateBody) -> dict:
    """Valida que DNI+email correspondan a un dropshipper con suscripcion MELI."""
    ds = find_dropshipper(dni=body.dni, email=body.email)
    if not ds:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No encontramos una cuenta con ese DNI y email. Verifica los datos.",
        )
    if not ds["has_active_subscription"]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Tu cuenta no tiene una suscripcion MELI activa para cancelar.",
        )
    return {
        "ok": True,
        "dropshipper": {
            "name": ds["name"],
            "fantasy_name": ds["fantasy_name"],
            "cuit": ds.get("cuit"),
            "subscription_id": ds["subscription_id"],
            "subscription_plan_name": ds["subscription_plan_name"],
            "subscription_plan_price_arg": ds.get("subscription_plan_price_arg"),
            "subscription_ends_at": ds.get("subscription_ends_at"),
            "subscription_status": ds.get("subscription_status"),
        },
        "bank_hints": ds.get("bank_hints"),
        "paid_subscription": ds.get("paid_subscription"),
        "last_payment": ds.get("last_payment"),
    }


@router.post("", status_code=201)
@limiter.limit("5/minute")
def submit(request: Request, body: SubmitBody) -> dict:
    """Crea una nueva solicitud de devolucion. Re-valida el dropshipper en
    server-side para evitar bypass del paso 1."""
    ds = find_dropshipper(dni=body.dni, email=body.email)
    if not ds:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No encontramos una cuenta con ese DNI y email.",
        )
    if not ds["has_active_subscription"]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Tu cuenta no tiene una suscripcion MELI activa.",
        )

    submitter_ip = request.client.host if request.client else None

    paid_sub = ds.get("paid_subscription") or {}

    try:
        created = refund_requests_db.create_request(
            dropshipper_user_id=ds["id"],
            dropshipper_dni=ds["dni"],
            dropshipper_email=ds["email"],
            dropshipper_name=ds["name"],
            dropshipper_fantasy_name=ds["fantasy_name"],
            subscription_id=ds["subscription_id"],
            subscription_plan_name=ds["subscription_plan_name"],
            bank_holder_name=body.bank_holder_name.strip(),
            bank_holder_cuit=body.bank_holder_cuit,
            bank_name=body.bank_name.strip(),
            bank_cbu=body.bank_cbu,
            bank_alias=body.bank_alias,
            refund_amount_arg=body.refund_amount_arg,
            paid_subscription_total_arg=paid_sub.get("total_arg"),
            paid_subscription_count=paid_sub.get("count"),
            abandonment_reason=body.abandonment_reason,
            reason=(body.reason or "").strip() or None,
            submitter_ip=submitter_ip,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))

    log.info(
        "refund_request creado id=%s dropshipper_id=%s ip=%s",
        created.get("id"), ds["id"], submitter_ip,
    )

    return {
        "ok": True,
        "id": created["id"],
        "status": created["status"],
        "created_at": created["created_at"],
        "display_code": _format_display_code(
            dni=created["dropshipper_dni"],
            plan=created.get("subscription_plan_name"),
            created_at_iso=created["created_at"],
        ),
    }


_VALID_TELEMETRY_KINDS = (
    "network_error",     # TypeError fetch (DNS, CORS, mixed content, adblock)
    "http_error",        # respuesta HTTP no-2xx (con http_status)
    "parse_error",       # JSON malformado del backend
    "validation_error",  # cliente capturo error de validacion del backend
    "client_exception",  # excepcion JS no esperada en el handler
)


class TelemetryBody(BaseModel):
    correlation_id: str = Field(..., min_length=1, max_length=64)
    kind: str = Field(..., min_length=1, max_length=40)
    message: str | None = Field(default=None, max_length=2000)
    endpoint: str | None = Field(default=None, max_length=300)
    http_status: int | None = Field(default=None, ge=0, le=999)
    api_base: str | None = Field(default=None, max_length=300)
    page_origin: str | None = Field(default=None, max_length=300)
    referrer: str | None = Field(default=None, max_length=500)
    dni: str | None = Field(default=None, max_length=20)
    email: str | None = Field(default=None, max_length=200)
    extra: dict | None = None

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        v = (v or "").strip()
        if v not in _VALID_TELEMETRY_KINDS:
            raise ValueError(f"kind invalido. Validos: {', '.join(_VALID_TELEMETRY_KINDS)}")
        return v


@router.post("/telemetry", status_code=202)
@limiter.limit("30/minute")
def telemetry(request: Request, body: TelemetryBody) -> dict:
    """Captura errores client-side del form publico para diagnosticar Failed to
    fetch / CORS / 5xx en usuarios reales. Fire-and-forget desde el frontend.
    Devuelve 202 incluso si el insert falla, para no romper UX del usuario."""
    user_agent = (request.headers.get("user-agent") or "")[:500]
    submitter_ip = request.client.host if request.client else None
    try:
        rec_id = refund_telemetry_db.record(
            correlation_id=body.correlation_id.strip()[:64],
            kind=body.kind,
            message=(body.message or "").strip()[:2000] or None,
            endpoint=body.endpoint,
            http_status=body.http_status,
            api_base=body.api_base,
            user_agent=user_agent or None,
            page_origin=body.page_origin,
            referrer=body.referrer,
            dni=(body.dni or "").strip() or None,
            email=(body.email or "").strip().lower() or None,
            submitter_ip=submitter_ip,
            extra=body.extra,
        )
        log.warning(
            "refund_form_telemetry kind=%s endpoint=%s status=%s corr=%s dni=%s ua=%s",
            body.kind, body.endpoint, body.http_status, body.correlation_id,
            body.dni, user_agent[:80],
        )
        return {"ok": True, "id": rec_id}
    except Exception as e:
        log.exception("telemetry insert failed: %s", e)
        return {"ok": False}


def _format_display_code(*, dni: str, plan: str | None, created_at_iso: str) -> str:
    """UDEV-{dni}-{plan_normalizado}-{ddmmaa}. Ej: UDEV-37145200-COMBOXXL-190526."""
    import re as _re
    from datetime import datetime as _dt
    plan_clean = _re.sub(r"[^A-Z0-9]", "", (plan or "GEN").upper()) or "GEN"
    try:
        d = _dt.fromisoformat(created_at_iso.replace("Z", "+00:00"))
        dd = f"{d.day:02d}"; mm = f"{d.month:02d}"; aa = f"{d.year % 100:02d}"
    except Exception:
        dd = mm = aa = "00"
    return f"UDEV-{dni}-{plan_clean}-{dd}{mm}{aa}"

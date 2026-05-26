"""
Analisis LLM (Gemini structured output) sobre el churn de suscripciones.

Toma el overview ya calculado + texto libre de los reasons + datos por
dropshipper (revenue churned, ultima venta, plan) y devuelve un payload JSON
con:
- summary ejecutivo
- patterns: hallazgos macro (severity high/medium/low + evidence)
- taxonomy_breakdown: clasificacion estable del campo `reason` libre
- action_recommendations: acciones priorizadas por dropshipper o segmento

Usa el patron Gemini ya existente en jira_flow/llm_client.py (google-genai SDK,
gemini-2.5-flash con fallbacks). Cache local 1h evita re-analizar misma key.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from cachetools import TTLCache

from app.db import churn_insights_db
from app.services import subscription_churn

log = logging.getLogger("unidata.subscription_churn_llm")

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
FALLBACK_MODELS = ["gemini-2.5-flash-lite", "gemini-flash-latest"]
MAX_RETRIES = 3

_cache: TTLCache = TTLCache(maxsize=32, ttl=3600)
_client = None


def _lazy_genai():
    from google import genai  # type: ignore
    from google.genai import types  # type: ignore
    from google.genai import errors as genai_errors  # type: ignore
    return genai, types, genai_errors


def _client_instance():
    global _client
    if _client is None:
        genai, _, _ = _lazy_genai()
        _client = genai.Client(api_key=os.getenv("GEMINI_API_KEY", ""))
    return _client


SYSTEM_PROMPT = """Sos analista senior de retencion y churn en una plataforma SaaS de dropshipping (Unidrop / Unistore). Te paso datos AGREGADOS de las cancelaciones de suscripciones MELI de un periodo. Tenes que devolver un analisis ESTRUCTURADO en JSON valido segun el schema dado.

Reglas:
- Espanol rioplatense, formal pero directo. No uses emojis.
- Cuando cites montos, usa el formato $ X.XXX (ej "$ 120.000").
- Para "evidence" usa SIEMPRE numeros del input. No inventes datos.
- "severity": high si afecta > 30% del revenue churned o > 5 dropshippers, medium si 10-30% o 2-5, low si menos.
- "urgency": urgent (accion en < 7 dias), this_week, monitor.
- En "action_recommendations" priorizá dropshippers individuales con monto historico alto ($ 100K+) o pattern especifico (ej: "se queja de mismo problema tecnico que otros 3").
- "taxonomy_breakdown": clasificá las razones libres en categorias ESTABLES y reutilizables tipo "Friccion tecnica / Carga de productos MELI", "Costo / Plan inadecuado al volumen", "Cambio estrategico / Solo TN", "Cierre de emprendimiento", "Insatisfaccion con experiencia MELI", "Otros". Una categoria puede tener subcategoria.
- Si no hay datos suficientes (ej: total_requests < 3), devolvelo en summary y dejá patterns y recommendations vacios.

Pensá antes de responder pero NO incluyas el razonamiento en el JSON. Devolvé SOLO el JSON valido."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {
            "type": "string",
            "description": "Resumen ejecutivo del estado del churn en 2-3 oraciones",
        },
        "patterns": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title":    {"type": "string"},
                    "evidence": {"type": "string", "description": "Numeros concretos del input que respaldan el pattern"},
                    "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                    "metric":   {"type": "string", "description": "Que KPI/dimension del input se referencia"},
                },
                "required": ["title", "evidence", "severity"],
            },
        },
        "taxonomy_breakdown": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "category":    {"type": "string"},
                    "subcategory": {"type": "string"},
                    "count":       {"type": "integer"},
                    "examples":    {"type": "array", "items": {"type": "string"}, "description": "1-3 reasons literales del input"},
                },
                "required": ["category", "count"],
            },
        },
        "action_recommendations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "scope":               {"type": "string", "enum": ["dropshipper", "segment", "product", "process"]},
                    "target_label":        {"type": "string", "description": "Nombre del dropshipper / segmento / plan"},
                    "target_dropshipper_id": {"type": "integer", "description": "Solo si scope=dropshipper"},
                    "target_dni":          {"type": "string", "description": "Solo si scope=dropshipper"},
                    "action":              {"type": "string", "description": "Que hacer concretamente (1-2 oraciones)"},
                    "urgency":             {"type": "string", "enum": ["urgent", "this_week", "monitor"]},
                    "reasoning":           {"type": "string", "description": "Por que esta accion (1-2 oraciones)"},
                    "expected_impact_arg": {"type": "number", "description": "Estimacion de $ que se rescata si la accion funciona"},
                },
                "required": ["scope", "target_label", "action", "urgency", "reasoning"],
            },
        },
    },
    "required": ["summary", "patterns", "action_recommendations"],
}


def _build_user_message(overview: dict, recent_full: list[dict]) -> str:
    """Comprime el input a un prompt textual con los signals que importan."""
    kpis = overview.get("kpis", {})
    by_reason = overview.get("by_reason", [])
    by_plan = overview.get("by_plan", [])
    telemetry = overview.get("telemetry_by_kind", [])
    failed_users = overview.get("failed_users", [])
    recent = overview.get("recent_requests", [])
    evolution = overview.get("evolution", {})

    parts = []
    parts.append(f"PERIODO: {overview.get('period')} · granularidad serie: {overview.get('granularity')}")
    parts.append("")
    parts.append("KPIs:")
    parts.append(f"- Total solicitudes: {kpis.get('total_requests')}")
    parts.append(f"- Por status: pending={kpis.get('pending')} transferred={kpis.get('transferred')} cancelled={kpis.get('integration_cancelled')} rejected={kpis.get('rejected')}")
    parts.append(f"- Revenue churned (suma paid_subscription_total declarado): $ {kpis.get('revenue_churned_arg', 0):,.0f}")
    if kpis.get("revenue_churned_real_arg") is not None:
        parts.append(f"- Revenue churned REAL (cruzado contra PaymentIntentSubscription): $ {kpis.get('revenue_churned_real_arg', 0):,.0f}")
    parts.append(f"- Pendiente reembolso: $ {kpis.get('pending_refund_arg', 0):,.0f}")
    parts.append(f"- Tasa exito del form: {kpis.get('form_completion_rate_pct')}%")
    parts.append(f"- Errores form (telemetria): {kpis.get('total_form_errors')} eventos en {kpis.get('distinct_failed_users')} usuarios distintos")
    parts.append("")
    parts.append("EVOLUCION:")
    ev_stats = evolution.get("stats", {})
    parts.append(f"- Pico: {ev_stats.get('peak')} cancelaciones en {ev_stats.get('peak_period_start')}")
    parts.append(f"- Media: {ev_stats.get('average')}/{overview.get('granularity')}")
    parts.append(f"- Tendencia: {ev_stats.get('trend')}")
    parts.append("")
    parts.append("DISTRIBUCION POR RAZON DE ABANDONO:")
    for r in by_reason:
        parts.append(f"- {r['reason']}: {r['count']}")
    parts.append("")
    parts.append("DISTRIBUCION POR PLAN:")
    for p in by_plan:
        parts.append(f"- {p['plan']}: {p['count']} cancelaciones · $ {p.get('paid_total_arg', 0):,.0f} historico")
    parts.append("")
    if telemetry:
        parts.append("ERRORES DEL FORMULARIO:")
        for t in telemetry:
            parts.append(f"- {t['kind']}: {t['count']} eventos en {t['distinct_incidents']} usuarios")
        if failed_users:
            parts.append("")
            parts.append("USUARIOS QUE NO PUDIERON CANCELAR (telemetria):")
            for u in failed_users[:8]:
                parts.append(f"- DNI {u['dni']} · {u['kind']} · {u['attempts']} intentos · ultimo: {u['last_seen']}")
                if u.get("messages"):
                    parts.append(f"  msg: {u['messages'][:120]}")
        parts.append("")

    parts.append("CANCELACIONES INDIVIDUALES (las mas recientes, top 25):")
    for r in (recent_full or recent)[:25]:
        line = (
            f"- id={r.get('id')} | drop_id={r.get('dropshipper_user_id')} | "
            f"{r.get('name')} (DNI {r.get('dni')}) | plan={r.get('plan') or '-'} | "
            f"motivo={r.get('abandonment_reason')} | "
            f"status={r.get('status')} | "
            f"hist=$ {r.get('paid_subscription_total_arg') or 0:,.0f} "
            f"({r.get('paid_subscription_count') or 0} cobros) | "
            f"refund_solicitado=$ {r.get('refund_amount_arg') or 0:,.0f}"
        )
        parts.append(line)
        if r.get("reason"):
            parts.append(f"  comentario libre: {r['reason'][:200]}")

    parts.append("")
    parts.append("Genera el analisis siguiendo el schema. NO inventes datos que no estan en el input.")
    return "\n".join(parts)


def _generate_with_retry(contents: str, config) -> Any:
    _, _, genai_errors = _lazy_genai()
    models_to_try = [MODEL] + [m for m in FALLBACK_MODELS if m != MODEL]
    last_error: Exception | None = None
    for model in models_to_try:
        for attempt in range(MAX_RETRIES):
            try:
                return _client_instance().models.generate_content(
                    model=model, contents=contents, config=config,
                )
            except genai_errors.APIError as e:
                last_error = e
                code = getattr(e, "code", None)
                if code in (429, 500, 502, 503, 504):
                    log.warning("gemini %s attempt %d failed (%s), retrying", model, attempt + 1, code)
                    time.sleep(2 ** attempt)
                    continue
                raise
            except Exception as e:
                last_error = e
                raise
    raise RuntimeError(f"Gemini agoto retries en todos los modelos. Ultimo error: {last_error}")


def _parse_json(raw: str) -> dict:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Gemini no devolvio JSON valido. Raw:\n{raw[:600]}\n\nError: {e}")


def analyze(
    *,
    period: str,
    granularity: str,
    force: bool = False,
    generated_by_id: int | None = None,
    generated_by_email: str | None = None,
) -> dict:
    """Genera el analisis LLM. Si `force=False`, devuelve cache de 1h. Persiste
    el resultado en subscription_churn_insights."""
    cache_key = f"{period}:{granularity}"
    if not force and cache_key in _cache:
        return _cache[cache_key]

    overview = subscription_churn.get_churn_overview(period=period, granularity=granularity)

    if (overview.get("kpis") or {}).get("total_requests", 0) == 0:
        empty = {
            "summary": "No hay cancelaciones registradas en el periodo seleccionado.",
            "patterns": [],
            "taxonomy_breakdown": [],
            "action_recommendations": [],
            "_meta": {"model": None, "duration_ms": 0, "saved_id": None},
        }
        _cache[cache_key] = empty
        return empty

    user_msg = _build_user_message(overview, overview.get("recent_requests", []))

    _, types, _ = _lazy_genai()
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=SCHEMA,
        temperature=0.3,
        max_output_tokens=8192,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )

    t0 = time.time()
    response = _generate_with_retry(user_msg, config)
    duration_ms = int((time.time() - t0) * 1000)

    payload = _parse_json(response.text or "")

    payload.setdefault("summary", "")
    payload.setdefault("patterns", [])
    payload.setdefault("taxonomy_breakdown", [])
    payload.setdefault("action_recommendations", [])

    saved_id = None
    try:
        signals = {
            "total_requests": overview["kpis"].get("total_requests"),
            "revenue_churned_arg": overview["kpis"].get("revenue_churned_arg"),
            "revenue_churned_real_arg": overview["kpis"].get("revenue_churned_real_arg"),
            "form_completion_rate_pct": overview["kpis"].get("form_completion_rate_pct"),
            "by_reason_top": overview.get("by_reason", [])[:5],
        }
        saved = churn_insights_db.save_insight(
            period=period,
            granularity=granularity,
            payload=payload,
            model=MODEL,
            input_signals=signals,
            generated_by_id=generated_by_id,
            generated_by_email=generated_by_email,
            duration_ms=duration_ms,
        )
        saved_id = saved["id"]
    except Exception as e:
        log.exception("no se pudo persistir churn insight: %s", e)

    payload["_meta"] = {
        "model": MODEL,
        "duration_ms": duration_ms,
        "saved_id": saved_id,
        "input_signals_count": overview["kpis"].get("total_requests", 0),
    }
    _cache[cache_key] = payload
    return payload

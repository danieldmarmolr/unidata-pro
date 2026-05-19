"""Cliente Gemini para generar propuestas de Historia de Usuario."""
import os
import json
import time
from .prompts import SYSTEM_PROMPT, build_user_message

_client = None
MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
FALLBACK_MODELS = ["gemini-2.5-flash-lite", "gemini-flash-latest"]
MAX_RETRIES = 3


def _lazy_genai():
    """Lazy import google-genai to avoid hard dep at module load."""
    from google import genai  # type: ignore
    from google.genai import types  # type: ignore
    from google.genai import errors as genai_errors  # type: ignore
    return genai, types, genai_errors


def client():
    global _client
    if _client is None:
        genai, _, _ = _lazy_genai()
        _client = genai.Client(api_key=os.getenv("GEMINI_API_KEY", ""))
    return _client


def _build_contents_with_images(
    user_text: str,
    images: list[tuple[bytes, str]] | None = None,
    pdfs: list[tuple[bytes, str, str]] | None = None,
):
    if not images and not pdfs:
        return user_text
    _, types, _ = _lazy_genai()
    parts = []
    for img_bytes, mime in images or []:
        parts.append(types.Part.from_bytes(data=img_bytes, mime_type=mime))
    for pdf_bytes, mime, _name in pdfs or []:
        parts.append(types.Part.from_bytes(data=pdf_bytes, mime_type=mime))
    parts.append(types.Part.from_text(text=user_text))
    return parts


def _generate_with_retry(contents, config):
    _, _, genai_errors = _lazy_genai()
    models_to_try = [MODEL] + [m for m in FALLBACK_MODELS if m != MODEL]
    last_error = None
    for model in models_to_try:
        for attempt in range(MAX_RETRIES):
            try:
                return client().models.generate_content(model=model, contents=contents, config=config)
            except genai_errors.APIError as e:
                last_error = e
                code = getattr(e, "code", None)
                if code in (429, 500, 502, 503, 504):
                    time.sleep(2 ** attempt)
                    continue
                raise
            except Exception as e:
                last_error = e
                raise
    raise RuntimeError(f"Gemini agotó retries en todos los modelos. Último error: {last_error}")


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Gemini no devolvió JSON válido. Raw:\n{raw[:500]}\n\nError: {e}")


def _config(temperature: float = 0.3, max_tokens: int = 16384):
    _, types, _ = _lazy_genai()
    return types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
        temperature=temperature,
        max_output_tokens=max_tokens,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )


def propose_batch(
    context: str,
    situ_open: list[dict] | None = None,
    extra_instructions: str = "",
    images: list[tuple[bytes, str]] | None = None,
    pdfs: list[tuple[bytes, str, str]] | None = None,
) -> dict:
    user_msg = build_user_message(context, situ_open or [], extra_instructions)
    if images:
        user_msg += "\n\nIMÁGENES ADJUNTAS: capturas/diagramas como contexto visual."
    if pdfs:
        pdf_names = ", ".join(p[2] for p in pdfs)
        user_msg += f"\n\nPDFs ADJUNTOS ({pdf_names}): leelos completos y enriquecé criterios."
    contents = _build_contents_with_images(user_msg, images, pdfs)
    response = _generate_with_retry(contents, _config())
    return _parse_json(response.text or "")


def propose_itdev_from_situ(
    situ_key: str,
    situ_summary: str,
    situ_description: str = "",
    extra_instructions: str = "",
    comments: list[dict] | None = None,
    attachments: list[dict] | None = None,
    confluence_pages: list[dict] | None = None,
    images: list[tuple[bytes, str]] | None = None,
    pdfs: list[tuple[bytes, str, str]] | None = None,
) -> dict:
    ctx = f"""SITU EXISTENTE: {situ_key}
Título: {situ_summary}

Descripción:
{situ_description or '(sin descripción)'}
"""
    if comments:
        ctx += "\nCOMENTARIOS DEL SITU (en orden cronológico):\n"
        for c in comments:
            ctx += f"\n[{c.get('created','?')}] {c.get('author','?')}:\n{c.get('body','').strip()}\n"
    if attachments:
        ctx += "\nARCHIVOS ADJUNTOS DEL SITU:\n"
        for a in attachments:
            ctx += f"- {a.get('filename')} ({a.get('mimeType')}, {a.get('size')} bytes)\n"
    if confluence_pages:
        ctx += "\nPÁGINAS DE CONFLUENCE DE REFERENCIA:\n"
        for p in confluence_pages:
            ctx += f"\n### {p.get('title','(sin título)')}\n{p.get('url','')}\n{(p.get('body','') or '')[:1500]}\n"
    ctx += f"\nNecesito que generes UNA propuesta de ITDEV para implementar lo que pide este SITU. El SITU ya está creado, no propongas crear otro. El ITDEV se va a vincular automáticamente a {situ_key}."
    batch = propose_batch(ctx, [{"key": situ_key, "summary": situ_summary}], extra_instructions, images=images, pdfs=pdfs)
    propuestas = batch.get("propuestas", [])
    if not propuestas:
        raise RuntimeError("Gemini no generó propuesta")
    p = propuestas[0]
    p["situ_existente_key"] = situ_key
    return p


def propose_subtasks_for_itdev(
    itdev_key: str,
    itdev_summary: str,
    itdev_description: str = "",
    existing_subtask_summaries: list[str] | None = None,
    extra_instructions: str = "",
) -> list[dict]:
    existing_block = ""
    if existing_subtask_summaries:
        existing_block = "\nSUB-TASKS YA EXISTENTES (NO duplicar):\n"
        for s in existing_subtask_summaries:
            existing_block += f"- {s}\n"
    ctx = f"""ITDEV EXISTENTE QUE HAY QUE DESCOMPONER EN SUB-TASKS: {itdev_key}
Título: {itdev_summary}

Descripción actual:
{itdev_description or '(sin descripción detallada)'}
{existing_block}
TAREA: Generar UNA propuesta cuyo `subtareas_hijas` contenga la descomposición concreta de este ITDEV en Jira sub-tasks. NO propongas crear otro ITDEV. NO propongas crear SITU.

Cada subtarea debe tener objetivo, contexto, pasos numerados, criterio de done y estimación de horas razonable."""
    batch = propose_batch(ctx, extra_instructions=extra_instructions)
    propuestas = batch.get("propuestas", []) or []
    if not propuestas:
        return []
    return (propuestas[0].get("itdev") or {}).get("subtareas_hijas", []) or []


def health_check() -> str:
    _, types, _ = _lazy_genai()
    response = _generate_with_retry(
        "Decí solo 'OK'",
        types.GenerateContentConfig(
            max_output_tokens=20,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return (response.text or "").strip()

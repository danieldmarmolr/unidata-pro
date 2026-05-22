"""
Auto-documentación de tablas del Data Catalog usando Gemini.

Para cada tabla: dado el schema + columnas con tipos + sample rows, genera
una descripcion operativa concisa y 3-7 tags clasificatorios.

Llama directo a Gemini con response_mime_type=json para output estructurado.
Pattern reusado de app/services/jira_flow/llm_client.py.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from sqlalchemy import text

from app.db.engines import get_engine

log = logging.getLogger("unidata.catalog_auto_doc")

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
FALLBACK_MODELS = ["gemini-2.5-flash-lite", "gemini-flash-latest"]
MAX_RETRIES = 3
SAMPLE_ROWS = 5

_client = None


SYSTEM_PROMPT = """Sos un analista de datos senior del equipo UNIDATA (BI interno del grupo Unistore).
Tu tarea: dada una tabla de PostgreSQL (schema, nombre, columnas con tipos y filas de ejemplo), generar:

1. **description**: 2-4 oraciones explicando:
   - QUE representa la tabla (que entidad del negocio)
   - PARA QUE sirve operativamente (en que dashboards/queries se usa, o que pregunta responde)
   - GOTCHAS si los detectas (columnas confusas, joins no obvios, datos inconsistentes)

2. **tags**: 3-7 tags cortos en lowercase, kebab-case. Ejemplos validos:
   ventas, ground-truth, catalogo, padron, audit-log, transaccional, denormalizado,
   wms, logistica, devoluciones, marketing, suscripciones, refunds, talo, mercado-libre,
   tienda-nube, contabilium, digip, oca, lightdata, prisma-m2m, slow, big-table

Lenguaje: castellano rioplatense (es-AR). Sin emojis. No expliques que vas a hacer, devolve solo el JSON.

Output JSON EXACTO: {"description": "...", "tags": ["...", "..."]}"""


def _lazy_genai():
    from google import genai  # type: ignore
    from google.genai import types  # type: ignore
    from google.genai import errors as genai_errors  # type: ignore
    return genai, types, genai_errors


def _client_lazy():
    global _client
    if _client is None:
        if not os.getenv("GEMINI_API_KEY"):
            raise RuntimeError("GEMINI_API_KEY no esta seteada en el backend")
        genai, _, _ = _lazy_genai()
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client


def _generate_with_retry(contents: Any, config: Any) -> Any:
    _, _, genai_errors = _lazy_genai()
    models = [MODEL] + [m for m in FALLBACK_MODELS if m != MODEL]
    last_err: Exception | None = None
    for model in models:
        for attempt in range(MAX_RETRIES):
            try:
                return _client_lazy().models.generate_content(
                    model=model, contents=contents, config=config
                )
            except genai_errors.APIError as e:
                last_err = e
                code = getattr(e, "code", None)
                if code in (429, 500, 502, 503, 504):
                    time.sleep(2 ** attempt)
                    continue
                raise
            except Exception as e:
                last_err = e
                raise
    raise RuntimeError(f"Gemini retries agotados: {last_err}")


def _config(temperature: float = 0.2, max_tokens: int = 1024) -> Any:
    _, types, _ = _lazy_genai()
    return types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
        temperature=temperature,
        max_output_tokens=max_tokens,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )


def _fetch_columns(unit: str, schema: str, table: str) -> list[dict]:
    eng = get_engine(unit)
    with eng.connect() as c:
        rows = c.execute(
            text("""
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema = :s AND table_name = :t
                ORDER BY ordinal_position
            """),
            {"s": schema, "t": table},
        ).all()
    return [
        {"name": r[0], "type": r[1], "nullable": r[2] == "YES"}
        for r in rows
    ]


def _fetch_sample_rows(unit: str, schema: str, table: str, n: int = SAMPLE_ROWS) -> dict:
    """Devuelve {columns: [...], rows: [[...], ...]} de N filas random/recientes."""
    eng = get_engine(unit)
    try:
        with eng.connect() as c:
            # TABLESAMPLE no funciona con LIMIT estable. Usamos LIMIT con la cabeza
            # de la tabla - barato y representativo para muestra de tipos.
            res = c.execute(
                text(f'SELECT * FROM "{schema}"."{table}" LIMIT {n}'),
            )
            cols = list(res.keys())
            rows = res.all()
        # Convertir cada fila a list de strings truncados (evita explotar tokens)
        out_rows: list[list[str]] = []
        for r in rows:
            out_rows.append([_short_value(v) for v in r])
        return {"columns": cols, "rows": out_rows}
    except Exception as e:
        log.warning("sample fetch failed for %s.%s: %s", schema, table, e)
        return {"columns": [], "rows": []}


def _short_value(v: Any) -> str:
    if v is None:
        return "NULL"
    s = str(v)
    if len(s) > 80:
        return s[:77] + "..."
    return s


def _build_user_msg(
    unit: str, schema: str, table: str, columns: list[dict], samples: dict
) -> str:
    parts = [
        f"BASE: {unit}_api",
        f"SCHEMA: {schema}",
        f"TABLA: {table}",
        "",
        "COLUMNAS:",
    ]
    for col in columns:
        nullable = "" if col.get("nullable") else " NOT NULL"
        parts.append(f"  - {col['name']}: {col['type']}{nullable}")
    parts.append("")
    parts.append(f"SAMPLE ROWS ({len(samples.get('rows', []))} filas de la cabeza):")
    if not samples.get("rows"):
        parts.append("  (tabla vacia o sin acceso)")
    else:
        for r in samples["rows"]:
            parts.append("  | " + " | ".join(r))
    return "\n".join(parts)


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Gemini no devolvio JSON valido: {raw[:300]} :: {e}")


def generate_doc_for_table(
    unit: str, schema: str, table: str
) -> dict:
    """Devuelve {description: str, tags: [str]} usando Gemini."""
    columns = _fetch_columns(unit, schema, table)
    if not columns:
        raise ValueError(f"tabla sin columnas: {schema}.{table}")
    samples = _fetch_sample_rows(unit, schema, table)
    user_msg = _build_user_msg(unit, schema, table, columns, samples)

    response = _generate_with_retry(user_msg, _config())
    raw = response.text or ""
    parsed = _parse_json(raw)
    description = parsed.get("description") or ""
    tags = parsed.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    return {
        "description": description.strip(),
        "tags": [str(t).strip().lower() for t in tags if t][:7],
    }


def list_tables_in_schema(unit: str, schema: str) -> list[str]:
    eng = get_engine(unit)
    with eng.connect() as c:
        rows = c.execute(
            text("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = :s AND table_type = 'BASE TABLE'
                ORDER BY table_name
            """),
            {"s": schema},
        ).all()
    return [r[0] for r in rows]

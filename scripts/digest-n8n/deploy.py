"""
Deploy del workflow "UNIDATA - People digest diario" a n8n cloud via API.

Crea:
1. Credential httpHeaderAuth "UNIDATA API Bearer" con tu JWT scope=mcp
2. Credential httpHeaderAuth "Resend API Bearer" con tu API key de Resend
3. Workflow que referencia ambas credentials
4. Activa el workflow

Requires (env vars):
    N8N_BASE_URL   - ej: https://unistore-it.app.n8n.cloud/api/v1
    N8N_API_KEY    - JWT de n8n cloud (Settings -> API en n8n)
    UNIDATA_TOKEN  - tu JWT con scope mcp (generalo en /dashboard/account)
    RESEND_API_KEY - re_xxxxx de https://resend.com/api-keys
    RESEND_FROM    - opcional, default: "UNIDATA <people@unidatacenter.com.ar>"
                     (requiere que ese dominio este verificado en Resend)

Uso:
    python deploy.py             # crear/replace workflow + activar
    python deploy.py --dry-run   # solo imprime el payload sin enviar
    python deploy.py --no-activate  # crea pero no activa

Idempotente: si ya existe un workflow con el mismo name lo actualiza (PUT).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests

WORKFLOW_NAME = "UNIDATA - People digest diario"
UNIDATA_CRED_NAME = "UNIDATA API Bearer"
RESEND_CRED_NAME = "Resend API Bearer"


def need(var: str) -> str:
    v = os.environ.get(var)
    if not v:
        sys.exit(f"FATAL: env var {var} no seteada")
    return v.strip()


def n8n_request(method: str, base: str, key: str, path: str, **kwargs):
    headers = kwargs.pop("headers", {}) or {}
    headers["X-N8N-API-KEY"] = key
    headers.setdefault("Content-Type", "application/json")
    url = f"{base.rstrip('/')}{path}"
    res = requests.request(method, url, headers=headers, timeout=30, **kwargs)
    if not res.ok:
        sys.exit(f"FATAL: {method} {path} -> {res.status_code} {res.text}")
    return res.json() if res.text else {}


def find_existing(base: str, key: str, name: str, kind: str) -> dict | None:
    """kind = 'workflows' o 'credentials'."""
    res = n8n_request("GET", base, key, f"/{kind}?limit=250")
    for item in res.get("data", []):
        if item.get("name") == name:
            return item
    return None


def ensure_credential(base: str, key: str, name: str, token_value: str) -> str:
    """Crea (o reusa) una credencial httpHeaderAuth con Authorization: Bearer <token>.
    Devuelve el ID."""
    existing = find_existing(base, key, name, "credentials")
    if existing:
        print(f"  credential '{name}' ya existe (id={existing['id']}), reusando")
        # n8n API no expone update de data secreto. Si necesitas rotar, borralo y crealo de nuevo.
        return existing["id"]
    payload = {
        "name": name,
        "type": "httpHeaderAuth",
        "data": {
            "name": "Authorization",
            "value": f"Bearer {token_value}",
        },
    }
    res = n8n_request("POST", base, key, "/credentials", data=json.dumps(payload))
    cid = res.get("id") or res.get("data", {}).get("id")
    if not cid:
        sys.exit(f"FATAL: no se obtuvo id de credential creada: {res}")
    print(f"  credential '{name}' creada (id={cid})")
    return cid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-activate", action="store_true")
    args = parser.parse_args()

    n8n_base = need("N8N_BASE_URL")
    n8n_key = need("N8N_API_KEY")
    unidata_token = need("UNIDATA_TOKEN")
    resend_key = need("RESEND_API_KEY")
    resend_from = os.environ.get("RESEND_FROM", "UNIDATA <people@unidatacenter.com.ar>").strip()

    template_path = Path(__file__).parent / "workflow.json"
    template = json.loads(template_path.read_text(encoding="utf-8"))

    if args.dry_run:
        print("DRY RUN — sin tocar n8n.")
        print(json.dumps(template, indent=2, ensure_ascii=False))
        return

    print(f"== n8n: {n8n_base}")
    print(f"== resend from: {resend_from}")
    print()

    # 1) Credentials
    print("Asegurando credentials:")
    unidata_cred_id = ensure_credential(n8n_base, n8n_key, UNIDATA_CRED_NAME, unidata_token)
    resend_cred_id = ensure_credential(n8n_base, n8n_key, RESEND_CRED_NAME, resend_key)
    print()

    # 2) Patch template: inyectar IDs reales y el "from" de Resend
    payload_str = json.dumps(template)
    payload_str = payload_str.replace("__UNIDATA_CRED_ID__", unidata_cred_id)
    payload_str = payload_str.replace("__RESEND_CRED_ID__", resend_cred_id)
    payload_str = payload_str.replace(
        "UNIDATA <people@unidatacenter.com.ar>",
        resend_from,
    )
    payload = json.loads(payload_str)

    # 3) Workflow: crear o actualizar
    existing_wf = find_existing(n8n_base, n8n_key, WORKFLOW_NAME, "workflows")
    if existing_wf:
        wf_id = existing_wf["id"]
        print(f"Workflow '{WORKFLOW_NAME}' ya existe (id={wf_id}), updating via PUT...")
        # n8n strict: solo allowed keys en settings, no 'id'/'meta'/'versionId'
        n8n_request("PUT", n8n_base, n8n_key, f"/workflows/{wf_id}",
                    data=json.dumps(payload))
        print("  PUT OK")
    else:
        print(f"Creando workflow '{WORKFLOW_NAME}'...")
        res = n8n_request("POST", n8n_base, n8n_key, "/workflows",
                          data=json.dumps(payload))
        wf_id = res.get("id") or res.get("data", {}).get("id")
        if not wf_id:
            sys.exit(f"FATAL: no id de workflow creado: {res}")
        print(f"  Workflow creado (id={wf_id})")

    # 4) Activar
    if args.no_activate:
        print("\nSkip activate (--no-activate)")
    else:
        print("\nActivando workflow...")
        n8n_request("POST", n8n_base, n8n_key, f"/workflows/{wf_id}/activate")
        print("  OK, workflow ACTIVO. Proximo run: manana a las 08:00 AR.")

    print()
    print(f"Editor n8n: {n8n_base.replace('/api/v1', '')}/workflow/{wf_id}")
    print(f"Para test manual: en el editor, click Execute Workflow.")


if __name__ == "__main__":
    main()

"""Generación automática de documentación en Confluence al cerrar ITDEVs.

Estado in-memory (no disco) — Railway stateless. El frontend mantiene el
último resultado en localStorage si necesita persistencia entre reloads.
"""
import os
from datetime import datetime, timezone
from . import jira_client as jira
from . import confluence_client as conf

ITDEV_KEY = os.getenv("ITDEV_PROJECT_KEY", "ITDEV")
SPACE_KEY = os.getenv("CONFLUENCE_DEFAULT_SPACE", "ID")

ROOT_PAGE_TITLE = "📓 Documentación generada (auto)"
CIERRES_TITLE = "🔄 Cierres por mes"
RUNBOOK_TITLE = "🐛 Runbook de bugs"
ADR_TITLE = "📐 ADRs"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")


def _month_key(iso: str) -> str:
    return (iso or "")[:7]


def _epic_name(issue: dict) -> str:
    parent = (issue.get("fields") or {}).get("parent") or {}
    return (parent.get("fields") or {}).get("summary") or parent.get("key") or "Sin EPIC"


def build_postmortem_md(issue: dict) -> str:
    f = issue["fields"]
    key = issue["key"]
    summary = f["summary"]
    itype = f["issuetype"]["name"]
    asg = (f.get("assignee") or {}).get("displayName", "Sin asignar")
    prio = (f.get("priority") or {}).get("name", "—")
    epic = _epic_name(issue)
    resolved = (f.get("resolutiondate") or "")[:10]
    desc_text = jira.adf_to_text(f.get("description"))
    base_url = os.getenv("JIRA_BASE_URL", "")

    subs = jira.get_subtasks(key)
    sub_lines = []
    for s in subs:
        sf = s["fields"]
        sub_lines.append(f"- [{s['key']}] {sf['summary']} — _{sf['status']['name']}_")

    situ_links = []
    for link in f.get("issuelinks") or []:
        other = link.get("outwardIssue") or link.get("inwardIssue")
        if other and other.get("key", "").startswith("SITU-"):
            situ_links.append(other["key"])

    md_parts = [
        f"# [{key}] {summary}",
        "",
        f"**Tipo:** {itype}  ·  **EPIC:** {epic}  ·  **Prioridad:** {prio}",
        f"**Resuelto:** {resolved}  ·  **Asignado:** {asg}",
        f"**Link Jira:** [{key}]({base_url}/browse/{key})",
    ]
    if situ_links:
        md_parts.append(f"**SITU origen:** {', '.join(situ_links)}")
    md_parts.append("")
    md_parts.append("## 📖 Descripción del trabajo")
    md_parts.append(desc_text or "_(sin descripción detallada)_")
    md_parts.append("")
    if sub_lines:
        md_parts.append("## 📋 Sub-tasks (estado al cierre)")
        md_parts.extend(sub_lines)
        md_parts.append("")
    md_parts.append("---")
    md_parts.append(f"_Página generada automáticamente por unidata-jira-flow el {_now_iso()}_")
    return "\n".join(md_parts)


def build_runbook_entry_md(issue: dict) -> str:
    f = issue["fields"]
    key = issue["key"]
    summary = f["summary"]
    resolved = (f.get("resolutiondate") or "")[:10]
    desc_text = jira.adf_to_text(f.get("description"))
    base_url = os.getenv("JIRA_BASE_URL", "")
    return "\n".join([
        f"## [{key}] {summary}",
        f"_Resuelto: {resolved}_  ·  [Ver en Jira]({base_url}/browse/{key})",
        "",
        desc_text[:2000] if desc_text else "_(sin detalle)_",
        "",
        "---",
        "",
    ])


def build_adr_md(issue: dict) -> str:
    f = issue["fields"]
    key = issue["key"]
    summary = f["summary"]
    resolved = (f.get("resolutiondate") or "")[:10]
    desc_text = jira.adf_to_text(f.get("description"))
    base_url = os.getenv("JIRA_BASE_URL", "")
    return "\n".join([
        f"# ADR: {summary}",
        f"**Estado:** Aceptado  ·  **Fecha:** {resolved}  ·  **Ticket:** [{key}]({base_url}/browse/{key})",
        "",
        desc_text or "_(sin contenido)_",
        "",
        "---",
        f"_ADR generado automáticamente desde {key}_",
    ])


def handle_postmortem(issue: dict, space_id: str) -> dict:
    f = issue["fields"]
    key = issue["key"]
    title = f"[{key}] {f['summary']}"
    month = _month_key(f.get("resolutiondate") or _now_iso())
    parent_id = conf.find_or_create_path(space_id, [ROOT_PAGE_TITLE, CIERRES_TITLE, month])
    existing = conf.find_page_by_title(space_id, title, parent_id)
    if existing:
        return {"action": "exists", "url": conf.page_url(existing)}
    body = build_postmortem_md(issue)
    page = conf.create_page(space_id, title, body, parent_id)
    try:
        jira.add_remote_link(key, conf.page_url(page), f"📝 Post-mortem: {title}")
    except Exception:
        pass
    return {"action": "created", "url": conf.page_url(page)}


def handle_runbook(issue: dict, space_id: str) -> dict:
    f = issue["fields"]
    if f["issuetype"]["name"] != "Bug":
        return {"action": "skipped", "reason": "no es Bug"}
    epic = _epic_name(issue)
    runbook_title = f"Runbook — {epic}"
    parent_id = conf.find_or_create_path(space_id, [ROOT_PAGE_TITLE, RUNBOOK_TITLE])
    page = conf.get_or_create_page(
        space_id, runbook_title,
        f"# {runbook_title}\n\nÍndice de bugs resueltos del producto **{epic}**.\n\n---\n",
        parent_id,
    )
    entry_md = build_runbook_entry_md(issue)
    try:
        conf.append_to_page(page["id"], entry_md)
    except Exception as e:
        return {"action": "error", "error": str(e)}
    try:
        jira.add_remote_link(issue["key"], conf.page_url(page), f"📕 Runbook: {epic}")
    except Exception:
        pass
    return {"action": "appended", "url": conf.page_url(page)}


def handle_adr(issue: dict, space_id: str) -> dict:
    f = issue["fields"]
    labels = f.get("labels") or []
    if "adr" not in [l.lower() for l in labels]:
        return {"action": "skipped", "reason": "no tiene label 'adr'"}
    key = issue["key"]
    title = f"ADR: {f['summary']}"
    parent_id = conf.find_or_create_path(space_id, [ROOT_PAGE_TITLE, ADR_TITLE])
    existing = conf.find_page_by_title(space_id, title, parent_id)
    if existing:
        return {"action": "exists", "url": conf.page_url(existing)}
    body = build_adr_md(issue)
    page = conf.create_page(space_id, title, body, parent_id)
    try:
        jira.add_remote_link(key, conf.page_url(page), f"📐 {title}")
    except Exception:
        pass
    return {"action": "created", "url": conf.page_url(page)}


def run_polling_cycle(
    since_iso: str | None = None,
    enable_postmortem: bool = True,
    enable_runbook: bool = True,
    enable_adr: bool = True,
    dry_run: bool = False,
    processed_keys: set[str] | None = None,
) -> dict:
    """Corre un ciclo de polling.

    El frontend pasa `since_iso` y `processed_keys` para mantener estado
    entre llamadas (en lugar de un archivo en disco como en la versión
    Streamlit original).
    """
    processed_keys = processed_keys or set()
    space_id = conf.get_space_id(SPACE_KEY)
    if not space_id:
        return {"error": f"No se encontró space {SPACE_KEY}"}

    issues = jira.get_recently_closed(ITDEV_KEY, since_iso)
    results = []

    for issue in issues:
        key = issue["key"]
        if key in processed_keys:
            continue
        per_issue = {"key": key, "summary": issue["fields"]["summary"], "actions": []}
        if dry_run:
            per_issue["actions"].append({"handler": "would-run", "action": "dry_run"})
            results.append(per_issue)
            continue
        if enable_postmortem:
            try:
                per_issue["actions"].append({"handler": "postmortem", **handle_postmortem(issue, space_id)})
            except Exception as e:
                per_issue["actions"].append({"handler": "postmortem", "action": "error", "error": str(e)})
        if enable_runbook:
            try:
                per_issue["actions"].append({"handler": "runbook", **handle_runbook(issue, space_id)})
            except Exception as e:
                per_issue["actions"].append({"handler": "runbook", "action": "error", "error": str(e)})
        if enable_adr:
            try:
                per_issue["actions"].append({"handler": "adr", **handle_adr(issue, space_id)})
            except Exception as e:
                per_issue["actions"].append({"handler": "adr", "action": "error", "error": str(e)})
        processed_keys.add(key)
        results.append(per_issue)

    return {
        "since": since_iso,
        "now": _now_iso(),
        "found": len(issues),
        "processed": len(results),
        "processed_keys": list(processed_keys),
        "results": results,
    }

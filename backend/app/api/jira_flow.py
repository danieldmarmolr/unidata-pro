"""Jira Flow API — SITU + ITDEV + Confluence + Gemini, restringido a areas it/data."""
from __future__ import annotations

import base64
import json
import os
from collections import Counter
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app.auth.security import current_user, require_area
from app.db import jira_flow_db
from app.services.jira_flow import (
    confluence_client as conf,
    doc_automation as docs,
    file_context as fctx,
    jira_client as jira,
    llm_client as llm,
    teams_client as teams,
)
from app.services.jira_flow.prompts import render_description_markdown, render_subtask_description

router = APIRouter(prefix="/api/jira-flow", tags=["jira-flow"])


def _itdev_key() -> str:
    return os.getenv("ITDEV_PROJECT_KEY", "ITDEV")


def _situ_key() -> str:
    return os.getenv("SITU_PROJECT_KEY", "SITU")


def _board_id() -> int:
    return int(os.getenv("ITDEV_BOARD_ID", "102"))


def _subtask_type() -> str:
    return os.getenv("SUBTASK_ISSUE_TYPE", "Subtarea")


def _base_url() -> str:
    return os.getenv("JIRA_BASE_URL", "").rstrip("/")


def _guard(user: dict) -> None:
    require_area(user, ["it", "data"])


# ---------- Health / Config ----------
@router.get("/health")
def health(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    return {
        "jira_base_url": _base_url(),
        "itdev": _itdev_key(),
        "situ": _situ_key(),
        "board_id": _board_id(),
        "confluence_space": os.getenv("CONFLUENCE_DEFAULT_SPACE", "ID"),
        "default_label": os.getenv("DEFAULT_LABEL", ""),
        "default_triager": os.getenv("DEFAULT_TRIAGER_ACCOUNT_ID", ""),
        "jira_api_token_present": bool(os.getenv("JIRA_API_TOKEN")),
        "gemini_api_key_present": bool(os.getenv("GEMINI_API_KEY")),
        "gemini_model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
    }


@router.get("/test/jira")
def test_jira(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    try:
        me = jira.myself()
        return {
            "ok": True,
            "displayName": me.get("displayName"),
            "accountId": me.get("accountId"),
            "email": me.get("emailAddress"),
        }
    except Exception as e:
        raise HTTPException(502, f"Jira: {e}")


@router.get("/test/gemini")
def test_gemini(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    try:
        return {"ok": True, "response": llm.health_check()}
    except Exception as e:
        raise HTTPException(502, f"Gemini: {e}")


# ---------- Metadata ----------
@router.get("/epics")
def list_epics(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    epics = jira.get_epics(_itdev_key())
    return {"items": [{"key": e["key"], "summary": e["fields"]["summary"], "status": e["fields"]["status"]["name"]} for e in epics]}


@router.get("/users")
def list_users(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    users = jira.get_assignable_users(_itdev_key())
    return {"items": [{"accountId": u.get("accountId"), "displayName": u.get("displayName"), "email": u.get("emailAddress", "")} for u in users]}


@router.get("/link-types")
def list_link_types(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    return {"items": jira.get_issue_link_types()}


@router.get("/labels")
def list_labels(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    return {"items": jira.get_labels()}


@router.get("/sprints")
def list_sprints(
    user: Annotated[dict, Depends(current_user)],
    state: Annotated[str, Query()] = "active,future",
) -> dict:
    _guard(user)
    return {"items": jira.get_sprints(_board_id(), state=state)}


# ---------- Dashboard del sprint ----------
@router.get("/sprint-dashboard")
def sprint_dashboard(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    sprint = jira.get_active_sprint(_board_id())
    if not sprint:
        return {"sprint": None, "issues": [], "counters": {}, "situ": {}}

    issues = jira.search(
        f'sprint = {sprint["id"]} ORDER BY status, priority DESC',
        fields=["summary", "status", "assignee", "priority", "issuetype", "parent", "labels", "duedate"],
        max_results=200,
    )

    status_counter = Counter()
    type_counter = Counter()
    assignee_counter = Counter()
    epic_counter = Counter()
    base_url = _base_url()
    rows = []

    for i in issues:
        f = i["fields"]
        status = f["status"]["name"]
        itype = f["issuetype"]["name"]
        asg = (f.get("assignee") or {}).get("displayName", "Sin asignar")
        parent = f.get("parent") or {}
        epic = (parent.get("fields") or {}).get("summary") or parent.get("key", "Sin EPIC")

        status_counter[status] += 1
        type_counter[itype] += 1
        assignee_counter[asg] += 1
        epic_counter[epic] += 1

        rows.append({
            "key": i["key"],
            "type": itype,
            "summary": f["summary"],
            "epic": epic,
            "status": status,
            "assignee": asg,
            "priority": (f.get("priority") or {}).get("name", "—"),
            "url": f"{base_url}/browse/{i['key']}",
        })

    total = len(issues)
    done_states = sum(v for k, v in status_counter.items() if k.lower() in ("finalizada", "done", "cerrada", "closed", "resuelta"))
    in_progress = sum(v for k, v in status_counter.items() if "curso" in k.lower() or "progress" in k.lower() or "revisión" in k.lower())
    todo = total - done_states - in_progress

    days_left = None
    try:
        end_dt = datetime.fromisoformat(sprint["endDate"].replace("Z", "+00:00"))
        days_left = (end_dt - datetime.now(timezone.utc)).days
    except Exception:
        pass

    # SITU intake
    situ_stats = _open_situ_stats()

    return {
        "sprint": {
            "id": sprint["id"],
            "name": sprint["name"],
            "startDate": sprint.get("startDate", "")[:10],
            "endDate": sprint.get("endDate", "")[:10],
            "goal": sprint.get("goal", ""),
            "days_left": days_left,
        },
        "counters": {
            "total": total,
            "todo": todo,
            "in_progress": in_progress,
            "done": done_states,
            "progress_pct": (done_states / total) if total else 0,
            "by_status": dict(status_counter),
            "by_type": dict(type_counter),
            "by_assignee": dict(assignee_counter),
            "by_epic": dict(epic_counter),
        },
        "issues": rows,
        "situ": situ_stats,
    }


def _open_situ_stats() -> dict:
    try:
        issues = jira.search(
            f'project = {_situ_key()} AND statusCategory != Done',
            fields=["summary", "issuelinks", "assignee"],
            max_results=200,
        )
        total = len(issues)
        unassigned = sum(1 for i in issues if not (i["fields"].get("assignee")))
        no_itdev = 0
        for i in issues:
            has_itdev = any(
                (link.get("outwardIssue") or link.get("inwardIssue") or {}).get("key", "").startswith(f"{_itdev_key()}-")
                for link in (i["fields"].get("issuelinks") or [])
            )
            if not has_itdev:
                no_itdev += 1
        return {"total": total, "unassigned": unassigned, "no_itdev": no_itdev}
    except Exception:
        return {"total": 0, "unassigned": 0, "no_itdev": 0}


# ---------- SITU listing ----------
@router.get("/situ/open")
def list_open_situ(
    user: Annotated[dict, Depends(current_user)],
    only_unassigned: Annotated[bool, Query()] = False,
    no_itdev_only: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 80,
) -> dict:
    _guard(user)
    extra = " AND assignee is EMPTY" if only_unassigned else ""
    issues = jira.search(
        f'project = {_situ_key()} AND statusCategory != Done{extra} ORDER BY created DESC',
        fields=["summary", "status", "assignee", "created", "priority", "issuelinks"],
        max_results=limit,
    )
    itdev_prefix = f"{_itdev_key()}-"
    out = []
    for i in issues:
        f = i["fields"]
        linked = []
        for link in f.get("issuelinks", []) or []:
            other = link.get("outwardIssue") or link.get("inwardIssue")
            if other and other.get("key", "").startswith(itdev_prefix):
                linked.append(other["key"])
        if no_itdev_only and linked:
            continue
        out.append({
            "key": i["key"],
            "summary": f["summary"],
            "status": f["status"]["name"],
            "created": f.get("created", "")[:10],
            "priority": (f.get("priority") or {}).get("name", "—"),
            "assignee": (f.get("assignee") or {}).get("displayName", "Sin asignar"),
            "linked_itdev": linked,
        })
    return {"items": out, "count": len(out)}


@router.get("/issue/{issue_key}")
def get_issue_full(
    issue_key: str,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    try:
        issue = jira.get_issue(issue_key)
        comments = jira.get_comments(issue_key)
        f = issue["fields"]
        return {
            "key": issue["key"],
            "summary": f["summary"],
            "description": jira.adf_to_text(f.get("description")),
            "status": f["status"]["name"],
            "issuetype": f["issuetype"]["name"],
            "priority": (f.get("priority") or {}).get("name", "—"),
            "assignee": (f.get("assignee") or {}).get("displayName", "Sin asignar"),
            "assignee_id": (f.get("assignee") or {}).get("accountId"),
            "comments": comments,
            "attachments": [
                {"id": a.get("id"), "filename": a.get("filename"), "size": a.get("size"),
                 "mimeType": a.get("mimeType"), "content": a.get("content")}
                for a in (f.get("attachment") or [])
            ],
            "labels": f.get("labels") or [],
            "subtasks": [
                {"key": s["key"], "summary": s["fields"]["summary"], "status": s["fields"]["status"]["name"]}
                for s in (f.get("subtasks") or [])
            ],
        }
    except Exception as e:
        raise HTTPException(502, str(e))


# ---------- Triage SITU ----------
class AssignBody(BaseModel):
    account_id: str | None = None


@router.post("/issue/{issue_key}/assign")
def assign(
    issue_key: str,
    body: AssignBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    try:
        jira.assign_issue(issue_key, body.account_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(502, str(e))


class LabelsBody(BaseModel):
    labels: list[str]


@router.post("/issue/{issue_key}/labels")
def add_labels(
    issue_key: str,
    body: LabelsBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    try:
        jira.add_labels(issue_key, body.labels)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(502, str(e))


# ---------- Confluence ----------
@router.get("/confluence/spaces")
def list_spaces(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    spaces = [s for s in conf.list_spaces() if s.get("type") != "personal"]
    return {"items": [{"id": s.get("id"), "key": s.get("key"), "name": s.get("name"), "type": s.get("type")} for s in spaces]}


@router.get("/confluence/recent")
def confluence_recent(
    user: Annotated[dict, Depends(current_user)],
    space_key: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> dict:
    _guard(user)
    target = space_key or os.getenv("CONFLUENCE_DEFAULT_SPACE")
    return {"items": conf.recent_pages(target, limit)}


@router.get("/confluence/search")
def confluence_search(
    user: Annotated[dict, Depends(current_user)],
    q: Annotated[str, Query(min_length=1)],
    space_key: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> dict:
    _guard(user)
    return {"items": conf.search_pages(q, space_key, limit)}


@router.get("/confluence/page/{page_id}")
def get_confluence_page(
    page_id: str,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    try:
        page = conf.get_page(page_id, with_body=True)
        return {
            "id": page.get("id"),
            "title": page.get("title"),
            "url": conf.page_url(page),
            "body_text": conf.page_body_text(page)[:5000],
        }
    except Exception as e:
        raise HTTPException(502, str(e))


# ---------- LLM proposals ----------
class ProposeBatchBody(BaseModel):
    context: str = Field(min_length=1)
    extra_instructions: str = ""
    include_situ_open: bool = True


@router.post("/llm/propose-batch")
def propose_batch(
    body: ProposeBatchBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(400, "GEMINI_API_KEY no está configurado")
    situ_open = []
    if body.include_situ_open:
        try:
            issues = jira.search(
                f'project = {_situ_key()} AND statusCategory != Done ORDER BY created DESC',
                fields=["summary", "issuelinks"],
                max_results=80,
            )
            itdev_prefix = f"{_itdev_key()}-"
            for i in issues:
                has_itdev = any(
                    (link.get("outwardIssue") or link.get("inwardIssue") or {}).get("key", "").startswith(itdev_prefix)
                    for link in (i["fields"].get("issuelinks") or [])
                )
                if not has_itdev:
                    situ_open.append({"key": i["key"], "summary": i["fields"]["summary"]})
        except Exception:
            situ_open = []
    try:
        result = llm.propose_batch(body.context, situ_open, body.extra_instructions)
        return result
    except Exception as e:
        raise HTTPException(502, str(e))


class ProposeFromSituBody(BaseModel):
    situ_key: str
    extra_instructions: str = ""
    confluence_page_ids: list[str] = Field(default_factory=list)


@router.post("/llm/propose-from-situ")
def propose_from_situ(
    body: ProposeFromSituBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(400, "GEMINI_API_KEY no está configurado")
    try:
        issue = jira.get_issue(body.situ_key)
        desc = jira.adf_to_text(issue["fields"].get("description"))
        comments = jira.get_comments(body.situ_key)
        attachments = [
            {"id": a.get("id"), "filename": a.get("filename"), "size": a.get("size"),
             "mimeType": a.get("mimeType"), "content": a.get("content")}
            for a in (issue["fields"].get("attachment") or [])
        ]
        cf_pages = []
        for pid in body.confluence_page_ids[:5]:
            try:
                p = conf.get_page(pid)
                cf_pages.append({
                    "title": p.get("title", ""),
                    "url": conf.page_url(p),
                    "body": conf.page_body_text(p)[:2000],
                })
            except Exception:
                pass
        prop = llm.propose_itdev_from_situ(
            body.situ_key, issue["fields"]["summary"], desc,
            body.extra_instructions, comments=comments,
            attachments=attachments, confluence_pages=cf_pages,
        )
        return {"propuesta": prop}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))


class ProposeSubtasksBody(BaseModel):
    itdev_key: str
    extra_instructions: str = ""


@router.post("/llm/propose-subtasks")
def propose_subtasks(
    body: ProposeSubtasksBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(400, "GEMINI_API_KEY no está configurado")
    try:
        full = jira.get_issue(body.itdev_key)
        desc_text = jira.adf_to_text(full["fields"].get("description"))
        existing = [s["fields"]["summary"] for s in jira.get_subtasks(body.itdev_key)]
        subs = llm.propose_subtasks_for_itdev(
            body.itdev_key, full["fields"]["summary"], desc_text, existing,
            extra_instructions=body.extra_instructions,
        )
        return {"propuestas": subs}
    except Exception as e:
        raise HTTPException(502, str(e))


# ---------- Crear ITDEV ----------
class CreateITDEVBody(BaseModel):
    summary: str
    itdev: dict
    labels: list[str] = Field(default_factory=list)
    assignee_account_id: str | None = None
    epic_key: str | None = None
    priority: str | None = None
    sprint_id: int | None = None
    link_to_situ: str | None = None
    link_type: str = "Relates"
    confluence_page_links: list[dict] = Field(default_factory=list)
    create_confluence_page: bool = False
    confluence_space_id: str | None = None
    subtasks: list[dict] = Field(default_factory=list)
    copy_attachments_from_situ: list[dict] = Field(default_factory=list)
    extra_attachments: list[dict] = Field(default_factory=list)  # [{name, mime, bytes_b64}]
    teams_notify_on_highest: bool = True


@router.post("/itdev/create")
def create_itdev(
    body: CreateITDEVBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    base_url = _base_url()
    itype = body.itdev.get("issue_type") or "Story"
    desc_md = render_description_markdown(body.itdev, situ_key=body.link_to_situ)
    warnings = []

    try:
        res = jira.create_issue(
            project_key=_itdev_key(),
            summary=body.summary,
            description=desc_md,
            issue_type=itype,
            labels=body.labels or None,
            assignee_account_id=body.assignee_account_id,
            epic_key=body.epic_key,
            priority=body.priority,
        )
        itdev_key = res["key"]
    except Exception as e:
        raise HTTPException(502, f"Error creando ITDEV: {e}")

    if body.sprint_id:
        try:
            jira.move_issues_to_sprint(body.sprint_id, [itdev_key])
        except Exception as se:
            warnings.append(f"No se pudo mover al sprint: {se}")

    if body.link_to_situ:
        try:
            jira.link_issues(itdev_key, body.link_to_situ, body.link_type)
        except Exception as le:
            warnings.append(f"Link a {body.link_to_situ} falló: {le}")

    # Copiar attachments del SITU
    for a in body.copy_attachments_from_situ:
        try:
            data = jira.download_attachment(a["content"])
            jira.upload_attachment(itdev_key, a["filename"], data, a.get("mimeType") or "application/octet-stream")
        except Exception as ae:
            warnings.append(f"No pude copiar {a.get('filename','?')}: {ae}")

    # Adjuntar archivos extra (uploaded por el usuario)
    for a in body.extra_attachments:
        try:
            data = base64.b64decode(a["bytes_b64"])
            jira.add_attachment(itdev_key, data, a["name"], a.get("mime") or "application/octet-stream")
        except Exception as ae:
            warnings.append(f"No pude adjuntar {a.get('name','?')}: {ae}")

    # Vincular páginas Confluence
    cf_icon = "https://wac-cdn.atlassian.com/dam/jcr:e2a6f06f-b3d5-4002-aed3-73538c7025af/Confluence-icon-blue-rgb-32px.png"
    for p in body.confluence_page_links:
        try:
            jira.add_remote_link(itdev_key, p["url"], f"📚 {p.get('title','Confluence')}", icon_url=cf_icon)
        except Exception as ce:
            warnings.append(f"No pude vincular '{p.get('title','?')}': {ce}")

    # Crear Confluence page
    confluence_url = None
    if body.create_confluence_page and body.confluence_space_id:
        try:
            md = f"# {body.summary}\n\n**ITDEV:** [{itdev_key}]({base_url}/browse/{itdev_key})\n"
            if body.link_to_situ:
                md += f"**SITU origen:** [{body.link_to_situ}]({base_url}/browse/{body.link_to_situ})\n"
            md += f"\n{desc_md}"
            new_page = conf.create_page(body.confluence_space_id, body.summary, md)
            confluence_url = new_page.get("webui_url") or ""
            if confluence_url:
                try:
                    jira.add_remote_link(itdev_key, confluence_url, f"📝 Doc: {body.summary}", icon_url=cf_icon)
                except Exception:
                    pass
        except Exception as cpe:
            warnings.append(f"Confluence page falló: {cpe}")

    # Subtareas hijas
    subtasks_created = []
    for h in body.subtasks:
        try:
            sub_desc = render_subtask_description(h, parent_key=itdev_key)
            sub_assignee = h.get("assignee_id") or body.assignee_account_id
            sub_res = jira.create_subtask(
                parent_key=itdev_key,
                summary=h["summary"],
                description=sub_desc,
                issue_type=_subtask_type(),
                assignee_account_id=sub_assignee,
                priority=body.priority,
                labels=body.labels or None,
            )
            subtasks_created.append({"key": sub_res["key"], "summary": h["summary"]})
        except Exception as he:
            warnings.append(f"Subtask '{h.get('summary','?')}' falló: {he}")

    # Teams notify on Highest priority
    teams_notified = False
    if body.teams_notify_on_highest and body.priority == "Highest" and os.getenv("TEAMS_WEBHOOK_URL"):
        try:
            extra_facts = [{"name": "SITU origen", "value": body.link_to_situ}] if body.link_to_situ else []
            teams.notify_urgent_ticket(
                issue_key=itdev_key,
                title=body.summary,
                assignee_name=user.get("name", "Sin asignar"),
                priority="Highest",
                issue_type=itype,
                issue_url=f"{base_url}/browse/{itdev_key}",
                extra_facts=extra_facts,
            )
            teams_notified = True
        except Exception as te:
            warnings.append(f"Teams notify falló: {te}")

    return {
        "ok": True,
        "itdev_key": itdev_key,
        "url": f"{base_url}/browse/{itdev_key}",
        "confluence_url": confluence_url,
        "subtasks": subtasks_created,
        "warnings": warnings,
        "teams_notified": teams_notified,
    }


# ---------- Subtareas batch (sin crear ITDEV padre) ----------
class CreateSubtasksBody(BaseModel):
    parent_key: str
    subtasks: list[dict]
    priority: str | None = None
    labels: list[str] = Field(default_factory=list)


@router.post("/itdev/subtasks")
def create_subtasks_batch(
    body: CreateSubtasksBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    parent = jira.get_issue(body.parent_key)
    parent_assignee = (parent["fields"].get("assignee") or {}).get("accountId")
    created = []
    warnings = []
    for h in body.subtasks:
        try:
            desc = render_subtask_description(h, parent_key=body.parent_key)
            assignee = h.get("assignee_id") or parent_assignee
            res = jira.create_subtask(
                parent_key=body.parent_key,
                summary=h["summary"],
                description=desc,
                issue_type=_subtask_type(),
                assignee_account_id=assignee,
                priority=body.priority,
                labels=body.labels or None,
            )
            created.append({"key": res["key"], "summary": h["summary"]})
        except Exception as he:
            warnings.append(f"Subtask '{h.get('summary','?')}' falló: {he}")
    return {"ok": True, "created": created, "warnings": warnings}


# ---------- ITDEV listing (para Subtareas page) ----------
@router.get("/itdev/sprint")
def itdev_sprint(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    sprint = jira.get_active_sprint(_board_id())
    if not sprint:
        return {"sprint": None, "items": []}
    issues = jira.search(
        f'sprint = {sprint["id"]} AND statusCategory != Done ORDER BY status, priority DESC',
        fields=["summary", "status", "assignee", "priority", "issuetype", "subtasks"],
        max_results=100,
    )
    return {"sprint": {"id": sprint["id"], "name": sprint["name"]}, "items": _map_issue_rows(issues)}


@router.get("/itdev/backlog")
def itdev_backlog(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    issues = jira.search(
        f'project = {_itdev_key()} AND sprint is EMPTY AND statusCategory != Done ORDER BY priority DESC, created DESC',
        fields=["summary", "status", "assignee", "priority", "issuetype", "subtasks"],
        max_results=100,
    )
    return {"items": _map_issue_rows(issues)}


def _map_issue_rows(issues: list[dict]) -> list[dict]:
    base = _base_url()
    out = []
    for i in issues:
        f = i["fields"]
        out.append({
            "key": i["key"],
            "summary": f["summary"],
            "status": f["status"]["name"],
            "type": f["issuetype"]["name"],
            "priority": (f.get("priority") or {}).get("name", "—"),
            "assignee": (f.get("assignee") or {}).get("displayName", "Sin asignar"),
            "assignee_id": (f.get("assignee") or {}).get("accountId"),
            "subtask_count": len(f.get("subtasks") or []),
            "url": f"{base}/browse/{i['key']}",
        })
    return out


# ---------- Auto Docs (state persistido en Supabase) ----------
class AutoDocsBody(BaseModel):
    enable_postmortem: bool = True
    enable_runbook: bool = True
    enable_adr: bool = True
    dry_run: bool = False


@router.get("/auto-docs/state")
def auto_docs_state(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    return jira_flow_db.get_state()


@router.post("/auto-docs/reset")
def auto_docs_reset(user: Annotated[dict, Depends(current_user)]) -> dict:
    _guard(user)
    jira_flow_db.reset_state()
    return {"ok": True}


@router.post("/auto-docs/run")
def auto_docs_run(
    body: AutoDocsBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    state = jira_flow_db.get_state()
    try:
        result = docs.run_polling_cycle(
            since_iso=state.get("last_run_iso"),
            enable_postmortem=body.enable_postmortem,
            enable_runbook=body.enable_runbook,
            enable_adr=body.enable_adr,
            dry_run=body.dry_run,
            processed_keys=set(state.get("processed_keys") or []),
        )
        if not body.dry_run and not result.get("error"):
            jira_flow_db.save_state(
                last_run_iso=result.get("now"),
                processed_keys=result.get("processed_keys", []),
                last_results=result.get("results", []),
            )
        return result
    except Exception as e:
        raise HTTPException(502, str(e))


# ---------- Upload files (multimodal Gemini + adjuntos diferidos) ----------
class FileProcessResp(BaseModel):
    """Resultado de procesar archivos. Cada attachment vuelve base64 para
    que el frontend lo guarde en memoria y lo reenvíe al endpoint /itdev/create
    o /llm/propose-batch sin necesitar storage temporal en el backend."""
    images: list[dict] = Field(default_factory=list)
    pdfs: list[dict] = Field(default_factory=list)
    texts: list[dict] = Field(default_factory=list)
    all_attachments: list[dict] = Field(default_factory=list)


@router.post("/files/process", response_model=FileProcessResp)
async def files_process(
    user: Annotated[dict, Depends(current_user)],
    files: list[UploadFile] = File(...),
) -> FileProcessResp:
    _guard(user)
    items: list[dict] = []
    for f in files:
        data = await f.read()
        items.append({"name": f.filename, "mime": f.content_type, "bytes": data})
    processed = fctx.process_files(items)
    return FileProcessResp(
        images=[
            {"name": next((n for (b, m, n) in processed["all_attachments"] if b == d and mi == m), "image"),
             "mime": mi, "bytes_b64": base64.b64encode(d).decode("ascii")}
            for d, mi in processed["images_for_gemini"]
        ],
        pdfs=[
            {"name": n, "mime": mi, "bytes_b64": base64.b64encode(d).decode("ascii")}
            for d, mi, n in processed["pdfs_for_gemini"]
        ],
        texts=[{"name": n, "text": t} for n, t in processed["extracted_texts"]],
        all_attachments=[
            {"name": n, "mime": mi, "bytes_b64": base64.b64encode(d).decode("ascii")}
            for d, mi, n in processed["all_attachments"]
        ],
    )


# ---------- Propose batch con archivos (multimodal) ----------
class ProposeBatchWithFilesBody(BaseModel):
    context: str = Field(min_length=1)
    extra_instructions: str = ""
    include_situ_open: bool = True
    images: list[dict] = Field(default_factory=list)  # [{name, mime, bytes_b64}]
    pdfs: list[dict] = Field(default_factory=list)
    extracted_texts: list[dict] = Field(default_factory=list)  # [{name, text}]


@router.post("/llm/propose-batch-with-files")
def propose_batch_with_files(
    body: ProposeBatchWithFilesBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(400, "GEMINI_API_KEY no está configurado")

    # SITU open
    situ_open = []
    if body.include_situ_open:
        try:
            issues = jira.search(
                f'project = {_situ_key()} AND statusCategory != Done ORDER BY created DESC',
                fields=["summary", "issuelinks"],
                max_results=80,
            )
            itdev_prefix = f"{_itdev_key()}-"
            for i in issues:
                has_itdev = any(
                    (link.get("outwardIssue") or link.get("inwardIssue") or {}).get("key", "").startswith(itdev_prefix)
                    for link in (i["fields"].get("issuelinks") or [])
                )
                if not has_itdev:
                    situ_open.append({"key": i["key"], "summary": i["fields"]["summary"]})
        except Exception:
            pass

    images = [(base64.b64decode(im["bytes_b64"]), im["mime"]) for im in body.images]
    pdfs = [(base64.b64decode(p["bytes_b64"]), p["mime"], p["name"]) for p in body.pdfs]

    enriched = body.context
    if body.extracted_texts:
        enriched += "\n\n---\nARCHIVOS DE CONTEXTO (texto extraído):\n"
        for t in body.extracted_texts:
            enriched += f"\n### 📎 {t['name']}\n{(t.get('text','') or '')[:8000]}\n"
    try:
        return llm.propose_batch(enriched, situ_open, body.extra_instructions, images=images or None, pdfs=pdfs or None)
    except Exception as e:
        raise HTTPException(502, str(e))


# ---------- Propose from SITU con archivos ----------
class ProposeFromSituWithFilesBody(BaseModel):
    situ_key: str
    extra_instructions: str = ""
    confluence_page_ids: list[str] = Field(default_factory=list)
    images: list[dict] = Field(default_factory=list)
    pdfs: list[dict] = Field(default_factory=list)
    extracted_texts: list[dict] = Field(default_factory=list)


@router.post("/llm/propose-from-situ-with-files")
def propose_from_situ_with_files(
    body: ProposeFromSituWithFilesBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(400, "GEMINI_API_KEY no está configurado")
    try:
        issue = jira.get_issue(body.situ_key)
        desc = jira.adf_to_text(issue["fields"].get("description"))
        comments = jira.get_comments(body.situ_key)
        attachments = [
            {"id": a.get("id"), "filename": a.get("filename"), "size": a.get("size"),
             "mimeType": a.get("mimeType"), "content": a.get("content")}
            for a in (issue["fields"].get("attachment") or [])
        ]
        cf_pages = []
        for pid in body.confluence_page_ids[:5]:
            try:
                p = conf.get_page(pid)
                cf_pages.append({
                    "title": p.get("title", ""),
                    "url": conf.page_url(p),
                    "body": conf.page_body_text(p)[:2000],
                })
            except Exception:
                pass
        images = [(base64.b64decode(im["bytes_b64"]), im["mime"]) for im in body.images]
        pdfs = [(base64.b64decode(p["bytes_b64"]), p["mime"], p["name"]) for p in body.pdfs]
        extracted = [(t["name"], t.get("text", "")) for t in body.extracted_texts]
        prop = llm.propose_itdev_from_situ(
            body.situ_key, issue["fields"]["summary"], desc,
            body.extra_instructions, comments=comments,
            attachments=attachments, confluence_pages=cf_pages,
            images=images or None, pdfs=pdfs or None,
            extracted_texts=extracted or None,
        )
        return {"propuesta": prop}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))


# ---------- Teams notify (Highest priority) ----------
class TeamsNotifyBody(BaseModel):
    issue_key: str
    title: str
    assignee_name: str = "Sin asignar"
    priority: str = "Highest"
    issue_type: str = "Task"
    extra_facts: list[dict] = Field(default_factory=list)


@router.post("/teams/notify-urgent")
def teams_notify_urgent(
    body: TeamsNotifyBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _guard(user)
    if not os.getenv("TEAMS_WEBHOOK_URL"):
        raise HTTPException(400, "TEAMS_WEBHOOK_URL no configurado")
    try:
        teams.notify_urgent_ticket(
            issue_key=body.issue_key,
            title=body.title,
            assignee_name=body.assignee_name,
            priority=body.priority,
            issue_type=body.issue_type,
            issue_url=f"{_base_url()}/browse/{body.issue_key}",
            extra_facts=body.extra_facts,
        )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(502, str(e))


# ---------- Adjuntar archivos a ITDEV (post-creación) ----------
@router.post("/itdev/{issue_key}/attach")
async def attach_files(
    issue_key: str,
    user: Annotated[dict, Depends(current_user)],
    files: list[UploadFile] = File(...),
) -> dict:
    _guard(user)
    uploaded = []
    warnings = []
    for f in files:
        data = await f.read()
        try:
            jira.add_attachment(issue_key, data, f.filename, f.content_type or "application/octet-stream")
            uploaded.append(f.filename)
        except Exception as e:
            warnings.append(f"No pude adjuntar {f.filename}: {e}")
    return {"ok": True, "uploaded": uploaded, "warnings": warnings}

"""Wrapper REST API Atlassian Cloud para SITU + ITDEV."""
import os
import re
import requests
from requests.auth import HTTPBasicAuth
from functools import lru_cache


def _base() -> str:
    return os.getenv("JIRA_BASE_URL", "").rstrip("/")


def _auth() -> HTTPBasicAuth:
    return HTTPBasicAuth(os.getenv("JIRA_EMAIL", ""), os.getenv("JIRA_API_TOKEN", ""))


HEADERS = {"Accept": "application/json", "Content-Type": "application/json"}


def _api(path: str) -> str:
    return f"{_base()}/rest/api/3{path}"


def _agile(path: str) -> str:
    return f"{_base()}/rest/agile/1.0{path}"


def myself():
    r = requests.get(_api("/myself"), auth=_auth(), headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def search(jql: str, fields: list[str] | None = None, max_results: int = 50):
    payload = {"jql": jql, "maxResults": max_results}
    if fields:
        payload["fields"] = fields
    r = requests.post(_api("/search/jql"), auth=_auth(), headers=HEADERS, json=payload, timeout=30)
    r.raise_for_status()
    return r.json().get("issues", [])


def get_issue(key: str):
    r = requests.get(_api(f"/issue/{key}"), auth=_auth(), headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


@lru_cache(maxsize=8)
def get_create_meta(project_key: str):
    params = {"projectKeys": project_key, "expand": "projects.issuetypes.fields"}
    r = requests.get(_api("/issue/createmeta"), auth=_auth(), headers=HEADERS, params=params, timeout=20)
    r.raise_for_status()
    return r.json()


@lru_cache(maxsize=8)
def get_project(project_key: str):
    r = requests.get(_api(f"/project/{project_key}"), auth=_auth(), headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def get_assignable_users(project_key: str, query: str = ""):
    params = {"project": project_key, "query": query, "maxResults": 50}
    r = requests.get(_api("/user/assignable/search"), auth=_auth(), headers=HEADERS, params=params, timeout=15)
    r.raise_for_status()
    return r.json()


def get_epics(project_key: str):
    jql = f'project = {project_key} AND issuetype = Epic AND statusCategory != Done ORDER BY created DESC'
    return search(jql, fields=["summary", "status"], max_results=50)


def assign_issue(issue_key: str, account_id: str | None):
    payload = {"accountId": account_id}
    r = requests.put(_api(f"/issue/{issue_key}/assignee"), auth=_auth(), headers=HEADERS, json=payload, timeout=15)
    r.raise_for_status()
    return True


def add_labels(issue_key: str, labels: list[str]):
    payload = {"update": {"labels": [{"add": l} for l in labels]}}
    r = requests.put(_api(f"/issue/{issue_key}"), auth=_auth(), headers=HEADERS, json=payload, timeout=15)
    r.raise_for_status()
    return True


def link_issues(inward_key: str, outward_key: str, link_type: str = "Relates"):
    payload = {
        "type": {"name": link_type},
        "inwardIssue": {"key": inward_key},
        "outwardIssue": {"key": outward_key},
    }
    r = requests.post(_api("/issueLink"), auth=_auth(), headers=HEADERS, json=payload, timeout=15)
    r.raise_for_status()
    return True


def get_issue_link_types():
    r = requests.get(_api("/issueLinkType"), auth=_auth(), headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json().get("issueLinkTypes", [])


def _inline_marks(text: str) -> list[dict]:
    nodes = []
    pattern = re.compile(r"(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)")
    pos = 0
    for m in pattern.finditer(text):
        if m.start() > pos:
            nodes.append({"type": "text", "text": text[pos:m.start()]})
        if m.group(2) is not None:
            nodes.append({"type": "text", "text": m.group(2), "marks": [{"type": "strong"}]})
        elif m.group(3) is not None:
            nodes.append({"type": "text", "text": m.group(3), "marks": [{"type": "code"}]})
        elif m.group(4) is not None:
            nodes.append({"type": "text", "text": m.group(4), "marks": [{"type": "em"}]})
        pos = m.end()
    if pos < len(text):
        nodes.append({"type": "text", "text": text[pos:]})
    return nodes or [{"type": "text", "text": text}]


def _markdown_to_adf(md: str) -> dict:
    content = []
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped == "---":
            content.append({"type": "rule"})
            i += 1
            continue
        if stripped.startswith("### "):
            content.append({"type": "heading", "attrs": {"level": 3}, "content": _inline_marks(stripped[4:])})
            i += 1
            continue
        if stripped.startswith("## "):
            content.append({"type": "heading", "attrs": {"level": 2}, "content": _inline_marks(stripped[3:])})
            i += 1
            continue
        if stripped.startswith("# "):
            content.append({"type": "heading", "attrs": {"level": 1}, "content": _inline_marks(stripped[2:])})
            i += 1
            continue
        if stripped.startswith(("- ", "* ")):
            items = []
            while i < len(lines) and lines[i].strip().startswith(("- ", "* ")):
                item_text = lines[i].strip()[2:]
                items.append({"type": "listItem", "content": [{"type": "paragraph", "content": _inline_marks(item_text)}]})
                i += 1
            content.append({"type": "bulletList", "content": items})
            continue
        ord_match = re.match(r"^(\d+)\.\s+(.+)$", stripped)
        if ord_match:
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s+", lines[i].strip()):
                item_text = re.match(r"^\d+\.\s+(.+)$", lines[i].strip()).group(1)
                items.append({"type": "listItem", "content": [{"type": "paragraph", "content": _inline_marks(item_text)}]})
                i += 1
            content.append({"type": "orderedList", "content": items})
            continue
        para_lines = [stripped]
        i += 1
        while i < len(lines):
            nxt = lines[i].strip()
            if not nxt or nxt.startswith(("# ", "## ", "### ", "- ", "* ", "---")) or re.match(r"^\d+\.\s+", nxt):
                break
            para_lines.append(nxt)
            i += 1
        content.append({"type": "paragraph", "content": _inline_marks(" ".join(para_lines))})
    return {"type": "doc", "version": 1, "content": content or [{"type": "paragraph"}]}


def _adf_paragraph(text: str) -> dict:
    return _markdown_to_adf(text)


def create_issue(
    project_key: str,
    summary: str,
    description: str = "",
    issue_type: str = "Task",
    labels: list[str] | None = None,
    assignee_account_id: str | None = None,
    epic_key: str | None = None,
    priority: str | None = None,
):
    fields = {
        "project": {"key": project_key},
        "summary": summary,
        "issuetype": {"name": issue_type},
    }
    if description:
        fields["description"] = _adf_paragraph(description)
    if labels:
        fields["labels"] = labels
    if assignee_account_id:
        fields["assignee"] = {"accountId": assignee_account_id}
    if priority:
        fields["priority"] = {"name": priority}
    if epic_key:
        fields["parent"] = {"key": epic_key}
    r = requests.post(_api("/issue"), auth=_auth(), headers=HEADERS, json={"fields": fields}, timeout=20)
    if not r.ok:
        raise RuntimeError(f"Error creando issue: {r.status_code} {r.text}")
    return r.json()


def create_subtask(parent_key: str, summary: str, description: str = "",
                   issue_type: str = "Subtarea", assignee_account_id: str | None = None,
                   priority: str | None = None, labels: list[str] | None = None) -> dict:
    project_key = parent_key.split("-")[0]
    fields = {
        "project": {"key": project_key},
        "summary": summary,
        "issuetype": {"name": issue_type},
        "parent": {"key": parent_key},
    }
    if description:
        fields["description"] = _adf_paragraph(description)
    if assignee_account_id:
        fields["assignee"] = {"accountId": assignee_account_id}
    if priority:
        fields["priority"] = {"name": priority}
    if labels:
        fields["labels"] = labels
    r = requests.post(_api("/issue"), auth=_auth(), headers=HEADERS, json={"fields": fields}, timeout=20)
    if not r.ok:
        raise RuntimeError(f"Error creando sub-task: {r.status_code} {r.text}")
    return r.json()


def update_issue(issue_key: str, fields: dict):
    r = requests.put(_api(f"/issue/{issue_key}"), auth=_auth(), headers=HEADERS, json={"fields": fields}, timeout=15)
    r.raise_for_status()
    return True


def get_transitions(issue_key: str):
    r = requests.get(_api(f"/issue/{issue_key}/transitions"), auth=_auth(), headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json().get("transitions", [])


def transition_issue(issue_key: str, transition_id: str):
    payload = {"transition": {"id": transition_id}}
    r = requests.post(_api(f"/issue/{issue_key}/transitions"), auth=_auth(), headers=HEADERS, json=payload, timeout=15)
    r.raise_for_status()
    return True


def adf_to_text(adf: dict | None) -> str:
    if not adf or not isinstance(adf, dict):
        return ""
    parts = []
    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "text" and "text" in node:
                parts.append(node["text"])
            for child in node.get("content", []) or []:
                walk(child)
            if node.get("type") in ("paragraph", "heading", "listItem"):
                parts.append("\n")
        elif isinstance(node, list):
            for n in node:
                walk(n)
    walk(adf)
    return "".join(parts).strip()


def get_comments(issue_key: str) -> list[dict]:
    r = requests.get(_api(f"/issue/{issue_key}/comment"), auth=_auth(), headers=HEADERS, timeout=15)
    r.raise_for_status()
    out = []
    for c in r.json().get("comments", []):
        out.append({
            "author": (c.get("author") or {}).get("displayName", "?"),
            "created": c.get("created", "")[:19],
            "body": adf_to_text(c.get("body")),
        })
    return out


def get_attachments(issue_key: str) -> list[dict]:
    issue = get_issue(issue_key)
    atts = issue["fields"].get("attachment", []) or []
    return [
        {"id": a.get("id"), "filename": a.get("filename"), "size": a.get("size"),
         "mimeType": a.get("mimeType"), "content": a.get("content")}
        for a in atts
    ]


def download_attachment(content_url: str) -> bytes:
    r = requests.get(content_url, auth=_auth(), timeout=60)
    r.raise_for_status()
    return r.content


def upload_attachment(issue_key: str, filename: str, data: bytes, mime_type: str = "application/octet-stream"):
    headers = {"Accept": "application/json", "X-Atlassian-Token": "no-check"}
    files = {"file": (filename, data, mime_type)}
    r = requests.post(_api(f"/issue/{issue_key}/attachments"), auth=_auth(), headers=headers, files=files, timeout=120)
    r.raise_for_status()
    return r.json()


def notify_issue(issue_key: str, subject: str, text_body: str, notify_assignee: bool = True) -> bool:
    if not notify_assignee:
        return True
    issue = get_issue(issue_key)
    assignee = (issue.get("fields") or {}).get("assignee") or {}
    account_id = assignee.get("accountId")
    display_name = assignee.get("displayName", "")
    if not account_id:
        return False
    paragraphs = [
        {"type": "paragraph", "content": [
            {"type": "mention", "attrs": {"id": account_id, "text": f"@{display_name}"}},
            {"type": "text", "text": " " + subject},
        ]},
    ]
    for line in (text_body or "").split("\n"):
        if line.strip():
            paragraphs.append({"type": "paragraph", "content": [{"type": "text", "text": line}]})
        else:
            paragraphs.append({"type": "paragraph"})
    body_adf = {"type": "doc", "version": 1, "content": paragraphs}
    payload = {"body": body_adf}
    r = requests.post(_api(f"/issue/{issue_key}/comment"), auth=_auth(), headers=HEADERS, json=payload, timeout=15)
    r.raise_for_status()
    return True


def add_remote_link(issue_key: str, url: str, title: str, icon_url: str | None = None) -> dict:
    obj = {"url": url, "title": title}
    if icon_url:
        obj["icon"] = {"url16x16": icon_url, "title": "Confluence"}
    payload = {"object": obj}
    r = requests.post(_api(f"/issue/{issue_key}/remotelink"), auth=_auth(), headers=HEADERS, json=payload, timeout=15)
    r.raise_for_status()
    return r.json()


def get_recently_closed(project_key: str, since_iso: str | None = None, max_results: int = 50) -> list[dict]:
    base_jql = f'project = {project_key} AND statusCategory = Done'
    if since_iso:
        base_jql += f' AND status changed to Done after "{since_iso}"'
    jql = base_jql + " ORDER BY resolved DESC, updated DESC"
    return search(
        jql,
        fields=["summary", "status", "assignee", "issuetype", "parent", "labels",
                "priority", "resolutiondate", "issuelinks", "subtasks", "description"],
        max_results=max_results,
    )


def get_subtasks(parent_key: str) -> list[dict]:
    return search(f'parent = {parent_key}', fields=["summary", "status", "assignee"], max_results=50)


def get_labels(max_results: int = 1000) -> list[str]:
    params = {"maxResults": max_results}
    r = requests.get(_api("/label"), auth=_auth(), headers=HEADERS, params=params, timeout=20)
    r.raise_for_status()
    return r.json().get("values", [])


def get_sprints(board_id: int | str, state: str = "active,future"):
    params = {"state": state}
    r = requests.get(_agile(f"/board/{board_id}/sprint"), auth=_auth(), headers=HEADERS, params=params, timeout=20)
    r.raise_for_status()
    return r.json().get("values", [])


def get_active_sprint(board_id: int | str):
    sprints = get_sprints(board_id, state="active")
    return sprints[0] if sprints else None


def move_issues_to_sprint(sprint_id: int, issue_keys: list[str]):
    payload = {"issues": issue_keys}
    r = requests.post(_agile(f"/sprint/{sprint_id}/issue"), auth=_auth(), headers=HEADERS, json=payload, timeout=20)
    r.raise_for_status()
    return True


def add_attachment(issue_key: str, file_bytes: bytes, filename: str, mime_type: str = "application/octet-stream") -> dict:
    headers = {"X-Atlassian-Token": "no-check", "Accept": "application/json"}
    files = {"file": (filename, file_bytes, mime_type)}
    r = requests.post(_api(f"/issue/{issue_key}/attachments"), auth=_auth(), headers=headers, files=files, timeout=60)
    if not r.ok:
        raise RuntimeError(f"Error subiendo adjunto: {r.status_code} {r.text}")
    return r.json()


def add_comment(issue_key: str, text: str):
    payload = {"body": _adf_paragraph(text)}
    r = requests.post(_api(f"/issue/{issue_key}/comment"), auth=_auth(), headers=HEADERS, json=payload, timeout=15)
    r.raise_for_status()
    return r.json()

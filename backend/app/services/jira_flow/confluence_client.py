"""Wrapper REST API Confluence Cloud."""
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


def _v2(path: str) -> str:
    return f"{_base()}/wiki/api/v2{path}"


def _v1(path: str) -> str:
    return f"{_base()}/wiki/rest/api{path}"


def myself():
    r = requests.get(_v1("/user/current"), auth=_auth(), headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


@lru_cache(maxsize=1)
def list_spaces() -> list[dict]:
    spaces = []
    cursor = None
    while True:
        params = {"limit": 100}
        if cursor:
            params["cursor"] = cursor
        r = requests.get(_v2("/spaces"), auth=_auth(), headers=HEADERS, params=params, timeout=20)
        r.raise_for_status()
        data = r.json()
        spaces.extend(data.get("results", []))
        next_link = data.get("_links", {}).get("next")
        if not next_link:
            break
        if "cursor=" in next_link:
            cursor = next_link.split("cursor=")[1].split("&")[0]
        else:
            break
    return spaces


def search_pages(query: str, space_key: str | None = None, limit: int = 25) -> list[dict]:
    cql_parts = ['type = "page"']
    if query.strip():
        q = query.replace('"', '\\"')
        cql_parts.append(f'(title ~ "{q}" OR text ~ "{q}")')
    if space_key:
        cql_parts.append(f'space = "{space_key}"')
    cql = " AND ".join(cql_parts) + " ORDER BY lastmodified DESC"
    params = {"cql": cql, "limit": limit}
    r = requests.get(_v1("/search"), auth=_auth(), headers=HEADERS, params=params, timeout=20)
    r.raise_for_status()
    out = []
    base = _base()
    for item in r.json().get("results", []):
        content = item.get("content", {})
        out.append({
            "id": content.get("id", ""),
            "title": item.get("title") or content.get("title", ""),
            "url": f"{base}/wiki" + (item.get("url") or ""),
            "excerpt": item.get("excerpt", ""),
            "space": (content.get("space") or {}).get("name", ""),
            "space_key": (content.get("space") or {}).get("key", ""),
            "lastModified": item.get("lastModified", ""),
        })
    return out


def get_page(page_id: str, with_body: bool = True) -> dict:
    params = {}
    if with_body:
        params["body-format"] = "storage"
    r = requests.get(_v2(f"/pages/{page_id}"), auth=_auth(), headers=HEADERS, params=params, timeout=20)
    r.raise_for_status()
    return r.json()


def page_body_text(page: dict) -> str:
    storage = (page.get("body") or {}).get("storage") or {}
    raw = storage.get("value", "") or ""
    text = re.sub(r"<[^>]+>", " ", raw)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def recent_pages(space_key: str | None = None, limit: int = 20) -> list[dict]:
    cql_parts = ['type = "page"']
    if space_key:
        cql_parts.append(f'space = "{space_key}"')
    cql = " AND ".join(cql_parts) + " ORDER BY lastmodified DESC"
    params = {"cql": cql, "limit": limit}
    r = requests.get(_v1("/search"), auth=_auth(), headers=HEADERS, params=params, timeout=20)
    r.raise_for_status()
    out = []
    base = _base()
    for item in r.json().get("results", []):
        content = item.get("content", {})
        out.append({
            "id": content.get("id", ""),
            "title": item.get("title") or content.get("title", ""),
            "url": f"{base}/wiki" + (item.get("url") or ""),
            "space": (content.get("space") or {}).get("name", ""),
            "lastModified": item.get("lastModified", ""),
        })
    return out


def _markdown_to_storage(md: str) -> str:
    out = []
    lines = md.splitlines()
    i = 0

    def inline(text: str) -> str:
        text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
        text = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", text)
        return text

    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped == "---":
            out.append("<hr/>")
            i += 1
            continue
        if stripped.startswith("### "):
            out.append(f"<h3>{inline(stripped[4:])}</h3>")
            i += 1
            continue
        if stripped.startswith("## "):
            out.append(f"<h2>{inline(stripped[3:])}</h2>")
            i += 1
            continue
        if stripped.startswith("# "):
            out.append(f"<h1>{inline(stripped[2:])}</h1>")
            i += 1
            continue
        if stripped.startswith(("- ", "* ")):
            items = []
            while i < len(lines) and lines[i].strip().startswith(("- ", "* ")):
                items.append(f"<li>{inline(lines[i].strip()[2:])}</li>")
                i += 1
            out.append("<ul>" + "".join(items) + "</ul>")
            continue
        ord_match = re.match(r"^\d+\.\s+", stripped)
        if ord_match:
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s+", lines[i].strip()):
                txt = re.match(r"^\d+\.\s+(.+)$", lines[i].strip()).group(1)
                items.append(f"<li>{inline(txt)}</li>")
                i += 1
            out.append("<ol>" + "".join(items) + "</ol>")
            continue
        para = [stripped]
        i += 1
        while i < len(lines):
            nxt = lines[i].strip()
            if not nxt or nxt.startswith(("# ", "## ", "### ", "- ", "* ", "---")) or re.match(r"^\d+\.\s+", nxt):
                break
            para.append(nxt)
            i += 1
        out.append(f"<p>{inline(' '.join(para))}</p>")
    return "\n".join(out)


def find_page_by_title(space_id: str, title: str, parent_id: str | None = None) -> dict | None:
    params = {"limit": 25, "title": title, "space-id": space_id}
    if parent_id:
        params["parent-id"] = parent_id
    r = requests.get(_v2("/pages"), auth=_auth(), headers=HEADERS, params=params, timeout=20)
    r.raise_for_status()
    for p in r.json().get("results", []):
        if p.get("title") == title:
            if parent_id and str(p.get("parentId")) != str(parent_id):
                continue
            return p
    return None


def get_or_create_page(space_id: str, title: str, body_markdown: str = "", parent_id: str | None = None) -> dict:
    existing = find_page_by_title(space_id, title, parent_id)
    if existing:
        return existing
    return create_page(space_id, title, body_markdown or f"# {title}\n", parent_id)


def find_or_create_path(space_id: str, path: list[str], root_body: str = "") -> str:
    parent_id = None
    for i, title in enumerate(path):
        body = root_body if (i == 0 and root_body) else f"# {title}\n\n_Página índice generada automáticamente._"
        page = get_or_create_page(space_id, title, body, parent_id)
        parent_id = str(page.get("id"))
    return parent_id


def get_page_version(page_id: str) -> int:
    r = requests.get(_v2(f"/pages/{page_id}"), auth=_auth(), headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json().get("version", {}).get("number", 1)


def update_page(page_id: str, title: str, body_markdown: str, version_increment: bool = True) -> dict:
    current_version = get_page_version(page_id)
    storage = _markdown_to_storage(body_markdown)
    payload = {
        "id": page_id,
        "status": "current",
        "title": title,
        "body": {"representation": "storage", "value": storage},
        "version": {"number": current_version + 1 if version_increment else current_version},
    }
    r = requests.put(_v2(f"/pages/{page_id}"), auth=_auth(), headers=HEADERS, json=payload, timeout=30)
    if not r.ok:
        raise RuntimeError(f"Error update página: {r.status_code} {r.text}")
    return r.json()


def append_to_page(page_id: str, additional_markdown: str) -> dict:
    page = get_page(page_id, with_body=True)
    title = page.get("title", "")
    current_storage = (page.get("body") or {}).get("storage", {}).get("value", "")
    new_storage = current_storage + "\n" + _markdown_to_storage(additional_markdown)
    current_version = page.get("version", {}).get("number", 1)
    payload = {
        "id": page_id,
        "status": "current",
        "title": title,
        "body": {"representation": "storage", "value": new_storage},
        "version": {"number": current_version + 1},
    }
    r = requests.put(_v2(f"/pages/{page_id}"), auth=_auth(), headers=HEADERS, json=payload, timeout=30)
    if not r.ok:
        raise RuntimeError(f"Error append página: {r.status_code} {r.text}")
    return r.json()


def get_space_id(space_key: str) -> str | None:
    spaces = list_spaces()
    for s in spaces:
        if s.get("key") == space_key:
            return s.get("id")
    return None


def page_url(page: dict) -> str:
    pid = page.get("id", "")
    sid = page.get("spaceId", "")
    if pid and sid:
        return f"{_base()}/wiki/spaces/{sid}/pages/{pid}"
    return ""


def create_page(space_id: str, title: str, body_markdown: str, parent_id: str | None = None) -> dict:
    storage = _markdown_to_storage(body_markdown)
    payload = {
        "spaceId": space_id,
        "status": "current",
        "title": title,
        "body": {"representation": "storage", "value": storage},
    }
    if parent_id:
        payload["parentId"] = parent_id
    r = requests.post(_v2("/pages"), auth=_auth(), headers=HEADERS, json=payload, timeout=30)
    if not r.ok:
        raise RuntimeError(f"Error creando página: {r.status_code} {r.text}")
    page = r.json()
    page_id = page.get("id", "")
    space_part = page.get("spaceId", "")
    page["webui_url"] = f"{_base()}/wiki/spaces/{space_part}/pages/{page_id}" if page_id else ""
    return page

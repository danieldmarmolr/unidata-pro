"""Cliente Microsoft Teams via Incoming Webhook (MessageCard format)."""
import os
import requests


def _webhook() -> str:
    return os.getenv("TEAMS_WEBHOOK_URL", "")


def send_message_card(
    title: str,
    text: str,
    facts: list[dict] | None = None,
    button_url: str | None = None,
    button_text: str = "Abrir",
    theme_color: str = "0078D4",
    summary: str | None = None,
    webhook_url: str | None = None,
) -> bool:
    url = webhook_url or _webhook()
    if not url:
        raise RuntimeError("Falta TEAMS_WEBHOOK_URL")

    sections = []
    if text:
        sections.append({"text": text, "markdown": True})
    if facts:
        sections.append({"facts": facts})

    card = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        "summary": summary or title,
        "themeColor": theme_color,
        "title": title,
        "sections": sections,
    }
    if button_url:
        card["potentialAction"] = [{
            "@type": "OpenUri",
            "name": button_text,
            "targets": [{"os": "default", "uri": button_url}],
        }]

    r = requests.post(url, json=card, timeout=15)
    if r.status_code not in (200, 202):
        raise RuntimeError(f"Teams webhook devolvió {r.status_code}: {r.text}")
    return True


def notify_urgent_ticket(
    issue_key: str,
    title: str,
    assignee_name: str,
    priority: str,
    issue_type: str,
    issue_url: str,
    extra_facts: list[dict] | None = None,
    webhook_url: str | None = None,
) -> bool:
    facts = [
        {"name": "Prioridad", "value": f"🔥 {priority}"},
        {"name": "Tipo", "value": issue_type},
        {"name": "Asignado", "value": assignee_name or "Sin asignar"},
    ] + (extra_facts or [])

    return send_message_card(
        title=f"🚨 [{issue_key}] {title}",
        text=f"Ticket de **prioridad {priority}** creado y asignado a **{assignee_name or 'Sin asignar'}**.",
        facts=facts,
        button_url=issue_url,
        button_text="Abrir en Jira",
        theme_color="FF0000",
        summary=f"🚨 {priority}: {issue_key}",
        webhook_url=webhook_url,
    )

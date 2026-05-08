"""
Generador de reporte mensual en PDF (reportlab).
Reusa executive_overview + sales_unistore + saas_unidrop para los datos.
"""
from __future__ import annotations

import datetime as dt
import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, PageBreak,
)

from app.services.dashboards import executive_overview
from app.services.sales import sales_unistore
from app.services.saas import saas_unidrop

PRIMARY = colors.HexColor("#7a3eae")
PRIMARY_DARK = colors.HexColor("#21093a")
ACCENT = colors.HexColor("#a259ff")
SOFT = colors.HexColor("#f5f0fb")
TEXT_MUTED = colors.HexColor("#6b7280")
SUCCESS = colors.HexColor("#25d366")
ERROR = colors.HexColor("#fb2c36")
WARN = colors.HexColor("#f59e0b")


def _styles():
    base = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName="Helvetica-Bold",
                             fontSize=20, textColor=PRIMARY_DARK, leading=24, spaceAfter=4),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold",
                             fontSize=14, textColor=PRIMARY, leading=18, spaceAfter=6, spaceBefore=14),
        "tagline": ParagraphStyle("tagline", parent=base["BodyText"], fontName="Helvetica-Oblique",
                                  fontSize=9, textColor=TEXT_MUTED, spaceAfter=10),
        "body": ParagraphStyle("body", parent=base["BodyText"], fontName="Helvetica",
                               fontSize=9, textColor=PRIMARY_DARK, leading=12),
        "muted": ParagraphStyle("muted", parent=base["BodyText"], fontName="Helvetica",
                                fontSize=8, textColor=TEXT_MUTED, leading=10),
        "footer": ParagraphStyle("footer", parent=base["BodyText"], fontName="Helvetica",
                                 fontSize=7, textColor=TEXT_MUTED, alignment=1),
    }


def _fmt_money(v: float | int | str) -> str:
    if isinstance(v, str): return v
    if v is None: return "—"
    return f"$ {v:,.0f}".replace(",", ".")


def _fmt_num(v: float | int | str) -> str:
    if isinstance(v, str): return v
    if v is None: return "—"
    return f"{int(v):,}".replace(",", ".")


def _fmt_card_value(c: dict) -> str:
    v = c.get("value")
    if isinstance(v, str): return f"{c.get('prefix','')}{v}{c.get('suffix','')}"
    if v is None: return "—"
    if c.get("prefix") == "$ ":
        return f"$ {v:,.0f}".replace(",", ".")
    if c.get("suffix") in ("%", " dias"):
        return f"{v}{c['suffix']}"
    return f"{int(v):,}".replace(",", ".") if isinstance(v, (int, float)) else str(v)


def _kpi_table(cards: list[dict], cols: int = 3) -> Table:
    """Grilla de KPI cards."""
    rows = []
    for i in range(0, len(cards), cols):
        row = cards[i:i+cols]
        cells = []
        for c in row:
            label = c.get("label", "")
            value = _fmt_card_value(c)
            delta = c.get("delta")
            hint = c.get("hint", "")
            delta_html = ""
            if delta is not None:
                color = "#25d366" if delta >= 0 else "#fb2c36"
                arrow = "▲" if delta >= 0 else "▼"
                delta_html = f'<font color="{color}" size="8"><b>{arrow} {abs(delta):.1f}%</b></font>'
            cell = (
                f'<para fontSize=8 textColor="#6b7280" spaceAfter=2>{label.upper()}</para>'
                f'<para fontSize=14 textColor="#21093a" spaceBefore=4 spaceAfter=2><b>{value}</b> {delta_html}</para>'
                f'<para fontSize=7 textColor="#9ca3af">{hint or "&nbsp;"}</para>'
            )
            cells.append(Paragraph(cell, getSampleStyleSheet()["BodyText"]))
        # padding hasta cols
        while len(cells) < cols:
            cells.append("")
        rows.append(cells)

    col_w = (A4[0] - 4*cm) / cols
    t = Table(rows, colWidths=[col_w]*cols)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0cff3")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0cff3")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return t


def _section_table(title: str, rows: list[list[str]], col_widths: list[float] | None = None) -> Table:
    """Tabla simple con headers violeta + filas alternadas."""
    if col_widths is None:
        col_widths = [(A4[0] - 4*cm) / len(rows[0])] * len(rows[0])
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
        ("BOX", (0, 0), (-1, -1), 0.5, PRIMARY),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e0cff3")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def build_monthly_report(month: str | None = None) -> bytes:
    """Genera el PDF y devuelve bytes."""
    now = dt.datetime.now(dt.timezone.utc)
    label_month = month or now.strftime("%Y-%m")
    label_human = dt.datetime.strptime(label_month, "%Y-%m").strftime("%B %Y").capitalize()

    exec_data = executive_overview()
    sales_data = sales_unistore("30d", "all")
    saas_data = saas_unidrop("30d", "all")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm,
        title=f"UNIDATA Reporte Ejecutivo {label_month}",
        author="UNIDATA",
    )
    s = _styles()
    story = []

    # ---------- Header ----------
    story.append(Paragraph(f"UNIDATA · Reporte Ejecutivo", s["h1"]))
    story.append(Paragraph(f"{label_human} · grupo Unistore", s["body"]))
    story.append(Paragraph("Convierte datos dispersos en decisiones", s["tagline"]))
    story.append(Spacer(1, 0.4*cm))

    # ---------- Resumen ejecutivo (cross unidad) ----------
    story.append(Paragraph("📊 Resumen ejecutivo", s["h2"]))
    if exec_data.get("cards"):
        story.append(_kpi_table(exec_data["cards"][:6], cols=3))
    story.append(Spacer(1, 0.4*cm))

    # ---------- Alertas ----------
    if exec_data.get("top_alerts"):
        story.append(Paragraph("🚨 Alertas operativas", s["h2"]))
        for alert in exec_data["top_alerts"][:6]:
            story.append(Paragraph(f"• {alert}", s["body"]))
        story.append(Spacer(1, 0.3*cm))

    # ---------- Salud de integraciones ----------
    if exec_data.get("integration_health"):
        story.append(Paragraph("⚙️ Salud de integraciones", s["h2"]))
        rows = [["Integracion", "Unidad", "Ultima actividad", "Estado"]]
        for it in exec_data["integration_health"]:
            status = it.get("status", "?")
            status_label = {"ok": "OK", "warn": "Lento", "error": "Sin sync"}.get(status, status)
            days = it.get("days_since_last")
            last = f"hace {days}d" if days is not None else "—"
            rows.append([it["name"], it["unit"], last, status_label])
        story.append(_section_table("Salud", rows, col_widths=[6.5*cm, 2.5*cm, 4*cm, 4*cm]))
        story.append(Spacer(1, 0.4*cm))

    story.append(PageBreak())

    # ---------- VENTAS UNISTORE ----------
    story.append(Paragraph("📈 Ventas Unistore (ultimos 30 dias)", s["h2"]))
    if sales_data.get("cards"):
        story.append(_kpi_table(sales_data["cards"], cols=3))
    story.append(Spacer(1, 0.3*cm))

    # Top productos
    if sales_data.get("top_products"):
        story.append(Paragraph("Top 10 productos vendidos", s["h2"]))
        rows = [["#", "Producto", "Unid.", "Ord.", "Revenue"]]
        for i, p in enumerate(sales_data["top_products"][:10], 1):
            rows.append([
                str(i), str(p["name"])[:55], _fmt_num(p["units"]),
                _fmt_num(p["orders"]), _fmt_money(p["revenue"]),
            ])
        story.append(_section_table("Top productos", rows,
                                    col_widths=[1*cm, 9*cm, 2*cm, 2*cm, 3*cm]))
        story.append(Spacer(1, 0.3*cm))

    # Top provincias
    if sales_data.get("top_provinces"):
        story.append(Paragraph("Top provincias por revenue", s["h2"]))
        rows = [["Provincia", "Ordenes", "Revenue"]]
        for p in sales_data["top_provinces"][:10]:
            orders = (p.get("extra") or {}).get("orders", 0)
            rows.append([p["category"], _fmt_num(orders), _fmt_money(p["value"])])
        story.append(_section_table("Provincias", rows,
                                    col_widths=[8*cm, 4*cm, 5*cm]))

    story.append(PageBreak())

    # ---------- SaaS UNIDROP ----------
    story.append(Paragraph("🛍️ SaaS Metrics Unidrop (ultimos 30 dias)", s["h2"]))
    if saas_data.get("cards"):
        story.append(_kpi_table(saas_data["cards"], cols=3))
    story.append(Spacer(1, 0.3*cm))

    # Funnel
    if saas_data.get("funnel"):
        story.append(Paragraph("Funnel de activacion", s["h2"]))
        rows = [["Etapa", "Usuarios", "% del total"]]
        total = saas_data["funnel"][0]["value"] if saas_data["funnel"] else 0
        for f in saas_data["funnel"]:
            pct = (f["value"] / total * 100) if total else 0
            rows.append([f["category"], _fmt_num(f["value"]), f"{pct:.1f}%"])
        story.append(_section_table("Funnel", rows,
                                    col_widths=[8*cm, 4*cm, 5*cm]))
        story.append(Spacer(1, 0.3*cm))

    # Top users por revenue
    if saas_data.get("top_users"):
        story.append(Paragraph("Top usuarios por volumen procesado", s["h2"]))
        rows = [["#", "Usuario", "Ordenes", "Revenue"]]
        for i, u in enumerate(saas_data["top_users"][:10], 1):
            orders = (u.get("extra") or {}).get("orders", 0)
            rows.append([str(i), str(u["category"])[:55], _fmt_num(orders), _fmt_money(u["value"])])
        story.append(_section_table("Top users", rows,
                                    col_widths=[1*cm, 9*cm, 3*cm, 4*cm]))

    # ---------- Footer ----------
    story.append(Spacer(1, 0.6*cm))
    story.append(Paragraph(
        f"Generado el {now.strftime('%d/%m/%Y %H:%M UTC')} · "
        "UNIDATA - Plataforma de datos del grupo Unistore · "
        "Confidencial",
        s["footer"],
    ))

    doc.build(story)
    return buf.getvalue()

"""Prompts del sistema para generación de Historias de Usuario."""

SYSTEM_PROMPT = """Sos un Product Owner asistente para el equipo de IT de Unistore.

Modelo de trabajo del equipo:
- Proyecto SITU = intake (Service Desk). Los SITU son pedidos de CLIENTES EXTERNOS — NO se crean desde esta herramienta, solo nacen cuando un cliente carga su pedido en el portal.
- Proyecto ITDEV = ejecución (SCRUM). EPICs por producto: UNIDROP, UNIFULL, UNISTORE, UNIDEV, UNIDATA, AUTOMATIZACIONES, CAPACITACIÓN CLAUDE.
- Linkeo: ITDEV "is caused by" SITU. Esto activa una automatización en Jira que sincroniza el estado para que el cliente externo vea el progreso de su pedido.

Tu trabajo: dado un contexto, identificás TODAS las acciones/tareas distintas y para cada una generás UNA propuesta de ITDEV. Primero clasificás el TIPO DE ISSUE — esto define la ESTRUCTURA del contenido:

**A) STORY** (feature, desarrollo nuevo, mejora con varias capas)
1. Título: formato `[Área de negocio impactada] Nombre descriptivo`
2. Historia de Usuario (Como/Quiero/Para)
3. 📖 Contexto narrativo (2-4 frases)
4. ✅ Criterios de Aceptación agrupados por área funcional (ej: "Backend", "Frontend", "Automatización n8n")
5. 🛠️ Subtareas por Rol técnico (NO asignar a personas — solo el rol/especialidad)

**B) BUG** (algo que está roto y hay que arreglar)
1. Título: `[Área impactada] Bug: descripción concreta del defecto`
2. 🐛 Comportamiento actual: qué está pasando mal (1-3 frases)
3. ✨ Comportamiento esperado: qué debería pasar (1-3 frases)
4. 🔁 Pasos para reproducir: lista numerada
5. 📍 Módulo / Pantalla afectada: dónde se manifiesta
6. 💡 Fix propuesto / Hipótesis técnica: si surge del contexto, cómo se arregla
7. 🛠️ Subtareas por Rol técnico (NO asignar a personas)

**C) TASK** (acción concreta, operativa, sin lógica de feature)
1. Título: `[Área] Acción concreta`
2. 🎯 Objetivo: 1-2 frases
3. 📋 Pasos a ejecutar: lista
4. ✅ Criterio de done: cómo sabemos que está completo
5. 🛠️ Subtareas por Rol técnico (NO asignar a personas)

⚠️ PRIORIDAD ABSOLUTA — INSTRUCCIONES DEL USUARIO:
Si el usuario envía `INSTRUCCIONES ADICIONALES` en el mensaje, esas reglas tienen PRIORIDAD MÁXIMA sobre cualquier otra regla de este system prompt.

REGLA DE CLASIFICACIÓN:
- Si el SITU/contexto describe algo que NO funciona como debería → **Bug**.
- Si describe trabajo operativo puntual sin desarrollo de feature → **Task**.
- Si describe construir/extender funcionalidad → **Story**.

ÁREAS DE NEGOCIO (NO son productos, eso va en la EPIC):
Logística, Finanzas, Comercial, Producto, Operaciones, Cliente Final, Marketing, Soporte, Inventario, Picking, Suscripciones, Devoluciones, Facturación, Datos/BI, Capacitación, Integraciones.

Roles técnicos para `subtareas_por_rol`: Backend, Frontend, Automatización Python/n8n, Data/DB, Cloud/DevOps, QA, Diseño UX, Producto, Arquitectura, Integraciones API.

REGLA IMPORTANTE de assignees:
- `assignee_sugerido` del ITDEV principal = responsable global del ticket, si surge del contexto.
- `assignee_sugerido` por cada SUBTAREA HIJA (Jira sub-task) = mapeo rol técnico → persona del equipo:
  · Backend / Backend Logística → Ezequiel o Georgina (según el módulo)
  · Frontend → Brian (general) o Emmanuel (Unidev específicamente)
  · Automatización Python/n8n, Scripts, Integraciones API → Daniel
  · Data/DB, Cloud/DevOps, Contabilium → Mauro
  · QA / Documentación / Decisiones de producto → Tomás
  Si la subtarea no encaja claramente con un rol, dejá `assignee_sugerido` igual al del Story padre.

NUNCA proponés crear un SITU. Si no hay SITU, simplemente el ITDEV se crea "huérfano".

Formato de salida: SIEMPRE JSON válido con esta estructura exacta:

{
  "propuestas": [
    {
      "titulo_corto": "etiqueta breve para la UI",
      "responsable_mencionado": "nombre o null",
      "situ_existente_key": "SITU-XXX si matchea uno existente, null si no",
      "needs_itdev": true/false,
      "es_solo_coordinacion": true/false,
      "itdev": {
        "summary": "[Área de negocio] Nombre descriptivo",
        "issue_type": "Story | Task | Bug",
        "epic_sugerida": "UNIDROP | UNIFULL | UNISTORE | UNIDEV | UNIDATA | AUTOMATIZACIONES | CAPACITACIÓN CLAUDE",
        "assignee_sugerido": "nombre del responsable principal o null",
        "prioridad": "Highest | High | Medium | Low",

        "historia_usuario": "Como [rol], Quiero [acción], Para [beneficio].",
        "contexto": "2-4 frases narrativas.",
        "criterios_aceptacion_grupos": [
          {"titulo_grupo": "Ej: Backend", "criterios": ["Criterio 1.", "Criterio 2."]}
        ],

        "bug_comportamiento_actual": "...",
        "bug_comportamiento_esperado": "...",
        "bug_pasos_reproducir": ["Paso 1.", "Paso 2."],
        "bug_modulo_afectado": "...",
        "bug_fix_propuesto": "...",

        "task_objetivo": "...",
        "task_pasos": ["Paso 1.", "Paso 2."],
        "task_criterio_done": ["..."],

        "subtareas_por_rol": [
          {"rol": "Backend", "items": ["Tarea 1.", "Tarea 2."]}
        ],

        "referencias_externas": [
          {"tipo": "DROP", "id": "DROP-42047105-235", "contexto": "Pedido afectado"}
        ],

        "subtareas_hijas": [
          {
            "summary": "[Rol] Descripción concreta",
            "objetivo": "1-2 frases.",
            "contexto": "Por qué.",
            "pasos": ["Paso 1.", "Paso 2."],
            "criterio_done": ["..."],
            "rol_tecnico": "Backend | Frontend | etc",
            "assignee_sugerido": "Daniel | Mauro | etc"
          }
        ]
      },
      "razonamiento": "1 frase: por qué esta EPIC, prioridad, y por qué linkeás (o no) a un SITU existente"
    }
  ],
  "resumen_global": "1-2 frases sobre el batch"
}

Respondé ÚNICAMENTE con el JSON, sin texto antes ni después, sin code fence.
"""


def build_user_message(context: str, situ_open: list[dict] | None = None, extra_instructions: str = "") -> str:
    msg = ""
    if situ_open:
        msg += "SITU ABIERTOS RECIENTES (para detectar matches — NO los crees, solo linkealos):\n"
        for s in situ_open:
            msg += f"- {s['key']}: {s['summary']}\n"
        msg += "\n"
    msg += f"CONTEXTO:\n{context}\n"
    if extra_instructions:
        msg += f"\nINSTRUCCIONES ADICIONALES:\n{extra_instructions}\n"
    msg += "\nGenerá el JSON con TODAS las propuestas de ITDEV identificadas con la estructura rica."
    return msg


def render_description_markdown(itdev: dict, situ_key: str | None = None) -> str:
    parts = []
    itype = (itdev.get("issue_type") or "Story").lower()

    if itype == "bug":
        if itdev.get("bug_comportamiento_actual"):
            parts += ["## 🐛 Comportamiento actual", itdev["bug_comportamiento_actual"].strip(), ""]
        if itdev.get("bug_comportamiento_esperado"):
            parts += ["## ✨ Comportamiento esperado", itdev["bug_comportamiento_esperado"].strip(), ""]
        pasos = itdev.get("bug_pasos_reproducir", []) or []
        if pasos:
            parts.append("## 🔁 Pasos para reproducir")
            for idx, p in enumerate(pasos, 1):
                parts.append(f"{idx}. {p}")
            parts.append("")
        if itdev.get("bug_modulo_afectado"):
            parts += ["## 📍 Módulo / Pantalla afectada", itdev["bug_modulo_afectado"].strip(), ""]
        if itdev.get("bug_fix_propuesto"):
            parts += ["## 💡 Fix propuesto / Hipótesis técnica", itdev["bug_fix_propuesto"].strip(), ""]

    elif itype == "task":
        if itdev.get("task_objetivo"):
            parts += ["## 🎯 Objetivo", itdev["task_objetivo"].strip(), ""]
        pasos = itdev.get("task_pasos", []) or []
        if pasos:
            parts.append("## 📋 Pasos a ejecutar")
            for idx, p in enumerate(pasos, 1):
                parts.append(f"{idx}. {p}")
            parts.append("")
        criterios_done = itdev.get("task_criterio_done", []) or []
        if criterios_done:
            parts.append("## ✅ Criterio de done")
            for c in criterios_done:
                parts.append(f"- {c}")
            parts.append("")

    else:  # Story
        if itdev.get("historia_usuario"):
            parts += [itdev["historia_usuario"].strip(), ""]
        if itdev.get("contexto"):
            parts += ["## 📖 Contexto", itdev["contexto"].strip(), ""]
        grupos = itdev.get("criterios_aceptacion_grupos", []) or []
        if grupos:
            parts.append("## ✅ Criterios de Aceptación")
            parts.append("")
            for g in grupos:
                parts.append(f"### {g.get('titulo_grupo', '')}")
                for c in g.get("criterios", []):
                    parts.append(f"- {c}")
                parts.append("")

    refs = itdev.get("referencias_externas", []) or []
    if refs:
        parts.append("## 🔎 Referencias / IDs mencionados")
        parts.append("")
        for r in refs:
            tipo = r.get("tipo", "")
            rid = r.get("id", "")
            ctx = r.get("contexto", "")
            line = f"- **{tipo}**: `{rid}`" if tipo else f"- `{rid}`"
            if ctx:
                line += f" — {ctx}"
            parts.append(line)
        parts.append("")

    subs = itdev.get("subtareas_por_rol", []) or []
    if subs:
        parts.append("## 🛠️ Subtareas por Rol")
        parts.append("")
        for s in subs:
            rol = s.get("rol") or "Equipo"
            parts.append(f"### [{rol}]")
            for it in s.get("items", []):
                parts.append(f"- {it}")
            parts.append("")

    hijas = itdev.get("subtareas_hijas", []) or []
    if hijas:
        parts.append("## 📋 Subtareas hijas (Jira Sub-tasks)")
        parts.append("")
        for h in hijas:
            parts.append(f"- **{h.get('summary','')}**")
            if h.get("objetivo"):
                parts.append(f"  _{h.get('objetivo')}_")
        parts.append("")

    if situ_key:
        parts += ["---", f"**SITU vinculado:** {situ_key}"]
    parts.append("**Origen:** unidata-jira-flow")
    return "\n".join(parts)


def render_subtask_description(subtask: dict, parent_key: str | None = None) -> str:
    parts = []
    if subtask.get("objetivo"):
        parts += ["## 🎯 Objetivo", subtask["objetivo"].strip(), ""]
    if subtask.get("contexto"):
        parts += ["## 📖 Contexto", subtask["contexto"].strip(), ""]
    pasos = subtask.get("pasos") or []
    if pasos:
        parts.append("## 📋 Pasos a ejecutar")
        for idx, p in enumerate(pasos, 1):
            parts.append(f"{idx}. {p}")
        parts.append("")
    cd = subtask.get("criterio_done") or []
    if cd:
        parts.append("## ✅ Criterio de done")
        for c in cd:
            parts.append(f"- {c}")
        parts.append("")
    if parent_key:
        parts += ["---", f"**Story padre:** {parent_key}"]
    return "\n".join(parts)


def parse_groups_from_textarea(text: str) -> list[dict]:
    grupos = []
    current = None
    for line in text.splitlines():
        line = line.rstrip()
        if not line.strip():
            continue
        if line.lstrip().startswith("##"):
            if current:
                grupos.append(current)
            current = {"titulo_grupo": line.lstrip("# ").strip(), "criterios": []}
        elif line.lstrip().startswith("-") or line.lstrip().startswith("*"):
            if current is None:
                current = {"titulo_grupo": "General", "criterios": []}
            current["criterios"].append(line.lstrip("-* ").strip())
        else:
            if current is None:
                current = {"titulo_grupo": "General", "criterios": []}
            current["criterios"].append(line.strip())
    if current:
        grupos.append(current)
    return grupos


def parse_roles_from_textarea(text: str) -> list[dict]:
    grupos = []
    current = None
    for line in text.splitlines():
        line = line.rstrip()
        if not line.strip():
            continue
        if line.lstrip().startswith("##"):
            if current:
                grupos.append(current)
            header = line.lstrip("# ").strip().strip("[]")
            current = {"rol": header, "items": []}
        elif line.lstrip().startswith("-") or line.lstrip().startswith("*"):
            if current is None:
                current = {"rol": "Equipo", "items": []}
            current["items"].append(line.lstrip("-* ").strip())
    if current:
        grupos.append(current)
    return grupos


def render_groups_to_textarea(grupos: list[dict], item_key: str = "criterios") -> str:
    out = []
    for g in grupos or []:
        if item_key == "criterios":
            out.append(f"## {g.get('titulo_grupo', '')}")
        else:
            rol = g.get("rol", "")
            out.append(f"## [{rol}]")
        for item in g.get(item_key, []):
            out.append(f"- {item}")
        out.append("")
    return "\n".join(out).strip()

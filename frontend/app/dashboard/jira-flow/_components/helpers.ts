import type { ITDEVProposal, ChildSubtask } from "../types";

export function renderGroupsToTextarea(grupos: { titulo_grupo?: string; rol?: string; criterios?: string[]; items?: string[] }[] | undefined, itemKey: "criterios" | "items"): string {
  if (!grupos) return "";
  const out: string[] = [];
  for (const g of grupos) {
    if (itemKey === "criterios") {
      out.push(`## ${g.titulo_grupo ?? ""}`);
    } else {
      out.push(`## [${g.rol ?? ""}]`);
    }
    const items = (g as any)[itemKey] ?? [];
    for (const it of items) out.push(`- ${it}`);
    out.push("");
  }
  return out.join("\n").trim();
}

export function parseGroupsFromTextarea(text: string): { titulo_grupo: string; criterios: string[] }[] {
  const grupos: { titulo_grupo: string; criterios: string[] }[] = [];
  let current: { titulo_grupo: string; criterios: string[] } | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (line.trimStart().startsWith("##")) {
      if (current) grupos.push(current);
      current = { titulo_grupo: line.replace(/^#+\s*/, "").trim(), criterios: [] };
    } else if (line.trimStart().startsWith("-") || line.trimStart().startsWith("*")) {
      if (!current) current = { titulo_grupo: "General", criterios: [] };
      current.criterios.push(line.replace(/^[\s\-*]+/, "").trim());
    } else {
      if (!current) current = { titulo_grupo: "General", criterios: [] };
      current.criterios.push(line.trim());
    }
  }
  if (current) grupos.push(current);
  return grupos;
}

export function parseRolesFromTextarea(text: string): { rol: string; items: string[] }[] {
  const grupos: { rol: string; items: string[] }[] = [];
  let current: { rol: string; items: string[] } | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (line.trimStart().startsWith("##")) {
      if (current) grupos.push(current);
      const header = line.replace(/^#+\s*/, "").trim().replace(/^\[|\]$/g, "");
      current = { rol: header, items: [] };
    } else if (line.trimStart().startsWith("-") || line.trimStart().startsWith("*")) {
      if (!current) current = { rol: "Equipo", items: [] };
      current.items.push(line.replace(/^[\s\-*]+/, "").trim());
    }
  }
  if (current) grupos.push(current);
  return grupos;
}

export function linesToList(text: string): string[] {
  return text.split("\n").map((l) => l.replace(/^[\s\-*]+/, "").trim()).filter(Boolean);
}

export function listToLines(items?: string[]): string {
  return (items || []).map((p) => `- ${p}`).join("\n");
}

export type EditableProposal = ITDEVProposal & {
  _criteriosMd?: string;
  _subtareasRolMd?: string;
  _bugPasosMd?: string;
  _taskPasosMd?: string;
  _taskDoneMd?: string;
  _refsMd?: string;
};

export function toEditable(p: ITDEVProposal): EditableProposal {
  return {
    ...p,
    _criteriosMd: renderGroupsToTextarea(p.criterios_aceptacion_grupos, "criterios"),
    _subtareasRolMd: renderGroupsToTextarea(p.subtareas_por_rol, "items"),
    _bugPasosMd: listToLines(p.bug_pasos_reproducir),
    _taskPasosMd: listToLines(p.task_pasos),
    _taskDoneMd: listToLines(p.task_criterio_done),
    _refsMd: (p.referencias_externas || []).map((r) => `${r.tipo || ""} | ${r.id || ""} | ${r.contexto || ""}`).join("\n"),
  };
}

export function fromEditable(ep: EditableProposal): ITDEVProposal {
  const out: ITDEVProposal = { ...ep };
  delete (out as any)._criteriosMd;
  delete (out as any)._subtareasRolMd;
  delete (out as any)._bugPasosMd;
  delete (out as any)._taskPasosMd;
  delete (out as any)._taskDoneMd;
  delete (out as any)._refsMd;

  if (ep._criteriosMd != null) out.criterios_aceptacion_grupos = parseGroupsFromTextarea(ep._criteriosMd);
  if (ep._subtareasRolMd != null) out.subtareas_por_rol = parseRolesFromTextarea(ep._subtareasRolMd);
  if (ep._bugPasosMd != null) out.bug_pasos_reproducir = linesToList(ep._bugPasosMd);
  if (ep._taskPasosMd != null) out.task_pasos = linesToList(ep._taskPasosMd);
  if (ep._taskDoneMd != null) out.task_criterio_done = linesToList(ep._taskDoneMd);
  if (ep._refsMd != null) {
    out.referencias_externas = ep._refsMd.split("\n").filter((l) => l.trim()).map((line) => {
      const parts = line.split("|").map((x) => x.trim());
      if (parts.length === 1) return { tipo: "", id: parts[0], contexto: "" };
      if (parts.length === 2) return { tipo: parts[0], id: parts[1], contexto: "" };
      return { tipo: parts[0], id: parts[1], contexto: parts.slice(2).join(" | ") };
    });
  }
  return out;
}

export type EditableChildSubtask = ChildSubtask & {
  _pasosMd?: string;
  _doneMd?: string;
  include?: boolean;
  assignee_id?: string | null;
};

export function toEditableChild(c: ChildSubtask): EditableChildSubtask {
  return {
    ...c,
    include: true,
    _pasosMd: listToLines(c.pasos),
    _doneMd: listToLines(c.criterio_done),
  };
}

export function fromEditableChild(c: EditableChildSubtask): ChildSubtask & { assignee_id?: string | null } {
  const out: any = { ...c };
  delete out._pasosMd; delete out._doneMd; delete out.include;
  if (c._pasosMd != null) out.pasos = linesToList(c._pasosMd);
  if (c._doneMd != null) out.criterio_done = linesToList(c._doneMd);
  return out;
}

export function matchAssigneeIdByName(users: { accountId: string; displayName: string }[] | undefined, name?: string | null): string | null {
  if (!name || !users) return null;
  const lc = name.toLowerCase();
  const parts = lc.split(/\s+/).filter(Boolean);
  for (const u of users) {
    const dn = (u.displayName || "").toLowerCase();
    if (parts.some((p) => dn.includes(p))) return u.accountId;
  }
  return null;
}

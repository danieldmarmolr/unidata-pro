export type SprintInfo = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  goal: string;
  days_left: number | null;
} | null;

export type SprintCounters = {
  total: number;
  todo: number;
  in_progress: number;
  done: number;
  progress_pct: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_assignee: Record<string, number>;
  by_epic: Record<string, number>;
};

export type SprintIssue = {
  key: string;
  type: string;
  summary: string;
  epic: string;
  status: string;
  assignee: string;
  priority: string;
  url: string;
};

export type SituOpenItem = {
  key: string;
  summary: string;
  status: string;
  created: string;
  priority: string;
  assignee: string;
  linked_itdev: string[];
};

export type SprintDashboardResp = {
  sprint: SprintInfo;
  counters: SprintCounters;
  issues: SprintIssue[];
  situ: { total: number; unassigned: number; no_itdev: number };
};

export type Epic = { key: string; summary: string; status: string };
export type AssignableUser = { accountId: string; displayName: string; email: string };
export type LinkType = { id: string; name: string; inward: string; outward: string };
export type Sprint = { id: number; name: string; state: string; startDate?: string; endDate?: string };
export type ConfluenceSpace = { id: string; key: string; name: string; type?: string };
export type ConfluencePage = {
  id: string;
  title: string;
  url: string;
  space?: string;
  space_key?: string;
  excerpt?: string;
  lastModified?: string;
};

export type ITDEVProposal = {
  summary: string;
  issue_type: "Story" | "Task" | "Bug";
  epic_sugerida?: string;
  assignee_sugerido?: string;
  prioridad?: "Highest" | "High" | "Medium" | "Low";
  historia_usuario?: string;
  contexto?: string;
  criterios_aceptacion_grupos?: { titulo_grupo: string; criterios: string[] }[];
  bug_comportamiento_actual?: string | null;
  bug_comportamiento_esperado?: string | null;
  bug_pasos_reproducir?: string[];
  bug_modulo_afectado?: string | null;
  bug_fix_propuesto?: string | null;
  task_objetivo?: string | null;
  task_pasos?: string[];
  task_criterio_done?: string[];
  subtareas_por_rol?: { rol: string; items: string[] }[];
  referencias_externas?: { tipo: string; id: string; contexto: string }[];
  subtareas_hijas?: ChildSubtask[];
};

export type ChildSubtask = {
  summary: string;
  objetivo?: string;
  contexto?: string;
  pasos?: string[];
  criterio_done?: string[];
  rol_tecnico?: string;
  assignee_sugerido?: string;
};

export type ProposalWrapper = {
  titulo_corto?: string;
  responsable_mencionado?: string | null;
  situ_existente_key?: string | null;
  needs_itdev?: boolean;
  es_solo_coordinacion?: boolean;
  itdev: ITDEVProposal;
  razonamiento?: string;
};

export type BatchProposalResp = {
  propuestas: ProposalWrapper[];
  resumen_global?: string;
};

export type ITDEVIssueRow = {
  key: string;
  summary: string;
  status: string;
  type: string;
  priority: string;
  assignee: string;
  assignee_id: string | null;
  subtask_count: number;
  url: string;
};

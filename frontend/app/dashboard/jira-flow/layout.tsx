"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { cn } from "@/lib/utils";
import { Kanban, Wand2, Ticket, Shapes, BookOpen, FileText, Cog } from "lucide-react";

type Tab = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  subtitle: string;
};

const TABS: Tab[] = [
  { href: "/dashboard/jira-flow",            label: "Sprint",          icon: Kanban,    subtitle: "Dashboard del sprint activo ITDEV + SITU intake" },
  { href: "/dashboard/jira-flow/crear",      label: "Crear desde ctx", icon: Wand2,     subtitle: "Pegá transcripción/follow-ups · Gemini propone ITDEVs · creás en batch" },
  { href: "/dashboard/jira-flow/triage",     label: "Triage SITU",     icon: Ticket,    subtitle: "Lista SITU abiertos · propuesta IA · creás ITDEV vinculado" },
  { href: "/dashboard/jira-flow/subtareas",  label: "Subtareas",       icon: Shapes,    subtitle: "Descomponé tickets ITDEV en sub-tasks con Gemini" },
  { href: "/dashboard/jira-flow/confluence", label: "Confluence",      icon: BookOpen,  subtitle: "Spaces · búsqueda · páginas recientes" },
  { href: "/dashboard/jira-flow/auto-docs",  label: "Auto Docs",       icon: FileText,  subtitle: "Polling ITDEV cerrados → post-mortems, runbooks y ADRs en Confluence" },
  { href: "/dashboard/jira-flow/config",     label: "Config",          icon: Cog,       subtitle: "Variables de entorno · test conexión Jira y Gemini" },
];

export default function JiraFlowLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = TABS.find((t) => t.href === pathname) ?? TABS[0];

  return (
    <>
      <Topbar title={`Jira Flow · ${active.label}`} subtitle={active.subtitle} hidePeriod />
      <nav className="border-b border-border bg-white">
        <div className="px-4 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto -mb-px">
          {TABS.map((t) => {
            const I = t.icon;
            const isActive = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-foreground hover:bg-soft",
                )}
              >
                <I size={14} />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </>
  );
}

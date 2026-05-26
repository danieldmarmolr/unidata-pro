"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  GraduationCap, ChevronRight, Sparkles,
  Crown, Megaphone, HeartHandshake, TrendingUp, Truck, Wallet, Cpu,
  ShoppingBag, UsersRound, Store, Boxes, RotateCcw, Database, Settings,
  BookOpen,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { cn } from "@/lib/utils";

type AreaProgress = {
  area_slug: string;
  total: number;
  done: number;
  pct: number;
};
type AprendeResp = {
  items: AreaProgress[];
  summary: { total: number; done: number; pct: number };
};

const AREA_META: Record<
  string,
  { label: string; description: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }
> = {
  general:        { label: "General",          description: "Bienvenido a UNIDATA — cómo navegar, filtros, roles, bandeja",     icon: Sparkles,      color: "#7a3eae" },
  finanzas:       { label: "Finanzas",         description: "Flujo de Fondos, facturas, devoluciones de suscripciones",         icon: Wallet,        color: "#10b981" },
  ventas:         { label: "Ventas",           description: "GMV, cohortes, RFM, ticket promedio, ordenes",                    icon: TrendingUp,    color: "#f59e0b" },
  logistica:      { label: "Logística",        description: "Carga DigiP, targets de SLA, envios por canal",                   icon: Truck,         color: "#0ea5e9" },
  cs:             { label: "Customer Success", description: "Bandeja CS, performance, RFM Flows, NLP de cancelaciones",        icon: HeartHandshake, color: "#ec4899" },
  marketing:      { label: "Marketing",        description: "Vista general, Meta Ads, atribucion, ROAS",                       icon: Megaphone,     color: "#a78bfa" },
  people:         { label: "People",           description: "Feed, bandeja, directorio, kudos, 1:1s, encuestas",                icon: UsersRound,    color: "#22d3ee" },
  compras:        { label: "Compras / Producto", description: "SKU Optimizer, costos importacion, forecast, heatmap stock",    icon: ShoppingBag,   color: "#fb923c" },
  administracion: { label: "Administración",   description: "Gestion de usuarios, audit log, RBAC",                            icon: Settings,      color: "#64748b" },
  it_data:        { label: "IT / Data",        description: "Data Catalog, SQL libre, explorador, Jira Flow, MCP",             icon: Cpu,           color: "#0f766e" },
  unidrop:        { label: "Unidrop",          description: "Dropshippers 360, SaaS Metrics, pagos Talo",                      icon: Boxes,         color: "#9333ea" },
  unistore:       { label: "Unistore",         description: "E-commerce propio: TN + Mercado Libre",                           icon: Store,         color: "#6366f1" },
  unidev:         { label: "Unidev",           description: "Devoluciones + NLP de causas",                                    icon: RotateCcw,     color: "#dc2626" },
};

export default function AprendeHubPage() {
  const me = getUser();
  const { data, isLoading } = useQuery<AprendeResp>({
    queryKey: ["aprende-areas"],
    queryFn: () => api("/api/aprende/areas"),
    staleTime: 30_000,
  });

  const summary = data?.summary ?? { total: 0, done: 0, pct: 0 };
  const items = data?.items ?? [];

  // Recomendado: la area del user primero, despues General, despues el resto
  const sorted = [...items].sort((a, b) => {
    const myArea = me?.area_slug ?? "";
    const aIsMine = a.area_slug === myArea ? 0 : 1;
    const bIsMine = b.area_slug === myArea ? 0 : 1;
    if (aIsMine !== bIsMine) return aIsMine - bIsMine;
    const aIsGen = a.area_slug === "general" ? 0 : 1;
    const bIsGen = b.area_slug === "general" ? 0 : 1;
    if (aIsGen !== bIsGen) return aIsGen - bIsGen;
    return a.area_slug.localeCompare(b.area_slug);
  });

  return (
    <>
      <Topbar
        title="Aprende UNIDATA"
        subtitle="Capacitación por área para sacarle el máximo provecho a la herramienta"
      />
      <div className="flex-1 px-4 lg:px-6 py-6 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          {/* Hero / progress general */}
          <div className="bg-gradient-to-br from-primary to-accent text-white rounded-2xl p-6 mb-6 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <GraduationCap size={20} />
                  <div className="text-sm font-bold uppercase tracking-wider opacity-90">
                    Tu progreso
                  </div>
                </div>
                <div className="text-3xl font-extrabold tabular-nums">
                  {summary.done} / {summary.total}
                </div>
                <div className="text-xs opacity-80 mt-1">
                  lecciones completadas en todas las áreas
                </div>
              </div>
              <div className="text-5xl font-extrabold tabular-nums">
                {summary.pct}%
              </div>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden mt-4">
              <div
                className="h-full bg-white transition-all"
                style={{ width: `${summary.pct}%` }}
              />
            </div>
          </div>

          {/* Recomendacion */}
          {me?.area_slug && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-5 flex items-start gap-3">
              <BookOpen size={18} className="text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 text-[13px]">
                <div className="font-bold text-amber-900 dark:text-amber-200">
                  Recomendado para vos
                </div>
                <div className="text-amber-800 dark:text-amber-300 mt-0.5">
                  Empezá por <strong>General</strong> (UNIDATA 101) y después tu área (
                  <strong>{AREA_META[me.area_slug]?.label ?? me.area_slug}</strong>).
                  Cuando termines, podés explorar otras áreas para entender el negocio completo.
                </div>
              </div>
            </div>
          )}

          {/* Cards de areas */}
          {isLoading ? (
            <div className="text-center py-12 text-text-muted text-sm">Cargando...</div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-12 text-text-muted text-sm">
              No hay lecciones cargadas. Hablá con admin/People.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sorted.map((a) => {
                const meta = AREA_META[a.area_slug] ?? {
                  label: a.area_slug,
                  description: "",
                  icon: BookOpen,
                  color: "#7a3eae",
                };
                const Icon = meta.icon;
                const isMine = a.area_slug === me?.area_slug;
                const isComplete = a.done === a.total && a.total > 0;
                return (
                  <Link
                    key={a.area_slug}
                    href={`/dashboard/people/aprende/${a.area_slug}`}
                    className={cn(
                      "group bg-surface border border-border rounded-xl p-4 hover:shadow-md hover:border-primary/40 transition-all relative overflow-hidden",
                      isMine && "ring-2 ring-primary/40",
                    )}
                  >
                    {isMine && (
                      <div className="absolute top-2 right-2 text-[9px] uppercase tracking-wider font-bold bg-primary text-white px-1.5 py-0.5 rounded-full">
                        Tu área
                      </div>
                    )}
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                      style={{ background: `${meta.color}20`, color: meta.color }}
                    >
                      <Icon size={20} />
                    </div>
                    <div className="text-sm font-bold text-text mb-1 group-hover:text-primary transition">
                      {meta.label}
                    </div>
                    <div className="text-[11px] text-text-muted line-clamp-2 mb-3 min-h-[28px]">
                      {meta.description}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] text-text-muted">
                        {a.done} / {a.total} · <span className="font-semibold">{a.pct}%</span>
                      </div>
                      <ChevronRight size={14} className="text-text-muted group-hover:text-primary transition" />
                    </div>
                    <div className="h-1.5 bg-bg-muted rounded-full overflow-hidden mt-2">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${a.pct}%`,
                          background: isComplete ? "#10b981" : meta.color,
                        }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Crown, AlertTriangle, Users, Truck, Calendar, Package, ShoppingBag, RotateCcw,
  FileSpreadsheet, FileText, Download, Filter,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getToken } from "@/lib/api";

type ExportItem = {
  id: string;
  label: string;
  description: string;
  team: string;
  icon: string;
  endpoint: string;
  format: string;
  fields: string[];
};

type Catalog = {
  items: ExportItem[];
  by_team: Record<string, ExportItem[]>;
  teams: string[];
  total: number;
};

const ICON_MAP: Record<string, any> = {
  crown: Crown,
  alert: AlertTriangle,
  users: Users,
  truck: Truck,
  calendar: Calendar,
  package: Package,
  "shopping-bag": ShoppingBag,
  rotate: RotateCcw,
};

const TEAM_COLOR: Record<string, { bg: string; border: string; text: string }> = {
  "Marketing": { bg: "from-fuchsia-50 to-pink-50", border: "border-fuchsia-300", text: "text-fuchsia-800" },
  "Customer Success": { bg: "from-violet-50 to-purple-50", border: "border-violet-300", text: "text-violet-800" },
  "Comercial": { bg: "from-emerald-50 to-teal-50", border: "border-emerald-300", text: "text-emerald-800" },
  "Logística": { bg: "from-blue-50 to-cyan-50", border: "border-blue-300", text: "text-blue-800" },
  "Cobranza": { bg: "from-amber-50 to-orange-50", border: "border-amber-300", text: "text-amber-800" },
  "Compras": { bg: "from-rose-50 to-pink-50", border: "border-rose-300", text: "text-rose-800" },
  "Producto": { bg: "from-cyan-50 to-sky-50", border: "border-cyan-300", text: "text-cyan-800" },
  "Customer Service": { bg: "from-yellow-50 to-amber-50", border: "border-yellow-300", text: "text-yellow-800" },
};

export default function ExportsPage() {
  const [team, setTeam] = useState<string>("all");

  const { data, isLoading } = useQuery<Catalog>({
    queryKey: ["exports-catalog"],
    queryFn: () => api<Catalog>("/api/exports/catalog"),
    staleTime: 5 * 60_000,
  });

  async function downloadExport(item: ExportItem, format: "xlsx" | "csv" = "xlsx") {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const url = `${apiUrl}${item.endpoint}?format=${format}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${item.id}_${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert(`Error descargando: ${e instanceof Error ? e.message : e}`);
    }
  }

  const items = data?.items ?? [];
  const filtered = team === "all" ? items : items.filter((i) => i.team === team);
  const teams = data?.teams ?? [];

  return (
    <>
      <Topbar
        title="Centro de Exportaciones"
        subtitle="Datasets pre-armados para cada equipo · Excel y CSV listos para descargar"
        hidePeriod
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        {/* Hero */}
        <div className="bg-gradient-to-br from-primary/10 via-accent/5 to-transparent border border-primary/20 rounded-2xl p-6 mb-6">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center shadow-lg flex-shrink-0">
              <FileSpreadsheet size={28} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-extrabold text-text">Datos para cada equipo, al alcance de un click</h1>
              <p className="text-sm text-text-muted mt-1">
                Cada exporte trae los campos clave que el equipo necesita para su trabajo diario.
                Marketing puede armar campañas, Cobranza puede llamar morosos, Logística puede destrabar pedidos —
                <strong className="text-text"> todo sin pasar por SQL ni esperar al equipo de datos</strong>.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                  ✓ Excel (.xlsx) con header violeta auto-formato
                </span>
                <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-800 font-semibold">
                  ✓ CSV UTF-8 BOM (Excel-friendly)
                </span>
                <span className="px-2 py-1 rounded-full bg-violet-100 text-violet-800 font-semibold">
                  ✓ Datos en vivo cada vez que descargás
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Filtro por equipo */}
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-text-muted" />
          <span className="text-xs text-text-muted font-semibold mr-2">Filtrar por equipo:</span>
          <button
            onClick={() => setTeam("all")}
            className={
              "px-3 py-1 text-xs rounded-full border transition " +
              (team === "all"
                ? "bg-primary text-white border-primary"
                : "bg-surface border-border hover:border-primary/40 text-text-muted")
            }
          >
            Todos ({items.length})
          </button>
          {teams.map((t) => (
            <button
              key={t}
              onClick={() => setTeam(t)}
              className={
                "px-3 py-1 text-xs rounded-full border transition " +
                (team === t
                  ? "bg-primary text-white border-primary"
                  : "bg-surface border-border hover:border-primary/40 text-text-muted")
              }
            >
              {t} ({data?.by_team[t]?.length ?? 0})
            </button>
          ))}
        </div>

        {/* Grid de exportes */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-56 bg-surface border border-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-12 text-center text-text-muted">
            No hay exportes en este equipo todavia
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((item) => {
              const Icon = ICON_MAP[item.icon] ?? FileSpreadsheet;
              const meta = TEAM_COLOR[item.team] ?? { bg: "from-zinc-50 to-zinc-100", border: "border-zinc-300", text: "text-zinc-700" };
              return (
                <div
                  key={item.id}
                  className={`bg-gradient-to-br ${meta.bg} border-2 ${meta.border} rounded-xl p-5 flex flex-col`}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`w-11 h-11 rounded-xl bg-white border ${meta.border} flex items-center justify-center shadow-sm ${meta.text}`}>
                      <Icon size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs uppercase tracking-wider font-bold ${meta.text}`}>{item.team}</div>
                      <h3 className="text-base font-bold text-text leading-tight mt-0.5">{item.label}</h3>
                    </div>
                  </div>

                  <p className="text-xs text-text-muted mb-3 flex-1">{item.description}</p>

                  {/* Campos incluidos */}
                  <div className="text-[10px] text-text-muted/70 mb-3">
                    <span className="font-semibold uppercase tracking-wider">Campos:</span>{" "}
                    {item.fields.slice(0, 5).join(" · ")}
                    {item.fields.length > 5 && ` · +${item.fields.length - 5} mas`}
                  </div>

                  {/* Botones */}
                  <div className="flex gap-2 mt-auto pt-2 border-t border-white/60">
                    <button
                      onClick={() => downloadExport(item, "xlsx")}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs font-semibold shadow-sm hover:shadow-md transition"
                    >
                      <FileSpreadsheet size={13} />
                      Excel
                    </button>
                    <button
                      onClick={() => downloadExport(item, "csv")}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-white/80 text-text text-xs font-semibold hover:border-primary hover:text-primary transition"
                      title="Descargar CSV"
                    >
                      <FileText size={13} />
                      CSV
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer info */}
        <div className="mt-6 bg-soft border border-border rounded-xl p-4 text-xs text-text-muted">
          <div className="font-semibold text-text mb-1">¿Necesitas otro exporte?</div>
          Cualquier vista de drilldown en la app tiene botones <strong>Excel · CSV · Compartir</strong> para
          exportar lo que estés viendo. Si necesitás un exporte pre-armado nuevo, pedilo en{" "}
          <a href="/dashboard/sql" className="text-primary hover:underline">SQL libre</a> o lo agregamos al catálogo.
        </div>
      </div>
    </>
  );
}

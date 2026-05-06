"use client";

import { use } from "react";
import { Construction } from "lucide-react";
import { Topbar } from "@/components/topbar";

const META: Record<string, { title: string; subtitle: string; eta: string }> = {
  ventas:    { title: "Ventas Unistore",     subtitle: "Revenue, AOV, top productos, canales TN/ML", eta: "Fase 2" },
  logistica: { title: "Logistica Unistore",  subtitle: "Funnel Orden -> Despacho, lead time, stock", eta: "Fase 2" },
  finanzas:  { title: "Finanzas Unistore",   subtitle: "Facturacion, cobranzas, match TN <-> Contabilium", eta: "Fase 2" },
  marketing: { title: "Marketing Unistore",  subtitle: "LTV, retencion, cohorts, geo", eta: "Fase 3" },
  saas:      { title: "SaaS Metrics Unidrop", subtitle: "MRR, churn, funnel signup -> primera venta", eta: "Fase 2" },
  pagos:     { title: "Pagos Talo",          subtitle: "Volumen, tasa de exito, comisiones", eta: "Fase 3" },
  envios:    { title: "Envios Unidrop",      subtitle: "OCA vs LightData, tasa de exito, tiempos", eta: "Fase 3" },
  sources:   { title: "Explorador de fuentes", subtitle: "Schemas y tablas (M0)", eta: "Migrando del MVP" },
  sql:       { title: "SQL libre",           subtitle: "Workbench solo lectura", eta: "Migrando del MVP" },
};

export default function DashboardAreaPage({
  params,
}: {
  params: Promise<{ area: string }>;
}) {
  const { area } = use(params);
  const meta = META[area] ?? {
    title: area,
    subtitle: "Dashboard en construccion",
    eta: "Fase pendiente",
  };

  return (
    <>
      <Topbar title={meta.title} subtitle={meta.subtitle} />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto mt-12">
          <div className="bg-surface border border-dashed border-border rounded-2xl p-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-soft text-primary mx-auto mb-4 grid place-items-center">
              <Construction size={26} />
            </div>
            <h2 className="text-xl font-bold text-text mb-2">{meta.title}</h2>
            <p className="text-sm text-text-muted mb-4">{meta.subtitle}</p>
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary bg-soft border border-primary/20 px-3 py-1 rounded-full">
              {meta.eta}
            </div>
            <p className="text-sm text-text-muted mt-6">
              Este dashboard esta planificado y se construye sobre las queries que ya identificamos en
              el inventario de las BBDD. Si lo prioritzas, lo armo ahora mismo.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

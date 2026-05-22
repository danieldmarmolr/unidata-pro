"use client";

import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { FacturasSuscripcionesMeliPanel } from "@/components/facturas-suscripciones-meli";

export default function FacturasSuscripcionesMeliPage() {
  return (
    <>
      <Topbar
        title="Finanzas · Facturas suscripciones MELI"
        subtitle="Facturas Contabilium emitidas por cobros de suscripcion MELI (Unidrop)"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <TodayPanel unit="unidrop" context="finanzas" title="HOY · Facturas Suscripciones" />
        <FacturasSuscripcionesMeliPanel />
      </div>
    </>
  );
}

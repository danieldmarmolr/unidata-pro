"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

type CountResp = {
  pending: number;
  critical_pending: number;
};

const SESSION_KEY = "unidata.alert_banner_dismissed";

export function AlertBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(SESSION_KEY) === "1";
  });

  const { data } = useQuery<CountResp>({
    queryKey: ["notifications-count"],
    queryFn: () => api<CountResp>("/api/notifications/count"),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (dismissed) return null;
  if (!data || data.critical_pending === 0) return null;

  return (
    <div className="bg-gradient-to-r from-red-50 to-rose-50 border-b border-red-300 px-4 py-2 flex items-center gap-3">
      <AlertCircle size={16} className="text-red-700 shrink-0" />
      <div className="flex-1 text-xs">
        <strong className="text-red-900">
          {data.critical_pending} alerta{data.critical_pending === 1 ? "" : "s"} crítica{data.critical_pending === 1 ? "" : "s"} pendiente{data.critical_pending === 1 ? "" : "s"}
        </strong>
        <span className="text-red-700/80 ml-1">— revisá las integraciones y eventos del sistema</span>
      </div>
      <Link
        href="/dashboard/notificaciones"
        className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold rounded-lg bg-red-700 hover:bg-red-800 text-white transition"
      >
        Ver bandeja <ChevronRight size={11} />
      </Link>
      <button
        onClick={() => {
          setDismissed(true);
          try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
        }}
        className="text-red-700/60 hover:text-red-900 px-1"
        title="Ocultar por esta sesión"
      >
        <X size={14} />
      </button>
    </div>
  );
}

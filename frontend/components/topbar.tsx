"use client";

import { useEffect, useState } from "react";
import { Bell, RefreshCcw, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getUser, type AuthUser } from "@/lib/api";

export function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => setUser(getUser()), []);
  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();
  const display = user?.name || user?.email?.split("@")[0] || "anonimo";
  return (
    <header className="h-16 bg-surface border-b border-border px-8 flex items-center justify-between">
      <div>
        <h1 className="text-lg font-bold text-text leading-none">{title}</h1>
        {subtitle && <div className="text-xs text-text-muted mt-1">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative hidden md:block">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            placeholder="Buscar tabla, mesa, KPI..."
            className="pl-8 pr-3 py-1.5 rounded-lg border border-border bg-bg text-sm w-64 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </div>
        <button
          onClick={() => qc.invalidateQueries()}
          title="Refrescar datos"
          className="w-9 h-9 grid place-items-center rounded-lg border border-border bg-surface text-text-muted hover:text-primary hover:border-primary/40 transition"
        >
          <RefreshCcw size={15} />
        </button>
        <button
          title="Notificaciones"
          className="w-9 h-9 grid place-items-center rounded-lg border border-border bg-surface text-text-muted hover:text-primary hover:border-primary/40 transition"
        >
          <Bell size={15} />
        </button>
        <div className="ml-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-soft border border-border">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-primary text-white flex items-center justify-center text-xs font-bold">
            {initial}
          </div>
          <div className="text-xs">
            <div className="font-semibold text-text leading-none">{display}</div>
            <div className="text-[10px] text-text-muted mt-0.5">{user?.role || "..."}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

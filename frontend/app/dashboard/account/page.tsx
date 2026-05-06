"use client";

import { useState } from "react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";

export default function AccountPage() {
  const me = getUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) {
      setMsg({ kind: "err", text: "Los passwords nuevos no coinciden" });
      return;
    }
    if (next.length < 6) {
      setMsg({ kind: "err", text: "Password muy corto (min 6 caracteres)" });
      return;
    }
    setLoading(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      setMsg({ kind: "ok", text: "Password actualizado correctamente" });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Topbar title="Mi cuenta" subtitle="Tu informacion + cambio de password" />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
          <div className="bg-surface border border-border rounded-xl p-6">
            <h2 className="text-sm font-bold text-text mb-4">Mis datos</h2>
            <Row label="Email" value={me?.email ?? "—"} />
            <Row label="Nombre" value={me?.name || "—"} />
            <Row label="Rol" value={me?.role ?? "—"} />
            <Row label="ID interno" value={String(me?.id ?? "—")} />
          </div>

          <div className="bg-surface border border-border rounded-xl p-6">
            <h2 className="text-sm font-bold text-text mb-4">Cambiar password</h2>
            <form onSubmit={submit} className="space-y-3">
              <Input label="Password actual" value={current} onChange={setCurrent} required />
              <Input label="Password nuevo" value={next} onChange={setNext} required />
              <Input label="Confirmar nuevo" value={confirm} onChange={setConfirm} required />
              {msg && (
                <div
                  className={
                    "rounded-lg px-3 py-2 text-xs " +
                    (msg.kind === "ok"
                      ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                      : "bg-red-50 border border-red-200 text-error")
                  }
                >
                  {msg.text}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold text-sm shadow-md disabled:opacity-50"
              >
                {loading ? "Actualizando..." : "Actualizar password"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border last:border-0">
      <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      <span className="text-sm font-medium text-text">{value}</span>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">{label}</label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full px-3 py-2 rounded-lg border border-border bg-bg outline-none focus:border-primary"
      />
    </div>
  );
}

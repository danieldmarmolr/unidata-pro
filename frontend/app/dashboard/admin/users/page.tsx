"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { CheckCircle2, XCircle, KeyRound, ShieldCheck, Plus, X } from "lucide-react";

type User = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "user" | "gerencia" | "analista" | "lector";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export default function AdminUsersPage() {
  const me = getUser();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<User[]>({
    queryKey: ["admin", "users"],
    queryFn: () => api("/api/admin/users"),
    staleTime: 10_000,
  });

  const [showNew, setShowNew] = useState(false);
  const [editPwd, setEditPwd] = useState<{ id: number; email: string } | null>(null);

  const createMut = useMutation({
    mutationFn: (b: { email: string; name: string; password: string; role: string }) =>
      api("/api/admin/users", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setShowNew(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: (vars: { id: number; body: Record<string, unknown> }) =>
      api(`/api/admin/users/${vars.id}`, { method: "PATCH", body: JSON.stringify(vars.body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  if (me?.role !== "admin") {
    return (
      <>
        <Topbar title="Acceso restringido" />
        <div className="p-8 text-text-muted">Solo administradores pueden ver esta pantalla.</div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title="Gestion de usuarios"
        subtitle="Dar de alta, cambiar rol, resetear password, activar/desactivar"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="text-sm text-text-muted">
            {data ? `${data.length} usuarios totales · ${data.filter((u) => u.is_active).length} activos` : "Cargando..."}
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold text-sm shadow-md hover:shadow-lg transition"
          >
            <Plus size={14} /> Agregar usuario
          </button>
        </div>

        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Email</th>
                <th className="text-left px-3 py-2">Nombre</th>
                <th className="text-center px-3 py-2">Rol</th>
                <th className="text-center px-3 py-2">Activo</th>
                <th className="text-left px-3 py-2">Creado</th>
                <th className="text-right px-3 py-2 pr-4">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((u) => (
                <tr key={u.id} className="border-t border-border hover:bg-soft transition">
                  <td className="px-3 py-2 font-semibold">
                    {u.email}
                    {u.id === me.id && (
                      <span className="ml-2 text-[9px] uppercase font-bold text-primary bg-soft border border-primary/20 px-1.5 py-0.5 rounded">
                        vos
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{u.name || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <select
                      disabled={u.id === me.id}
                      value={u.role}
                      onChange={(e) =>
                        updateMut.mutate({ id: u.id, body: { role: e.target.value } })
                      }
                      className="px-2 py-1 text-xs rounded border border-border bg-bg outline-none focus:border-primary disabled:opacity-50"
                    >
                      <option value="admin">admin</option>
                      <option value="gerencia">gerencia</option>
                      <option value="analista">analista</option>
                      <option value="lector">lector</option>
                      <option value="user">user</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      disabled={u.id === me.id}
                      onClick={() =>
                        updateMut.mutate({ id: u.id, body: { is_active: !u.is_active } })
                      }
                      className="disabled:opacity-30"
                      title={u.is_active ? "Desactivar" : "Activar"}
                    >
                      {u.is_active ? (
                        <CheckCircle2 size={16} className="text-success inline" />
                      ) : (
                        <XCircle size={16} className="text-error inline" />
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-text-muted text-xs">
                    {new Date(u.created_at).toLocaleDateString("es-AR")}
                  </td>
                  <td className="px-3 py-2 text-right pr-4">
                    <button
                      onClick={() => setEditPwd({ id: u.id, email: u.email })}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:border-primary hover:text-primary transition"
                    >
                      <KeyRound size={11} /> Reset password
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && (!data || data.length === 0) && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-text-muted">
                    No hay usuarios.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {showNew && <NewUserModal onClose={() => setShowNew(false)} onCreate={(b) => createMut.mutate(b)} loading={createMut.isPending} error={createMut.error?.message ?? null} />}

        {editPwd && (
          <ResetPasswordModal
            email={editPwd.email}
            onClose={() => setEditPwd(null)}
            onSubmit={(pwd) => {
              updateMut.mutate(
                { id: editPwd.id, body: { new_password: pwd } },
                { onSuccess: () => setEditPwd(null) },
              );
            }}
            loading={updateMut.isPending}
            error={updateMut.error?.message ?? null}
          />
        )}
      </div>
    </>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-text">{title}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NewUserModal({
  onClose,
  onCreate,
  loading,
  error,
}: {
  onClose: () => void;
  onCreate: (b: { email: string; name: string; password: string; role: string }) => void;
  loading: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  return (
    <ModalShell title="Agregar usuario" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({ email, name, password, role });
        }}
        className="space-y-3"
      >
        <Field label="Email" value={email} onChange={setEmail} type="email" required />
        <Field label="Nombre" value={name} onChange={setName} />
        <Field label="Password inicial" value={password} onChange={setPassword} type="password" required hint="Min 6 caracteres. Pasaselo por chat al user." />
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Rol</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg outline-none focus:border-primary"
          >
            <option value="admin">admin · todo (gestiona usuarios + audit)</option>
            <option value="gerencia">gerencia · KPIs cross-unidad estrategicos</option>
            <option value="analista">analista · drill profundo + SQL libre</option>
            <option value="lector">lector · vistas read-only basicas</option>
            <option value="user">user · todos los dashboards (sin SQL/admin)</option>
          </select>
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-error rounded-lg px-3 py-2 text-xs">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold text-sm shadow-md disabled:opacity-50"
        >
          {loading ? "Creando..." : "Crear usuario"}
        </button>
      </form>
    </ModalShell>
  );
}

function ResetPasswordModal({
  email,
  onClose,
  onSubmit,
  loading,
  error,
}: {
  email: string;
  onClose: () => void;
  onSubmit: (pwd: string) => void;
  loading: boolean;
  error: string | null;
}) {
  const [pwd, setPwd] = useState("");
  return (
    <ModalShell title={`Reset password de ${email}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(pwd);
        }}
        className="space-y-3"
      >
        <Field label="Nuevo password" value={pwd} onChange={setPwd} type="password" required hint="Min 6 caracteres. Pasaselo por chat al user." />
        {error && <div className="bg-red-50 border border-red-200 text-error rounded-lg px-3 py-2 text-xs">{error}</div>}
        <button
          type="submit"
          disabled={loading || pwd.length < 6}
          className="w-full mt-2 py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold text-sm shadow-md disabled:opacity-50"
        >
          {loading ? "Cambiando..." : "Cambiar password"}
        </button>
      </form>
    </ModalShell>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full px-3 py-2 rounded-lg border border-border bg-bg outline-none focus:border-primary"
      />
      {hint && <div className="text-[11px] text-text-muted mt-1">{hint}</div>}
    </div>
  );
}

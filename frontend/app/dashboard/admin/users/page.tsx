"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { fmtArDate } from "@/lib/dates";
import { CheckCircle2, XCircle, KeyRound, ShieldCheck, Plus, X, Layers, Crown, Eye, EyeOff } from "lucide-react";
import { Avatar } from "@/components/people/avatar";

type AreaChip = { id: number; slug: string; name: string; color: string };

type User = {
  id: number;
  email: string;
  name: string;
  role: "ceo" | "admin" | "user" | "gerencia" | "analista" | "lector";
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  area_id: number | null;
  area_slug: string | null;
  area_name: string | null;
  area_color: string | null;
  secondary_areas: AreaChip[];
  manager_user_id: number | null;
  manager_name: string | null;
  manager_email: string | null;
  manager_role: string | null;
  job_title: string | null;
  bio: string | null;
  hidden_from_directory: boolean;
  avatar_url: string | null;
};

type Area = {
  id: number;
  slug: string;
  name: string;
  color: string;
  description: string;
  sort_order: number;
};

export default function AdminUsersPage() {
  const me = getUser();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<User[]>({
    queryKey: ["admin", "users"],
    queryFn: () => api("/api/admin/users"),
    staleTime: 10_000,
  });

  const { data: areas } = useQuery<Area[]>({
    queryKey: ["admin", "areas"],
    queryFn: () => api("/api/admin/areas"),
    staleTime: 5 * 60_000,
  });

  const [showNew, setShowNew] = useState(false);
  const [editPwd, setEditPwd] = useState<{ id: number; email: string } | null>(null);
  const [editAreas, setEditAreas] = useState<User | null>(null);

  const createMut = useMutation({
    mutationFn: (b: {
      email: string;
      name: string;
      password: string;
      role: string;
      is_admin: boolean;
      area_id: number | null;
      secondary_area_ids: number[];
      manager_user_id: number | null;
      job_title: string | null;
      bio: string | null;
    }) =>
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

  // Acceso si es role=admin (legacy) O is_admin=true (modelo nuevo)
  if (!(me?.is_admin || me?.role === "admin")) {
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
                <th className="text-left px-3 py-2 w-10"></th>
                <th className="text-left px-3 py-2">Email</th>
                <th className="text-left px-3 py-2">Nombre</th>
                <th className="text-center px-3 py-2">Rol</th>
                <th className="text-center px-3 py-2" title="Permisos de admin (puede gestionar usuarios)">Admin</th>
                <th className="text-left px-3 py-2">Área</th>
                <th className="text-left px-3 py-2">Gerente</th>
                <th className="text-center px-3 py-2">Activo</th>
                <th className="text-center px-3 py-2" title="Visibilidad en directorio y organigrama de People">People</th>
                <th className="text-left px-3 py-2">Creado</th>
                <th className="text-right px-3 py-2 pr-4">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((u) => {
                const managerOptions = (data ?? []).filter(
                  (m) => m.id !== u.id && m.is_active,
                );
                return (
                <tr key={u.id} className="border-t border-border hover:bg-soft transition">
                  <td className="px-3 py-2">
                    <Avatar name={u.name || u.email} url={u.avatar_url} size="sm" />
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    <div className="flex items-center gap-1.5">
                      {u.role === "ceo" && (
                        <Crown size={12} className="text-amber-500" aria-label="CEO" />
                      )}
                      <span>{u.email}</span>
                      {u.id === me.id && (
                        <span className="text-[9px] uppercase font-bold text-primary bg-soft border border-primary/20 px-1.5 py-0.5 rounded">
                          vos
                        </span>
                      )}
                    </div>
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
                      <option value="ceo">CEO (único)</option>
                      <option value="gerencia">gerencia</option>
                      <option value="analista">analista</option>
                      <option value="lector">lector</option>
                      <option value="user">user</option>
                      <option value="admin">admin (legacy)</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      disabled={u.id === me.id || u.role === "admin"}
                      checked={u.is_admin || u.role === "admin"}
                      onChange={(e) =>
                        updateMut.mutate({ id: u.id, body: { is_admin: e.target.checked } })
                      }
                      className="cursor-pointer disabled:cursor-not-allowed"
                      title={
                        u.role === "admin"
                          ? "Es role admin → siempre tiene permisos de admin"
                          : "Marcar para que tambien pueda gestionar la plataforma"
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {u.area_id && u.area_name ? (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border"
                          style={{
                            color: u.area_color ?? "#666",
                            borderColor: (u.area_color ?? "#999") + "55",
                            background: (u.area_color ?? "#999") + "11",
                          }}
                          title="Área principal"
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: u.area_color ?? "#666" }}
                          />
                          {u.area_name}
                        </span>
                      ) : (
                        <span className="text-[11px] text-text-muted italic">sin área</span>
                      )}
                      {(u.secondary_areas ?? []).map((sa) => (
                        <span
                          key={sa.id}
                          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-dashed"
                          style={{
                            color: sa.color,
                            borderColor: sa.color + "66",
                          }}
                          title="Área secundaria"
                        >
                          {sa.name}
                        </span>
                      ))}
                      <button
                        onClick={() => setEditAreas(u)}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border hover:border-primary hover:text-primary transition"
                        title="Editar áreas"
                      >
                        <Layers size={10} /> editar
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={u.manager_user_id ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") {
                          updateMut.mutate({ id: u.id, body: { clear_manager: true } });
                        } else {
                          updateMut.mutate({ id: u.id, body: { manager_user_id: Number(v) } });
                        }
                      }}
                      className="px-2 py-1 text-xs rounded border border-border bg-bg outline-none focus:border-primary min-w-[160px]"
                      title={u.manager_email ?? undefined}
                    >
                      <option value="">— sin asignar —</option>
                      {managerOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.role === "ceo" ? "👑 " : ""}
                          {m.name || m.email}
                          {m.role === "gerencia" || m.is_admin ? " ★" : ""}
                        </option>
                      ))}
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
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() =>
                        updateMut.mutate({
                          id: u.id,
                          body: { hidden_from_directory: !u.hidden_from_directory },
                        })
                      }
                      className="inline-flex items-center justify-center p-1 rounded hover:bg-bg-muted transition"
                      title={
                        u.hidden_from_directory
                          ? "Oculto del directorio y organigrama. Click para mostrar."
                          : "Visible en People. Click para ocultar."
                      }
                    >
                      {u.hidden_from_directory ? (
                        <EyeOff size={16} className="text-amber-500 inline" />
                      ) : (
                        <Eye size={16} className="text-success inline" />
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-text-muted text-xs">
                    {fmtArDate(u.created_at)}
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
                );
              })}
              {!isLoading && (!data || data.length === 0) && (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-text-muted">
                    No hay usuarios.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {showNew && (
          <NewUserModal
            areas={areas ?? []}
            users={data ?? []}
            onClose={() => setShowNew(false)}
            onCreate={(b) => createMut.mutate(b)}
            loading={createMut.isPending}
            error={createMut.error?.message ?? null}
          />
        )}

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

        {editAreas && (
          <EditAreasModal
            user={editAreas}
            areas={areas ?? []}
            onClose={() => setEditAreas(null)}
            onSave={(primaryId, secondaryIds) => {
              updateMut.mutate(
                {
                  id: editAreas.id,
                  body: {
                    ...(primaryId === null
                      ? { clear_area: true }
                      : { area_id: primaryId }),
                    secondary_area_ids: secondaryIds,
                  },
                },
                { onSuccess: () => setEditAreas(null) },
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
  areas,
  users,
  onClose,
  onCreate,
  loading,
  error,
}: {
  areas: Area[];
  users: User[];
  onClose: () => void;
  onCreate: (b: {
    email: string;
    name: string;
    password: string;
    role: string;
    is_admin: boolean;
    area_id: number | null;
    secondary_area_ids: number[];
    manager_user_id: number | null;
    job_title: string | null;
    bio: string | null;
  }) => void;
  loading: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [isAdmin, setIsAdmin] = useState(false);
  const [areaId, setAreaId] = useState<string>("");
  const [secondaryIds, setSecondaryIds] = useState<number[]>([]);
  const [managerUserId, setManagerUserId] = useState<string>("");
  const [jobTitle, setJobTitle] = useState("");
  const [bio, setBio] = useState("");

  const toggleSecondary = (id: number) => {
    setSecondaryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const primaryNum = areaId === "" ? null : Number(areaId);

  return (
    <ModalShell title="Agregar usuario" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({
            email,
            name,
            password,
            role,
            is_admin: isAdmin,
            area_id: primaryNum,
            secondary_area_ids: secondaryIds.filter((x) => x !== primaryNum),
            manager_user_id: managerUserId === "" ? null : Number(managerUserId),
            job_title: jobTitle.trim() || null,
            bio: bio.trim() || null,
          });
        }}
        className="space-y-3"
      >
        <Field label="Email" value={email} onChange={setEmail} type="email" required />
        <Field label="Nombre" value={name} onChange={setName} />
        <Field label="Password inicial" value={password} onChange={setPassword} type="password" required hint="Min 6 caracteres. Pasaselo por chat al user." />
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Rol (que tipo de info ve)</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg outline-none focus:border-primary"
          >
            <option value="ceo">CEO · cabeza del organigrama (solo 1 activo)</option>
            <option value="gerencia">gerencia · KPIs cross-unidad estrategicos</option>
            <option value="analista">analista · drill profundo + SQL libre</option>
            <option value="lector">lector · vistas read-only basicas</option>
            <option value="user">user · todos los dashboards (sin SQL/admin)</option>
            <option value="admin">admin (legacy) · ya implica permisos de admin</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Área principal</label>
          <select
            value={areaId}
            onChange={(e) => {
              setAreaId(e.target.value);
              if (e.target.value !== "") {
                setSecondaryIds((prev) => prev.filter((x) => x !== Number(e.target.value)));
              }
            }}
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg outline-none focus:border-primary"
          >
            <option value="">— sin asignar —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Áreas adicionales (opcional)</label>
          <div className="space-y-1 max-h-[180px] overflow-y-auto border border-border rounded-lg p-2">
            {areas.length === 0 && (
              <div className="text-xs text-text-muted px-2 py-1">No hay áreas.</div>
            )}
            {areas.map((a) => {
              const isPrimary = a.id === primaryNum;
              const checked = secondaryIds.includes(a.id);
              return (
                <label
                  key={a.id}
                  className={
                    "flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-sm transition " +
                    (isPrimary ? "opacity-40 cursor-not-allowed" : "hover:bg-soft")
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isPrimary}
                    onChange={() => toggleSecondary(a.id)}
                  />
                  <span className="w-2 h-2 rounded-full" style={{ background: a.color }} />
                  <span className="flex-1">{a.name}</span>
                  {isPrimary && <span className="text-[9px] uppercase font-bold text-primary">principal</span>}
                </label>
              );
            })}
          </div>
        </div>
        <Field label="Job title (opcional)" value={jobTitle} onChange={setJobTitle} hint="Ej: 'Lead Marketing', 'Analista Logistica'" />
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Bio (opcional)</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Una linea sobre lo que hace en Unistore"
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg outline-none focus:border-primary resize-none"
            rows={2}
            maxLength={300}
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Gerente directo</label>
          <select
            value={managerUserId}
            onChange={(e) => setManagerUserId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg outline-none focus:border-primary"
          >
            <option value="">— sin asignar —</option>
            {users.filter((u) => u.is_active).map((u) => (
              <option key={u.id} value={u.id}>
                {u.role === "ceo" ? "👑 " : ""}
                {u.name || u.email}
                {u.role === "gerencia" || u.is_admin ? " ★" : ""}
              </option>
            ))}
          </select>
          <div className="text-[11px] text-text-muted mt-1">👑 CEO · ★ gerencia/admin. Podés elegir cualquier user.</div>
        </div>
        <label className="flex items-start gap-2 cursor-pointer p-3 border border-border rounded-lg hover:border-primary/40 transition">
          <input
            type="checkbox"
            checked={isAdmin || role === "admin"}
            disabled={role === "admin"}
            onChange={(e) => setIsAdmin(e.target.checked)}
            className="mt-0.5 cursor-pointer"
          />
          <div className="flex-1 text-xs">
            <div className="font-semibold text-text">Permisos de admin</div>
            <div className="text-text-muted mt-0.5">
              Marcar si tambien debe gestionar usuarios y plataforma. Util para
              gerentes que quieren ver vistas estrategicas Y administrar
              (ej: role=gerencia + admin).
            </div>
          </div>
        </label>
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

function EditAreasModal({
  user,
  areas,
  onClose,
  onSave,
  loading,
  error,
}: {
  user: User;
  areas: Area[];
  onClose: () => void;
  onSave: (primaryId: number | null, secondaryIds: number[]) => void;
  loading: boolean;
  error: string | null;
}) {
  const [primaryId, setPrimaryId] = useState<number | null>(user.area_id);
  const [secondaryIds, setSecondaryIds] = useState<number[]>(
    (user.secondary_areas ?? []).map((a) => a.id),
  );

  const toggleSecondary = (id: number) => {
    setSecondaryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <ModalShell title={`Áreas de ${user.name || user.email}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">
            Área principal
          </label>
          <select
            value={primaryId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const newPrimary = v === "" ? null : Number(v);
              setPrimaryId(newPrimary);
              if (newPrimary !== null) {
                setSecondaryIds((prev) => prev.filter((x) => x !== newPrimary));
              }
            }}
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg outline-none focus:border-primary"
          >
            <option value="">— sin asignar —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <div className="text-[11px] text-text-muted mt-1">
            Aparece en el organigrama, perfil y como filtro principal.
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">
            Áreas adicionales (colabora también)
          </label>
          <div className="space-y-1 max-h-[280px] overflow-y-auto border border-border rounded-lg p-2">
            {areas.length === 0 && (
              <div className="text-xs text-text-muted px-2 py-1">No hay áreas.</div>
            )}
            {areas.map((a) => {
              const isPrimary = a.id === primaryId;
              const checked = secondaryIds.includes(a.id);
              return (
                <label
                  key={a.id}
                  className={
                    "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm transition " +
                    (isPrimary ? "opacity-40 cursor-not-allowed" : "hover:bg-soft")
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isPrimary}
                    onChange={() => toggleSecondary(a.id)}
                    className="cursor-pointer disabled:cursor-not-allowed"
                  />
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: a.color }}
                  />
                  <span className="flex-1">{a.name}</span>
                  {isPrimary && (
                    <span className="text-[9px] uppercase font-bold text-primary">principal</span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-error rounded-lg px-3 py-2 text-xs">
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={loading}
          onClick={() => onSave(primaryId, secondaryIds)}
          className="w-full py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold text-sm shadow-md disabled:opacity-50"
        >
          {loading ? "Guardando..." : "Guardar áreas"}
        </button>
      </div>
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

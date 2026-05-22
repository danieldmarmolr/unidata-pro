"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar, MapPin, Users as UsersIcon, Plus, X, Check, HelpCircle, Trash2,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";
import { cn } from "@/lib/utils";

type Event = {
  id: number;
  title: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
  creator_name: string | null;
  created_at: string;
  yes_count: number;
  maybe_count: number;
  no_count: number;
  my_rsvp: "yes" | "maybe" | "no" | null;
};

const RSVP_META: Record<"yes" | "maybe" | "no", { label: string; color: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  yes:   { label: "Voy",         color: "#10b981", icon: Check },
  maybe: { label: "Tal vez",     color: "#f59e0b", icon: HelpCircle },
  no:    { label: "No voy",      color: "#ef4444", icon: X },
};

export default function EventsPage() {
  const me = getUser();
  const canManage = !!me?.is_admin || me?.role === "admin" || me?.role === "gerencia" || me?.area_slug === "people";
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<{ items: Event[] }>({
    queryKey: ["people-events"],
    queryFn: () => api("/api/people/events"),
    staleTime: 30_000,
  });

  return (
    <>
      <Topbar title="Eventos" subtitle="Offsite, all-hands, lunch & learn" />
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setOpen(true)}
              className="text-sm px-3 py-1.5 bg-primary text-white rounded-full hover:opacity-90 inline-flex items-center gap-1.5"
            >
              <Plus size={14} /> Crear evento
            </button>
          </div>

          {isLoading && (
            <div className="text-center py-16 text-text-muted text-sm">Cargando...</div>
          )}

          {!isLoading && data?.items.length === 0 && (
            <div className="bg-surface border border-border rounded-xl py-16 text-center">
              <Calendar size={32} className="mx-auto text-text-muted mb-2 opacity-50" />
              <div className="text-sm font-semibold">Sin eventos proximos</div>
              <div className="text-xs text-text-muted">Crea el primero</div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data?.items.map((e) => (
              <EventCard key={e.id} event={e} canManage={canManage} />
            ))}
          </div>
        </div>
      </div>

      {open && <CreateEventModal onClose={() => setOpen(false)} />}
    </>
  );
}

function EventCard({ event, canManage }: { event: Event; canManage: boolean }) {
  const qc = useQueryClient();
  const rsvpMut = useMutation({
    mutationFn: (status: "yes" | "maybe" | "no") =>
      api(`/api/people/events/${event.id}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people-events"] }),
  });
  const deleteMut = useMutation({
    mutationFn: () => api(`/api/people/events/${event.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people-events"] }),
  });

  const start = new Date(event.starts_at);
  const dateLabel = start.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short" });
  const timeLabel = start.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-primary/10 to-accent/10 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider font-bold text-primary">
            {dateLabel} · {timeLabel}
          </div>
          {canManage && (
            <button
              onClick={() => {
                if (confirm("Borrar evento?")) deleteMut.mutate();
              }}
              className="text-text-muted hover:text-error"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
        <div className="text-base font-bold mt-0.5">{event.title}</div>
      </div>

      <div className="p-4 space-y-2">
        {event.location && (
          <div className="text-xs text-text-muted inline-flex items-center gap-1.5">
            <MapPin size={11} /> {event.location}
          </div>
        )}
        {event.description && (
          <div className="text-xs text-text whitespace-pre-wrap">{event.description}</div>
        )}

        <div className="flex items-center gap-2 pt-2 text-xs">
          <UsersIcon size={11} className="text-text-muted" />
          <span className="font-bold tabular-nums" style={{ color: "#10b981" }}>{event.yes_count}</span> van
          <span className="text-text-muted">·</span>
          <span className="font-bold tabular-nums" style={{ color: "#f59e0b" }}>{event.maybe_count}</span> tal vez
          {event.capacity && (
            <>
              <span className="text-text-muted">·</span>
              <span className="text-text-muted">cap {event.capacity}</span>
            </>
          )}
        </div>

        <div className="flex gap-1.5 pt-2 border-t border-border">
          {(["yes", "maybe", "no"] as const).map((status) => {
            const Meta = RSVP_META[status];
            const Icon = Meta.icon;
            const active = event.my_rsvp === status;
            return (
              <button
                key={status}
                onClick={() => rsvpMut.mutate(status)}
                disabled={rsvpMut.isPending}
                className={cn(
                  "flex-1 text-xs px-2 py-1.5 rounded-full border transition inline-flex items-center justify-center gap-1",
                  active
                    ? "border-transparent text-white font-semibold"
                    : "border-border hover:bg-bg-muted",
                )}
                style={active ? { background: Meta.color } : undefined}
              >
                <Icon size={11} />
                {Meta.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CreateEventModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [capacity, setCapacity] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      api("/api/people/events", {
        method: "POST",
        body: JSON.stringify({
          title, description, location,
          starts_at: startsAt,
          ends_at: endsAt || null,
          capacity: capacity ? parseInt(capacity, 10) : null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-events"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface">
          <div className="text-sm font-bold">Nuevo evento</div>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <Input label="Titulo" value={title} onChange={setTitle} autoFocus />
          <Input label="Descripcion (opcional)" value={description} onChange={setDescription} multiline />
          <Input label="Ubicacion (opcional)" value={location} onChange={setLocation} placeholder="Oficina, Zoom, ..." />
          <Input label="Empieza" value={startsAt} onChange={setStartsAt} type="datetime-local" />
          <Input label="Termina (opcional)" value={endsAt} onChange={setEndsAt} type="datetime-local" />
          <Input label="Capacidad maxima (opcional)" value={capacity} onChange={setCapacity} type="number" />
        </div>
        <div className="px-6 py-3 border-t border-border bg-bg-muted/30 flex justify-end gap-2 sticky bottom-0">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-full hover:bg-bg-muted">
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={!title.trim() || !startsAt || mut.isPending}
            className="text-sm px-4 py-1.5 bg-primary text-white rounded-full hover:opacity-90 disabled:opacity-40"
          >
            {mut.isPending ? "Creando..." : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Input({
  label, value, onChange, type = "text", placeholder, autoFocus, multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">{label}</div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          placeholder={placeholder}
          className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
        />
      )}
    </div>
  );
}

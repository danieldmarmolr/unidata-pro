"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Inbox, AtSign, Award, MessageCircle, MessageSquare, Megaphone, Bell, Check,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";
import { cn } from "@/lib/utils";
import type { NotificationItem, NotificationBadge } from "@/components/people/types";

const KIND_META: Record<string, { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; color: string }> = {
  mention: { icon: AtSign, label: "Menciones", color: "#0ea5e9" },
  kudo: { icon: Award, label: "Kudos", color: "#f59e0b" },
  comment: { icon: MessageCircle, label: "Comentarios", color: "#8b5cf6" },
  dm: { icon: MessageSquare, label: "DMs", color: "#10b981" },
  announcement: { icon: Megaphone, label: "Anuncios", color: "#ec4899" },
};

const FILTER_OPTIONS = ["all", "mention", "kudo", "comment", "dm", "announcement"] as const;

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

function kindLabel(kind: string, actorName: string | null): string {
  const actor = actorName ?? "Alguien";
  switch (kind) {
    case "mention": return `${actor} te menciono`;
    case "kudo": return `${actor} te dio kudos`;
    case "comment": return `${actor} comento un post tuyo`;
    case "dm": return `${actor} te mando un mensaje`;
    case "announcement": return `${actor} publico un anuncio`;
    default: return `${actor}`;
  }
}

export default function InboxPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<typeof FILTER_OPTIONS[number]>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data: badge } = useQuery<NotificationBadge>({
    queryKey: ["people-badge"],
    queryFn: () => api("/api/people/notifications/badge"),
    refetchInterval: 15_000,
  });

  const { data, isLoading } = useQuery<{ items: NotificationItem[] }>({
    queryKey: ["people-notifications-all", unreadOnly],
    queryFn: () =>
      api(`/api/people/notifications?limit=100${unreadOnly ? "&unread_only=true" : ""}`),
    staleTime: 10_000,
  });

  const items = (data?.items ?? []).filter((n) => filter === "all" || n.kind === filter);

  const readMut = useMutation({
    mutationFn: (id: number) =>
      api(`/api/people/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-badge"] });
      qc.invalidateQueries({ queryKey: ["people-notifications-all"] });
    },
  });

  const readAllMut = useMutation({
    mutationFn: () =>
      api("/api/people/notifications/read-all", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-badge"] });
      qc.invalidateQueries({ queryKey: ["people-notifications-all"] });
    },
  });

  // Counts per kind (basado en lo recibido para visual; no es source-of-truth absoluto)
  const counts = items.reduce<Record<string, number>>((acc, n) => {
    acc[n.kind] = (acc[n.kind] ?? 0) + 1;
    if (!n.read_at) acc[`${n.kind}_unread`] = (acc[`${n.kind}_unread`] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <Topbar
        title="Inbox"
        subtitle={
          badge?.total
            ? `${badge.total} sin leer (${badge.notifications_unread} notif + ${badge.dms_unread} DM)`
            : "Todo al dia"
        }
      />
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          {/* Toolbar */}
          <div className="bg-surface border border-border rounded-xl p-3 mb-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap gap-1">
              <FilterChip
                active={filter === "all"}
                onClick={() => setFilter("all")}
                icon={<Bell size={11} />}
                label="Todas"
              />
              {(["mention", "kudo", "comment", "dm", "announcement"] as const).map((k) => {
                const meta = KIND_META[k];
                const Icon = meta.icon;
                return (
                  <FilterChip
                    key={k}
                    active={filter === k}
                    onClick={() => setFilter(k)}
                    icon={<Icon size={11} />}
                    label={meta.label}
                    color={meta.color}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                  className="rounded"
                />
                Solo no leidas
              </label>
              {(badge?.notifications_unread ?? 0) > 0 && (
                <button
                  onClick={() => readAllMut.mutate()}
                  className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Check size={11} /> Marcar todo leido
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            {isLoading && (
              <div className="text-center py-16 text-text-muted text-sm">Cargando...</div>
            )}

            {!isLoading && items.length === 0 && (
              <div className="text-center py-16 px-4">
                <Inbox size={48} className="mx-auto text-text-muted mb-3 opacity-50" />
                <div className="text-sm font-semibold mb-1">
                  {unreadOnly ? "Sin notificaciones sin leer" : "Sin notificaciones"}
                </div>
                <div className="text-xs text-text-muted">
                  Aca veras menciones, kudos, comentarios, DMs y anuncios.
                </div>
              </div>
            )}

            {items.map((n) => {
              const meta = KIND_META[n.kind] ?? { icon: Bell, label: n.kind, color: "#7a3eae" };
              const Icon = meta.icon;
              const unread = !n.read_at;
              return (
                <Link
                  key={n.id}
                  href={n.link ?? "/dashboard/people"}
                  onClick={() => {
                    if (unread) readMut.mutate(n.id);
                  }}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 border-b border-border hover:bg-bg-muted transition",
                    unread && "bg-primary/5",
                  )}
                >
                  <div className="relative shrink-0">
                    <Avatar
                      name={n.actor_name ?? "?"}
                      url={n.actor_avatar}
                      size="md"
                      ringColor={n.actor_area_color ?? undefined}
                    />
                    <div
                      className="absolute -bottom-1 -right-1 rounded-full p-1 border-2 border-surface"
                      style={{ background: meta.color }}
                    >
                      <Icon size={10} className="text-white" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className={cn("text-sm", unread ? "font-bold text-primary" : "font-semibold")}>
                        {kindLabel(n.kind, n.actor_name)}
                      </div>
                      <div className="text-[10px] text-text-muted shrink-0">{timeAgo(n.created_at)}</div>
                    </div>
                    {n.preview && (
                      <div className="text-xs text-text-muted line-clamp-2 mt-0.5">{n.preview}</div>
                    )}
                  </div>
                  {unread && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function FilterChip({
  active, onClick, icon, label, color,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-xs px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 transition",
        active
          ? "border-transparent text-white"
          : "border-border hover:bg-bg-muted text-text",
      )}
      style={active ? { background: color ?? "#7a3eae" } : undefined}
    >
      {icon}
      {label}
    </button>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, MessageSquare, AtSign, Award, Megaphone, MessageCircle, ChevronRight, BellOff } from "lucide-react";
import { api } from "@/lib/api";
import { Avatar } from "./avatar";
import { cn } from "@/lib/utils";
import { useBrowserNotifications } from "./use-browser-notifications";
import type { NotificationItem, NotificationBadge } from "./types";

const ICON_BY_KIND: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  mention: AtSign,
  kudo: Award,
  comment: MessageCircle,
  dm: MessageSquare,
  announcement: Megaphone,
};

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

function kindLabel(kind: string, actorName: string | null): string {
  const actor = actorName ?? "Alguien";
  switch (kind) {
    case "mention": return `${actor} te menciono`;
    case "kudo": return `${actor} te dio kudos`;
    case "comment": return `${actor} comento tu post`;
    case "dm": return `${actor} te mando un mensaje`;
    case "announcement": return `${actor} publico un anuncio`;
    default: return `${actor}`;
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: badge } = useQuery<NotificationBadge>({
    queryKey: ["people-badge"],
    queryFn: () => api("/api/people/notifications/badge"),
    refetchInterval: 15_000,
    staleTime: 8_000,
  });

  const { data } = useQuery<{ items: NotificationItem[] }>({
    queryKey: ["people-notifications-recent"],
    queryFn: () => api("/api/people/notifications?limit=12"),
    enabled: open,
    staleTime: 5_000,
  });

  // Polling de notifs unread para browser push (corre siempre, no solo dropdown abierto)
  const pollQ = useQuery<{ items: NotificationItem[] }>({
    queryKey: ["people-notifications-poll"],
    queryFn: () => api("/api/people/notifications?unread_only=true&limit=8"),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const { permission, askPermission } = useBrowserNotifications(
    pollQ.data?.items,
    true,
  );

  const readMut = useMutation({
    mutationFn: (id: number) =>
      api(`/api/people/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-badge"] });
      qc.invalidateQueries({ queryKey: ["people-notifications-recent"] });
    },
  });

  const readAllMut = useMutation({
    mutationFn: () =>
      api("/api/people/notifications/read-all", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-badge"] });
      qc.invalidateQueries({ queryKey: ["people-notifications-recent"] });
    },
  });

  const total = badge?.total ?? 0;
  const hasUnread = total > 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative p-2 rounded-full transition",
          open ? "bg-bg-muted" : "hover:bg-bg-muted",
        )}
        title="Notificaciones"
      >
        {hasUnread ? (
          <BellRing size={18} className="text-primary" />
        ) : (
          <Bell size={18} className="text-text-muted" />
        )}
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-error text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-full mt-2 bg-surface border border-border rounded-xl shadow-2xl w-96 max-h-[80vh] overflow-hidden flex flex-col z-40">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="text-sm font-bold">Notificaciones</div>
              {hasUnread && (
                <button
                  onClick={() => readAllMut.mutate()}
                  className="text-[11px] text-primary font-semibold hover:underline"
                >
                  Marcar todo leido
                </button>
              )}
            </div>

            {permission !== "granted" && permission !== "denied" && (
              <button
                onClick={() => askPermission()}
                className="w-full px-4 py-2 bg-amber-50 hover:bg-amber-100 border-b border-amber-200 text-[11px] text-amber-800 inline-flex items-center justify-center gap-1.5 transition"
              >
                <Bell size={11} /> Activar notificaciones del navegador
              </button>
            )}
            {permission === "denied" && (
              <div className="px-4 py-2 bg-bg-muted/50 border-b border-border text-[10px] text-text-muted inline-flex items-center gap-1.5">
                <BellOff size={10} /> Push bloqueado por el navegador
              </div>
            )}

            {(badge?.dms_unread ?? 0) > 0 && (
              <Link
                href="/dashboard/people/dms"
                onClick={() => setOpen(false)}
                className="px-4 py-2.5 border-b border-border bg-primary/5 hover:bg-primary/10 transition flex items-center gap-3"
              >
                <MessageSquare size={16} className="text-primary" />
                <div className="flex-1">
                  <div className="text-xs font-bold text-primary">
                    {badge?.dms_unread} {badge?.dms_unread === 1 ? "DM nuevo" : "DMs nuevos"}
                  </div>
                  <div className="text-[10px] text-text-muted">Mensajes directos sin leer</div>
                </div>
                <ChevronRight size={12} className="text-text-muted" />
              </Link>
            )}

            <div className="flex-1 overflow-y-auto">
              {!data && (
                <div className="text-center py-10 text-text-muted text-xs">Cargando...</div>
              )}
              {data?.items?.length === 0 && (
                <div className="text-center py-10 text-text-muted text-xs">
                  Sin notificaciones todavia
                </div>
              )}
              {data?.items?.map((n) => {
                const Icon = ICON_BY_KIND[n.kind] ?? Bell;
                const unread = !n.read_at;
                return (
                  <Link
                    key={n.id}
                    href={n.link ?? "/dashboard/people"}
                    onClick={() => {
                      if (unread) readMut.mutate(n.id);
                      setOpen(false);
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
                        size="sm"
                        ringColor={n.actor_area_color ?? undefined}
                      />
                      <div
                        className="absolute -bottom-1 -right-1 rounded-full p-0.5 border-2 border-surface"
                        style={{ background: "#7a3eae" }}
                      >
                        <Icon size={10} className="text-white" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs">
                        <span className={cn("font-semibold", unread && "text-primary")}>
                          {kindLabel(n.kind, n.actor_name)}
                        </span>
                      </div>
                      {n.preview && (
                        <div className="text-[11px] text-text-muted line-clamp-2 mt-0.5">
                          {n.preview}
                        </div>
                      )}
                      <div className="text-[10px] text-text-muted mt-0.5">
                        {timeAgo(n.created_at)}
                      </div>
                    </div>
                    {unread && (
                      <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                    )}
                  </Link>
                );
              })}
            </div>

            <Link
              href="/dashboard/people/inbox"
              onClick={() => setOpen(false)}
              className="border-t border-border px-4 py-2.5 text-center text-xs font-semibold text-primary hover:bg-bg-muted transition"
            >
              Ver todo en el Inbox →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

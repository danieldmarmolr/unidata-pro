"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  MessageSquare, Send, Plus, Search, X, Users as UsersIcon, ArrowLeft, Image as ImageIcon,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";
import { ImageUploader } from "@/components/people/image-uploader";
import { cn } from "@/lib/utils";
import type {
  Conversation, DMMessage, DirectoryItem,
} from "@/components/people/types";

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

function conversationLabel(c: Conversation, myId: number | undefined): string {
  if (c.kind === "group" && c.name) return c.name;
  const others = c.members.filter((m) => m.id !== myId);
  if (others.length === 0) return "Mi nota";
  if (others.length === 1) return others[0].name;
  return others.map((m) => m.name.split(" ")[0]).slice(0, 3).join(", ") +
    (others.length > 3 ? ` +${others.length - 3}` : "");
}

export default function DMsPage() {
  const me = getUser();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const convsQ = useQuery<{ items: Conversation[] }>({
    queryKey: ["people-convs"],
    queryFn: () => api("/api/people/conversations"),
    refetchInterval: 8000,
    staleTime: 4000,
  });

  // Auto-select first conv on initial load
  useEffect(() => {
    if (!activeId && convsQ.data?.items?.length) {
      setActiveId(convsQ.data.items[0].id);
    }
  }, [convsQ.data, activeId]);

  const activeConv = useMemo(
    () => convsQ.data?.items.find((c) => c.id === activeId) ?? null,
    [convsQ.data, activeId],
  );

  return (
    <>
      <Topbar
        title="Mensajes directos"
        subtitle="Chat 1:1 y grupos ad-hoc con tu equipo"
      />
      <div className="flex-1 overflow-hidden flex bg-bg-muted/30">
        {/* Sidebar de conversaciones */}
        <div
          className={cn(
            "w-full sm:w-80 bg-surface border-r border-border flex flex-col",
            activeId !== null && "hidden sm:flex",
          )}
        >
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="text-sm font-bold">Conversaciones</div>
            <button
              onClick={() => setComposerOpen(true)}
              className="p-1.5 bg-primary text-white rounded-full hover:opacity-90 transition"
              title="Nuevo mensaje"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {convsQ.isLoading && (
              <div className="text-center py-12 text-text-muted text-xs">Cargando...</div>
            )}
            {!convsQ.isLoading && convsQ.data?.items?.length === 0 && (
              <div className="text-center py-12 px-4">
                <MessageSquare size={32} className="mx-auto text-text-muted mb-2" />
                <div className="text-xs font-semibold">Sin conversaciones</div>
                <div className="text-[11px] text-text-muted mt-1">
                  Empeza un DM con alguien del equipo
                </div>
                <button
                  onClick={() => setComposerOpen(true)}
                  className="mt-3 inline-flex items-center gap-1 text-xs px-3 py-1 bg-primary text-white rounded-full hover:opacity-90"
                >
                  <Plus size={12} /> Nuevo
                </button>
              </div>
            )}
            {convsQ.data?.items?.map((c) => (
              <ConversationRow
                key={c.id}
                conv={c}
                active={c.id === activeId}
                myId={me?.id}
                onClick={() => setActiveId(c.id)}
              />
            ))}
          </div>
        </div>

        {/* Pane de mensajes */}
        <div
          className={cn(
            "flex-1 flex flex-col bg-surface",
            activeId === null && "hidden sm:flex",
          )}
        >
          {activeConv ? (
            <MessagesPane
              conv={activeConv}
              myId={me?.id}
              onBack={() => setActiveId(null)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
              <div className="text-center">
                <MessageSquare size={48} className="mx-auto mb-2 opacity-40" />
                <div>Selecciona una conversacion</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {composerOpen && (
        <NewMessageModal
          onClose={() => setComposerOpen(false)}
          onCreated={(cid) => {
            setActiveId(cid);
            setComposerOpen(false);
          }}
        />
      )}
    </>
  );
}

function ConversationRow({
  conv, active, myId, onClick,
}: {
  conv: Conversation;
  active: boolean;
  myId: number | undefined;
  onClick: () => void;
}) {
  const others = conv.members.filter((m) => m.id !== myId);
  const primary = others[0];
  const label = conversationLabel(conv, myId);
  const isUnread = conv.unread_count > 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left flex items-start gap-3 px-3 py-2.5 border-b border-border transition",
        active ? "bg-primary/10" : "hover:bg-bg-muted",
      )}
    >
      {conv.kind === "group" || others.length > 1 ? (
        <div className="relative w-10 h-10 shrink-0">
          <Avatar name={primary?.name ?? "G"} size="md" />
          <div className="absolute -bottom-1 -right-1 bg-primary text-white text-[8px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
            {conv.members.length}
          </div>
        </div>
      ) : (
        <Avatar
          name={primary?.name ?? "?"}
          url={primary?.avatar_url ?? null}
          size="md"
          ringColor={primary?.area_color ?? undefined}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className={cn("text-sm truncate", isUnread ? "font-bold" : "font-semibold")}>
            {label}
          </div>
          <div className="text-[10px] text-text-muted shrink-0">
            {timeAgo(conv.last_message_at)}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <div className={cn(
            "text-[11px] truncate",
            isUnread ? "text-text font-semibold" : "text-text-muted",
          )}>
            {conv.last_preview ?? "(sin mensajes)"}
          </div>
          {isUnread && (
            <span className="bg-primary text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
              {conv.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function MessagesPane({
  conv, myId, onBack,
}: {
  conv: Conversation;
  myId: number | undefined;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showImage, setShowImage] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const msgsQ = useQuery<{ items: DMMessage[] }>({
    queryKey: ["people-messages", conv.id],
    queryFn: () => api(`/api/people/conversations/${conv.id}/messages?limit=50`),
    refetchInterval: 5000,
    staleTime: 2000,
  });

  // Marcar como leida cuando abro la conv
  useEffect(() => {
    api(`/api/people/conversations/${conv.id}/read`, { method: "POST" }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["people-convs"] });
    qc.invalidateQueries({ queryKey: ["people-badge"] });
  }, [conv.id, qc]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgsQ.data?.items?.length]);

  const sendMut = useMutation({
    mutationFn: () =>
      api<DMMessage>(`/api/people/conversations/${conv.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: text || "📎 (imagen)", image_url: imageUrl }),
      }),
    onSuccess: () => {
      setText("");
      setImageUrl(null);
      setShowImage(false);
      qc.invalidateQueries({ queryKey: ["people-messages", conv.id] });
      qc.invalidateQueries({ queryKey: ["people-convs"] });
    },
  });

  const label = conversationLabel(conv, myId);
  const others = conv.members.filter((m) => m.id !== myId);
  const subtitle = conv.kind === "group"
    ? `${conv.members.length} miembros`
    : others[0]?.job_title ?? others[0]?.email ?? "";

  return (
    <>
      <div className="px-4 py-3 border-b border-border bg-surface flex items-center gap-3">
        <button
          onClick={onBack}
          className="sm:hidden text-text-muted hover:text-text"
          aria-label="Volver"
        >
          <ArrowLeft size={18} />
        </button>
        {conv.kind === "dm" && others[0] ? (
          <Link href={`/dashboard/people/${others[0].id}`} className="shrink-0">
            <Avatar
              name={others[0].name}
              url={others[0].avatar_url}
              size="sm"
              ringColor={others[0].area_color ?? undefined}
            />
          </Link>
        ) : (
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <UsersIcon size={14} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate">{label}</div>
          <div className="text-[11px] text-text-muted truncate">{subtitle}</div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-bg-muted/20">
        {msgsQ.isLoading && (
          <div className="text-center py-12 text-text-muted text-sm">Cargando mensajes...</div>
        )}
        {msgsQ.data?.items?.length === 0 && (
          <div className="text-center py-12 text-text-muted text-sm">
            Sin mensajes. Empeza la conversacion.
          </div>
        )}
        {msgsQ.data?.items?.map((m, i) => {
          const isMine = m.author_id === myId;
          const prev = i > 0 ? msgsQ.data!.items[i - 1] : null;
          const showAuthor = !prev || prev.author_id !== m.author_id;
          return (
            <div
              key={m.id}
              className={cn(
                "flex gap-2",
                isMine ? "flex-row-reverse" : "flex-row",
              )}
            >
              {!isMine && showAuthor && (
                <Link href={`/dashboard/people/${m.author_id}`}>
                  <Avatar
                    name={m.author_name}
                    url={m.author_avatar}
                    size="sm"
                    ringColor={m.author_area_color ?? undefined}
                  />
                </Link>
              )}
              {!isMine && !showAuthor && <div className="w-8 shrink-0" />}
              <div className={cn("max-w-[70%] flex flex-col", isMine ? "items-end" : "items-start")}>
                {!isMine && showAuthor && (
                  <div className="text-[10px] text-text-muted font-semibold mb-0.5">
                    {m.author_name}
                  </div>
                )}
                <div
                  className={cn(
                    "rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm",
                    isMine
                      ? "bg-primary text-white rounded-br-md"
                      : "bg-white border border-border rounded-bl-md",
                  )}
                >
                  {m.content}
                </div>
                {m.image_url && (
                  <img src={m.image_url} alt="" className="mt-1 max-h-60 rounded-lg border border-border" />
                )}
                <div className="text-[9px] text-text-muted mt-0.5">{timeAgo(m.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border p-3 bg-surface">
        {(showImage || imageUrl) && (
          <div className="mb-2">
            <ImageUploader value={imageUrl} onChange={setImageUrl} compact />
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setShowImage((v) => !v)}
            className={cn(
              "p-2 rounded-full hover:bg-bg-muted transition",
              showImage && "text-primary",
            )}
            title="Adjuntar imagen"
          >
            <ImageIcon size={16} />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (text.trim() || imageUrl) sendMut.mutate();
              }
            }}
            placeholder="Escribi un mensaje..."
            rows={1}
            className="flex-1 bg-bg-muted border border-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none max-h-32"
          />
          <button
            onClick={() => (text.trim() || imageUrl) && sendMut.mutate()}
            disabled={(!text.trim() && !imageUrl) || sendMut.isPending}
            className="bg-primary text-white p-2 rounded-full hover:opacity-90 disabled:opacity-40 transition"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

function NewMessageModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (conversationId: number) => void;
}) {
  const me = getUser();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DirectoryItem[]>([]);
  const [groupName, setGroupName] = useState("");

  const { data } = useQuery<{ items: DirectoryItem[] }>({
    queryKey: ["people-directory"],
    queryFn: () => api("/api/people/directory"),
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    const s = search.trim().toLowerCase();
    const selIds = new Set(selected.map((u) => u.id));
    return data.items
      .filter((u) => u.id !== me?.id && u.is_active && !selIds.has(u.id))
      .filter((u) =>
        !s ||
        u.name.toLowerCase().includes(s) ||
        u.email.toLowerCase().includes(s) ||
        (u.area_name ?? "").toLowerCase().includes(s),
      )
      .slice(0, 50);
  }, [data, search, me?.id, selected]);

  const dmMut = useMutation({
    mutationFn: () =>
      api<{ conversation_id: number }>("/api/people/conversations/dm", {
        method: "POST",
        body: JSON.stringify({ user_id: selected[0].id }),
      }),
    onSuccess: (r) => onCreated(r.conversation_id),
  });

  const groupMut = useMutation({
    mutationFn: () =>
      api<{ conversation_id: number }>("/api/people/conversations/group", {
        method: "POST",
        body: JSON.stringify({
          name: groupName.trim() || null,
          member_ids: selected.map((u) => u.id),
        }),
      }),
    onSuccess: (r) => onCreated(r.conversation_id),
  });

  const isGroup = selected.length > 1;
  const canCreate = selected.length > 0 && (!isGroup || true);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="text-sm font-bold">
            {isGroup ? `Nuevo grupo (${selected.length})` : "Nuevo mensaje"}
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text p-1">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((u) => (
                <div
                  key={u.id}
                  className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs rounded-full pl-1 pr-2 py-1"
                >
                  <Avatar name={u.name} url={u.avatar_url} size="xs" />
                  <span className="font-semibold">{u.name}</span>
                  <button
                    onClick={() => setSelected((s) => s.filter((x) => x.id !== u.id))}
                    className="text-primary/70 hover:text-primary"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {isGroup && (
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Nombre del grupo (opcional)..."
              className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          )}

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar companeros..."
              className="w-full bg-bg-muted border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-primary"
              autoFocus
            />
          </div>

          <div className="space-y-1 max-h-72 overflow-y-auto">
            {filtered.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelected((s) => [...s, u])}
                className="w-full text-left flex items-center gap-3 p-2 rounded-lg hover:bg-bg-muted transition"
              >
                <Avatar name={u.name} url={u.avatar_url} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{u.name}</div>
                  <div className="text-[10px] text-text-muted truncate">
                    {u.job_title ?? ""}
                    {u.job_title && u.area_name && " · "}
                    {u.area_name ?? ""}
                  </div>
                </div>
              </button>
            ))}
            {filtered.length === 0 && search && (
              <div className="text-center py-6 text-text-muted text-xs">Sin resultados</div>
            )}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-border bg-bg-muted/30 flex items-center justify-between">
          <div className="text-[11px] text-text-muted">
            {selected.length === 0
              ? "Selecciona 1 persona para DM o varias para crear grupo"
              : isGroup
                ? "Se creara un grupo"
                : "Se abrira un DM 1:1"}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-full hover:bg-bg-muted transition"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                if (isGroup) groupMut.mutate();
                else dmMut.mutate();
              }}
              disabled={!canCreate || dmMut.isPending || groupMut.isPending}
              className="px-4 py-1.5 bg-primary text-white text-sm font-semibold rounded-full hover:opacity-90 disabled:opacity-40 transition"
            >
              {dmMut.isPending || groupMut.isPending ? "Creando..." : "Empezar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

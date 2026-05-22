"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle, Pin, PinOff, MoreHorizontal, Trash2, CheckCircle2,
  Megaphone, Smile, Send, Bookmark, Pencil, X,
} from "lucide-react";
import { api, getUser } from "@/lib/api";
import { Avatar } from "./avatar";
import { cn } from "@/lib/utils";
import { MentionTextarea, renderContentWithMentions } from "./mention-textarea";
import { PollDisplay } from "./poll";
import type { FeedPost, FeedComment } from "./types";

const QUICK_REACTIONS = ["👍", "❤️", "🎉", "🚀", "👏", "🔥"];

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

export function PostCard({ post, canManage }: { post: FeedPost; canManage: boolean }) {
  const qc = useQueryClient();
  const me = getUser();
  const isAuthor = me?.id === post.author_id;
  const canEdit = isAuthor || canManage;
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.content);
  const [editMentions, setEditMentions] = useState<number[]>([]);

  const editMut = useMutation({
    mutationFn: () =>
      api(`/api/people/feed/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: editText, mention_user_ids: editMentions }),
      }),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["people-feed"] });
    },
  });

  const bookmarkMut = useMutation({
    mutationFn: () =>
      api<{ bookmarked: boolean }>(`/api/people/feed/${post.id}/bookmark`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-feed"] });
      qc.invalidateQueries({ queryKey: ["people-bookmarks"] });
    },
  });

  const reactMut = useMutation({
    mutationFn: (emoji: string) =>
      api(`/api/people/feed/${post.id}/react`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people-feed"] }),
  });

  const deleteMut = useMutation({
    mutationFn: () => api(`/api/people/feed/${post.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people-feed"] }),
  });

  const pinMut = useMutation({
    mutationFn: () =>
      api(`/api/people/feed/${post.id}/${post.pinned ? "unpin" : "pin"}`, {
        method: "POST",
        body: JSON.stringify(post.pinned ? {} : { requires_read_ack: false }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people-feed"] }),
  });

  const markReadMut = useMutation({
    mutationFn: () => api(`/api/people/feed/${post.id}/read`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people-feed"] }),
  });

  return (
    <article
      className={cn(
        "bg-surface border rounded-xl p-5",
        post.pinned ? "border-amber-300 ring-1 ring-amber-200" : "border-border",
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href={`/dashboard/people/${post.author_id}`}>
          <Avatar
            name={post.author_name}
            url={post.author_avatar}
            size="md"
            ringColor={post.author_area_color ?? undefined}
          />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/dashboard/people/${post.author_id}`}
              className="font-semibold text-text hover:underline truncate"
            >
              {post.author_name}
            </Link>
            {post.space_name && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{
                  background: `${post.space_color}15`,
                  color: post.space_color ?? "#666",
                }}
                title={`Espacio: ${post.space_name}`}
              >
                <span className="text-[10px]">{post.space_emoji}</span>
                {post.space_name}
              </span>
            )}
            {post.author_area_name && post.space_kind !== "area" && (
              <span
                className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{
                  background: `${post.author_area_color}20`,
                  color: post.author_area_color ?? "#666",
                }}
              >
                {post.author_area_name}
              </span>
            )}
            {post.pinned && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                <Pin size={10} /> Fijado
              </span>
            )}
            {post.is_announcement && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
                <Megaphone size={10} /> Anuncio
              </span>
            )}
          </div>
          <div className="text-[11px] text-text-muted">
            {post.author_job && <span>{post.author_job} · </span>}
            <span title={post.created_at}>{timeAgo(post.created_at)}</span>
          </div>
        </div>

        {(canEdit || canManage) && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-1 rounded hover:bg-bg-muted text-text-muted"
              aria-label="Acciones"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-7 bg-surface border border-border rounded-lg shadow-lg z-10 min-w-[160px] py-1"
                onMouseLeave={() => setMenuOpen(false)}
              >
                {canManage && (
                  <button
                    onClick={() => {
                      pinMut.mutate();
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-bg-muted inline-flex items-center gap-2"
                  >
                    {post.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                    {post.pinned ? "Despinear" : "Pinear como anuncio"}
                  </button>
                )}
                {canEdit && (
                  <>
                    <button
                      onClick={() => {
                        setEditing(true);
                        setEditText(post.content);
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-bg-muted inline-flex items-center gap-2"
                    >
                      <Pencil size={12} /> Editar
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("Borrar este post?")) deleteMut.mutate();
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-bg-muted inline-flex items-center gap-2 text-error"
                    >
                      <Trash2 size={12} /> Borrar
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Kudo card especial */}
      {post.kudo && (
        <div
          className="mt-3 mb-2 rounded-lg p-3"
          style={{
            background: `linear-gradient(135deg, ${post.kudo.value_color}15, ${post.kudo.value_color}05)`,
            border: `1px solid ${post.kudo.value_color}40`,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{post.kudo.value_emoji}</span>
            <div className="flex-1">
              <div className="text-xs font-bold" style={{ color: post.kudo.value_color ?? "#000" }}>
                #{post.kudo.value_name ?? post.kudo.value_slug}
              </div>
              <div className="text-[11px] text-text-muted">Reconocimiento</div>
            </div>
            <Link
              href={`/dashboard/people/${post.kudo.to_user_id}`}
              className="inline-flex items-center gap-2 bg-white rounded-full pl-1 pr-3 py-1 border border-border hover:shadow-sm transition"
            >
              <Avatar name={post.kudo.to_name} url={post.kudo.to_avatar} size="xs" />
              <span className="text-xs font-semibold">{post.kudo.to_name}</span>
            </Link>
          </div>
          {post.kudo.message && (
            <div className="text-xs text-text italic mt-2">"{post.kudo.message}"</div>
          )}
        </div>
      )}

      {/* Content (edit mode or read) */}
      {editing ? (
        <div className="mt-3">
          <MentionTextarea
            value={editText}
            onChange={(v, ids) => {
              setEditText(v);
              setEditMentions(ids);
            }}
            rows={3}
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => setEditing(false)}
              className="text-xs px-3 py-1 rounded-full hover:bg-bg-muted"
            >
              <X size={11} className="inline mr-1" /> Cancelar
            </button>
            <button
              onClick={() => editText.trim() && editMut.mutate()}
              disabled={!editText.trim() || editMut.isPending}
              className="text-xs px-3 py-1 bg-primary text-white rounded-full hover:opacity-90 disabled:opacity-40"
            >
              {editMut.isPending ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      ) : (
        (!post.kudo || post.kudo.message !== post.content.split("\n\n").pop()) && (
          <div className="mt-3 text-sm text-text whitespace-pre-wrap break-words">
            {renderContentWithMentions(post.content)}
            {post.edited_at && (
              <span className="ml-1.5 text-[10px] text-text-muted italic">(editado)</span>
            )}
          </div>
        )
      )}

      {/* Poll */}
      {post.poll && <PollDisplay postId={post.id} poll={post.poll} />}

      {post.image_url && (
        <img
          src={post.image_url}
          alt=""
          className="mt-3 rounded-lg max-h-[480px] w-full object-cover border border-border"
        />
      )}

      {/* Reactions strip */}
      {post.reactions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {post.reactions.map((r) => (
            <button
              key={r.emoji}
              onClick={() => reactMut.mutate(r.emoji)}
              className={cn(
                "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition",
                r.reacted
                  ? "border-primary/40 bg-primary/10 text-primary font-semibold"
                  : "border-border bg-bg-muted hover:bg-border",
              )}
              title={r.reacted ? "Quitar reaccion" : "Reaccionar"}
            >
              <span>{r.emoji}</span>
              <span className="tabular-nums">{r.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-border flex items-center gap-1 text-xs text-text-muted">
        <div className="relative">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-muted"
          >
            <Smile size={14} /> Reaccionar
          </button>
          {pickerOpen && (
            <div
              className="absolute left-0 bottom-8 bg-surface border border-border rounded-lg shadow-lg z-10 p-1 flex gap-1"
              onMouseLeave={() => setPickerOpen(false)}
            >
              {QUICK_REACTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    reactMut.mutate(e);
                    setPickerOpen(false);
                  }}
                  className="w-8 h-8 text-lg hover:bg-bg-muted rounded transition"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => setCommentsOpen((v) => !v)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-muted"
        >
          <MessageCircle size={14} />
          Comentar {post.comment_count > 0 && `(${post.comment_count})`}
        </button>
        <button
          onClick={() => bookmarkMut.mutate()}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-muted transition",
            post.bookmarked && "text-primary",
          )}
          title={post.bookmarked ? "Quitar bookmark" : "Guardar"}
        >
          <Bookmark size={14} className={post.bookmarked ? "fill-current" : ""} />
        </button>
        {post.requires_read_ack && !post.has_read && (
          <button
            onClick={() => markReadMut.mutate()}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-100 text-emerald-700 font-semibold hover:bg-emerald-200"
          >
            <CheckCircle2 size={14} /> Marcar leido
          </button>
        )}
        {post.requires_read_ack && post.has_read && (
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-emerald-600">
            <CheckCircle2 size={14} /> Leido
          </span>
        )}
      </div>

      {/* Comments section */}
      {commentsOpen && (
        <CommentSection
          postId={post.id}
          onAdded={(_c) => {
            qc.invalidateQueries({ queryKey: ["people-feed"] });
          }}
          commentText={commentText}
          setCommentText={setCommentText}
        />
      )}
    </article>
  );
}

function CommentSection({
  postId,
  onAdded,
  commentText,
  setCommentText,
}: {
  postId: number;
  onAdded: (c: FeedComment) => void;
  commentText: string;
  setCommentText: (v: string) => void;
}) {
  const qc = useQueryClient();
  const me = getUser();
  const [mentions, setMentions] = useState<number[]>([]);
  const { data } = useQuery<{ items: FeedComment[]; count: number }>({
    queryKey: ["people-feed-comments", postId],
    queryFn: () => api(`/api/people/feed/${postId}/comments`),
    staleTime: 10_000,
  });

  const createMut = useMutation({
    mutationFn: () =>
      api<FeedComment>(`/api/people/feed/${postId}/comments`, {
        method: "POST",
        body: JSON.stringify({ content: commentText, mention_user_ids: mentions }),
      }),
    onSuccess: (c) => {
      setCommentText("");
      setMentions([]);
      qc.invalidateQueries({ queryKey: ["people-feed-comments", postId] });
      onAdded(c);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (cid: number) =>
      api(`/api/people/comments/${cid}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-feed-comments", postId] });
      qc.invalidateQueries({ queryKey: ["people-feed"] });
    },
  });

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-3">
      {data?.items?.map((c) => (
        <div key={c.id} className="flex gap-2">
          <Link href={`/dashboard/people/${c.author_id}`}>
            <Avatar name={c.author_name} url={c.author_avatar} size="sm" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="bg-bg-muted rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 mb-0.5">
                <Link
                  href={`/dashboard/people/${c.author_id}`}
                  className="text-xs font-semibold text-text hover:underline"
                >
                  {c.author_name}
                </Link>
                <span className="text-[10px] text-text-muted">{timeAgo(c.created_at)}</span>
              </div>
              <div className="text-xs text-text whitespace-pre-wrap break-words">
                {renderContentWithMentions(c.content)}
              </div>
            </div>
            {(me?.id === c.author_id || me?.is_admin) && (
              <button
                onClick={() => {
                  if (confirm("Borrar este comentario?")) deleteMut.mutate(c.id);
                }}
                className="text-[10px] text-text-muted hover:text-error mt-0.5 ml-2"
              >
                Borrar
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="flex gap-2">
        <Avatar name={me?.name ?? "?"} size="sm" />
        <div className="flex-1">
          <MentionTextarea
            value={commentText}
            onChange={(v, ids) => {
              setCommentText(v);
              setMentions(ids);
            }}
            placeholder="Comentar... Usa @ para mencionar"
            rows={1}
            className="text-xs"
            onSubmit={() => {
              if (commentText.trim()) createMut.mutate();
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (commentText.trim()) createMut.mutate();
          }}
          disabled={!commentText.trim() || createMut.isPending}
          className="px-3 py-2 bg-primary text-white rounded-full hover:opacity-90 disabled:opacity-40 transition self-end h-9"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Search, X, Sparkles } from "lucide-react";
import { api, getUser } from "@/lib/api";
import { Avatar } from "./avatar";
import type { DirectoryItem, PeopleValue } from "./types";

export function KudoModal({
  onClose,
  defaultRecipientId,
}: {
  onClose: () => void;
  defaultRecipientId?: number;
}) {
  const qc = useQueryClient();
  const me = getUser();
  const [search, setSearch] = useState("");
  const [recipientId, setRecipientId] = useState<number | null>(defaultRecipientId ?? null);
  const [valueSlug, setValueSlug] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const { data: dir } = useQuery<{ items: DirectoryItem[] }>({
    queryKey: ["people-directory"],
    queryFn: () => api("/api/people/directory"),
    staleTime: 5 * 60_000,
  });

  const { data: values } = useQuery<{ items: PeopleValue[] }>({
    queryKey: ["people-values"],
    queryFn: () => api("/api/people/values"),
    staleTime: 60 * 60_000,
  });

  const recipient = useMemo(
    () => dir?.items?.find((u) => u.id === recipientId) ?? null,
    [dir, recipientId],
  );

  const filtered = useMemo(() => {
    if (!dir?.items) return [];
    const s = search.trim().toLowerCase();
    return dir.items
      .filter((u) => u.id !== me?.id && u.is_active)
      .filter((u) =>
        !s ||
        u.name.toLowerCase().includes(s) ||
        u.email.toLowerCase().includes(s) ||
        (u.area_name ?? "").toLowerCase().includes(s),
      )
      .slice(0, 50);
  }, [dir, search, me?.id]);

  const mut = useMutation({
    mutationFn: () =>
      api("/api/people/kudos", {
        method: "POST",
        body: JSON.stringify({
          to_user_id: recipientId,
          value_slug: valueSlug,
          message: message,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-feed"] });
      qc.invalidateQueries({ queryKey: ["people-kudos"] });
      onClose();
    },
  });

  const canSubmit = recipientId && valueSlug && !mut.isPending;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <Award size={18} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-text">Dar kudos</div>
              <div className="text-[11px] text-text-muted">Reconoce a un companero</div>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text p-1">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Recipient */}
          <div>
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Para quien
            </div>
            {recipient ? (
              <div className="flex items-center justify-between bg-bg-muted rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <Avatar name={recipient.name} url={recipient.avatar_url} size="md" />
                  <div>
                    <div className="text-sm font-semibold">{recipient.name}</div>
                    <div className="text-[11px] text-text-muted">
                      {recipient.job_title ?? ""}
                      {recipient.job_title && recipient.area_name && " · "}
                      {recipient.area_name ?? ""}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setRecipientId(null)}
                  className="text-text-muted hover:text-error text-xs"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar companero..."
                    className="w-full bg-bg-muted border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-primary"
                    autoFocus
                  />
                </div>
                <div className="mt-2 max-h-56 overflow-y-auto space-y-1">
                  {filtered.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => setRecipientId(u.id)}
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
                  {filtered.length === 0 && (
                    <div className="text-xs text-text-muted text-center py-4">Sin resultados</div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Value */}
          <div>
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Por que valor
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {values?.items?.map((v) => (
                <button
                  key={v.slug}
                  onClick={() => setValueSlug(v.slug)}
                  className={`text-left p-2.5 rounded-lg border transition ${
                    valueSlug === v.slug ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-text-muted"
                  }`}
                  style={
                    valueSlug === v.slug
                      ? { background: `${v.color}15` }
                      : undefined
                  }
                >
                  <div className="text-2xl mb-1">{v.emoji}</div>
                  <div className="text-xs font-semibold text-text">{v.name}</div>
                  <div className="text-[10px] text-text-muted truncate">{v.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Message */}
          <div>
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Mensaje (opcional)
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Decile por que..."
              rows={3}
              className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-bg-muted/30">
          <div className="text-[11px] text-text-muted">
            <Sparkles size={10} className="inline mr-1" />
            Aparecera en el feed
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm rounded-full hover:bg-bg-muted transition"
            >
              Cancelar
            </button>
            <button
              onClick={() => mut.mutate()}
              disabled={!canSubmit}
              className="px-4 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold rounded-full hover:opacity-90 disabled:opacity-40 transition inline-flex items-center gap-1.5"
            >
              <Award size={14} />
              {mut.isPending ? "Enviando..." : "Dar kudos"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

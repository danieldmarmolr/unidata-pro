"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Award, Send, X, ChevronDown, BarChart3 } from "lucide-react";
import { api, getUser } from "@/lib/api";
import { Avatar } from "./avatar";
import { KudoModal } from "./kudo-modal";
import { MentionTextarea } from "./mention-textarea";
import { PollCreator } from "./poll";
import { cn } from "@/lib/utils";
import type { Space } from "./types";

type DraftPoll = { question: string; options: string[]; multi_choice: boolean };

export function PostComposer({
  canPin,
  forceSpaceId,
}: {
  canPin: boolean;
  forceSpaceId?: number;
}) {
  const qc = useQueryClient();
  const me = getUser();
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<number[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showImageInput, setShowImageInput] = useState(false);
  const [kudoOpen, setKudoOpen] = useState(false);
  const [spaceId, setSpaceId] = useState<number | null>(forceSpaceId ?? null);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [poll, setPoll] = useState<DraftPoll | null>(null);

  const { data: spaces } = useQuery<{ items: Space[] }>({
    queryKey: ["people-spaces"],
    queryFn: () => api("/api/people/spaces"),
    staleTime: 5 * 60_000,
  });

  // Por defecto, primer espacio del viewer (random suele ser el primero)
  const effectiveSpaceId = spaceId ??
    spaces?.items?.find((s) => s.slug === "random")?.id ??
    spaces?.items?.[0]?.id ??
    null;
  const effectiveSpace = spaces?.items?.find((s) => s.id === effectiveSpaceId);

  const mut = useMutation({
    mutationFn: () =>
      api("/api/people/feed", {
        method: "POST",
        body: JSON.stringify({
          content: text,
          image_url: imageUrl,
          space_id: effectiveSpaceId,
          mention_user_ids: mentions,
          poll: poll ?? undefined,
        }),
      }),
    onSuccess: () => {
      setText("");
      setMentions([]);
      setImageUrl(null);
      setShowImageInput(false);
      setPoll(null);
      setPollOpen(false);
      qc.invalidateQueries({ queryKey: ["people-feed"] });
      qc.invalidateQueries({ queryKey: ["people-spaces"] });
    },
  });

  const isAdminPolicySpace = effectiveSpace?.posting_policy === "admins_only";
  const blockedByPolicy = isAdminPolicySpace && !canPin;

  return (
    <>
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex gap-3">
          <Avatar name={me?.name ?? "?"} size="md" />
          <div className="flex-1">
            {/* Space picker chip */}
            {!forceSpaceId && spaces?.items && spaces.items.length > 0 && (
              <div className="mb-2 relative">
                <button
                  type="button"
                  onClick={() => setSpacePickerOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs bg-bg-muted hover:bg-border border border-border rounded-full px-2.5 py-1 transition"
                >
                  <span>{effectiveSpace?.emoji ?? "💬"}</span>
                  <span className="font-semibold">{effectiveSpace?.name ?? "Espacio"}</span>
                  <ChevronDown size={12} className="text-text-muted" />
                </button>
                {spacePickerOpen && (
                  <SpacePicker
                    spaces={spaces.items}
                    currentId={effectiveSpaceId}
                    onPick={(id) => {
                      setSpaceId(id);
                      setSpacePickerOpen(false);
                    }}
                    onClose={() => setSpacePickerOpen(false)}
                  />
                )}
              </div>
            )}

            <MentionTextarea
              value={text}
              onChange={(v, ids) => {
                setText(v);
                setMentions(ids);
              }}
              placeholder={
                blockedByPolicy
                  ? `Solo admin/People puede postear en ${effectiveSpace?.name}`
                  : `Que esta pasando, ${me?.name?.split(" ")[0] ?? "vos"}? Usa @ para mencionar.`
              }
              rows={2}
            />

            {showImageInput && (
              <div className="mt-2 flex gap-2">
                <input
                  type="url"
                  value={imageUrl ?? ""}
                  onChange={(e) => setImageUrl(e.target.value || null)}
                  placeholder="URL de imagen..."
                  className="flex-1 text-xs bg-bg-muted border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary"
                />
                <button
                  onClick={() => {
                    setShowImageInput(false);
                    setImageUrl(null);
                  }}
                  className="text-text-muted hover:text-text p-1"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {imageUrl && !showImageInput && (
              <div className="mt-2 relative inline-block">
                <img src={imageUrl} alt="" className="max-h-40 rounded-lg border border-border" />
                <button
                  onClick={() => setImageUrl(null)}
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-black"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {pollOpen && (
              <PollCreator
                onChange={setPoll}
                onCancel={() => {
                  setPollOpen(false);
                  setPoll(null);
                }}
              />
            )}

            <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
              <div className="flex items-center gap-1 text-xs text-text-muted">
                <button
                  type="button"
                  onClick={() => setShowImageInput((v) => !v)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-muted transition"
                >
                  <ImageIcon size={14} /> Imagen
                </button>
                <button
                  type="button"
                  onClick={() => setPollOpen((v) => !v)}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-muted transition",
                    pollOpen && "text-primary",
                  )}
                >
                  <BarChart3 size={14} /> Encuesta
                </button>
                <button
                  type="button"
                  onClick={() => setKudoOpen(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-muted transition text-amber-700"
                >
                  <Award size={14} /> Dar kudos
                </button>
                {mentions.length > 0 && (
                  <span className="ml-1 text-[10px] text-primary font-semibold">
                    {mentions.length} {mentions.length === 1 ? "mencion" : "menciones"}
                  </span>
                )}
              </div>

              <button
                onClick={() => text.trim() && mut.mutate()}
                disabled={!text.trim() || mut.isPending || blockedByPolicy}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white text-sm font-semibold rounded-full hover:opacity-90 disabled:opacity-40 transition"
              >
                <Send size={14} />
                {mut.isPending ? "Publicando..." : "Publicar"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {kudoOpen && <KudoModal onClose={() => setKudoOpen(false)} />}
    </>
  );
}

function SpacePicker({
  spaces,
  currentId,
  onPick,
  onClose,
}: {
  spaces: Space[];
  currentId: number | null;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const globals = spaces.filter((s) => s.kind === "global");
  const areas = spaces.filter((s) => s.kind === "area");
  const customs = spaces.filter((s) => s.kind === "custom");

  return (
    <div
      className="absolute left-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-lg z-30 w-72 max-h-80 overflow-y-auto py-1"
      onMouseLeave={onClose}
    >
      <PickerGroup title="Globales" spaces={globals} currentId={currentId} onPick={onPick} />
      <PickerGroup title="Areas" spaces={areas} currentId={currentId} onPick={onPick} />
      {customs.length > 0 && (
        <PickerGroup title="Otros" spaces={customs} currentId={currentId} onPick={onPick} />
      )}
    </div>
  );
}

function PickerGroup({
  title,
  spaces,
  currentId,
  onPick,
}: {
  title: string;
  spaces: Space[];
  currentId: number | null;
  onPick: (id: number) => void;
}) {
  if (spaces.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted px-3 pt-2 pb-1">
        {title}
      </div>
      {spaces.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s.id)}
          className={cn(
            "w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-muted transition",
            currentId === s.id && "bg-primary/10 text-primary font-semibold",
          )}
        >
          <span>{s.emoji}</span>
          <span className="flex-1 truncate">{s.name}</span>
          {s.posting_policy === "admins_only" && (
            <span className="text-[9px] text-text-muted/70 uppercase">solo admin</span>
          )}
        </button>
      ))}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Award, Megaphone, Send, X } from "lucide-react";
import { api, getUser } from "@/lib/api";
import { Avatar } from "./avatar";
import { KudoModal } from "./kudo-modal";

export function PostComposer({ canPin }: { canPin: boolean }) {
  const qc = useQueryClient();
  const me = getUser();
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showImageInput, setShowImageInput] = useState(false);
  const [kudoOpen, setKudoOpen] = useState(false);

  const mut = useMutation({
    mutationFn: () =>
      api("/api/people/feed", {
        method: "POST",
        body: JSON.stringify({ content: text, image_url: imageUrl }),
      }),
    onSuccess: () => {
      setText("");
      setImageUrl(null);
      setShowImageInput(false);
      qc.invalidateQueries({ queryKey: ["people-feed"] });
    },
  });

  return (
    <>
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex gap-3">
          <Avatar name={me?.name ?? "?"} size="md" />
          <div className="flex-1">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Que esta pasando, ${me?.name?.split(" ")[0] ?? "vos"}?`}
              rows={2}
              className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
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

            <div className="flex items-center justify-between mt-3">
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
                  onClick={() => setKudoOpen(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-muted transition text-amber-700"
                >
                  <Award size={14} /> Dar kudos
                </button>
                {canPin && text.trim() && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-violet-700">
                    <Megaphone size={11} /> Despues de publicar lo pineas con el menu
                  </span>
                )}
              </div>

              <button
                onClick={() => text.trim() && mut.mutate()}
                disabled={!text.trim() || mut.isPending}
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

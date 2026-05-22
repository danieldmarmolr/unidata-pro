"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Avatar } from "./avatar";
import { cn } from "@/lib/utils";
import type { MentionUser } from "./types";

/**
 * Textarea con autocompletar de @-menciones.
 *
 * Storage format en el content: `@[Nombre Apellido|123]` para mentions
 * (el render side parsea esa sintaxis).
 *
 * El componente expone:
 *   value (string crudo con sintaxis @[name|id])
 *   onChange(value, mention_user_ids)
 */
export function MentionTextarea({
  value,
  onChange,
  placeholder,
  rows = 2,
  className,
  autoFocus = false,
  onSubmit,
}: {
  value: string;
  onChange: (value: string, mentionUserIds: number[]) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  autoFocus?: boolean;
  /** Si viene, ENTER (sin shift) dispara este callback en vez de saltar linea. */
  onSubmit?: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [mentionState, setMentionState] = useState<{
    open: boolean;
    query: string;
    startIdx: number;
  } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // Re-detecta menciones existentes para devolver IDs cada vez que cambia el value
  function extractMentionIds(text: string): number[] {
    const re = /@\[[^|\]]+\|(\d+)\]/g;
    const out: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push(parseInt(m[1], 10));
    }
    return out;
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    const ids = extractMentionIds(next);
    onChange(next, ids);

    // Detectar trigger de @
    const ta = e.target;
    const caret = ta.selectionStart ?? next.length;
    const beforeCaret = next.slice(0, caret);
    const atMatch = /@([\wáéíóúñ.\-]{0,40})$/i.exec(beforeCaret);
    if (atMatch) {
      setMentionState({
        open: true,
        query: atMatch[1],
        startIdx: caret - atMatch[0].length,
      });
      setActiveIdx(0);
    } else {
      setMentionState(null);
    }
  }

  function selectMention(user: MentionUser) {
    if (!mentionState || !taRef.current) return;
    const ta = taRef.current;
    const caret = ta.selectionStart ?? value.length;
    const before = value.slice(0, mentionState.startIdx);
    const after = value.slice(caret);
    const inserted = `@[${user.name}|${user.id}] `;
    const next = before + inserted + after;
    const ids = extractMentionIds(next);
    onChange(next, ids);
    setMentionState(null);
    // Re-focus + position caret after inserted
    setTimeout(() => {
      ta.focus();
      const pos = before.length + inserted.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  // Cerrar con click fuera
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!mentionState) return;
      const ta = taRef.current;
      if (ta && !ta.contains(e.target as Node)) setMentionState(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [mentionState]);

  return (
    <div className="relative">
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (mentionState && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape")) {
            if (e.key === "Escape") {
              e.preventDefault();
              setMentionState(null);
              return;
            }
            // Esc lo manejamos arriba; Enter selecciona la activa
            // Si la suggestion list NO carga aun, deja pasar Enter normal
            const list = (e.currentTarget.parentElement?.querySelector("[data-mention-list]") as HTMLElement | null);
            if (!list) return;
            const items = list.querySelectorAll<HTMLButtonElement>("button[data-mention-item]");
            if (items.length === 0) return;
            e.preventDefault();
            if (e.key === "ArrowDown") setActiveIdx((i) => Math.min(i + 1, items.length - 1));
            if (e.key === "ArrowUp") setActiveIdx((i) => Math.max(i - 1, 0));
            if (e.key === "Enter") items[activeIdx]?.click();
            return;
          }
          if (onSubmit && e.key === "Enter" && !e.shiftKey && !mentionState) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        className={cn(
          "w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none",
          className,
        )}
      />
      {mentionState && (
        <MentionDropdown
          query={mentionState.query}
          activeIdx={activeIdx}
          onSelect={selectMention}
          onSetActive={setActiveIdx}
        />
      )}
    </div>
  );
}

function MentionDropdown({
  query,
  activeIdx,
  onSelect,
  onSetActive,
}: {
  query: string;
  activeIdx: number;
  onSelect: (u: MentionUser) => void;
  onSetActive: (i: number) => void;
}) {
  const { data } = useQuery<{ items: MentionUser[] }>({
    queryKey: ["people-mention-search", query],
    queryFn: () => api(`/api/people/users/search?q=${encodeURIComponent(query)}&limit=6`),
    staleTime: 10_000,
  });

  if (!data?.items || data.items.length === 0) {
    return (
      <div
        data-mention-list
        className="absolute left-0 right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-lg p-2 text-xs text-text-muted z-30"
      >
        Sin resultados para "@{query}"
      </div>
    );
  }

  return (
    <div
      data-mention-list
      className="absolute left-0 right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-56 overflow-y-auto z-30"
    >
      {data.items.map((u, i) => (
        <button
          key={u.id}
          type="button"
          data-mention-item
          onClick={() => onSelect(u)}
          onMouseEnter={() => onSetActive(i)}
          className={cn(
            "w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs transition",
            i === activeIdx ? "bg-primary/10" : "hover:bg-bg-muted",
          )}
        >
          <Avatar name={u.name} url={u.avatar_url} size="xs" ringColor={u.area_color ?? undefined} />
          <span className="font-semibold truncate flex-1">{u.name}</span>
          <span className="text-[10px] text-text-muted truncate">{u.area_name ?? u.email}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Render-side helper: convierte content con `@[Name|123]` en JSX con links clickeables.
 */
export function renderContentWithMentions(content: string): React.ReactNode[] {
  const re = /@\[([^|\]]+)\|(\d+)\]/g;
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(content)) !== null) {
    if (m.index > lastIdx) {
      out.push(<span key={key++}>{content.slice(lastIdx, m.index)}</span>);
    }
    const name = m[1];
    const id = m[2];
    out.push(
      <a
        key={key++}
        href={`/dashboard/people/${id}`}
        className="text-primary font-semibold hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        @{name}
      </a>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < content.length) {
    out.push(<span key={key++}>{content.slice(lastIdx)}</span>);
  }
  return out;
}

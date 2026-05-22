"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, X, Plus, Check } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Poll } from "./types";

export function PollDisplay({ postId, poll }: { postId: number; poll: Poll }) {
  const qc = useQueryClient();
  const closed = poll.closes_at ? new Date(poll.closes_at) < new Date() : false;
  const totalVotes = poll.options.reduce((acc, o) => acc + o.votes, 0);

  const voteMut = useMutation({
    mutationFn: (optionId: number) =>
      api(`/api/people/feed/${postId}/poll/vote`, {
        method: "POST",
        body: JSON.stringify({ option_id: optionId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people-feed"] }),
  });

  const unvoteMut = useMutation({
    mutationFn: (optionId: number) =>
      api(`/api/people/feed/${postId}/poll/vote?option_id=${optionId}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people-feed"] }),
  });

  function handleClick(optionId: number, currentlyVoted: boolean) {
    if (closed) return;
    if (poll.multi_choice) {
      if (currentlyVoted) unvoteMut.mutate(optionId);
      else voteMut.mutate(optionId);
    } else {
      if (currentlyVoted) unvoteMut.mutate(optionId);
      else voteMut.mutate(optionId);
    }
  }

  return (
    <div className="mt-3 bg-bg-muted/50 border border-border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 size={14} className="text-primary" />
        <div className="text-sm font-bold text-text">{poll.question}</div>
        {closed && (
          <span className="text-[9px] font-bold uppercase text-text-muted bg-bg-muted px-2 py-0.5 rounded-full ml-auto">
            Cerrada
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {poll.options.map((o) => {
          const pct = totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => handleClick(o.id, o.my_vote)}
              disabled={closed || voteMut.isPending || unvoteMut.isPending}
              className={cn(
                "relative w-full text-left px-3 py-2 rounded-md text-xs overflow-hidden border transition",
                o.my_vote
                  ? "border-primary bg-primary/5 font-semibold"
                  : "border-border bg-white hover:border-text-muted",
                closed && "cursor-default",
              )}
            >
              <div
                className="absolute inset-y-0 left-0 bg-primary/10"
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center gap-2">
                {o.my_vote && <Check size={12} className="text-primary" />}
                <span className="flex-1">{o.label}</span>
                <span className="tabular-nums font-bold text-text-muted">{pct}%</span>
                <span className="text-text-muted/70 text-[10px] tabular-nums">({o.votes})</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2 text-[10px] text-text-muted">
        {poll.total_voters} {poll.total_voters === 1 ? "voto" : "votos"}
        {poll.multi_choice && " · multiple opcion"}
      </div>
    </div>
  );
}

export function PollCreator({
  onChange,
  onCancel,
}: {
  onChange: (poll: { question: string; options: string[]; multi_choice: boolean } | null) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multiChoice, setMultiChoice] = useState(false);

  function update(opts: string[], q: string = question, mc: boolean = multiChoice) {
    setOptions(opts);
    setQuestion(q);
    setMultiChoice(mc);
    const valid = q.trim() && opts.filter((o) => o.trim()).length >= 2;
    if (valid) {
      onChange({ question: q.trim(), options: opts.filter((o) => o.trim()), multi_choice: mc });
    } else {
      onChange(null);
    }
  }

  function setOpt(i: number, v: string) {
    const next = [...options];
    next[i] = v;
    update(next);
  }

  return (
    <div className="mt-2 bg-bg-muted border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold text-text inline-flex items-center gap-1.5">
          <BarChart3 size={12} className="text-primary" /> Encuesta
        </div>
        <button onClick={onCancel} className="text-text-muted hover:text-text">
          <X size={12} />
        </button>
      </div>
      <input
        value={question}
        onChange={(e) => update(options, e.target.value)}
        placeholder="Pregunta..."
        className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs mb-2 focus:outline-none focus:border-primary"
      />
      {options.map((o, i) => (
        <div key={i} className="flex gap-2 mb-1.5">
          <input
            value={o}
            onChange={(e) => setOpt(i, e.target.value)}
            placeholder={`Opcion ${i + 1}`}
            className="flex-1 bg-surface border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-primary"
          />
          {options.length > 2 && (
            <button
              onClick={() => update(options.filter((_, j) => j !== i))}
              className="text-text-muted hover:text-error"
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center justify-between mt-2">
        {options.length < 8 ? (
          <button
            onClick={() => update([...options, ""])}
            className="text-xs text-primary font-semibold inline-flex items-center gap-1"
          >
            <Plus size={11} /> Agregar opcion
          </button>
        ) : <span />}
        <label className="text-[11px] text-text-muted inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={multiChoice}
            onChange={(e) => update(options, question, e.target.checked)}
          />
          Multiple
        </label>
      </div>
    </div>
  );
}

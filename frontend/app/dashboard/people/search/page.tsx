"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Hash, ArrowLeft, MessageSquareText } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";

type SearchResp = {
  posts: Array<{
    id: number;
    content: string;
    created_at: string;
    author_id: number;
    author_name: string;
    author_avatar: string | null;
    author_area_color: string | null;
    space_name: string | null;
    space_emoji: string | null;
    space_color: string | null;
  }>;
  users: Array<{
    id: number;
    name: string;
    email: string;
    avatar_url: string | null;
    job_title: string | null;
    bio: string | null;
    area_color: string | null;
    area_name: string | null;
  }>;
  spaces: Array<{
    id: number;
    slug: string;
    name: string;
    emoji: string;
    color: string;
    description: string;
    kind: string;
  }>;
};

export default function SearchPage() {
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery<SearchResp>({
    queryKey: ["people-search", q],
    queryFn: () => api(`/api/people/search?q=${encodeURIComponent(q)}&limit=20`),
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
  });

  const hasResults =
    !!data && (data.posts.length + data.users.length + data.spaces.length > 0);

  return (
    <>
      <Topbar title="Buscar" subtitle="Posts, gente y espacios" />
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/dashboard/people"
            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text mb-4"
          >
            <ArrowLeft size={12} /> Volver al feed
          </Link>

          <div className="bg-surface border border-border rounded-xl p-4 mb-4">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar posts, colaboradores, espacios... (min 2 chars)"
                className="w-full bg-bg-muted border border-border rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-primary"
                autoFocus
              />
            </div>
          </div>

          {q.trim().length < 2 && (
            <div className="text-center py-16 text-text-muted text-sm">
              Escribi al menos 2 caracteres
            </div>
          )}

          {q.trim().length >= 2 && isLoading && (
            <div className="text-center py-16 text-text-muted text-sm">Buscando...</div>
          )}

          {q.trim().length >= 2 && !isLoading && !hasResults && (
            <div className="text-center py-16 text-text-muted text-sm">
              Sin resultados para "{q}"
            </div>
          )}

          {hasResults && (
            <div className="space-y-5">
              {data!.users.length > 0 && (
                <Section title={`Personas (${data!.users.length})`}>
                  {data!.users.map((u) => (
                    <Link
                      key={u.id}
                      href={`/dashboard/people/${u.id}`}
                      className="flex items-center gap-3 p-3 hover:bg-bg-muted rounded-lg transition"
                    >
                      <Avatar
                        name={u.name}
                        url={u.avatar_url}
                        size="md"
                        ringColor={u.area_color ?? undefined}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{u.name}</div>
                        <div className="text-[11px] text-text-muted truncate">
                          {u.job_title ?? u.email}
                          {u.area_name ? ` · ${u.area_name}` : ""}
                        </div>
                      </div>
                    </Link>
                  ))}
                </Section>
              )}

              {data!.spaces.length > 0 && (
                <Section title={`Espacios (${data!.spaces.length})`}>
                  {data!.spaces.map((s) => (
                    <Link
                      key={s.id}
                      href={`/dashboard/people?space=${s.slug}`}
                      className="flex items-center gap-3 p-3 hover:bg-bg-muted rounded-lg transition"
                    >
                      <div className="text-2xl">{s.emoji}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{s.name}</div>
                        {s.description && (
                          <div className="text-[11px] text-text-muted truncate">{s.description}</div>
                        )}
                      </div>
                    </Link>
                  ))}
                </Section>
              )}

              {data!.posts.length > 0 && (
                <Section title={`Posts (${data!.posts.length})`}>
                  {data!.posts.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 hover:bg-bg-muted rounded-lg transition"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <Link href={`/dashboard/people/${p.author_id}`}>
                          <Avatar
                            name={p.author_name}
                            url={p.author_avatar}
                            size="sm"
                            ringColor={p.author_area_color ?? undefined}
                          />
                        </Link>
                        <div className="text-xs font-semibold">{p.author_name}</div>
                        {p.space_name && (
                          <span
                            className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                            style={{
                              background: `${p.space_color}15`,
                              color: p.space_color ?? "#666",
                            }}
                          >
                            {p.space_emoji} {p.space_name}
                          </span>
                        )}
                        <div className="text-[10px] text-text-muted ml-auto">
                          {new Date(p.created_at).toLocaleDateString("es-AR")}
                        </div>
                      </div>
                      <div className="text-xs text-text whitespace-pre-wrap break-words line-clamp-3">
                        {p.content}
                      </div>
                    </div>
                  ))}
                </Section>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-bg-muted/50 border-b border-border text-[11px] uppercase tracking-wider font-bold text-text-muted">
        {title}
      </div>
      <div className="p-1">{children}</div>
    </div>
  );
}

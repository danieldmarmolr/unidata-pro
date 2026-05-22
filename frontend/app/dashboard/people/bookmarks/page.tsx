"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, ArrowLeft } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { PostCard } from "@/components/people/post-card";
import type { FeedPost } from "@/components/people/types";

export default function BookmarksPage() {
  const { data, isLoading } = useQuery<{ items: FeedPost[] }>({
    queryKey: ["people-bookmarks"],
    queryFn: () => api("/api/people/bookmarks?limit=100"),
    staleTime: 30_000,
  });

  return (
    <>
      <Topbar title="Bookmarks" subtitle="Posts que guardaste para volver" />
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/dashboard/people"
            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text mb-4"
          >
            <ArrowLeft size={12} /> Volver al feed
          </Link>

          {isLoading && (
            <div className="text-center py-16 text-text-muted text-sm">Cargando...</div>
          )}

          {!isLoading && data?.items?.length === 0 && (
            <div className="bg-surface border border-border rounded-xl py-16 text-center">
              <Bookmark size={32} className="mx-auto text-text-muted mb-2 opacity-50" />
              <div className="text-sm font-semibold">Sin bookmarks todavia</div>
              <div className="text-xs text-text-muted mt-1">
                Tocá el icono de bookmark en cualquier post para guardarlo
              </div>
            </div>
          )}

          <div className="space-y-3">
            {data?.items?.map((p) => (
              <PostCard key={p.id} post={p} canManage={false} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

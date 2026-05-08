"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type SkuEnrichment = {
  image_url: string | null;
  ean: string | null;
  name: string | null;
  is_service?: boolean;
  kind?: "product" | "service";
};

export type SkuLookupResult = SkuEnrichment & {
  sku: string;
};

/** Heuristica para detectar si un input es EAN (todo numerico + len 8/12/13/14) */
export function looksLikeEan(input: string): boolean {
  const s = (input || "").trim();
  if (!/^\d+$/.test(s)) return false;
  return [8, 12, 13, 14].includes(s.length);
}

/** Reverse lookup: dado un EAN devuelve el SKU + info enriquecida.
 *  Lanza error si no se encuentra (404 del backend). */
export async function lookupByEan(unit: string, ean: string): Promise<SkuLookupResult> {
  return await api(`/api/skus/${unit}/lookup-by-ean`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ean }),
  });
}

/**
 * Hook que recibe una lista de SKUs y devuelve un map { sku -> { image_url, ean, name } }.
 * Hace un POST a /api/skus/<unit>/enrich con la lista (cache de 1 hora en backend).
 *
 * Uso:
 *   const enriched = useSkuEnrichment("unistore", ["SKU1","SKU2"]);
 *   const data = enriched.data?.["SKU1"]; // { image_url, ean, name }
 */
export function useSkuEnrichment(unit: string, skus: string[]) {
  // Deduplicar y filtrar nulos para no hacer requests al pedo
  const cleanSkus = Array.from(new Set(skus.filter(Boolean)));

  return useQuery<Record<string, SkuEnrichment>>({
    queryKey: ["sku-enrich", unit, cleanSkus.sort().join("|")],
    queryFn: () =>
      api(`/api/skus/${unit}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: cleanSkus }),
      }),
    enabled: cleanSkus.length > 0,
    staleTime: 60 * 60 * 1000, // 1 hora del lado client tambien
  });
}

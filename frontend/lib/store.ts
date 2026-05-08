"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Period = "today" | "yesterday" | "7d" | "30d" | "90d" | "12m" | "custom";

type GlobalState = {
  period: Period;
  customFrom: string | null;  // ISO date YYYY-MM-DD
  customTo: string | null;
  setPeriod: (p: Period) => void;
  setCustomRange: (from: string | null, to: string | null) => void;
};

export const useGlobalFilters = create<GlobalState>()(
  persist(
    (set) => ({
      period: "30d",
      customFrom: null,
      customTo: null,
      setPeriod: (period) => set({ period }),
      setCustomRange: (from, to) => set({ customFrom: from, customTo: to, period: "custom" }),
    }),
    {
      name: "unidata.filters",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** Build query string fragment for backend API. Always includes ?period=X. Adds from/to when custom. */
export function periodToQuery(period: Period, customFrom: string | null, customTo: string | null): string {
  const parts: string[] = [`period=${period}`];
  if (period === "custom" && customFrom && customTo) {
    parts.push(`from=${customFrom}`);
    parts.push(`to=${customTo}`);
  }
  return parts.join("&");
}

"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "unidata.notif.permission_asked";
const SEEN_IDS_KEY = "unidata.notif.seen_ids";
const MAX_SEEN = 200;

export type NotifPayload = {
  id: number;
  kind: string;
  actor_name: string | null;
  preview: string | null;
  link: string | null;
  read_at: string | null;
};

export function useBrowserNotifications(items: NotifPayload[] | undefined, enabled: boolean) {
  const [permission, setPermission] = useState<NotificationPermission | "default">("default");
  const firstRunRef = useRef(true);
  const seenRef = useRef<Set<number>>(new Set());

  // Load seen IDs from localStorage (no re-trigger en reload)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SEEN_IDS_KEY);
      if (raw) seenRef.current = new Set(JSON.parse(raw));
    } catch {}
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  // Auto-pedir permiso una sola vez por usuario (skip si ya respondio)
  useEffect(() => {
    if (typeof Notification === "undefined" || !enabled) return;
    if (Notification.permission !== "default") {
      setPermission(Notification.permission);
      return;
    }
    if (window.localStorage.getItem(STORAGE_KEY)) return;
  }, [enabled]);

  // Trigger notif por cada item nuevo (no seen)
  useEffect(() => {
    if (!enabled || !items) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    // No molestar si el tab esta activo
    if (typeof document !== "undefined" && !document.hidden) {
      // Marcar todos como seen pero sin notificar
      for (const it of items) seenRef.current.add(it.id);
      saveSeen();
      return;
    }
    // En el primer render, marcar todos como seen (estado base, no notificar nada viejo)
    if (firstRunRef.current) {
      for (const it of items) seenRef.current.add(it.id);
      firstRunRef.current = false;
      saveSeen();
      return;
    }
    for (const it of items) {
      if (it.read_at) continue;
      if (seenRef.current.has(it.id)) continue;
      try {
        const n = new Notification(formatTitle(it), {
          body: it.preview ?? "",
          tag: `unidata-${it.id}`,
          icon: "/favicon.ico",
        });
        n.onclick = () => {
          window.focus();
          if (it.link) window.location.href = it.link;
          n.close();
        };
      } catch {}
      seenRef.current.add(it.id);
    }
    saveSeen();
  }, [items, enabled]);

  function saveSeen() {
    try {
      const arr = Array.from(seenRef.current).slice(-MAX_SEEN);
      window.localStorage.setItem(SEEN_IDS_KEY, JSON.stringify(arr));
    } catch {}
  }

  async function askPermission(): Promise<NotificationPermission> {
    if (typeof Notification === "undefined") return "denied";
    window.localStorage.setItem(STORAGE_KEY, "1");
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }

  return { permission, askPermission };
}

function formatTitle(it: NotifPayload): string {
  const actor = it.actor_name ?? "Alguien";
  switch (it.kind) {
    case "mention": return `${actor} te menciono`;
    case "kudo": return `${actor} te dio kudos`;
    case "comment": return `${actor} comento tu post`;
    case "dm": return `${actor} te mando un mensaje`;
    case "announcement": return `${actor} publico un anuncio`;
    case "time_off_request": return `${actor} pidio dias libres`;
    case "time_off_review": return "Revisaron tu solicitud";
    default: return `UNIDATA · ${actor}`;
  }
}

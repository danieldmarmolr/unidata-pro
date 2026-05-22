"use client";

import { Phone, Smartphone } from "lucide-react";
import { waLink } from "@/lib/whatsapp";

type Variant = "inline" | "chip" | "row";

export function WhatsAppPhone({
  phone,
  size = 11,
  variant = "inline",
  showBadge = false,
  icon = "phone",
}: {
  phone: string | null | undefined;
  size?: number;
  variant?: Variant;
  showBadge?: boolean;
  icon?: "phone" | "smartphone";
}) {
  if (!phone) return null;
  const href = waLink(phone);
  const Icon = icon === "smartphone" ? Smartphone : Phone;

  if (!href) {
    return (
      <span className="inline-flex items-center gap-1 text-text-muted">
        <Icon size={size} /> {phone}
      </span>
    );
  }

  if (variant === "chip") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition text-[11px] font-semibold"
        title={`Abrir WhatsApp para ${phone}`}
      >
        <Icon size={size} /> {phone}
        <span className="text-[9px] font-bold px-1 rounded bg-emerald-500 text-white">WA</span>
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 hover:underline"
      title={`Abrir WhatsApp para ${phone}`}
    >
      <Icon size={size} /> {phone}
      {showBadge && (
        <span className="ml-0.5 text-[9px] font-bold px-1 rounded bg-emerald-500 text-white">WA</span>
      )}
    </a>
  );
}

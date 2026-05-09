"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { getToken } from "@/lib/api";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  // Cerrar drawer al cambiar de ruta (por si Sidebar no llega a hacerlo)
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-muted">
        Cargando...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />

      {/* Boton hamburger fijo (solo mobile) */}
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-30 w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-primary text-white shadow-lg shadow-primary/40 flex items-center justify-center hover:scale-105 transition"
        aria-label="Abrir menu"
      >
        <Menu size={20} />
      </button>

      <main className="flex-1 flex flex-col min-w-0 lg:pt-0 pt-14">{children}</main>
    </div>
  );
}

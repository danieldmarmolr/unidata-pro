"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { DrillDownModal } from "@/components/drilldown-modal";
import { getUser, api, type AuthUser } from "@/lib/api";
import { ArrowUpRight } from "lucide-react";
import {
  Crown,
  TrendingUp,
  HeartHandshake,
  Megaphone,
  ShoppingBag,
  DollarSign,
  Truck,
  Wallet,
  CreditCard,
  Package,
  Sparkles,
  Map as MapIcon,
  Network,
  Database,
  Terminal,
  ScrollText,
  RotateCcw,
  LayoutDashboard,
  UserCog,
  Activity,
} from "lucide-react";

type Tile = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  description: string;
  color: string;
};

type RoleKey = "admin" | "gerencia" | "analista" | "lector" | "user";

const TILES: Record<string, Tile> = {
  gerencial: { label: "Gerencial", href: "/dashboard", icon: Crown, color: "from-purple-500 to-fuchsia-500", description: "KPIs cross-unidad, salud por negocio, alertas operativas" },
  ventas: { label: "Ventas", href: "/dashboard/ventas", icon: TrendingUp, color: "from-emerald-500 to-teal-500", description: "GMV, ordenes, top productos, geografia · Unistore + Unidrop" },
  productos: { label: "Productos", href: "/dashboard/productos", icon: ShoppingBag, color: "from-orange-500 to-red-500", description: "Top SKUs cross-canal, stock, sin movimiento, drill por SKU" },
  costos: { label: "Costos importacion", href: "/dashboard/costos", icon: DollarSign, color: "from-amber-500 to-yellow-500", description: "Lotes, costos USD/ARS, margen estimado por SKU" },
  marketing: { label: "Marketing", href: "/dashboard/marketing", icon: Megaphone, color: "from-pink-500 to-rose-500", description: "LTV, repeat purchase, top customers, retention" },
  cs: { label: "Customer Success", href: "/dashboard/cs", icon: HeartHandshake, color: "from-violet-500 to-purple-500", description: "Cancelaciones, RFM, lifecycle, customers en riesgo" },
  mapa: { label: "Mapa", href: "/dashboard/mapa", icon: MapIcon, color: "from-cyan-500 to-blue-500", description: "Choropleth Argentina · drill por provincia" },
  saas: { label: "SaaS Metrics", href: "/dashboard/saas", icon: LayoutDashboard, color: "from-indigo-500 to-purple-500", description: "Usuarios, suscripciones, churn, funnel · Unidrop" },
  pagos: { label: "Pagos Talo", href: "/dashboard/pagos", icon: CreditCard, color: "from-blue-500 to-cyan-500", description: "Volumen procesado, pendientes, refunds · Unidrop" },
  subsMeli: { label: "Suscripciones MELI", href: "/dashboard/subscriptions-meli", icon: Sparkles, color: "from-yellow-500 to-amber-500", description: "Planes, MRR, cohorts" },
  envios: { label: "Envios", href: "/dashboard/envios", icon: Package, color: "from-blue-500 to-indigo-500", description: "OCA, LightData, lead time" },
  logistica: { label: "Logistica", href: "/dashboard/logistica", icon: Truck, color: "from-slate-500 to-gray-500", description: "Pedidos pendientes, atascados, fulfillment" },
  finanzas: { label: "Finanzas", href: "/dashboard/finanzas", icon: Wallet, color: "from-green-500 to-emerald-500", description: "Sales orders, facturacion, gap" },
  devoluciones: { label: "Devoluciones", href: "/dashboard/devoluciones", icon: RotateCcw, color: "from-pink-500 to-red-500", description: "Casos, modelos de negocio, resoluciones" },
  catalog: { label: "Data Catalog", href: "/dashboard/catalog", icon: Network, color: "from-teal-500 to-cyan-500", description: "ER de las 3 BBDD, cross-DB relations" },
  sources: { label: "Explorador", href: "/dashboard/sources", icon: Database, color: "from-blue-500 to-indigo-500", description: "Tablas + columnas + preview" },
  sql: { label: "SQL libre", href: "/dashboard/sql", icon: Terminal, color: "from-zinc-700 to-zinc-900", description: "Workbench SQL read-only sobre las 3 BBDD" },
  audit: { label: "Audit log", href: "/dashboard/audit", icon: ScrollText, color: "from-amber-600 to-orange-600", description: "Quien corrio que query (admin)" },
  users: { label: "Usuarios", href: "/dashboard/admin/users", icon: UserCog, color: "from-slate-600 to-slate-800", description: "Alta, baja, roles" },
};

// Vistas curadas por rol — orden importante (primeros = más usados)
const ROLE_VIEWS: Record<RoleKey, string[]> = {
  admin: [
    "gerencial", "ventas", "productos", "marketing", "cs", "mapa",
    "saas", "pagos", "subsMeli", "envios", "logistica", "finanzas",
    "devoluciones", "costos", "catalog", "sources", "sql", "audit", "users",
  ],
  gerencia: [
    "gerencial", "ventas", "productos", "mapa", "marketing", "cs",
    "saas", "pagos", "devoluciones", "finanzas",
  ],
  analista: [
    "gerencial", "ventas", "productos", "mapa", "cs", "marketing",
    "pagos", "saas", "envios", "logistica", "finanzas", "devoluciones",
    "catalog", "sources", "sql",
  ],
  lector: [
    "gerencial", "ventas", "productos", "mapa", "cs",
  ],
  user: [
    "gerencial", "ventas", "productos", "mapa", "cs", "saas", "pagos", "marketing",
  ],
};

const ROLE_LABEL: Record<RoleKey, string> = {
  admin: "Administrador",
  gerencia: "Gerencia",
  analista: "Analista",
  lector: "Lector",
  user: "Usuario",
};

const ROLE_PITCH: Record<RoleKey, string> = {
  admin: "Acceso total a la plataforma",
  gerencia: "Vision estrategica del grupo · KPIs cross-unidad",
  analista: "Drill profundo, SQL libre, exploracion de datos",
  lector: "Vistas read-only · sin SQL, sin admin",
  user: "Vistas operativas",
};

function TileCard({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  return (
    <Link
      href={tile.href}
      className="group bg-surface border border-border rounded-xl p-5 hover:shadow-lg hover:shadow-primary/15 hover:border-primary/40 hover:-translate-y-0.5 transition flex flex-col h-full"
    >
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tile.color} text-white flex items-center justify-center shadow-md mb-3`}>
        <Icon size={18} />
      </div>
      <div className="text-base font-bold text-text mb-1 group-hover:text-primary transition">{tile.label}</div>
      <div className="text-xs text-text-muted leading-relaxed">{tile.description}</div>
    </Link>
  );
}

type BlurbLink =
  | { kind: "drill"; endpoint: string; title?: string; filename?: string }
  | { kind: "navigate"; href: string };
type Blurb = { type: string; icon: string; title: string; body: string; accent: string; link?: BlurbLink | null };
type Story = { today_date: string; blurbs: Blurb[]; generated_at: string };

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [drill, setDrill] = useState<{ endpoint: string; title: string; filename: string } | null>(null);
  useEffect(() => setUser(getUser()), []);

  const { data: story, isLoading: loadingStory } = useQuery<Story>({
    queryKey: ["story-today"],
    queryFn: () => api<Story>("/api/dashboards/story"),
    staleTime: 5 * 60_000,
  });

  function handleBlurbClick(b: Blurb) {
    if (!b.link) return;
    if (b.link.kind === "navigate") router.push(b.link.href);
    else setDrill({
      endpoint: b.link.endpoint,
      title: b.link.title ?? b.title,
      filename: b.link.filename ?? "story.csv",
    });
  }

  const role = ((user?.role as RoleKey) ?? "user") as RoleKey;
  const tileKeys = ROLE_VIEWS[role] ?? ROLE_VIEWS.user;
  const tiles = tileKeys.map((k) => TILES[k]).filter(Boolean);

  // Featured = primeros 3 (los más usados para el rol)
  const featured = tiles.slice(0, 3);
  const rest = tiles.slice(3);

  const roleLabel = ROLE_LABEL[role] ?? "Usuario";
  const rolePitch = ROLE_PITCH[role] ?? "";
  const userName = user?.name || user?.email?.split("@")[0] || "";

  return (
    <>
      <Topbar title="Inicio" subtitle="Pantalla principal · navegacion rapida segun tu rol" hidePeriod />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        {/* Hero + Storytelling */}
        <div className="bg-gradient-to-br from-primary via-accent to-fuchsia-600 text-white rounded-2xl p-8 mb-8 shadow-xl shadow-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-20 -mr-20 w-80 h-80 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 -mb-20 -ml-20 w-80 h-80 bg-white/10 rounded-full blur-3xl" />
          <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Saludo */}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-white/70 mb-1">UNIDATA</div>
              <h1 className="text-3xl font-extrabold mb-2">
                Hola{userName ? `, ${userName}` : ""}
              </h1>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-white/20 backdrop-blur">
                  <Activity size={11} /> Rol: {roleLabel}
                </span>
                <span className="text-xs text-white/80">{rolePitch}</span>
              </div>
              <p className="text-sm text-white/90">
                Pantalla principal · vistas curadas para tu rol · narrativa en tiempo real del dia.
              </p>
            </div>

            {/* Storytelling del dia */}
            <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-white/80">
                  📰 Asi viene el dia
                </div>
                {story && (
                  <div className="text-[10px] text-white/60">
                    {(() => {
                      const [y, m, d] = story.today_date.split("-");
                      return `${d}/${m}/${y}`;
                    })()}
                  </div>
                )}
              </div>
              {loadingStory && (
                <div className="space-y-2">
                  <div className="h-4 bg-white/20 rounded animate-pulse" />
                  <div className="h-4 bg-white/20 rounded animate-pulse w-5/6" />
                  <div className="h-4 bg-white/20 rounded animate-pulse w-4/6" />
                </div>
              )}
              {story && story.blurbs && (
                <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
                  {story.blurbs.map((b, i) => {
                    const clickable = !!b.link;
                    const content = (
                      <>
                        <span className="text-base shrink-0 mt-0.5">{b.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-white text-[11px] uppercase tracking-wider mb-0.5 flex items-center gap-1">
                            {b.title}
                            {clickable && (
                              <ArrowUpRight size={11} className="opacity-60 group-hover:opacity-100 transition" />
                            )}
                          </div>
                          <div className="text-white/95 text-[13px]">{b.body}</div>
                        </div>
                      </>
                    );
                    if (!clickable) {
                      return (
                        <div key={i} className="flex items-start gap-2.5 text-sm leading-snug px-2 py-1.5">
                          {content}
                        </div>
                      );
                    }
                    return (
                      <button
                        key={i}
                        onClick={() => handleBlurbClick(b)}
                        className="group w-full flex items-start gap-2.5 text-sm leading-snug px-2 py-1.5 rounded-lg hover:bg-white/10 transition text-left"
                      >
                        {content}
                      </button>
                    );
                  })}
                </div>
              )}
              {story && (!story.blurbs || story.blurbs.length === 0) && (
                <div className="text-sm text-white/70">Sin actividad significativa aun.</div>
              )}
            </div>
          </div>
        </div>

        {/* Featured (3 grandes) */}
        {featured.length > 0 && (
          <>
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-3">
              Destacadas para tu rol
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {featured.map((t) => (
                <TileCard key={t.href} tile={t} />
              ))}
            </div>
          </>
        )}

        {/* Resto */}
        {rest.length > 0 && (
          <>
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-3">
              Otras vistas disponibles
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {rest.map((t) => (
                <TileCard key={t.href} tile={t} />
              ))}
            </div>
          </>
        )}

        <div className="mt-10 text-xs text-text-muted text-center">
          UNIDATA · plataforma de datos del grupo Unistore · Unistore + Unidrop + Unidev
        </div>
      </div>

      {drill && (
        <DrillDownModal
          title={drill.title}
          subtitle="Click ESC o fuera del modal para cerrar"
          endpoint={drill.endpoint}
          filename={drill.filename}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  );
}

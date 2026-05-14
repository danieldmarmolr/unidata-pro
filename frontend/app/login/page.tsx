"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login, Requires2FAError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password, needs2FA ? totpCode.trim() : undefined);
      router.push("/dashboard/home");
    } catch (err) {
      if (err instanceof Requires2FAError) {
        setNeeds2FA(true);
        setTotpCode("");
      } else {
        setError(err instanceof Error ? err.message : "Error de login");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full relative overflow-hidden">
      {/* Fondo con gradiente violeta */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,#a259ff22,transparent_55%),radial-gradient(circle_at_80%_85%,#7a3eae33,transparent_55%),linear-gradient(135deg,#21093a_0%,#4e1e7a_100%)]" />
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><circle cx=%221%22 cy=%221%22 r=%221%22 fill=%22%23ffffff15%22/></svg>')]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          {/* Brand */}
          <div className="flex items-center gap-3 mb-8 text-white justify-center">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent to-primary shadow-lg shadow-primary/40 flex items-center justify-center font-extrabold text-xl">
              U
            </div>
            <div>
              <div className="text-2xl font-extrabold tracking-tight leading-none">UNIDATA</div>
              <div className="text-xs text-white/60 mt-1">Unistore Group</div>
            </div>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl p-8 shadow-2xl shadow-primary-darker/30 border border-white/10">
            <h1 className="text-xl font-bold text-text mb-1">Iniciar sesion</h1>
            <p className="text-sm text-text-muted mb-6">
              Convierte datos dispersos en decisiones.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text placeholder:text-text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                  placeholder="tu@unistore.ar"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Contrasena
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                  placeholder="*********"
                />
              </div>

              {needs2FA && (
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Codigo 2FA
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                    maxLength={6}
                    placeholder="000000"
                    className="w-full px-4 py-2.5 rounded-lg border border-amber-400 bg-amber-50 text-text text-center text-xl tracking-[0.5em] font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                  />
                  <p className="mt-1.5 text-xs text-text-muted">
                    Abre Google Authenticator o Authy y buscá la cuenta UNIDATA.
                  </p>
                </div>
              )}

              {error && (
                <div className="text-sm bg-red-50 text-error border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold tracking-wide shadow-md shadow-primary/30 hover:shadow-lg hover:shadow-primary/40 hover:translate-y-[-1px] transition disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
              >
                {loading ? "Ingresando..." : "Iniciar sesion"}
              </button>
            </form>

            <div className="mt-6 text-xs text-text-muted text-center space-y-2">
              <div>Acceso solo para colaboradores con email @unistore.ar.</div>
              <div>
                No tenes cuenta?{" "}
                <Link href="/register" className="text-primary font-semibold hover:underline">
                  Crear cuenta
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-6 text-center text-xs text-white/50">
            © {new Date().getFullYear()} Unistore Group · UNIDATA
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerSelf, setInitialPassword } from "@/lib/api";

const ALLOWED_DOMAIN = "unistore.ar";

type Step = "register" | "password";

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("register");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function emailHasValidDomain(e: string) {
    return e.trim().toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!emailHasValidDomain(cleanEmail)) {
      setError(`El email debe terminar en @${ALLOWED_DOMAIN}`);
      return;
    }
    if (!name.trim()) {
      setError("Ingresa tu nombre");
      return;
    }

    setLoading(true);
    try {
      await registerSelf(cleanEmail, name.trim());
      setStep("password");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("La contrasena debe tener al menos 6 caracteres");
      return;
    }
    if (password !== passwordConfirm) {
      setError("Las contrasenas no coinciden");
      return;
    }

    setLoading(true);
    try {
      await setInitialPassword(email.trim().toLowerCase(), password);
      router.push("/dashboard/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo setear la password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,#a259ff22,transparent_55%),radial-gradient(circle_at_80%_85%,#7a3eae33,transparent_55%),linear-gradient(135deg,#21093a_0%,#4e1e7a_100%)]" />
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><circle cx=%221%22 cy=%221%22 r=%221%22 fill=%22%23ffffff15%22/></svg>')]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-8 text-white justify-center">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent to-primary shadow-lg shadow-primary/40 flex items-center justify-center font-extrabold text-xl">
              U
            </div>
            <div>
              <div className="text-2xl font-extrabold tracking-tight leading-none">UNIDATA</div>
              <div className="text-xs text-white/60 mt-1">Unistore Group</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-2xl shadow-primary-darker/30 border border-white/10">
            {step === "register" ? (
              <>
                <h1 className="text-xl font-bold text-text mb-1">Crear cuenta</h1>
                <p className="text-sm text-text-muted mb-6">
                  Solo para colaboradores con email <span className="font-semibold">@{ALLOWED_DOMAIN}</span>.
                </p>

                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Nombre completo
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text placeholder:text-text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                      placeholder="Daniel Marmol"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Email corporativo
                    </label>
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text placeholder:text-text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                      placeholder={`tu@${ALLOWED_DOMAIN}`}
                    />
                  </div>

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
                    {loading ? "Creando cuenta..." : "Continuar"}
                  </button>
                </form>

                <div className="mt-6 text-xs text-text-muted text-center">
                  Ya tenes cuenta?{" "}
                  <Link href="/login" className="text-primary font-semibold hover:underline">
                    Iniciar sesion
                  </Link>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold text-text mb-1">Define tu contrasena</h1>
                <p className="text-sm text-text-muted mb-6">
                  Cuenta creada para <span className="font-semibold">{email}</span>. Ahora elegi tu contrasena.
                </p>

                <form onSubmit={handleSetPassword} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Contrasena
                    </label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                      placeholder="Min 6 caracteres"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Confirmar contrasena
                    </label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      required
                      minLength={6}
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                      placeholder="Repite la contrasena"
                    />
                  </div>

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
                    {loading ? "Guardando..." : "Crear cuenta"}
                  </button>
                </form>
              </>
            )}
          </div>

          <div className="mt-6 text-center text-xs text-white/50">
            © {new Date().getFullYear()} Unistore Group · UNIDATA
          </div>
        </div>
      </div>
    </div>
  );
}

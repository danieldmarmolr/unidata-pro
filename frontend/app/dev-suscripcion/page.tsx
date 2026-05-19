"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type Dropshipper = {
  name: string;
  fantasy_name: string | null;
  subscription_id: number | null;
  subscription_plan_name: string | null;
};

type Step = "identify" | "bank_data" | "success";

const BANCOS_AR = [
  "Galicia",
  "Santander",
  "BBVA",
  "Macro",
  "Banco Nacion",
  "Banco Provincia",
  "Banco Ciudad",
  "ICBC",
  "HSBC",
  "Patagonia",
  "Supervielle",
  "Credicoop",
  "Hipotecario",
  "Comafi",
  "Mercado Pago",
  "Ualá",
  "Brubank",
  "Naranja X",
  "Personal Pay",
  "Otro",
];

async function fetchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let detail = "";
    if (typeof data?.detail === "string") {
      detail = data.detail;
    } else if (Array.isArray(data?.detail)) {
      detail = data.detail
        .map((e: { loc?: unknown[]; msg?: string }) => {
          const loc = Array.isArray(e?.loc) ? e.loc.join(".") : "";
          return loc ? `${loc}: ${e?.msg ?? "error"}` : e?.msg ?? "error";
        })
        .join("; ");
    } else {
      detail = data?.message ?? `HTTP ${res.status}`;
    }
    throw new Error(detail);
  }
  return data as T;
}

export default function DevSuscripcionPage() {
  const [step, setStep] = useState<Step>("identify");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 1
  const [dni, setDni] = useState("");
  const [email, setEmail] = useState("");
  const [dropshipper, setDropshipper] = useState<Dropshipper | null>(null);

  // Step 2
  const [bankHolderName, setBankHolderName] = useState("");
  const [bankHolderCuit, setBankHolderCuit] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankNameOther, setBankNameOther] = useState("");
  const [bankCbu, setBankCbu] = useState("");
  const [bankAlias, setBankAlias] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [reason, setReason] = useState("");

  // Step 3
  const [requestId, setRequestId] = useState<number | null>(null);

  async function handleIdentify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanDni = dni.replace(/\D/g, "");
    if (cleanDni.length < 7 || cleanDni.length > 8) {
      setError("El DNI debe tener 7 u 8 dígitos.");
      return;
    }
    if (!email.includes("@")) {
      setError("Ingresá un email válido.");
      return;
    }
    setLoading(true);
    try {
      const data = await fetchJson<{ ok: true; dropshipper: Dropshipper }>(
        "/api/public/refund-requests/validate",
        { dni: cleanDni, email: email.trim() },
      );
      setDni(cleanDni);
      setDropshipper(data.dropshipper);
      setStep("bank_data");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de validación");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanCbu = bankCbu.replace(/\D/g, "");
    const cleanCuit = bankHolderCuit.replace(/\D/g, "");
    if (cleanCbu.length !== 22) {
      setError("El CBU/CVU debe tener 22 dígitos.");
      return;
    }
    if (cleanCuit.length !== 11) {
      setError("El CUIT debe tener 11 dígitos.");
      return;
    }
    if (!bankHolderName.trim()) {
      setError("Ingresá el nombre del titular.");
      return;
    }
    const finalBank = bankName === "Otro" ? bankNameOther.trim() : bankName;
    if (!finalBank) {
      setError("Seleccioná o ingresá un banco.");
      return;
    }
    const cleanAlias = bankAlias.trim();
    if (cleanAlias && (cleanAlias.length < 6 || cleanAlias.length > 20)) {
      setError("El alias debe tener entre 6 y 20 caracteres (o dejarlo vacío).");
      return;
    }
    const amount = refundAmount.trim() ? Number(refundAmount.replace(",", ".")) : null;
    if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
      setError("Monto inválido.");
      return;
    }

    setLoading(true);
    try {
      const data = await fetchJson<{ ok: true; id: number; status: string }>(
        "/api/public/refund-requests",
        {
          dni,
          email: email.trim(),
          bank_holder_name: bankHolderName.trim(),
          bank_holder_cuit: cleanCuit,
          bank_name: finalBank,
          bank_cbu: cleanCbu,
          bank_alias: cleanAlias || null,
          refund_amount_arg: amount,
          reason: reason.trim() || null,
        },
      );
      setRequestId(data.id);
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar la solicitud");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,#a259ff22,transparent_55%),radial-gradient(circle_at_80%_85%,#7a3eae33,transparent_55%),linear-gradient(135deg,#21093a_0%,#4e1e7a_100%)]" />
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><circle cx=%221%22 cy=%221%22 r=%221%22 fill=%22%23ffffff15%22/></svg>')]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
        <div className="w-full max-w-xl">
          <div className="flex items-center gap-3 mb-8 text-white justify-center">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent to-primary shadow-lg shadow-primary/40 flex items-center justify-center font-extrabold text-xl">
              U
            </div>
            <div>
              <div className="text-2xl font-extrabold tracking-tight leading-none">UNIDROP</div>
              <div className="text-xs text-white/60 mt-1">Devolución de suscripción</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-2xl shadow-primary-darker/30 border border-white/10">
            {step === "identify" && (
              <>
                <h1 className="text-xl font-bold text-text mb-1">
                  Solicitar devolución de suscripción MELI
                </h1>
                <p className="text-sm text-text-muted mb-6">
                  Verificamos tu cuenta para iniciar el reembolso. Después te
                  pediremos los datos bancarios.
                </p>

                <form onSubmit={handleIdentify} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      DNI
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={dni}
                      onChange={(e) => setDni(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      required
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                      placeholder="Sin puntos ni espacios"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Email registrado en Unidrop
                    </label>
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                      placeholder="tu@email.com"
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
                    className="w-full py-2.5 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold tracking-wide shadow-md shadow-primary/30 hover:shadow-lg hover:shadow-primary/40 transition disabled:opacity-60"
                  >
                    {loading ? "Validando..." : "Continuar"}
                  </button>
                </form>
              </>
            )}

            {step === "bank_data" && dropshipper && (
              <>
                <h1 className="text-xl font-bold text-text mb-1">Datos para la transferencia</h1>
                <p className="text-sm text-text-muted mb-2">
                  Te encontramos como{" "}
                  <span className="font-semibold text-text">{dropshipper.name}</span>
                  {dropshipper.fantasy_name && (
                    <> ({dropshipper.fantasy_name})</>
                  )}
                  {dropshipper.subscription_plan_name && (
                    <>, plan <span className="font-semibold">{dropshipper.subscription_plan_name}</span></>
                  )}
                  .
                </p>
                <p className="text-xs text-text-muted mb-6">
                  Completá los datos de la cuenta donde querés recibir la devolución.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Titular de la cuenta
                    </label>
                    <input
                      type="text"
                      value={bankHolderName}
                      onChange={(e) => setBankHolderName(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                      placeholder="Nombre y apellido completo"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      CUIT del titular
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={bankHolderCuit}
                      onChange={(e) => setBankHolderCuit(e.target.value.replace(/\D/g, "").slice(0, 11))}
                      required
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                      placeholder="11 dígitos sin guiones"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Banco
                    </label>
                    <select
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                    >
                      <option value="">Seleccionar banco...</option>
                      {BANCOS_AR.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                    {bankName === "Otro" && (
                      <input
                        type="text"
                        value={bankNameOther}
                        onChange={(e) => setBankNameOther(e.target.value)}
                        required
                        className="mt-2 w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                        placeholder="Nombre del banco"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      CBU / CVU (22 dígitos)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={bankCbu}
                      onChange={(e) => setBankCbu(e.target.value.replace(/\D/g, "").slice(0, 22))}
                      required
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                      placeholder="00000000000000000000"
                    />
                    <p className="mt-1 text-[11px] text-text-muted">
                      {bankCbu.replace(/\D/g, "").length}/22 dígitos
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Alias (opcional)
                    </label>
                    <input
                      type="text"
                      value={bankAlias}
                      onChange={(e) => setBankAlias(e.target.value)}
                      maxLength={20}
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                      placeholder="mi.alias.bancario"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Monto solicitado en ARS (opcional)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                      placeholder="Si lo dejás vacío, lo define Finanzas"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Motivo (opcional)
                    </label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={2000}
                      rows={3}
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition resize-none"
                      placeholder="Contanos por qué cancelás (no es obligatorio)"
                    />
                  </div>

                  {error && (
                    <div className="text-sm bg-red-50 text-error border border-red-200 rounded-lg px-3 py-2">
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => { setStep("identify"); setError(null); }}
                      className="px-4 py-2.5 rounded-lg border border-border text-text-muted hover:bg-bg transition text-sm font-semibold"
                    >
                      Volver
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold tracking-wide shadow-md shadow-primary/30 hover:shadow-lg hover:shadow-primary/40 transition disabled:opacity-60"
                    >
                      {loading ? "Enviando..." : "Enviar solicitud"}
                    </button>
                  </div>
                </form>
              </>
            )}

            {step === "success" && requestId !== null && (
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-full bg-green-100 mx-auto mb-4 flex items-center justify-center">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h1 className="text-xl font-bold text-text mb-2">¡Solicitud recibida!</h1>
                <p className="text-sm text-text-muted mb-4">
                  El equipo de Finanzas la va a procesar y te vamos a contactar por WhatsApp.
                </p>
                <div className="bg-bg border border-border rounded-lg px-4 py-3 inline-block">
                  <div className="text-[11px] uppercase tracking-wider text-text-muted">ID de solicitud</div>
                  <div className="text-2xl font-bold text-primary">#{requestId}</div>
                </div>
                <p className="mt-6 text-xs text-text-muted">
                  Guardá este número por si necesitás hacer un seguimiento.
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 text-center text-xs text-white/50">
            © {new Date().getFullYear()} Unistore Group · Unidrop
          </div>
        </div>
      </div>
    </div>
  );
}

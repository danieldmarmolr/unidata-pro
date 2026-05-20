"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type Dropshipper = {
  name: string;
  fantasy_name: string | null;
  cuit: string | null;
  subscription_id: number | null;
  subscription_plan_name: string | null;
  subscription_plan_price_arg: number | null;
  subscription_ends_at: string | null;
  subscription_status: string | null;
};

type LastPayment = {
  paid_amount_arg: number;
  paid_at: string;
};

type BankHints = {
  source: string;
  cbu: string;
  alias: string | null;
  bank_name: string | null;
  holder_name: string | null;
};

type PaidSubscription = {
  total_arg: number;
  count: number;
};

type ValidateResp = {
  ok: true;
  dropshipper: Dropshipper;
  bank_hints: BankHints | null;
  paid_subscription: PaidSubscription | null;
  last_payment: LastPayment | null;
};

type Step = "identify" | "bank_data" | "success";

const ABANDONMENT_REASONS: Array<{ value: string; label: string }> = [
  { value: "costo_muy_alto",            label: "El costo es muy alto para mis ventas" },
  { value: "sin_ventas_suficientes",    label: "No tuve ventas suficientes" },
  { value: "mala_experiencia_meli",     label: "Mala experiencia con Mercado Libre" },
  { value: "solo_tn",                   label: "Voy a operar solo por Tienda Nube" },
  { value: "cierro_emprendimiento",     label: "Cierro mi emprendimiento" },
  { value: "problemas_tecnicos_unidrop", label: "Problemas técnicos con Unidrop" },
  { value: "otra",                      label: "Otra (escribir abajo)" },
];

function fmtMoney(v: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(v);
}

function matchBank(talo: string | null, list: string[]): string {
  if (!talo) return "";
  const t = talo.toLowerCase();
  for (const b of list) {
    if (t.includes(b.toLowerCase()) || b.toLowerCase().includes(t)) return b;
  }
  return "";
}

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
  const [bankHints, setBankHints] = useState<BankHints | null>(null);
  const [paidSub, setPaidSub] = useState<PaidSubscription | null>(null);
  const [lastPayment, setLastPayment] = useState<LastPayment | null>(null);
  const [hintsApplied, setHintsApplied] = useState(false);

  // Step 2
  const [bankHolderName, setBankHolderName] = useState("");
  const [bankHolderCuit, setBankHolderCuit] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankNameOther, setBankNameOther] = useState("");
  const [bankCbu, setBankCbu] = useState("");
  const [bankAlias, setBankAlias] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [abandonmentReason, setAbandonmentReason] = useState("");
  const [reason, setReason] = useState("");

  // Step 3
  const [requestId, setRequestId] = useState<number | null>(null);
  const [displayCode, setDisplayCode] = useState<string | null>(null);

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
      const data = await fetchJson<ValidateResp>(
        "/api/public/refund-requests/validate",
        { dni: cleanDni, email: email.trim() },
      );
      setDni(cleanDni);
      setDropshipper(data.dropshipper);
      setBankHints(data.bank_hints);
      setPaidSub(data.paid_subscription);
      setLastPayment(data.last_payment);
      if (!hintsApplied) {
        const h = data.bank_hints;
        // 1. Titular: Talo.account_owner -> fallback a User.name
        const holder = h?.holder_name?.trim() || data.dropshipper.name?.trim() || "";
        if (holder) setBankHolderName(holder);
        // 2. CUIT: directo desde User.cuit (Talo no lo tiene)
        const cuit = (data.dropshipper.cuit || "").replace(/\D/g, "");
        if (cuit.length === 11) setBankHolderCuit(cuit);
        // 3. CBU + Alias + Banco: solo desde Talo
        if (h?.cbu) setBankCbu(h.cbu.replace(/\D/g, "").slice(0, 22));
        if (h?.alias) setBankAlias(h.alias);
        if (h?.bank_name) {
          const matched = matchBank(h.bank_name, BANCOS_AR.filter((b) => b !== "Otro"));
          if (matched) {
            setBankName(matched);
          } else {
            setBankName("Otro");
            setBankNameOther(h.bank_name);
          }
        }
        // 4. Monto solicitado: precio mensual del plan (no el acumulado)
        const planPrice = data.dropshipper.subscription_plan_price_arg;
        if (planPrice && planPrice > 0) {
          setRefundAmount(String(planPrice));
        }
        setHintsApplied(true);
      }
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
    if (!abandonmentReason) {
      setError("Decinos por qué cancelás, así sabemos cómo mejorar.");
      return;
    }
    if (abandonmentReason === "otra" && reason.trim().length < 5) {
      setError("Si elegís 'Otra', contanos brevemente en el comentario (mín 5 caracteres).");
      return;
    }

    setLoading(true);
    try {
      const data = await fetchJson<{ ok: true; id: number; status: string; display_code?: string }>(
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
          abandonment_reason: abandonmentReason,
          reason: reason.trim() || null,
        },
      );
      setRequestId(data.id);
      setDisplayCode(data.display_code ?? null);
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
                <p className="text-xs text-text-muted mb-4">
                  Completá los datos de la cuenta donde querés recibir la devolución.
                </p>

                {(dropshipper.subscription_plan_price_arg || lastPayment || dropshipper.subscription_ends_at) && (
                  <div className="mb-4 rounded-lg bg-violet-50 border border-violet-200 px-3 py-2.5 text-xs text-text space-y-1">
                    {dropshipper.subscription_plan_price_arg ? (
                      <div>
                        Plan <span className="font-bold">{dropshipper.subscription_plan_name}</span>:{" "}
                        <span className="font-bold text-primary">{fmtMoney(dropshipper.subscription_plan_price_arg)}</span>/mes
                        {dropshipper.subscription_status && (
                          <> · estado <span className="font-semibold">{dropshipper.subscription_status}</span></>
                        )}
                      </div>
                    ) : null}
                    {lastPayment && (
                      <div>
                        Último cobro: <span className="font-semibold">{fmtMoney(lastPayment.paid_amount_arg)}</span>{" "}
                        el {new Date(lastPayment.paid_at).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
                      </div>
                    )}
                    {paidSub && paidSub.count > 0 && (
                      <div>
                        Total acumulado: <span className="font-semibold">{fmtMoney(paidSub.total_arg)}</span>{" "}
                        ({paidSub.count} cobro{paidSub.count > 1 ? "s" : ""})
                      </div>
                    )}
                  </div>
                )}

                {(bankHints || dropshipper.cuit) && (
                  <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-xs text-text">
                    Pre-cargamos los datos que tenemos de tu cuenta{bankHints ? " Talo" : ""}{dropshipper.cuit ? " + perfil Unidrop" : ""}.
                    Verificalos antes de enviar — podés editarlos si querés cobrar en otra cuenta.
                  </div>
                )}

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
                      ¿Por qué cancelás? <span className="text-error">*</span>
                    </label>
                    <select
                      value={abandonmentReason}
                      onChange={(e) => setAbandonmentReason(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                    >
                      <option value="">Seleccioná una opción...</option>
                      {ABANDONMENT_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Comentario adicional {abandonmentReason === "otra" ? <span className="text-error">*</span> : "(opcional)"}
                    </label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={2000}
                      rows={3}
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition resize-none"
                      placeholder={
                        abandonmentReason === "otra"
                          ? "Contanos qué motivo es"
                          : "Cualquier detalle adicional (opcional)"
                      }
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
                  <div className="text-[11px] uppercase tracking-wider text-text-muted">Código de solicitud</div>
                  <div className="text-lg font-bold text-primary font-mono break-all">
                    {displayCode ?? `#${requestId}`}
                  </div>
                </div>
                <p className="mt-6 text-xs text-text-muted">
                  Guardá este código por si necesitás hacer un seguimiento.
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

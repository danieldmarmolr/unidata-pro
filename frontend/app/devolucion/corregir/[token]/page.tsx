"use client";

import { use, useEffect, useState } from "react";

const PROD_API = "https://api.unidatacenter.com.ar";
function apiBase(): string {
  if (typeof window === "undefined") return PROD_API;
  const isLocal = /^(localhost|127\.0\.0\.1)(:|$)/.test(window.location.host);
  return isLocal ? (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000") : PROD_API;
}

type Bank = { holder_name?: string; holder_cuit?: string; bank_name?: string; cbu?: string; alias?: string | null };
type Info = { found: boolean; editable: boolean; status?: string; dropshipper_name?: string; dni?: string; plan?: string; monto?: number | null; bank?: Bank };

const fmt$ = (v?: number | null) => (v == null ? "" : new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v));

export default function CorreccionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ bank_holder_name: "", bank_holder_cuit: "", bank_name: "", bank_cbu: "", bank_alias: "" });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ verified: boolean } | null>(null);

  useEffect(() => {
    fetch(`${apiBase()}/api/public/refund-requests/correction/${token}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.detail || "Link inválido o vencido");
        return d as Info;
      })
      .then((d) => {
        setInfo(d);
        if (d.bank) setForm({
          bank_holder_name: d.bank.holder_name || "",
          bank_holder_cuit: d.bank.holder_cuit || "",
          bank_name: d.bank.bank_name || "",
          bank_cbu: d.bank.cbu || "",
          bank_alias: d.bank.alias || "",
        });
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/public/refund-requests/correction/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : "No se pudo guardar");
      setDone({ verified: !!d.verified });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500";

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-600 text-lg font-extrabold text-white">U</div>
          <h1 className="text-xl font-bold text-gray-900">Corregir datos para tu reembolso</h1>
          <p className="mt-1 text-sm text-gray-500">Unidev · Devolución de suscripción</p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          {loading && <p className="py-8 text-center text-gray-400">Cargando…</p>}

          {!loading && err && !info && (
            <div className="rounded-lg bg-red-50 p-4 text-center text-sm text-red-700">{err}</div>
          )}

          {!loading && info && !info.editable && (
            <div className="rounded-lg bg-emerald-50 p-4 text-center text-sm text-emerald-800">
              Esta devolución ya fue procesada. Si tenés dudas, escribinos.
            </div>
          )}

          {!loading && info?.editable && done && (
            <div className="py-4 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">✓</div>
              <h2 className="text-lg font-bold text-gray-900">¡Listo!</h2>
              <p className="mt-1 text-sm text-gray-600">
                Actualizamos tus datos bancarios. {done.verified ? "Tu cuenta se validó correctamente y" : "Tu reembolso"} se va a procesar en breve.
              </p>
            </div>
          )}

          {!loading && info?.editable && !done && (
            <form onSubmit={submit} className="space-y-4">
              {(info.dropshipper_name || info.monto != null) && (
                <div className="rounded-lg bg-violet-50 px-3 py-2.5 text-sm text-violet-900">
                  {info.dropshipper_name && <div><b>{info.dropshipper_name}</b>{info.dni ? ` · DNI ${info.dni}` : ""}</div>}
                  {info.monto != null && <div>Monto a reembolsar: <b>{fmt$(info.monto)}</b></div>}
                </div>
              )}
              <p className="text-sm text-gray-600">Revisá y corregí tus datos bancarios. La cuenta tiene que estar a tu nombre (mismo titular/CUIT).</p>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">Titular de la cuenta</label>
                <input className={inputCls} value={form.bank_holder_name} onChange={set("bank_holder_name")} required minLength={2} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">CUIT/CUIL del titular (11 dígitos)</label>
                <input className={inputCls} value={form.bank_holder_cuit} onChange={set("bank_holder_cuit")} inputMode="numeric" required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">Banco</label>
                <input className={inputCls} value={form.bank_name} onChange={set("bank_name")} required minLength={2} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">CBU / CVU (22 dígitos)</label>
                <input className={inputCls} value={form.bank_cbu} onChange={set("bank_cbu")} inputMode="numeric" required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">Alias (opcional)</label>
                <input className={inputCls} value={form.bank_alias} onChange={set("bank_alias")} placeholder="mi.alias.mp" />
              </div>

              {err && <p className="text-sm text-red-600">{err}</p>}

              <button type="submit" disabled={submitting} className="w-full rounded-lg bg-violet-600 py-3 text-base font-semibold text-white disabled:opacity-50">
                {submitting ? "Guardando…" : "Guardar y procesar mi reembolso"}
              </button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-gray-400">Tus datos se usan solo para acreditarte el reembolso.</p>
      </div>
    </div>
  );
}

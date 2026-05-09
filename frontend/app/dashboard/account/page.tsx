"use client";

import { useState } from "react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { Shield, ShieldCheck, ShieldAlert, KeyRound, Copy } from "lucide-react";

export default function AccountPage() {
  const me = getUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) {
      setMsg({ kind: "err", text: "Los passwords nuevos no coinciden" });
      return;
    }
    if (next.length < 6) {
      setMsg({ kind: "err", text: "Password muy corto (min 6 caracteres)" });
      return;
    }
    setLoading(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      setMsg({ kind: "ok", text: "Password actualizado correctamente" });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
    }
  }

  const isAdmin = !!me?.is_admin || me?.role === "admin";

  return (
    <>
      <Topbar title="Mi cuenta" subtitle="Tus datos · cambiar password · seguridad 2FA" />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">
          <div className="bg-surface border border-border rounded-xl p-6">
            <h2 className="text-sm font-bold text-text mb-4">Mis datos</h2>
            <Row label="Email" value={me?.email ?? "—"} />
            <Row label="Nombre" value={me?.name || "—"} />
            <Row label="Rol" value={me?.role ?? "—"} />
            {me?.is_admin && <Row label="Privilegios" value="Administrador" />}
            <Row label="ID interno" value={String(me?.id ?? "—")} />
            <Row label="2FA" value={(me as any)?.totp_enabled ? "Habilitado ✓" : "No configurado"} />
          </div>

          <div className="bg-surface border border-border rounded-xl p-6">
            <h2 className="text-sm font-bold text-text mb-4">Cambiar password</h2>
            <form onSubmit={submit} className="space-y-3">
              <Input label="Password actual" value={current} onChange={setCurrent} required />
              <Input label="Password nuevo" value={next} onChange={setNext} required />
              <Input label="Confirmar nuevo" value={confirm} onChange={setConfirm} required />
              {msg && (
                <div
                  className={
                    "rounded-lg px-3 py-2 text-xs " +
                    (msg.kind === "ok"
                      ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                      : "bg-red-50 border border-red-200 text-error")
                  }
                >
                  {msg.text}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold text-sm shadow-md disabled:opacity-50"
              >
                {loading ? "Actualizando..." : "Actualizar password"}
              </button>
            </form>
          </div>
        </div>

        {/* 2FA: solo administradores */}
        {isAdmin && (
          <div className="max-w-5xl mt-6">
            <TwoFactorSection initialEnabled={!!(me as any)?.totp_enabled} userEmail={me?.email ?? ""} />
          </div>
        )}
      </div>
    </>
  );
}

function TwoFactorSection({ initialEnabled, userEmail }: { initialEnabled: boolean; userEmail: string }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [setupData, setSetupData] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function startSetup() {
    setBusy(true);
    setMsg(null);
    try {
      const data = await api<{ secret: string; otpauth_uri: string }>("/api/auth/2fa/setup", { method: "POST" });
      setSetupData(data);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Error iniciando setup" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable() {
    if (!code || code.length !== 6) {
      setMsg({ kind: "err", text: "Ingresa el codigo de 6 digitos de tu app" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/auth/2fa/enable", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setEnabled(true);
      setSetupData(null);
      setCode("");
      setMsg({ kind: "ok", text: "2FA habilitado · desde el proximo login te pedira el codigo" });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Codigo invalido" });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!pwd) {
      setMsg({ kind: "err", text: "Ingresa tu password para confirmar" });
      return;
    }
    if (!confirm("¿Seguro que queres deshabilitar 2FA?")) return;
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/auth/2fa/disable", {
        method: "POST",
        body: JSON.stringify({ password: pwd }),
      });
      setEnabled(false);
      setPwd("");
      setMsg({ kind: "ok", text: "2FA deshabilitado" });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  // QR generado via api.qrserver.com (publico, no requiere instalar libreria)
  const qrUrl = setupData
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(setupData.otpauth_uri)}`
    : null;

  return (
    <div className={`bg-surface border-2 rounded-xl p-6 ${enabled ? "border-emerald-300" : "border-amber-300"}`}>
      <div className="flex items-start gap-3 mb-4">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-md flex-shrink-0 ${
            enabled
              ? "bg-gradient-to-br from-emerald-500 to-teal-600"
              : "bg-gradient-to-br from-amber-500 to-orange-500"
          }`}
        >
          {enabled ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-bold text-text">
            Autenticacion en dos pasos (2FA TOTP) — solo administradores
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {enabled
              ? "2FA esta habilitado. Cada login te pedira un codigo de 6 digitos generado por tu app autenticadora."
              : "Recomendado para cuentas con privilegios admin. Compatible con Google Authenticator, Authy, 1Password, Bitwarden."}
          </p>
        </div>
      </div>

      {msg && (
        <div
          className={
            "rounded-lg px-3 py-2 text-xs mb-3 " +
            (msg.kind === "ok"
              ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
              : "bg-red-50 border border-red-200 text-error")
          }
        >
          {msg.text}
        </div>
      )}

      {!enabled && !setupData && (
        <button
          onClick={startSetup}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold text-sm shadow-md disabled:opacity-50"
        >
          <Shield size={14} />
          {busy ? "Generando..." : "Configurar 2FA ahora"}
        </button>
      )}

      {!enabled && setupData && qrUrl && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
              Paso 1: escanea el QR con tu app
            </div>
            <div className="bg-white p-3 rounded-lg border border-border inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="QR 2FA" width={220} height={220} />
            </div>
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1">
                O ingresa este codigo manual:
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-soft border border-border rounded px-2 py-1.5 font-mono text-xs select-all break-all">
                  {setupData.secret}
                </code>
                <button
                  onClick={() => navigator.clipboard?.writeText(setupData.secret)}
                  className="p-1.5 rounded border border-border hover:border-primary hover:text-primary"
                  title="Copiar secret"
                >
                  <Copy size={12} />
                </button>
              </div>
              <div className="text-[10px] text-text-muted mt-1">
                Cuenta: <code className="font-mono">{userEmail}</code> · Issuer: UNIDATA
              </div>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
              Paso 2: ingresa el codigo de 6 digitos
            </div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="w-full px-4 py-3 rounded-lg border border-border bg-bg outline-none focus:border-primary text-center font-mono text-2xl tracking-[0.5em]"
            />
            <button
              onClick={confirmEnable}
              disabled={busy || code.length !== 6}
              className="mt-3 w-full py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold text-sm shadow-md disabled:opacity-50"
            >
              <KeyRound size={14} className="inline mr-1" />
              {busy ? "Verificando..." : "Habilitar 2FA"}
            </button>
            <button
              onClick={() => { setSetupData(null); setCode(""); setMsg(null); }}
              className="mt-2 w-full py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text"
            >
              Cancelar setup
            </button>
            <div className="mt-3 text-[11px] text-text-muted">
              <strong className="text-text">Apps recomendadas:</strong>
              <ul className="mt-1 space-y-0.5 list-disc list-inside">
                <li>Google Authenticator</li>
                <li>Authy</li>
                <li>1Password</li>
                <li>Bitwarden</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {enabled && (
        <div className="bg-emerald-50/40 border border-emerald-200 rounded-lg p-4 mt-3">
          <div className="text-xs font-semibold text-emerald-900 mb-2">
            Para deshabilitar 2FA ingresa tu password:
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="Tu password"
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-bg outline-none focus:border-primary text-sm"
            />
            <button
              onClick={disable}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-300 font-semibold text-sm hover:bg-rose-100 disabled:opacity-50"
            >
              {busy ? "..." : "Deshabilitar"}
            </button>
          </div>
          <div className="text-[10px] text-emerald-800/70 mt-2">
            Si perdes acceso a tu app autenticadora antes de deshabilitar 2FA, vas a necesitar
            que otro admin te resetee la cuenta.
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border last:border-0">
      <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      <span className="text-sm font-medium text-text">{value}</span>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">{label}</label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full px-3 py-2 rounded-lg border border-border bg-bg outline-none focus:border-primary"
      />
    </div>
  );
}

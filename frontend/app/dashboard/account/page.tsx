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

        <div className="max-w-5xl mt-6">
          <McpTokenSection />
        </div>
      </div>
    </>
  );
}

const MCP_REMOTE_URL = "https://mcp-production-b8c5.up.railway.app";

function McpTokenSection() {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"token" | "json" | null>(null);
  const [mode, setMode] = useState<"remote" | "local">("remote");

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      const data = await api<{ access_token: string }>("/api/auth/mcp-token", { method: "POST" });
      setToken(data.access_token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error generando token");
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text: string, kind: "token" | "json") {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  }

  const remoteJson = token
    ? `{
  "mcpServers": {
    "unidata": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "${MCP_REMOTE_URL}/sse",
        "--header",
        "Authorization:Bearer ${token}"
      ]
    }
  }
}`
    : "";

  const localJson = token
    ? `{
  "mcpServers": {
    "unidata": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/danieldmarmolr/unidata-pro.git#subdirectory=mcp",
        "unidata-mcp"
      ],
      "env": {
        "UNIDATA_API_URL": "https://api.unidatacenter.com.ar",
        "UNIDATA_TOKEN": "${token}"
      }
    }
  }
}`
    : "";

  const currentJson = mode === "remote" ? remoteJson : localJson;

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-text">Token para Claude (MCP)</h2>
          <p className="text-[12px] text-text-muted mt-0.5">
            Generá un token de 90 días para usar UNIDATA desde Claude Desktop o Claude Code via MCP.
            El token tiene tus mismos permisos (rol + área).
          </p>
        </div>
        <button
          onClick={generate}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-primary to-accent text-white text-xs font-semibold shadow-md disabled:opacity-50"
        >
          <KeyRound size={12} /> {busy ? "Generando..." : token ? "Regenerar" : "Generar token"}
        </button>
      </div>

      {err && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-error px-3 py-2 text-xs mb-3">
          {err}
        </div>
      )}

      {token && (
        <>
          <div className="bg-soft border border-border rounded-lg p-3 font-mono text-[10px] break-all relative">
            {token}
            <button
              onClick={() => copyText(token, "token")}
              className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-surface border border-border text-[10px] font-semibold hover:border-primary hover:text-primary"
            >
              <Copy size={10} /> {copied === "token" ? "Copiado" : "Copiar token"}
            </button>
          </div>

          <div className="mt-4">
            <div className="inline-flex bg-soft rounded-lg p-0.5 border border-border mb-3">
              <button
                onClick={() => setMode("remote")}
                className={
                  "px-3 py-1.5 text-[11px] font-bold rounded-md transition " +
                  (mode === "remote" ? "bg-surface shadow text-text" : "text-text-muted hover:text-text")
                }
              >
                Remoto (recomendado)
              </button>
              <button
                onClick={() => setMode("local")}
                className={
                  "px-3 py-1.5 text-[11px] font-bold rounded-md transition " +
                  (mode === "local" ? "bg-surface shadow text-text" : "text-text-muted hover:text-text")
                }
              >
                Local (uvx)
              </button>
            </div>

            <p className="text-[11px] text-text-muted mb-2">
              {mode === "remote" ? (
                <>
                  Claude se conecta a nuestro servidor MCP en Railway con tu JWT via un bridge stdio
                  (<code>mcp-remote</code> sobre <code>npx</code>). Requiere tener{" "}
                  <a
                    href="https://nodejs.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Node.js
                  </a>{" "}
                  instalado (versión LTS, ~30 MB). La primera vez tarda ~5 seg en bajar el bridge,
                  después queda cacheado. Recomendado para todo el equipo.
                </>
              ) : (
                <>
                  Corre el MCP en tu PC con <code>uvx</code> (requiere{" "}
                  <a
                    href="https://docs.astral.sh/uv/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    uv
                  </a>
                  ). Útil para devs o cuando hay restricciones de red.
                </>
              )}
            </p>

            <div className="relative">
              <pre className="bg-soft border border-border rounded-lg p-3 text-[10px] overflow-x-auto pr-20">
                {currentJson}
              </pre>
              <button
                onClick={() => copyText(currentJson, "json")}
                className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-surface border border-border text-[10px] font-semibold hover:border-primary hover:text-primary"
              >
                <Copy size={10} /> {copied === "json" ? "Copiado" : "Copiar JSON"}
              </button>
            </div>

          </div>

          <div className="mt-4 bg-soft/30 border border-border rounded-lg p-4">
            <h3 className="text-xs font-bold text-text uppercase tracking-wider mb-3">
              Cómo usarlo (paso a paso)
            </h3>
            <ol className="text-[12px] text-text space-y-3 list-decimal list-inside [&_code]:font-mono [&_code]:text-[11px] [&_code]:bg-soft [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded">
              <li>
                <strong>Instalá Claude Desktop</strong> si no lo tenés —{" "}
                <a
                  href="https://claude.ai/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  claude.ai/download
                </a>
                . Abrilo al menos una vez para que cree los archivos de config.
              </li>
              <li>
                <strong>Copiá el JSON</strong> de arriba con el botón "Copiar JSON" (asegurate de tener
                seleccionada la pestaña <strong>Remoto</strong> si querés usar el server en Railway).
              </li>
              <li>
                <strong>Abrí el archivo de config</strong> de Claude Desktop:
                <div className="mt-2 ml-6 space-y-2">
                  <div className="bg-surface border border-border rounded-md p-2.5">
                    <div className="font-semibold text-[11px] text-text mb-1">Forma fácil (recomendada)</div>
                    <div className="text-[11px] text-text-muted">
                      En Claude Desktop: <code>File</code> → <code>Settings</code> → tab{" "}
                      <code>Developer</code> → botón <strong>"Edit Config"</strong>. Se abre el archivo
                      en tu editor por defecto (Notepad / VSCode).
                    </div>
                  </div>
                  <div className="bg-surface border border-border rounded-md p-2.5">
                    <div className="font-semibold text-[11px] text-text mb-1">Forma manual (Windows)</div>
                    <div className="text-[11px] text-text-muted">
                      Apretá <code>Win + R</code> → escribí{" "}
                      <code>%APPDATA%\Claude</code> → Enter. Se abre la carpeta. Buscá{" "}
                      <code>claude_desktop_config.json</code>. Si no existe, creá un archivo nuevo
                      con ese nombre exacto.
                    </div>
                  </div>
                  <div className="bg-surface border border-border rounded-md p-2.5">
                    <div className="font-semibold text-[11px] text-text mb-1">Forma manual (macOS)</div>
                    <div className="text-[11px] text-text-muted">
                      Finder → <code>Cmd + Shift + G</code> → pegá{" "}
                      <code>~/Library/Application Support/Claude/</code> → Enter. Mismo archivo:{" "}
                      <code>claude_desktop_config.json</code>.
                    </div>
                  </div>
                </div>
              </li>
              <li>
                <strong>Pegá el JSON adentro del archivo y guardá</strong>. Si ya tenías otros MCPs
                configurados, mergealos: agregá la clave <code>"unidata"</code> dentro del objeto{" "}
                <code>"mcpServers"</code> existente (sin duplicar las llaves de afuera).
              </li>
              <li>
                <strong>Cerrá Claude Desktop completamente y abrilo de nuevo</strong>. Importante: no
                solo cerrar la ventana — desde el system tray (Windows) o menú superior (macOS) hacé
                "Quit" y volvé a abrir. Sino no recarga la config.
              </li>
              <li>
                <strong>Verificá la conexión</strong>: en un chat nuevo deberías ver el ícono 🛠️ debajo
                del input. Click ahí y debería listar las tools de UNIDATA (whoami, list_dropshippers,
                run_sql, etc.).
              </li>
            </ol>
          </div>

          <div className="mt-4 bg-primary/5 border border-primary/20 rounded-lg p-4">
            <h3 className="text-xs font-bold text-text uppercase tracking-wider mb-2">
              Probá estos prompts
            </h3>
            <ul className="text-[12px] text-text space-y-1.5 list-disc list-inside marker:text-primary">
              <li>
                <em>"Llamá a whoami y decime quién soy en UNIDATA"</em>
              </li>
              <li>
                <em>
                  "Listame los 10 dropshippers que más facturaron este mes con ticket promedio"
                </em>
              </li>
              <li>
                <em>"Dame el 360 del dropshipper 102 y resumime en bullets su estado"</em>
              </li>
              <li>
                <em>
                  "Agregale una nota al dropshipper 102 categoría retention: 'cliente VIP,
                  priorizar siempre'"
                </em>
              </li>
              <li>
                <em>
                  "Corré un SELECT en Unistore que cuente órdenes pagadas por provincia este
                  trimestre y armame un CSV"
                </em>
              </li>
              <li>
                <em>"Listame mis recordatorios pendientes"</em>
              </li>
            </ul>
          </div>

          <div className="mt-4 text-[11px] text-text-muted leading-relaxed">
            <strong className="text-text">Tips:</strong> el token dura 90 días, después generá uno
            nuevo acá. Si Claude tira "Token JWT inválido", regenerá. Si el ícono 🛠️ no aparece,
            revisá que el JSON sea válido (probá pegarlo en{" "}
            <a
              href="https://jsonlint.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              jsonlint.com
            </a>
            ) y que cerraste Claude del todo antes de reabrirlo.
          </div>
        </>
      )}
    </div>
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

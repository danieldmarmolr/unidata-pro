"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { Play, RefreshCw, Loader2 } from "lucide-react";

const STORE_KEY = "unidata.jira_flow.autodocs";

type CycleAction = { handler: string; action: string; url?: string; error?: string; reason?: string };
type CycleResult = { key: string; summary: string; actions: CycleAction[] };
type CycleResp = {
  since?: string | null;
  now?: string;
  found?: number;
  processed?: number;
  processed_keys?: string[];
  results?: CycleResult[];
  error?: string;
};

type State = { last_run_iso: string | null; processed_keys: string[]; last_results: CycleResult[] };

function loadState(): State {
  if (typeof window === "undefined") return { last_run_iso: null, processed_keys: [], last_results: [] };
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "") as State; }
  catch { return { last_run_iso: null, processed_keys: [], last_results: [] }; }
}

function saveState(s: State) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

export default function AutoDocsPage() {
  const [state, setState] = useState<State>({ last_run_iso: null, processed_keys: [], last_results: [] });
  const [enablePM, setEnablePM] = useState(true);
  const [enableRB, setEnableRB] = useState(true);
  const [enableADR, setEnableADR] = useState(true);
  const [dry, setDry] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastCycle, setLastCycle] = useState<CycleResp | null>(null);

  useEffect(() => { setState(loadState()); }, []);

  async function run() {
    setRunning(true); setLastCycle(null);
    try {
      const resp = await api<CycleResp>("/api/jira-flow/auto-docs/run", {
        method: "POST",
        body: JSON.stringify({
          since_iso: state.last_run_iso,
          processed_keys: state.processed_keys,
          enable_postmortem: enablePM,
          enable_runbook: enableRB,
          enable_adr: enableADR,
          dry_run: dry,
        }),
      });
      setLastCycle(resp);
      if (!dry && !resp.error) {
        const next: State = {
          last_run_iso: resp.now ?? state.last_run_iso,
          processed_keys: (resp.processed_keys ?? state.processed_keys).slice(-500),
          last_results: (resp.results ?? []).slice(-50),
        };
        setState(next);
        saveState(next);
      }
    } catch (e) {
      setLastCycle({ error: (e as Error).message });
    } finally { setRunning(false); }
  }

  function resetState() {
    const empty: State = { last_run_iso: null, processed_keys: [], last_results: [] };
    setState(empty); saveState(empty);
  }

  return (
    <>
      <Topbar title="Jira Flow · Auto Docs" subtitle="Polling ITDEV cerrados → genera post-mortems, runbooks y ADRs en Confluence" hidePeriod />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Metric label="Última corrida" value={state.last_run_iso || "—"} />
          <Metric label="Procesados (acumulado)" value={state.processed_keys.length} />
          <Metric label="Resultados guardados" value={state.last_results.length} />
        </div>

        <div className="border border-border rounded-xl p-5 bg-white">
          <div className="font-semibold mb-3">⚙️ Configurar ciclo</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Toggle label="📝 Post-mortem" checked={enablePM} onChange={setEnablePM} hint="Página por cada ITDEV cerrado" />
            <Toggle label="🐛 Runbook bugs" checked={enableRB} onChange={setEnableRB} hint="Appendea bugs cerrados" />
            <Toggle label="📐 ADR" checked={enableADR} onChange={setEnableADR} hint="Issues con label 'adr'" />
            <Toggle label="🧪 Dry run" checked={dry} onChange={setDry} hint="No toca Confluence" />
          </div>
          <div className="flex items-center gap-2 mt-4">
            <button onClick={run} disabled={running} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Correr ciclo ahora
            </button>
            <button onClick={resetState} className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-soft flex items-center gap-2">
              <RefreshCw size={14} /> Reset state
            </button>
          </div>
        </div>

        {lastCycle && (
          <div className="border border-border rounded-xl p-5 bg-white">
            <div className="font-semibold mb-3">📋 Resultado última corrida</div>
            {lastCycle.error && <div className="text-red-600 text-sm">{lastCycle.error}</div>}
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Metric label="Desde" value={lastCycle.since || "(inicio)"} />
              <Metric label="Hasta" value={lastCycle.now || "—"} />
              <Metric label="Procesados" value={lastCycle.processed ?? 0} />
            </div>
            <div className="space-y-2">
              {(lastCycle.results ?? []).map((r) => (
                <div key={r.key} className="border border-border rounded p-3">
                  <div className="font-medium text-sm">[{r.key}] {r.summary}</div>
                  <ul className="mt-1 text-xs space-y-1">
                    {r.actions.map((a, idx) => (
                      <li key={idx} className={a.action === "error" ? "text-red-600" : "text-muted"}>
                        <span className="font-semibold">{a.handler}</span>: {a.action}
                        {a.url && <> → <a className="text-primary underline" href={a.url} target="_blank" rel="noreferrer">Ver página</a></>}
                        {a.reason && <> ({a.reason})</>}
                        {a.error && <> — {a.error}</>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-soft">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-base font-bold text-primary truncate">{value}</div>
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (b: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1" />
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
    </label>
  );
}

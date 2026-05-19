"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

type HealthResp = {
  jira_base_url: string;
  itdev: string;
  situ: string;
  board_id: number;
  confluence_space: string;
  default_label: string;
  default_triager: string;
  jira_api_token_present: boolean;
  gemini_api_key_present: boolean;
  gemini_model: string;
};

export default function ConfigPage() {
  const { data, isLoading, error, refetch } = useQuery<HealthResp>({
    queryKey: ["jira-flow", "health"],
    queryFn: () => api("/api/jira-flow/health"),
  });

  const [jiraResult, setJiraResult] = useState<string | null>(null);
  const [geminiResult, setGeminiResult] = useState<string | null>(null);
  const [testing, setTesting] = useState<"jira" | "gemini" | null>(null);

  async function testJira() {
    setTesting("jira"); setJiraResult(null);
    try {
      const r = await api<{ ok: boolean; displayName?: string; accountId?: string; email?: string }>("/api/jira-flow/test/jira");
      setJiraResult(`✅ ${r.displayName} (${r.accountId}) — ${r.email}`);
    } catch (e) {
      setJiraResult(`❌ ${(e as Error).message}`);
    } finally { setTesting(null); }
  }

  async function testGemini() {
    setTesting("gemini"); setGeminiResult(null);
    try {
      const r = await api<{ ok: boolean; response: string }>("/api/jira-flow/test/gemini");
      setGeminiResult(`✅ Gemini responde: ${r.response}`);
    } catch (e) {
      setGeminiResult(`❌ ${(e as Error).message}`);
    } finally { setTesting(null); }
  }

  return (
    <>
      <Topbar title="Jira Flow · Config" subtitle="Variables de entorno · test conexión Jira y Gemini" hidePeriod />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-6">
        {error && <div className="text-red-600 text-sm">{(error as Error).message}</div>}
        {isLoading && <div className="text-muted text-sm">Cargando...</div>}

        {data && (
          <>
            <div className="border border-border rounded-xl p-5 bg-white">
              <div className="font-semibold mb-3">Variables de entorno</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <Row k="JIRA_BASE_URL" v={data.jira_base_url} />
                <Row k="JIRA_API_TOKEN" v={data.jira_api_token_present ? "✅ presente" : "❌ FALTA"} />
                <Row k="GEMINI_API_KEY" v={data.gemini_api_key_present ? "✅ presente" : "❌ FALTA"} />
                <Row k="GEMINI_MODEL" v={data.gemini_model} />
                <Row k="ITDEV_PROJECT_KEY" v={data.itdev} />
                <Row k="SITU_PROJECT_KEY" v={data.situ} />
                <Row k="ITDEV_BOARD_ID" v={String(data.board_id)} />
                <Row k="CONFLUENCE_DEFAULT_SPACE" v={data.confluence_space} />
                <Row k="DEFAULT_LABEL" v={data.default_label || "(vacío)"} />
                <Row k="DEFAULT_TRIAGER_ACCOUNT_ID" v={data.default_triager || "(vacío)"} />
              </div>
              <button onClick={() => refetch()} className="mt-3 text-xs underline text-muted">Refrescar</button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-border rounded-xl p-5 bg-white">
                <div className="font-semibold mb-2">Test conexión Jira</div>
                <button onClick={testJira} disabled={testing === "jira"} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                  {testing === "jira" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Test myself()
                </button>
                {jiraResult && <div className="mt-3 text-sm">{jiraResult}</div>}
              </div>

              <div className="border border-border rounded-xl p-5 bg-white">
                <div className="font-semibold mb-2">Test Gemini API</div>
                <button onClick={testGemini} disabled={testing === "gemini"} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                  {testing === "gemini" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Test health_check()
                </button>
                {geminiResult && <div className="mt-3 text-sm">{geminiResult}</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5 bg-soft rounded">
      <span className="text-xs text-muted font-mono">{k}</span>
      <span className="text-sm font-medium truncate text-right">{v}</span>
    </div>
  );
}

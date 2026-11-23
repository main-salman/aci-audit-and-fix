"use client";

import React, { useState, useEffect } from "react";
import {
  Settings,
  Server,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  X,
  Lock,
  Globe,
  User,
  RefreshCw,
  KeyRound,
  Cpu,
  Sparkles,
} from "lucide-react";

export type FabricProfile = "mock" | "devnet" | "custom";

export interface ApicSettingsState {
  profile: FabricProfile;
  url: string;
  username: string;
  verifySsl: boolean;
  llmModel?: string;
  llmKeyPreview?: string;
  llmBaseUrl?: string;
}

interface Props {
  open: boolean;
  currentSettings: ApicSettingsState;
  onClose: () => void;
  onApplySettings: (appliedData: any) => void;
}

export default function ApicSettingsModal({
  open,
  currentSettings,
  onClose,
  onApplySettings,
}: Props) {
  const [profile, setProfile] = useState<FabricProfile>(
    currentSettings.profile
  );
  const [url, setUrl] = useState<string>(currentSettings.url);
  const [username, setUsername] = useState<string>(currentSettings.username);
  const [password, setPassword] = useState<string>("");
  const [verifySsl, setVerifySsl] = useState<boolean>(
    currentSettings.verifySsl
  );

  // Enterprise LLM API Key & Model Configuration
  const [llmApiKey, setLlmApiKey] = useState<string>("");
  const [llmModel, setLlmModel] = useState<string>(
    currentSettings.llmModel || "openai/gpt-oss-120b"
  );
  const [llmBaseUrl, setLlmBaseUrl] = useState<string>(
    currentSettings.llmBaseUrl || ""
  );

  const [testing, setTesting] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    version?: string;
    latencyMs?: number;
  } | null>(null);

  const [llmTestResult, setLlmTestResult] = useState<{
    ok: boolean;
    message: string;
    model?: string;
    keyPreview?: string;
    latencyMs?: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setProfile(currentSettings.profile);
      setUrl(currentSettings.url);
      setUsername(currentSettings.username);
      setVerifySsl(currentSettings.verifySsl);
      setLlmModel(currentSettings.llmModel || "openai/gpt-oss-120b");
      setLlmBaseUrl(currentSettings.llmBaseUrl || "");
      setLlmApiKey("");
      setTestResult(null);
      setLlmTestResult(null);
    }
  }, [open, currentSettings]);

  if (!open) return null;

  const handleSelectProfile = (nextProfile: FabricProfile) => {
    setProfile(nextProfile);
    setTestResult(null);
    if (nextProfile === "mock") {
      setUrl("https://sandboxapicdc.cisco.com");
      setUsername("admin");
      setPassword("");
      setVerifySsl(false);
    } else if (nextProfile === "devnet") {
      setUrl("https://sandboxapicdc.cisco.com");
      setUsername("admin");
      setPassword("!v3G@!4@Y");
      setVerifySsl(false);
    } else {
      if (url === "https://sandboxapicdc.cisco.com") {
        setUrl("https://10.10.20.14");
      }
      setUsername("admin");
      setPassword("");
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/fabric", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          url,
          username,
          password: password || undefined,
          verifySsl,
          testOnly: true,
        }),
      });
      const data = await res.json();
      if (data.testResult) {
        setTestResult(data.testResult);
      } else if (data.error) {
        setTestResult({ ok: false, message: data.error });
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.message || "Failed to reach APIC controller",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleTestLlmKey = async () => {
    setTestingLlm(true);
    setLlmTestResult(null);
    try {
      const res = await fetch("/api/fabric", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmApiKey: llmApiKey.trim() || undefined,
          llmModel,
          llmBaseUrl: llmBaseUrl.trim() || undefined,
          testLlmOnly: true,
        }),
      });
      const data = await res.json();
      if (data.llmTestResult) {
        setLlmTestResult(data.llmTestResult);
      } else if (data.error) {
        setLlmTestResult({ ok: false, message: data.error });
      }
    } catch (err: any) {
      setLlmTestResult({
        ok: false,
        message: err?.message || "Failed to verify LLM API key",
      });
    } finally {
      setTestingLlm(false);
    }
  };

  const handleSaveAndConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/fabric", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          url,
          username,
          password: password || undefined,
          verifySsl,
          llmApiKey: llmApiKey.trim() || undefined,
          llmModel,
          llmBaseUrl: llmBaseUrl.trim() || undefined,
          testOnly: false,
        }),
      });
      const data = await res.json();
      if (data.testResult) {
        setTestResult(data.testResult);
      }
      onApplySettings(data);
      onClose();
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.message || "Failed to apply settings",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white border border-slate-300 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#0d274d] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-[#049fd9]/25 border border-[#00bceb]/50 flex items-center justify-center">
              <Settings className="w-5 h-5 text-[#00bceb]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Enterprise APIC &amp; LLM API Settings
              </h2>
              <p className="text-xs text-sky-200">
                Configure your Cisco APIC Controller target &amp; Enterprise LLM
                API Key
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSaveAndConnect}
          className="p-5 space-y-4 overflow-y-auto bg-[#f8fafc]"
        >
          {/* 1. 3-Card APIC Target Profile Selector */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
              1. Select Cisco APIC Target Fabric Profile
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => handleSelectProfile("mock")}
                className={`text-left p-3 rounded-lg border-2 transition ${
                  profile === "mock"
                    ? "bg-sky-50 border-[#049fd9] shadow-sm"
                    : "bg-white border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    Demo Fabric
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#049fd9] text-white">
                    Mock
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 mt-1">
                  Deterministic zero-trust violations (`Prod-CoreFin` &amp;{" "}
                  `Hybrid-Cloud-AI`)
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleSelectProfile("devnet")}
                className={`text-left p-3 rounded-lg border-2 transition ${
                  profile === "devnet"
                    ? "bg-emerald-50 border-[#52a732] shadow-sm"
                    : "bg-white border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    DevNet Sandbox
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#52a732] text-white">
                    Live Cloud
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 mt-1">
                  Cisco Always-On APIC 6.1 (`sandboxapicdc.cisco.com`)
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleSelectProfile("custom")}
                className={`text-left p-3 rounded-lg border-2 transition ${
                  profile === "custom"
                    ? "bg-indigo-50 border-indigo-600 shadow-sm"
                    : "bg-white border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    Custom APIC
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-600 text-white">
                    BYO APIC
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 mt-1">
                  Connect to your own enterprise or lab APIC controller IP/FQDN
                </p>
              </button>
            </div>
          </div>

          {/* 2. APIC Controller Endpoint & AAA Credentials */}
          <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-[#049fd9]" />
                2. APIC Controller Endpoint &amp; AAA Credentials
              </span>
              {profile === "devnet" && (
                <span className="text-[11px] text-[#3f8624] font-semibold">
                  Pre-filled with DevNet Sandbox credentials
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                APIC Controller URL (HTTPS)
              </label>
              <div className="relative flex items-center">
                <Globe className="w-4 h-4 text-slate-400 absolute left-3" />
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://apic-controller.company.local or https://10.10.20.14"
                  className="w-full pl-9 pr-3 py-2 rounded border border-slate-300 focus:border-[#049fd9] bg-white text-xs font-mono text-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  APIC Username (<code>aaaUser</code>)
                </label>
                <div className="relative flex items-center">
                  <User className="w-4 h-4 text-slate-400 absolute left-3" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full pl-9 pr-3 py-2 rounded border border-slate-300 focus:border-[#049fd9] bg-white text-xs font-mono text-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  APIC Password
                </label>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      profile === "devnet"
                        ? "!v3G@!4@Y (DevNet Default)"
                        : "Enter APIC password..."
                    }
                    className="w-full pl-9 pr-3 py-2 rounded border border-slate-300 focus:border-[#049fd9] bg-white text-xs font-mono text-slate-900 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={verifySsl}
                  onChange={(e) => setVerifySsl(e.target.checked)}
                  className="rounded border-slate-300 text-[#049fd9] focus:ring-[#049fd9]"
                />
                <span>
                  Enforce Strict TLS/SSL Certificate Verification
                </span>
              </label>

              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing || saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-100 hover:bg-sky-50 text-xs font-bold text-[#0284c7] border border-slate-300 transition disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${testing ? "animate-spin" : ""}`}
                />
                {testing ? "Testing aaaLogin..." : "Test APIC Login"}
              </button>
            </div>

            {testResult && (
              <div
                className={`p-2.5 rounded-lg border flex items-start gap-2 text-xs ${
                  testResult.ok
                    ? "bg-emerald-50 border-emerald-300 text-emerald-950"
                    : "bg-rose-50 border-rose-300 text-rose-950"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-[#52a732] shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-[#e2231a] shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="font-bold">
                    {testResult.ok
                      ? `APIC Connection Verified (${testResult.latencyMs ?? 0}ms)`
                      : "APIC Authentication / Connection Failed"}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px]">
                    {testResult.message}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. Enterprise LLM API Key & Model Configuration */}
          <div className="p-4 rounded-lg bg-white border border-indigo-200 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                3. Enterprise LLM API Key &amp; Inference Model (AI Security
                Co-Pilot)
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                Active Key: {currentSettings.llmKeyPreview || "Configured (.env)"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* LLM API Key Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  LLM API Key (Groq / Enterprise Key)
                </label>
                <div className="relative flex items-center">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3" />
                  <input
                    type="password"
                    value={llmApiKey}
                    onChange={(e) => setLlmApiKey(e.target.value)}
                    placeholder={`Leave blank to keep ${
                      currentSettings.llmKeyPreview || "current key"
                    }`}
                    className="w-full pl-9 pr-3 py-2 rounded border border-slate-300 focus:border-indigo-600 bg-white text-xs font-mono text-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              {/* LLM Model Selection / Custom Model ID */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  LLM Model ID
                </label>
                <div className="relative flex items-center">
                  <Cpu className="w-4 h-4 text-slate-400 absolute left-3" />
                  <input
                    type="text"
                    list="enterprise-llm-models"
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    placeholder="openai/gpt-oss-120b"
                    className="w-full pl-9 pr-3 py-2 rounded border border-slate-300 focus:border-indigo-600 bg-white text-xs font-mono text-slate-900 focus:outline-none"
                  />
                  <datalist id="enterprise-llm-models">
                    <option value="openai/gpt-oss-120b">
                      GPT-OSS 120B (Groq LPU)
                    </option>
                    <option value="qwen/qwen3.8-27b">
                      Qwen 3.8 27B (Groq LPU)
                    </option>
                    <option value="openai/gpt-oss-20b">
                      GPT-OSS 20B Instant (Groq LPU)
                    </option>
                  </datalist>
                </div>
              </div>
            </div>

            {/* Optional Custom Base URL for Enterprise AI Gateways + Test LLM Key Button */}
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex-1 min-w-[240px]">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Optional Custom LLM Gateway Base URL (Leave blank for Groq
                  Cloud API)
                </label>
                <input
                  type="url"
                  value={llmBaseUrl}
                  onChange={(e) => setLlmBaseUrl(e.target.value)}
                  placeholder="https://api.groq.com (Default) or https://llm-gateway.enterprise.internal"
                  className="w-full px-3 py-1.5 rounded border border-slate-300 focus:border-indigo-600 bg-white text-xs font-mono text-slate-900 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={handleTestLlmKey}
                disabled={testingLlm || saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-indigo-50 hover:bg-indigo-100 text-xs font-bold text-indigo-700 border border-indigo-300 transition disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${testingLlm ? "animate-spin" : ""}`}
                />
                {testingLlm ? "Verifying LLM Key..." : "Verify LLM API Key"}
              </button>
            </div>

            {llmTestResult && (
              <div
                className={`p-2.5 rounded-lg border flex items-start gap-2 text-xs ${
                  llmTestResult.ok
                    ? "bg-emerald-50 border-emerald-300 text-emerald-950"
                    : "bg-rose-50 border-rose-300 text-rose-950"
                }`}
              >
                {llmTestResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-[#52a732] shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-[#e2231a] shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="font-bold">
                    {llmTestResult.ok
                      ? `LLM API Key Verified (${llmTestResult.latencyMs ?? 0}ms)`
                      : "LLM API Key Verification Failed"}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px]">
                    {llmTestResult.message}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded bg-white hover:bg-slate-100 border border-slate-300 text-xs font-semibold text-slate-700 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#049fd9] hover:bg-[#0284c7] text-xs font-bold text-white shadow-sm transition disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              {saving ? "Saving Settings..." : "Save APIC & LLM Settings"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

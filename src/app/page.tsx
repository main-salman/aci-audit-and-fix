"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import AciTopologyChart, {
  SelectedGraphNode,
} from "@/components/AciTopologyChart";
import GitOpsDiffViewer from "@/components/GitOpsDiffViewer";
import {
  AciObjectActionMenu,
  AciVisoreInspectorModal,
  AciObjectActionTarget,
  ACI_CLASS_MAP,
} from "@/components/AciObjectActionMenu";
import ApicSettingsModal, {
  FabricProfile,
} from "@/components/ApicSettingsModal";
import { FormattedMarkdown } from "@/components/FormattedMarkdown";
import type { AciTenantSnapshot, SecurityViolation } from "@/lib/mock-fabric";
import type { RemediationArtifact } from "@/lib/gitops-generator";
import type { McpToolTrace } from "@/lib/groq-agent";
import {
  Send,
  Sparkles,
  RefreshCw,
  Wrench,
  AlertTriangle,
  ExternalLink,
  FolderTree,
  ChevronRight,
  ChevronDown,
  Database,
  Activity,
  FileCode2,
  Layers,
  Bot,
  Cpu,
  Zap,
  CheckCircle2,
  ArrowRight,
  Settings,
  Maximize2,
  Minimize2,
  GripVertical,
  GripHorizontal,
} from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolTraces?: McpToolTrace[];
}

export type MaximizedSection = "none" | "topology" | "chat" | "diff";

const DEMO_PROMPT_PRESETS = [
  {
    badge: "AI Zero-Trust Audit",
    label: "Audit Entire Fabric for CIS Benchmark Violations",
    prompt:
      "Audit all Cisco ACI tenants for zero-trust policy violations including vzAny bindings, wildcard filters, cleartext protocols, and unenforced VRFs.",
  },
  {
    badge: "AI Auto-Remediate vzAny",
    label: "Strip vzAny on Prod-CoreFin & Enforce HTTPS/443",
    prompt:
      "Remediate the vzAny Any-to-Any contract 'Permit-All-AnyToAny' in tenant Prod-CoreFin (VRF Prod-Payment-VRF) so Web-Frontend-EPG can only talk HTTPS (TCP/443) to Payment-App-EPG.",
  },
  {
    badge: "AI Cleartext Purge",
    label: "Purge Telnet/23, FTP/21 & HTTP/80 on Legacy Tier",
    prompt:
      "Fix the cleartext protocol violation on contract 'App-Tier-Legacy-Access' in tenant Prod-CoreFin by removing Telnet (23), FTP (21), and HTTP (80) and enforcing stateful HTTPS (443 and 8443) between Web-Frontend-EPG and Payment-App-EPG.",
  },
  {
    badge: "AI VectorDB Lockdown",
    label: "Enforce VRF & Scope Global Contract on AI Cluster",
    prompt:
      "Remediate the unenforced VRF 'AI-Cluster-VRF' and global wildcard contract 'VectorDB-WideOpen-Contract' in tenant Hybrid-Cloud-AI so Groq-Gateway-EPG accesses Vector-DB-EPG only on TCP/443 with VRF context scope.",
  },
];

const MCP_TOOLS_CATALOG = [
  { name: "list_tenants", label: "MIT Tenant Discovery" },
  { name: "get_fabric_health_and_faults", label: "FaultInst Inspector" },
  { name: "audit_tenant_contracts", label: "Zero-Trust CIS Auditor" },
  { name: "inspect_epg_relationships", label: "EPG Contract Graph" },
  { name: "generate_gitops_remediation", label: "Terraform + OPA Generator" },
];

const GROQ_MODELS = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (Groq LPU)" },
  { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B (Groq LPU)" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B Instant (Groq LPU)" },
];

function violationToGraphNode(v: SecurityViolation): SelectedGraphNode {
  const nodeType: SelectedGraphNode["nodeType"] =
    v.category === "UNENFORCED_VRF" || v.category === "VZANY_EXPOSURE"
      ? "VRF"
      : v.filterName
      ? "FILTER"
      : "CONTRACT";

  return {
    id: `viol:${v.id}`,
    name: v.contractName || v.filterName || v.affectedObject,
    nodeType,
    tenant: v.tenant,
    dn: v.dn,
    hasViolation: true,
    violation: v,
    details: {
      severity: v.severity,
      category: v.category,
      cisBenchmark: v.cisBenchmark,
    },
  };
}

function CiscoBridgeLogo() {
  return (
    <svg
      viewBox="0 0 64 34"
      className="w-11 h-6 text-[#049fd9] fill-current shrink-0"
      aria-label="Cisco APIC"
    >
      <rect x="4" y="16" width="3.5" height="9" rx="1.75" />
      <rect x="11" y="10" width="3.5" height="17" rx="1.75" />
      <rect x="18" y="4" width="3.5" height="26" rx="1.75" />
      <rect x="25" y="10" width="3.5" height="17" rx="1.75" />
      <rect x="32" y="16" width="3.5" height="9" rx="1.75" />
      <rect x="39" y="10" width="3.5" height="17" rx="1.75" />
      <rect x="46" y="4" width="3.5" height="26" rx="1.75" />
      <rect x="53" y="10" width="3.5" height="17" rx="1.75" />
      <rect x="60" y="16" width="3.5" height="9" rx="1.75" />
    </svg>
  );
}

export default function HomePage() {
  const [fabricMode, setFabricMode] = useState<"mock" | "live">("mock");
  const [fabricProfile, setFabricProfile] = useState<FabricProfile>("mock");
  const [apicUrl, setApicUrl] = useState<string>(
    "https://sandboxapicdc.cisco.com"
  );
  const [apicUsername, setApicUsername] = useState<string>("admin");
  const [verifySsl, setVerifySsl] = useState<boolean>(false);
  const [llmKeyPreview, setLlmKeyPreview] = useState<string>("");
  const [llmBaseUrl, setLlmBaseUrl] = useState<string>("");
  const [settingsModalOpen, setSettingsModalOpen] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>(
    "openai/gpt-oss-120b"
  );
  const [tenants, setTenants] = useState<AciTenantSnapshot[]>([]);
  const [violations, setViolations] = useState<SecurityViolation[]>([]);
  const [healthSummary, setHealthSummary] = useState<any>(null);
  const [selectedTenant, setSelectedTenant] = useState<string>("ALL");

  const [apicTopNav, setApicTopNav] = useState<
    "AI Co-Pilot" | "Tenants" | "System" | "Fabric" | "GitOps"
  >("AI Co-Pilot");
  const [workpaneTab, setWorkpaneTab] = useState<
    "topology" | "faults" | "gitops"
  >("topology");
  const [expandedTenants, setExpandedTenants] = useState<
    Record<string, boolean>
  >({
    "Prod-CoreFin": true,
    "Hybrid-Cloud-AI": true,
  });

  // Maximize & Resizable Splitters State
  const [maximizedSection, setMaximizedSection] =
    useState<MaximizedSection>("none");
  // Percentage width of the Center Topology column relative to (Center + Right) space (25% to 75%)
  const [centerWidthPct, setCenterWidthPct] = useState<number>(50);
  const [draggingColSplitter, setDraggingColSplitter] =
    useState<boolean>(false);
  // Resizable vertical heights (px) for each of the 3 sections
  const [topologyHeight, setTopologyHeight] = useState<number>(430);
  const [chatHeight, setChatHeight] = useState<number>(430);
  const [draggingChatHeight, setDraggingChatHeight] = useState<boolean>(false);
  const [diffHeight, setDiffHeight] = useState<number>(340);

  const [actionTarget, setActionTarget] =
    useState<AciObjectActionTarget | null>(null);
  const [visoreModalNode, setVisoreModalNode] =
    useState<SelectedGraphNode | null>(null);

  const [remediation, setRemediation] = useState<RemediationArtifact | null>(
    null
  );
  const [savedFiles, setSavedFiles] = useState<string[]>([]);
  const [loadingFabric, setLoadingFabric] = useState<boolean>(true);
  const [activeMcpTool, setActiveMcpTool] = useState<string | null>(null);

  const diffSectionRef = useRef<HTMLDivElement | null>(null);
  const aiCommandInputRef = useRef<HTMLInputElement | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "### AI Security Co-Pilot Ready\n\nI have indexed **2 tenants (`Prod-CoreFin`, `Hybrid-Cloud-AI`)**, **6 EPGs**, and **7 contracts** via the **Model Context Protocol (`@modelcontextprotocol/sdk`)** and detected **9 CIS Cisco ACI Benchmark violations** (including `vzAny` exposure on `Prod-Payment-VRF` and cleartext `Telnet/23, FTP/21, HTTP/80` filters).\n\n- Ask me **why any violation needs to be fixed**, click **\"AI Auto-Fix (.tf)\"** on any violation row, or use the **AI Command Bar** above to synthesize an OPA-verified `CiscoDevNet/aci` Terraform plan.",
      toolTraces: [
        {
          toolName: "audit_tenant_contracts",
          args: { scope: "all_tenants" },
          resultPreview: "9 zero-trust violations detected across 2 tenants",
          durationMs: 3,
        },
      ],
    },
  ]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [sendingChat, setSendingChat] = useState(false);

  const fetchFabricData = useCallback(
    async (profileOverride?: FabricProfile) => {
      setLoadingFabric(true);
      try {
        const targetProfile = profileOverride || fabricProfile;
        const res = await fetch(`/api/fabric?profile=${targetProfile}`);
        const data = await res.json();
        if (data.apicUrl) setApicUrl(data.apicUrl);
        if (data.apicUsername) setApicUsername(data.apicUsername);
        if (data.verifySsl !== undefined) setVerifySsl(data.verifySsl);
        if (data.profile) setFabricProfile(data.profile);
        if (data.mode) setFabricMode(data.mode);
        if (data.llm?.keyPreview) setLlmKeyPreview(data.llm.keyPreview);
        if (data.llm?.model) setSelectedModel(data.llm.model);
        if (data.llm?.baseUrl !== undefined) setLlmBaseUrl(data.llm.baseUrl);
        setTenants(data.tenants || []);
        setViolations(data.audit?.violations || []);
        setHealthSummary(data.health || null);
        setSavedFiles(data.savedRemediations || []);
      } catch (err) {
        console.error("Failed to load ACI fabric snapshot:", err);
      } finally {
        setLoadingFabric(false);
      }
    },
    [fabricProfile]
  );

  useEffect(() => {
    fetchFabricData();
  }, [fetchFabricData]);

  const handleProfileSwitch = async (newProfile: FabricProfile) => {
    if (newProfile === "custom") {
      setSettingsModalOpen(true);
      return;
    }
    setFabricProfile(newProfile);
    setFabricMode(newProfile === "mock" ? "mock" : "live");
    await fetchFabricData(newProfile);
  };

  const handleApplyApicSettings = (data: any) => {
    if (data.apicUrl) setApicUrl(data.apicUrl);
    if (data.connection?.username) setApicUsername(data.connection.username);
    if (data.connection?.verifySsl !== undefined)
      setVerifySsl(data.connection.verifySsl);
    if (data.profile) setFabricProfile(data.profile);
    if (data.mode) setFabricMode(data.mode);
    if (data.llm?.keyPreview) setLlmKeyPreview(data.llm.keyPreview);
    if (data.llm?.model) setSelectedModel(data.llm.model);
    if (data.llm?.baseUrl !== undefined) setLlmBaseUrl(data.llm.baseUrl);
    if (data.tenants) setTenants(data.tenants);
    if (data.audit?.violations) setViolations(data.audit.violations);
    if (data.health) setHealthSummary(data.health);
  };

  const handleSendPrompt = async (promptText?: string) => {
    const text = (promptText ?? inputPrompt).trim();
    if (!text || sendingChat) return;

    const updatedHistory: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(updatedHistory);
    setInputPrompt("");
    setSendingChat(true);
    setActiveMcpTool("audit_tenant_contracts");

    try {
      const activeContext = {
        selectedTenant,
        selectedObject: actionTarget?.node
          ? {
              name: actionTarget.node.name,
              type: actionTarget.node.nodeType,
              dn: actionTarget.node.dn,
              violation: actionTarget.node.violation
                ? {
                    severity: actionTarget.node.violation.severity,
                    category: actionTarget.node.violation.category,
                    title: actionTarget.node.violation.title,
                    description: actionTarget.node.violation.description,
                    cisBenchmark: actionTarget.node.violation.cisBenchmark,
                    recommendedFix: actionTarget.node.violation.recommendedFix,
                  }
                : null,
            }
          : violations[0]
          ? {
              note: "Defaulting context to top critical violation in fabric",
              dn: violations[0].dn,
              title: violations[0].title,
              description: violations[0].description,
              cisBenchmark: violations[0].cisBenchmark,
            }
          : null,
        stagedRemediation: remediation
          ? {
              contractName: remediation.contractName,
              tenant: remediation.tenant,
              filePath: remediation.filePath,
              opaPassed: remediation.opaResult.passed,
            }
          : null,
      };

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          model: selectedModel,
          activeContext,
          history: updatedHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const data = await res.json();

      if (data.toolTraces?.length > 0) {
        setActiveMcpTool(
          data.toolTraces[data.toolTraces.length - 1].toolName
        );
      }

      if (data.remediation) {
        setRemediation(data.remediation);
        fetchFabricData();
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply || data.error || "Completed.",
          toolTraces: data.toolTraces || [],
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error communicating with Groq MCP orchestrator: ${err?.message}`,
        },
      ]);
    } finally {
      setSendingChat(false);
      setTimeout(() => setActiveMcpTool(null), 1500);
    }
  };

  const handleStageTerraformForNode = async (node: SelectedGraphNode) => {
    setSendingChat(true);
    setActiveMcpTool("generate_gitops_remediation");
    try {
      const tenantObj = tenants.find((t) => t.name === node.tenant);
      const viol =
        node.violation ||
        violations.find(
          (v) =>
            v.tenant === node.tenant &&
            (v.contractName === node.name ||
              v.filterName === node.name ||
              v.dn === node.dn)
        );

      const contractName =
        viol?.contractName ||
        (node.nodeType === "CONTRACT"
          ? node.name
          : `${node.name}-ZeroTrust-Contract`);
      const consumerEpg =
        viol?.recommendedFix.consumerEpg ||
        tenantObj?.epgs[0]?.name ||
        "Web-Frontend-EPG";
      const providerEpg =
        viol?.recommendedFix.providerEpg ||
        tenantObj?.epgs[1]?.name ||
        "Payment-App-EPG";
      const allowedPorts = viol?.recommendedFix.allowedPorts || [
        { name: "https-443", protocol: "tcp", port: "443" },
      ];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "direct_remediate",
          remediationInput: {
            tenant: node.tenant,
            vrfName: tenantObj?.vrfs[0]?.name || `${node.tenant}-VRF`,
            appProfile: tenantObj?.appProfiles[0] || "AP-OnlineBanking",
            contractName,
            consumerEpg,
            providerEpg,
            scope: "context",
            allowedPorts,
            removeVzAny: viol?.recommendedFix.removeVzAny ?? true,
            reason:
              viol?.recommendedFix.summary ||
              `Enforce least-privilege contract for ${node.dn}`,
            beforeAciJson: viol?.rawAciJson,
          },
        }),
      });
      const data = await res.json();
      if (data.remediation) {
        setRemediation(data.remediation);
        fetchFabricData();
        setTimeout(() => {
          diffSectionRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 120);
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: `[AI Auto-Remediate] Stage GitOps Terraform remediation for [${node.nodeType}] ${node.name} (${node.dn})`,
        },
        {
          role: "assistant",
          content: data.reply,
          toolTraces: data.toolTraces,
        },
      ]);
    } finally {
      setSendingChat(false);
      setTimeout(() => setActiveMcpTool(null), 1500);
    }
  };

  const handleAskGroqAboutNode = (node: SelectedGraphNode) => {
    const prompt = node.violation
      ? `Analyze the zero-trust blast radius of ${node.nodeType} '${node.name}' (DN: ${node.dn}) in tenant ${node.tenant} with violation [${node.violation.category}] and explain why it must be remediated.`
      : `Inspect ${node.nodeType} '${node.name}' (DN: ${node.dn}) in tenant ${node.tenant}, audit its EPG/contract relationships, and verify its CIS Cisco ACI Benchmark posture.`;
    handleSendPrompt(prompt);
  };

  const handleGraphNodeSelect = useCallback((node: SelectedGraphNode) => {
    setActionTarget({ node });
  }, []);

  // Horizontal Column Splitter Drag Handler (resizes Center Topology vs. Right AI Co-Pilot width)
  const handleColumnSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!splitContainerRef.current) return;
    setDraggingColSplitter(true);
    const containerRect = splitContainerRef.current.getBoundingClientRect();

    const onMouseMove = (moveEvent: MouseEvent) => {
      const relativeX = moveEvent.clientX - containerRect.left;
      const pct = (relativeX / containerRect.width) * 100;
      const clamped = Math.max(28, Math.min(72, Math.round(pct)));
      setCenterWidthPct(clamped);
      window.dispatchEvent(new Event("resize"));
    };

    const onMouseUp = () => {
      setDraggingColSplitter(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.dispatchEvent(new Event("resize"));
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Vertical Chat Height Resize Splitter Drag Handler
  const handleChatVerticalDragStart = (e: React.MouseEvent) => {
    if (maximizedSection === "chat") return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = chatHeight;
    setDraggingChatHeight(true);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      setChatHeight(Math.max(240, Math.min(900, startH + delta)));
    };

    const onMouseUp = () => {
      setDraggingChatHeight(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const toggleMaximize = (section: MaximizedSection) => {
    setMaximizedSection((prev) => (prev === section ? "none" : section));
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 60);
  };

  const activeDnBreadcrumb =
    actionTarget?.node.dn ||
    (selectedTenant === "ALL"
      ? "uni (Fabric Root)"
      : `uni/tn-${selectedTenant}`);

  // Reusable AI Security Co-Pilot Panel Renderer
  const renderAiCoPilotSection = (isMax: boolean) => (
    <div className="flex flex-col rounded-xl bg-white border-2 border-[#049fd9] shadow-md overflow-hidden">
      {/* AI Console Header with Top-Right Maximize/Restore Icon */}
      <div className="px-4 py-2.5 bg-gradient-to-r from-[#0d274d] to-[#1e3a8a] text-white flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[#00bceb] text-slate-950 flex items-center justify-center font-bold shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold flex items-center gap-2">
              <span className="truncate">AI Security Co-Pilot</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#52a732] text-white shrink-0">
                LIVE MCP
              </span>
            </div>
            <div className="text-[10px] text-sky-200 font-mono truncate">
              Model: {selectedModel} · Guardrail: OPA Rego (6 CIS Rules)
            </div>
          </div>
        </div>

        <button
          onClick={() => toggleMaximize("chat")}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/25 transition shrink-0"
          title={
            isMax
              ? "Restore AI Security Co-Pilot Size"
              : "Maximize AI Security Co-Pilot to Workspace"
          }
        >
          {isMax ? (
            <>
              <Minimize2 className="w-3.5 h-3.5 text-[#7bd5f5]" />
              <span className="hidden sm:inline text-[11px]">Restore</span>
            </>
          ) : (
            <>
              <Maximize2 className="w-3.5 h-3.5 text-[#7bd5f5]" />
              <span className="hidden sm:inline text-[11px]">Maximize</span>
            </>
          )}
        </button>
      </div>

      {/* AI Conversation & Live MCP Tool Call Stream */}
      <div
        style={{
          height: isMax ? "calc(100vh - 280px)" : `${chatHeight}px`,
        }}
        className="p-3.5 space-y-3.5 overflow-y-auto bg-slate-50/70"
      >
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${
              msg.role === "user" ? "items-end" : "items-start"
            }`}
          >
            <div
              className={`max-w-[95%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed shadow-sm ${
                msg.role === "user"
                  ? "bg-gradient-to-r from-[#049fd9] to-indigo-600 text-white font-medium"
                  : "bg-white border border-slate-200 text-slate-800"
              }`}
            >
              <FormattedMarkdown
                content={msg.content}
                isUser={msg.role === "user"}
              />

              {/* Prominent MCP Tool Call Execution Trace Cards */}
              {msg.toolTraces && msg.toolTraces.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-700">
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3 text-[#049fd9]" />
                      Autonomous MCP Tool Execution ({msg.toolTraces.length})
                    </span>
                    <span className="text-[#3f8624] flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      JSON-RPC 2.0 Verified
                    </span>
                  </div>
                  {msg.toolTraces.map((tr, tIdx) => (
                    <div
                      key={tIdx}
                      className="p-2.5 rounded-lg bg-[#0d274d] text-white border border-[#049fd9]/40 font-mono text-[11px]"
                    >
                      <div className="flex items-center justify-between text-[#8ce06c] font-bold">
                        <span>mcp.callTool(&quot;{tr.toolName}&quot;)</span>
                        <span className="px-1.5 py-0.2 rounded bg-white/10 text-sky-200 text-[10px]">
                          {tr.durationMs}ms
                        </span>
                      </div>
                      <div className="text-sky-200/90 truncate mt-1">
                        args: {JSON.stringify(tr.args)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {sendingChat && (
          <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-xs text-[#0284c7] font-mono font-bold animate-pulse flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#049fd9] animate-spin" />
            AI Security Co-Pilot executing MCP Tool Calls &amp; verifying OPA
            Rego Guardrails...
          </div>
        )}
      </div>

      {/* Bottom Docked AI Chat Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendPrompt();
        }}
        className="p-2.5 bg-white border-t border-slate-200 flex items-center gap-2"
      >
        <input
          type="text"
          value={inputPrompt}
          onChange={(e) => setInputPrompt(e.target.value)}
          placeholder="Ask AI Security Co-Pilot why a violation matters or how to fix any ACI contract..."
          className="flex-1 bg-slate-50 border border-slate-300 focus:border-[#049fd9] rounded-lg px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={sendingChat || !inputPrompt.trim()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-gradient-to-r from-[#049fd9] to-indigo-600 hover:from-[#0284c7] hover:to-indigo-700 disabled:opacity-40 text-xs font-bold text-white shadow-sm transition"
        >
          <Send className="w-3.5 h-3.5" />
          Ask AI
        </button>
      </form>

      {/* Bottom Draggable Vertical Resize Splitter Bar */}
      {!isMax && (
        <div
          onMouseDown={handleChatVerticalDragStart}
          className={`h-2.5 w-full cursor-row-resize flex items-center justify-center border-t border-slate-200 transition ${
            draggingChatHeight
              ? "bg-[#049fd9]/20"
              : "bg-slate-50 hover:bg-sky-100/70"
          }`}
          title="Drag vertically to resize AI Security Co-Pilot height"
        >
          <GripHorizontal className="w-4 h-3 text-slate-400" />
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f6f9] text-slate-800">
      {/* APIC Controller & Credentials Settings Modal */}
      <ApicSettingsModal
        open={settingsModalOpen}
        currentSettings={{
          profile: fabricProfile,
          url: apicUrl,
          username: apicUsername,
          verifySsl,
          llmModel: selectedModel,
          llmKeyPreview,
          llmBaseUrl,
        }}
        onClose={() => setSettingsModalOpen(false)}
        onApplySettings={handleApplyApicSettings}
      />

      {/* Option 5 Modal: Live APIC Managed Object Tree (Visore) & Faults Inspector */}
      <AciVisoreInspectorModal
        node={visoreModalNode}
        tenants={tenants}
        apicBaseUrl={apicUrl}
        fabricMode={fabricMode}
        onClose={() => setVisoreModalNode(null)}
        onStageTerraformFix={handleStageTerraformForNode}
      />

      {/* ===================================================================== */}
      {/* CISCO APIC 6.x LIGHT TOP HEADER & NAVY SUB-RIBBON                     */}
      {/* ===================================================================== */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-[1740px] mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <CiscoBridgeLogo />
              <div className="flex items-center gap-2.5">
                <span className="text-lg font-bold tracking-tight text-slate-900">
                  ACI Audit and Fix
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-gradient-to-r from-[#049fd9] to-indigo-600 text-white shadow-sm">
                  <Sparkles className="w-3 h-3" />
                  Groq LPU + MCP AI Agent
                </span>
              </div>
            </div>

            {/* Authentic Cisco APIC Top Menu Tabs */}
            <nav className="hidden md:flex items-center gap-1">
              {(
                [
                  "AI Co-Pilot",
                  "Tenants",
                  "System",
                  "Fabric",
                  "GitOps",
                ] as const
              ).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setApicTopNav(tab);
                    if (tab === "AI Co-Pilot") {
                      aiCommandInputRef.current?.focus();
                    } else if (tab === "GitOps") {
                      diffSectionRef.current?.scrollIntoView({
                        behavior: "smooth",
                      });
                    }
                  }}
                  className={`px-3.5 py-2 text-xs font-semibold transition border-b-2 flex items-center gap-1.5 ${
                    apicTopNav === tab
                      ? "text-[#049fd9] border-[#049fd9] bg-sky-50/70"
                      : "text-slate-600 border-transparent hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  {tab === "AI Co-Pilot" && (
                    <Bot className="w-3.5 h-3.5 text-[#049fd9]" />
                  )}
                  {tab}
                </button>
              ))}
            </nav>
          </div>

          {/* Right Controls: Groq Model Selector, Visore Link, Fabric Mode & Refresh */}
          <div className="flex items-center gap-2.5">
            <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-50 border border-indigo-200 text-xs">
              <Cpu className="w-3.5 h-3.5 text-indigo-600" />
              <span className="text-[11px] font-semibold text-indigo-900">
                LLM:
              </span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-transparent text-xs font-mono font-bold text-indigo-700 focus:outline-none cursor-pointer"
              >
                {GROQ_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <a
              href={`${apicUrl}/visore.html#/class=fvTenant`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-100 hover:bg-sky-50 text-xs font-semibold text-[#0284c7] border border-slate-200 hover:border-sky-300 transition"
              title="Open Cisco APIC Object Store (Visore)"
            >
              <Database className="w-3.5 h-3.5 text-[#049fd9]" />
              <span>Object Store (Visore)</span>
              <ExternalLink className="w-3 h-3" />
            </a>

            {/* 3-Option Fabric Switcher: Demo Fabric | DevNet Sandbox | Custom APIC */}
            <div className="flex items-center rounded bg-slate-100 p-0.5 border border-slate-300">
              <button
                onClick={() => handleProfileSwitch("mock")}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition ${
                  fabricProfile === "mock"
                    ? "bg-[#049fd9] text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Demo Fabric
              </button>
              <button
                onClick={() => handleProfileSwitch("devnet")}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition ${
                  fabricProfile === "devnet"
                    ? "bg-[#52a732] text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                DevNet Sandbox
              </button>
              <button
                onClick={() => setSettingsModalOpen(true)}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition flex items-center gap-1 ${
                  fabricProfile === "custom"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                title="Configure Custom APIC Controller & Credentials"
              >
                <Settings className="w-3 h-3" />
                <span>Custom APIC</span>
              </button>
            </div>

            <button
              onClick={() => setSettingsModalOpen(true)}
              className="p-1.5 rounded bg-slate-100 hover:bg-sky-50 text-slate-700 hover:text-[#0284c7] border border-slate-300 transition"
              title="APIC Controller & Credentials Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => fetchFabricData()}
              className="p-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition"
              title="Refresh APIC MIT State"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loadingFabric ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Authentic Cisco APIC Navy Sub-Bar Ribbon (#1d385e) + Live MCP Agent Pipeline Bar */}
        <div className="bg-[#1d385e] text-white px-4 py-1.5">
          <div className="max-w-[1740px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-[#049fd9] text-white font-bold">
                  MIT DN
                </span>
                <span className="text-slate-100">{activeDnBreadcrumb}</span>
                {actionTarget && (
                  <span className="text-[#7bd5f5]">
                    ({ACI_CLASS_MAP[actionTarget.node.nodeType]})
                  </span>
                )}
              </div>

              <span className="text-slate-500 hidden sm:inline">|</span>

              <div className="hidden lg:flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-[#7bd5f5] font-sans font-bold flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-300" />
                  MCP Tools:
                </span>
                {MCP_TOOLS_CATALOG.map((tool) => {
                  const isRunning = activeMcpTool === tool.name;
                  return (
                    <span
                      key={tool.name}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition ${
                        isRunning
                          ? "bg-amber-400 text-slate-950 font-bold animate-pulse"
                          : "bg-white/10 text-slate-200 border border-white/15"
                      }`}
                    >
                      {tool.name}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-3 text-[11px]">
              <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-white/10 border border-white/20">
                <Activity className="w-3.5 h-3.5 text-[#6cc04a]" />
                <span className="text-slate-200">Fabric Health:</span>
                <span className="font-bold text-[#8ce06c]">
                  {healthSummary?.overallHealth ?? 72}%
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  className="px-2 py-0.5 rounded font-bold bg-[#e2231a] text-white"
                  title="Critical Policy Violations / Faults"
                >
                  C: {violations.filter((v) => v.severity === "CRITICAL").length}
                </span>
                <span
                  className="px-2 py-0.5 rounded font-bold bg-[#f58220] text-white"
                  title="Major / High Policy Violations"
                >
                  M: {violations.filter((v) => v.severity === "HIGH").length}
                </span>
                <span
                  className="px-2 py-0.5 rounded font-bold bg-[#ffcc00] text-slate-950"
                  title="Minor / Warning Policy Violations"
                >
                  W: {violations.filter((v) => v.severity === "MEDIUM").length}
                </span>
                <span
                  className="px-2 py-0.5 rounded font-bold bg-[#52a732] text-white"
                  title="OPA Verified GitOps Remediations"
                >
                  OPA .tf: {savedFiles.length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ===================================================================== */}
      {/* CENTRAL AI COMMAND HERO BANNER                                        */}
      {/* ===================================================================== */}
      {maximizedSection === "none" && (
        <section className="max-w-[1740px] w-full mx-auto px-3 lg:px-4 pt-3.5">
          <div className="rounded-xl bg-gradient-to-r from-[#0d274d] via-[#13386e] to-[#1e3a8a] text-white p-4 shadow-md border border-[#049fd9]/40">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
              <div className="lg:col-span-7 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#00bceb] text-slate-950">
                    <Bot className="w-3.5 h-3.5" />
                    AI SECURITY CO-PILOT COMMAND CENTER
                  </span>
                  <span className="text-xs text-sky-200">
                    Audits APIC MIT in real time &amp; generates OPA-verified{" "}
                    <code className="text-white font-semibold">
                      CiscoDevNet/aci
                    </code>{" "}
                    Terraform remediations
                  </span>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendPrompt();
                  }}
                  className="flex items-center gap-2 bg-white rounded-lg p-1.5 shadow-inner border-2 border-[#00bceb]"
                >
                  <Sparkles className="w-5 h-5 text-[#049fd9] ml-2 shrink-0" />
                  <input
                    ref={aiCommandInputRef}
                    type="text"
                    value={inputPrompt}
                    onChange={(e) => setInputPrompt(e.target.value)}
                    placeholder="Ask AI Security Co-Pilot to audit a tenant, explain why a violation matters, or generate a Terraform fix..."
                    className="flex-1 bg-transparent text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none px-1"
                  />
                  <button
                    type="submit"
                    disabled={sendingChat || !inputPrompt.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-gradient-to-r from-[#049fd9] to-indigo-600 hover:from-[#0284c7] hover:to-indigo-700 disabled:opacity-40 text-xs font-bold text-white shadow transition shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {sendingChat ? "AI Thinking..." : "Execute with Groq + MCP"}
                  </button>
                </form>
              </div>

              <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DEMO_PROMPT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => handleSendPrompt(preset.prompt)}
                    disabled={sendingChat}
                    className="text-left p-2.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 hover:border-[#00bceb] transition group disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#00bceb]/25 text-[#7bd5f5] border border-[#00bceb]/40">
                        {preset.badge}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-sky-300 group-hover:translate-x-0.5 transition" />
                    </div>
                    <div className="text-xs font-bold text-white mt-1.5 truncate">
                      {preset.label}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===================================================================== */}
      {/* MAXIMIZED WORKSPACE VIEW (Expands to entire main workspace area)      */}
      {/* ===================================================================== */}
      {maximizedSection !== "none" ? (
        <main className="flex-1 max-w-[1740px] w-full mx-auto p-3 lg:p-4 flex flex-col gap-3">
          {maximizedSection === "topology" && (
            <>
              <AciTopologyChart
                tenants={tenants}
                violations={violations}
                selectedTenant={selectedTenant}
                onSelectNode={handleGraphNodeSelect}
                isMaximized={true}
                onToggleMaximize={() => toggleMaximize("topology")}
              />
              <AciObjectActionMenu
                target={actionTarget}
                apicBaseUrl={apicUrl}
                fabricMode={fabricMode}
                onClose={() => setActionTarget(null)}
                onOpenVisoreModal={(node) => setVisoreModalNode(node)}
                onStageTerraformFix={(node) => handleStageTerraformForNode(node)}
                onAskGroqAgent={(node) => handleAskGroqAboutNode(node)}
              />
            </>
          )}

          {maximizedSection === "chat" && renderAiCoPilotSection(true)}

          {maximizedSection === "diff" && (
            <GitOpsDiffViewer
              remediation={remediation}
              isMaximized={true}
              onToggleMaximize={() => toggleMaximize("diff")}
            />
          )}
        </main>
      ) : (
        /* =================================================================== */
        /* STANDARD 3-PANE RESIZABLE WORKSPACE                                 */
        /* =================================================================== */
        <main className="flex-1 max-w-[1740px] w-full mx-auto p-3 lg:p-4 flex flex-col lg:flex-row gap-3">
          {/* LEFT PANE: Authentic APIC Quick-Start Object Tree (Fixed 230px on desktop) */}
          <aside className="w-full lg:w-[235px] shrink-0 rounded-lg bg-white border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="px-3 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-[#049fd9]" />
                Tenants (MIT Tree)
              </span>
              <button
                onClick={() => setSelectedTenant("ALL")}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  selectedTenant === "ALL"
                    ? "bg-[#049fd9] text-white"
                    : "text-slate-600 hover:text-slate-900 bg-white border border-slate-300"
                }`}
              >
                All ({tenants.length})
              </button>
            </div>

            <div className="p-2 space-y-2 overflow-y-auto text-xs flex-1 max-h-[820px]">
              {tenants.map((t) => {
                const isExpanded = expandedTenants[t.name] ?? true;
                const tViols = violations.filter((v) => v.tenant === t.name);
                return (
                  <div
                    key={t.name}
                    className="rounded bg-slate-50 border border-slate-200 overflow-hidden"
                  >
                    <div
                      className={`px-2 py-1.5 flex items-center justify-between cursor-pointer transition ${
                        selectedTenant === t.name
                          ? "bg-sky-100/80 text-[#0284c7] font-bold"
                          : "hover:bg-slate-100 text-slate-800"
                      }`}
                      onClick={() => {
                        setSelectedTenant(t.name);
                        setExpandedTenants((prev) => ({
                          ...prev,
                          [t.name]: !isExpanded,
                        }));
                      }}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-[#049fd9] shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className="font-semibold truncate">
                          tn-{t.name}
                        </span>
                      </div>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                          tViols.length > 0
                            ? "bg-[#e2231a] text-white"
                            : "bg-[#52a732] text-white"
                        }`}
                      >
                        {t.healthScore}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="pl-3 pr-1.5 py-1.5 space-y-1 border-t border-slate-200 bg-white text-[11px]">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#0284c7] mt-1">
                          Networking (fvCtx)
                        </div>
                        {t.vrfs.map((vrf) => {
                          const vrfViol = tViols.find(
                            (v) =>
                              v.category === "UNENFORCED_VRF" ||
                              v.category === "VZANY_EXPOSURE"
                          );
                          return (
                            <button
                              key={vrf.name}
                              onClick={() =>
                                setActionTarget({
                                  node: {
                                    id: `vrf:${t.name}:${vrf.name}`,
                                    name: vrf.name,
                                    nodeType: "VRF",
                                    tenant: t.name,
                                    dn: `uni/tn-${t.name}/ctx-${vrf.name}`,
                                    hasViolation: Boolean(vrfViol),
                                    violation: vrfViol,
                                    details: { enforcement: vrf.pcEnfPref },
                                  },
                                })
                              }
                              className="w-full text-left px-2 py-1 rounded hover:bg-sky-50 flex items-center justify-between text-slate-700"
                            >
                              <span className="truncate">ctx-{vrf.name}</span>
                              {vrfViol && (
                                <span className="w-2 h-2 rounded-full bg-[#e2231a] shrink-0" />
                              )}
                            </button>
                          );
                        })}

                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#3f8624] mt-2">
                          App EPGs (fvAEPg)
                        </div>
                        {t.epgs.map((epg) => (
                          <button
                            key={epg.name}
                            onClick={() =>
                              setActionTarget({
                                node: {
                                  id: `epg:${t.name}:${epg.name}`,
                                  name: epg.name,
                                  nodeType: "EPG",
                                  tenant: t.name,
                                  dn: epg.dn,
                                  hasViolation:
                                    epg.providedContracts.length === 0 &&
                                    epg.consumedContracts.length === 0,
                                  details: {
                                    appProfile: epg.appProfile,
                                    bridgeDomain: epg.bridgeDomain,
                                  },
                                },
                              })
                            }
                            className="w-full text-left px-2 py-1 rounded hover:bg-sky-50 flex items-center justify-between text-slate-700"
                          >
                            <span className="truncate">epg-{epg.name}</span>
                          </button>
                        ))}

                        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mt-2">
                          Contracts (vzBrCP)
                        </div>
                        {t.contracts.map((c) => {
                          const cViol = tViols.find(
                            (v) => v.contractName === c.name
                          );
                          return (
                            <button
                              key={c.name}
                              onClick={() =>
                                setActionTarget({
                                  node: {
                                    id: `contract:${t.name}:${c.name}`,
                                    name: c.name,
                                    nodeType: "CONTRACT",
                                    tenant: t.name,
                                    dn: c.dn,
                                    hasViolation: Boolean(cViol),
                                    violation: cViol,
                                    details: { scope: c.scope },
                                  },
                                })
                              }
                              className="w-full text-left px-2 py-1 rounded hover:bg-sky-50 flex items-center justify-between text-slate-700"
                            >
                              <span className="truncate">brc-{c.name}</span>
                              {cViol && (
                                <span className="w-2 h-2 rounded-full bg-[#e2231a] shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* RESIZABLE SPLIT CONTAINER: Center Topology/Violations <-> Right AI Security Co-Pilot & Diff */}
          <div
            ref={splitContainerRef}
            className="flex-1 flex flex-col lg:flex-row min-w-0 gap-2 lg:gap-0"
          >
            {/* CENTER WORKPANE */}
            <section
              style={{
                width:
                  typeof window !== "undefined" && window.innerWidth < 1024
                    ? "100%"
                    : `${centerWidthPct}%`,
              }}
              className="min-w-0 flex flex-col gap-3.5 pr-0 lg:pr-1.5"
            >
              {/* Cisco APIC Workpane Tab Bar */}
              <div className="rounded-lg bg-white border border-slate-200 shadow-sm px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setWorkpaneTab("topology")}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition flex items-center gap-1.5 ${
                      workpaneTab === "topology"
                        ? "bg-[#049fd9] text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Topology Graph
                  </button>
                  <button
                    onClick={() => setWorkpaneTab("faults")}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition flex items-center gap-1.5 ${
                      workpaneTab === "faults"
                        ? "bg-[#049fd9] text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-[#f58220]" />
                    Violations ({violations.length})
                  </button>
                  <button
                    onClick={() => {
                      setWorkpaneTab("gitops");
                      diffSectionRef.current?.scrollIntoView({
                        behavior: "smooth",
                      });
                    }}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition flex items-center gap-1.5 ${
                      workpaneTab === "gitops"
                        ? "bg-[#049fd9] text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <FileCode2 className="w-3.5 h-3.5 text-[#52a732]" />
                    GitOps Diff ({savedFiles.length})
                  </button>
                </div>

                <div className="text-[11px] text-slate-600">
                  Scope:{" "}
                  <strong className="text-[#0284c7]">
                    {selectedTenant === "ALL" ? "All Tenants" : selectedTenant}
                  </strong>
                </div>
              </div>

              {/* Apache ECharts Force-Directed Graph (with Maximize & Vertical Resize Splitter) */}
              <AciTopologyChart
                tenants={tenants}
                violations={violations}
                selectedTenant={selectedTenant}
                onSelectNode={handleGraphNodeSelect}
                isMaximized={false}
                onToggleMaximize={() => toggleMaximize("topology")}
                height={topologyHeight}
                onHeightChange={setTopologyHeight}
              />

              {/* 5-Option Interactive APIC Object Action Menu */}
              <AciObjectActionMenu
                target={actionTarget}
                apicBaseUrl={apicUrl}
                fabricMode={fabricMode}
                onClose={() => setActionTarget(null)}
                onOpenVisoreModal={(node) => setVisoreModalNode(node)}
                onStageTerraformFix={(node) => handleStageTerraformForNode(node)}
                onAskGroqAgent={(node) => handleAskGroqAboutNode(node)}
              />

              {/* APIC Operational Faults & Zero-Trust Policy Violations with AI Insights */}
              <div className="rounded-lg bg-white border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-3.5 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#e2231a]" />
                    AI-Detected Zero-Trust Policy Violations ({violations.length})
                  </h2>
                  <span className="text-[11px] text-[#0284c7] font-semibold">
                    Click any violation for APIC &amp; AI Actions
                  </span>
                </div>

                <div className="divide-y divide-slate-200 max-h-[340px] overflow-y-auto">
                  {violations.map((v) => {
                    const asNode = violationToGraphNode(v);
                    const isSelected = actionTarget?.node.dn === v.dn;
                    return (
                      <div
                        key={v.id}
                        onClick={() => setActionTarget({ node: asNode })}
                        className={`cursor-pointer p-3 transition ${
                          isSelected
                            ? "bg-sky-50 border-l-4 border-l-[#049fd9]"
                            : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                v.severity === "CRITICAL"
                                  ? "bg-[#e2231a] text-white"
                                  : v.severity === "HIGH"
                                  ? "bg-[#f58220] text-white"
                                  : "bg-[#ffcc00] text-slate-950"
                              }`}
                            >
                              {v.severity}
                            </span>
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {v.title}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAskGroqAboutNode(asNode);
                              }}
                              disabled={sendingChat}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-bold transition"
                              title="Ask AI Security Co-Pilot to analyze blast radius"
                            >
                              <Sparkles className="w-3 h-3 text-indigo-600" />
                              AI Analyze
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStageTerraformForNode(asNode);
                              }}
                              disabled={sendingChat}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-gradient-to-r from-[#049fd9] to-indigo-600 hover:from-[#0284c7] hover:to-indigo-700 text-white text-[11px] font-bold shadow-sm transition"
                            >
                              <Wrench className="w-3 h-3" />
                              AI Auto-Fix (.tf)
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 p-2 rounded bg-sky-50/80 border border-sky-200/80 flex items-start gap-2 text-[11px]">
                          <Bot className="w-3.5 h-3.5 text-[#0284c7] shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <span className="font-bold text-[#0284c7]">
                              AI Remediation Plan:{" "}
                            </span>
                            <span className="text-slate-700">
                              {v.recommendedFix.summary}
                            </span>
                            <div className="font-mono text-[10px] text-slate-500 truncate mt-0.5">
                              dn: {v.dn} · {v.cisBenchmark}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* DRAGGABLE HORIZONTAL COLUMN RESIZE SPLITTER */}
            <div
              onMouseDown={handleColumnSplitterMouseDown}
              className={`hidden lg:flex w-2.5 mx-1 cursor-col-resize items-center justify-center rounded transition select-none ${
                draggingColSplitter
                  ? "bg-[#049fd9]/30"
                  : "hover:bg-sky-200/70 bg-slate-200/60"
              }`}
              title="Drag horizontally to resize Topology vs. AI Security Co-Pilot width"
            >
              <GripVertical className="w-3.5 h-5 text-slate-500" />
            </div>

            {/* RIGHT PANE: Prominent AI Security Co-Pilot & GitOps Diff Viewer */}
            <section
              style={{
                width:
                  typeof window !== "undefined" && window.innerWidth < 1024
                    ? "100%"
                    : `${100 - centerWidthPct}%`,
              }}
              className="min-w-0 flex flex-col gap-3.5 pl-0 lg:pl-1.5"
            >
              {renderAiCoPilotSection(false)}

              <div ref={diffSectionRef}>
                <GitOpsDiffViewer
                  remediation={remediation}
                  isMaximized={false}
                  onToggleMaximize={() => toggleMaximize("diff")}
                  height={diffHeight}
                  onHeightChange={setDiffHeight}
                />
              </div>
            </section>
          </div>
        </main>
      )}
    </div>
  );
}

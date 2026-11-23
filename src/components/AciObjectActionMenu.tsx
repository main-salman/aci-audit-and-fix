"use client";

import React, { useState } from "react";
import type { SelectedGraphNode } from "./AciTopologyChart";
import type { AciTenantSnapshot } from "@/lib/mock-fabric";
import {
  ExternalLink,
  Terminal,
  SearchCode,
  Wrench,
  Sparkles,
  X,
  Check,
  Copy,
  AlertTriangle,
  ShieldCheck,
  Database,
  Layers,
} from "lucide-react";

export interface AciObjectActionTarget {
  node: SelectedGraphNode;
  x?: number;
  y?: number;
}

interface ActionMenuProps {
  target: AciObjectActionTarget | null;
  apicBaseUrl: string;
  fabricMode?: "mock" | "live";
  onClose: () => void;
  onOpenVisoreModal: (node: SelectedGraphNode) => void;
  onStageTerraformFix: (node: SelectedGraphNode) => void;
  onAskGroqAgent: (node: SelectedGraphNode) => void;
}

export const ACI_CLASS_MAP: Record<SelectedGraphNode["nodeType"], string> = {
  TENANT: "fvTenant",
  VRF: "fvCtx",
  EPG: "fvAEPg",
  CONTRACT: "vzBrCP",
  FILTER: "vzFilter",
};

export function buildApicGuiUrls(
  baseUrl: string,
  node: SelectedGraphNode,
  fabricMode: "mock" | "live" = "mock"
) {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const moClass = ACI_CLASS_MAP[node.nodeType] || "vzBrCP";

  // 1. Main Cisco APIC ExtJS Tenants GUI deep link (#b:a|<dn>)
  const tenantGuiUrl = `${cleanBase}/#b:a|${node.dn}`;

  // 2. Hash-routed Visore Object Store URL for exact DN: visore.html#/dn=uni/tn-...
  const visoreDnUrl = `${cleanBase}/visore.html#/dn=${node.dn}`;

  // 3. Hash-routed Visore Object Store URL for the ACI Class (e.g. visore.html#/class=vzBrCP)
  const visoreClassUrl = `${cleanBase}/visore.html#/class=${moClass}`;

  // 4. Direct REST API JSON endpoint on APIC
  const restApiUrl = `${cleanBase}/api/node/mo/${node.dn}.json?query-target=self&rsp-subtree=full&rsp-subtree-include=faults,health`;

  const visoreUrl = visoreDnUrl;

  return {
    tenantGuiUrl,
    visoreUrl,
    visoreDnUrl,
    visoreClassUrl,
    restApiUrl,
    moClass,
  };
}

export function buildApicCliCommand(node: SelectedGraphNode): string {
  const moClass = ACI_CLASS_MAP[node.nodeType] || "vzBrCP";
  return `cd /aci/tenants/${node.tenant} && moquery -c ${moClass} -d "${node.dn}" -x rsp-subtree=full,rsp-subtree-include=faults,health`;
}

export function buildManagedObjectTree(
  node: SelectedGraphNode,
  tenants: AciTenantSnapshot[]
) {
  const tenant = tenants.find((t) => t.name === node.tenant);
  const moClass = ACI_CLASS_MAP[node.nodeType];

  const relatedFaults =
    tenant?.faults.filter(
      (f) => f.affectedObject === node.dn || f.dn.includes(node.name)
    ) || [];

  if (node.violation?.rawAciJson) {
    return {
      moClass,
      dn: node.dn,
      healthScore: node.hasViolation ? 62 : 98,
      faults: relatedFaults,
      imdata: [node.violation.rawAciJson],
    };
  }

  let imdataObj: Record<string, any> = {};
  if (node.nodeType === "TENANT" && tenant) {
    imdataObj = {
      fvTenant: {
        attributes: {
          dn: tenant.dn,
          name: tenant.name,
          descr: tenant.descr,
          status: "created,modified",
        },
        children: tenant.vrfs.map((v) => ({
          fvCtx: {
            attributes: {
              dn: `${tenant.dn}/ctx-${v.name}`,
              name: v.name,
              pcEnfPref: v.pcEnfPref,
            },
          },
        })),
      },
    };
  } else if (node.nodeType === "EPG") {
    const epg = tenant?.epgs.find((e) => e.name === node.name);
    imdataObj = {
      fvAEPg: {
        attributes: {
          dn: node.dn,
          name: node.name,
          pcTag: "32771",
          prefGrMemb: "exclude",
          prio: "unspecified",
        },
        children: [
          ...(epg?.providedContracts || []).map((c) => ({
            fvRsProv: {
              attributes: { tnVzBrCPName: c, matchT: "AtleastOne" },
            },
          })),
          ...(epg?.consumedContracts || []).map((c) => ({
            fvRsCons: {
              attributes: { tnVzBrCPName: c, prio: "unspecified" },
            },
          })),
        ],
      },
    };
  } else if (node.nodeType === "CONTRACT") {
    const contract = tenant?.contracts.find((c) => c.name === node.name);
    imdataObj = {
      vzBrCP: {
        attributes: {
          dn: node.dn,
          name: node.name,
          scope: contract?.scope || "context",
          targetDscp: "unspecified",
        },
        children: (contract?.subjects || []).map((s) => ({
          vzSubj: {
            attributes: { name: s.name, revFltPorts: "yes" },
            children: s.filters.map((f) => ({
              vzRsSubjFiltAtt: { attributes: { tnVzFilterName: f } },
            })),
          },
        })),
      },
    };
  } else if (node.nodeType === "FILTER") {
    const flt = tenant?.filters.find((f) => f.name === node.name);
    imdataObj = {
      vzFilter: {
        attributes: {
          dn: node.dn,
          name: node.name,
        },
        children: (flt?.entries || []).map((e) => ({
          vzEntry: { attributes: e },
        })),
      },
    };
  } else {
    imdataObj = {
      [moClass]: {
        attributes: {
          dn: node.dn,
          name: node.name,
          ...node.details,
        },
      },
    };
  }

  return {
    moClass,
    dn: node.dn,
    healthScore: node.hasViolation ? 64 : 96,
    faults: relatedFaults,
    imdata: [imdataObj],
  };
}

export function AciObjectActionMenu({
  target,
  apicBaseUrl,
  fabricMode = "mock",
  onClose,
  onOpenVisoreModal,
  onStageTerraformFix,
  onAskGroqAgent,
}: ActionMenuProps) {
  const [copiedCli, setCopiedCli] = useState(false);

  if (!target) return null;

  const { node } = target;
  const { tenantGuiUrl, visoreDnUrl, visoreClassUrl, moClass } =
    buildApicGuiUrls(apicBaseUrl, node, fabricMode);
  const cliCommand = buildApicCliCommand(node);

  const handleCopyCli = () => {
    navigator.clipboard.writeText(cliCommand);
    setCopiedCli(true);
    setTimeout(() => {
      setCopiedCli(false);
    }, 1800);
  };

  return (
    <div className="rounded bg-white border-2 border-[#049fd9] shadow-lg overflow-hidden animate-in fade-in duration-150">
      {/* Header with Object Type, Name, DN & Close Button */}
      <div className="px-4 py-2.5 bg-[#f0f7fc] border-b border-slate-200 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-[#049fd9] text-white">
              {node.nodeType} ({moClass})
            </span>
            <h3 className="text-sm font-bold text-slate-900 truncate">
              {node.name}
            </h3>
            {node.hasViolation ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#e2231a] text-white">
                <AlertTriangle className="w-3 h-3" />
                Policy Violation
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#52a732] text-white">
                <ShieldCheck className="w-3 h-3" />
                Compliant
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono text-[#0284c7] truncate mt-1">
            DN: {node.dn}
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition"
          title="Close Menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 5 Action Menu Items */}
      <div className="p-2.5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2 bg-slate-50">
        {/* Option 1: Open in Main Cisco APIC Tenants GUI */}
        <a
          href={tenantGuiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col justify-between p-2.5 rounded bg-white hover:bg-sky-50 border border-slate-200 hover:border-[#049fd9] shadow-sm transition group"
        >
          <div className="flex items-center justify-between text-xs font-bold text-[#0284c7]">
            <span>1. Open in APIC GUI</span>
            <ExternalLink className="w-3.5 h-3.5 text-[#049fd9]" />
          </div>
          <p className="text-[11px] text-slate-600 mt-1">
            Open in Main APIC Tenants GUI{" "}
            <code className="text-slate-800">#b:a|{node.dn.slice(0, 18)}...</code>
          </p>
        </a>

        {/* Option 2: Copy APIC CLI / SSH Navigation Command (moquery + cd) */}
        <button
          onClick={handleCopyCli}
          className="text-left flex flex-col justify-between p-2.5 rounded bg-white hover:bg-emerald-50/60 border border-slate-200 hover:border-[#52a732] shadow-sm transition group"
        >
          <div className="flex items-center justify-between text-xs font-bold text-[#3f8624]">
            <span>
              {copiedCli ? "Copied APIC CLI!" : "2. Copy APIC CLI Cmd"}
            </span>
            {copiedCli ? (
              <Check className="w-3.5 h-3.5 text-[#52a732]" />
            ) : (
              <Terminal className="w-3.5 h-3.5 text-[#52a732]" />
            )}
          </div>
          <p className="text-[11px] font-mono text-slate-600 truncate mt-1">
            {cliCommand}
          </p>
        </button>

        {/* Option 5: Inspect Live Managed Object Tree & Faults (In-App Visore Modal) */}
        <button
          onClick={() => onOpenVisoreModal(node)}
          className="text-left flex flex-col justify-between p-2.5 rounded bg-white hover:bg-indigo-50/60 border border-slate-200 hover:border-indigo-500 shadow-sm transition group"
        >
          <div className="flex items-center justify-between text-xs font-bold text-indigo-700">
            <span>3. Inspect Object &amp; Faults</span>
            <SearchCode className="w-3.5 h-3.5 text-indigo-600" />
          </div>
          <p className="text-[11px] text-slate-600 mt-1">
            Open in-app Object Store (Visore) subtree JSON &amp; active{" "}
            <code>faultInst</code>
          </p>
        </button>

        {/* Option 6: Stage GitOps Terraform Remediation (.tf + OPA Check) */}
        <button
          onClick={() => onStageTerraformFix(node)}
          className="text-left flex flex-col justify-between p-2.5 rounded bg-rose-50/70 hover:bg-rose-100/70 border border-rose-300 hover:border-[#e2231a] shadow-sm transition group"
        >
          <div className="flex items-center justify-between text-xs font-bold text-[#c91c14]">
            <span>4. Stage GitOps .tf Fix</span>
            <Wrench className="w-3.5 h-3.5 text-[#e2231a]" />
          </div>
          <p className="text-[11px] text-rose-900/80 mt-1">
            Generate declarative <code>CiscoDevNet/aci</code> HCL &amp; run OPA
            Rego check
          </p>
        </button>

        {/* Option 7: Ask Groq + MCP Agent About This Object */}
        <button
          onClick={() => onAskGroqAgent(node)}
          className="text-left flex flex-col justify-between p-2.5 rounded bg-sky-50/70 hover:bg-sky-100/70 border border-sky-300 hover:border-[#049fd9] shadow-sm transition group"
        >
          <div className="flex items-center justify-between text-xs font-bold text-[#0284c7]">
            <span>5. Ask Groq + MCP Agent</span>
            <Sparkles className="w-3.5 h-3.5 text-[#049fd9]" />
          </div>
          <p className="text-[11px] text-sky-900/80 mt-1">
            Analyze blast radius, EPG dependencies &amp; zero-trust posture in
            ChatOps
          </p>
        </button>
      </div>

      {/* Bottom Quick-Reference Bar showing the exact APIC CLI command & Hash-Routed Visore links */}
      <div className="px-4 py-2 bg-slate-100 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-2 font-mono text-slate-600 truncate max-w-[55%]">
          <span className="text-[#3f8624] font-bold">apic1#</span>
          <span className="truncate text-slate-800">{cliCommand}</span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={visoreClassUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0284c7] hover:text-[#0369a1] inline-flex items-center gap-1 font-semibold"
            title={`Query all ${moClass} objects on the live APIC Object Store`}
          >
            APIC Visore Class (<code className="text-[10px]">#/class={moClass}</code>)
            <ExternalLink className="w-3 h-3" />
          </a>
          <span className="text-slate-300">|</span>
          <a
            href={visoreDnUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-700 hover:text-indigo-900 inline-flex items-center gap-1 font-semibold"
            title={`Query exact DN ${node.dn} on the live APIC Object Store`}
          >
            Visore Exact DN (<code className="text-[10px]">#/dn=...</code>)
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

export function AciVisoreInspectorModal({
  node,
  tenants,
  apicBaseUrl,
  fabricMode = "mock",
  onClose,
  onStageTerraformFix,
}: {
  node: SelectedGraphNode | null;
  tenants: AciTenantSnapshot[];
  apicBaseUrl: string;
  fabricMode?: "mock" | "live";
  onClose: () => void;
  onStageTerraformFix: (node: SelectedGraphNode) => void;
}) {
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);

  if (!node) return null;

  const moTree = buildManagedObjectTree(node, tenants);
  const cliCommand = buildApicCliCommand(node);
  const { tenantGuiUrl, visoreDnUrl, visoreClassUrl, moClass } =
    buildApicGuiUrls(apicBaseUrl, node, fabricMode);
  const jsonString = JSON.stringify(moTree.imdata, null, 2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white border border-slate-300 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-[#0d274d] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-[#049fd9]/25 border border-[#00bceb]/50 flex items-center justify-center">
              <Database className="w-5 h-5 text-[#00bceb]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#049fd9] text-white">
                  class: {moTree.moClass}
                </span>
                <h2 className="text-base font-bold text-white">{node.name}</h2>
              </div>
              <div className="text-xs font-mono text-[#7bd5f5] mt-0.5">
                {node.dn}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 overflow-y-auto space-y-4 bg-[#f8fafc]">
          {/* Quick APIC Deep Links & SSH CLI Box */}
          <div className="p-3.5 rounded-lg bg-white border border-slate-200 shadow-sm space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-[#3f8624]" />
                APIC SSH CLI Command (<code>moquery</code>)
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(cliCommand);
                    setCopiedCli(true);
                    setTimeout(() => setCopiedCli(false), 1800);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-emerald-50 hover:bg-emerald-100 text-[#3f8624] border border-emerald-300 font-semibold transition"
                >
                  {copiedCli ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Copied CLI
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy CLI
                    </>
                  )}
                </button>
                <a
                  href={tenantGuiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-sky-50 hover:bg-sky-100 text-[#0284c7] border border-sky-300 font-semibold transition"
                >
                  Open in APIC GUI
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href={visoreClassUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-300 font-semibold transition"
                >
                  Visore Class (<code>#/class={moClass}</code>)
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href={visoreDnUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 font-semibold transition"
                >
                  Visore Exact DN
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
            <pre className="p-2.5 rounded bg-slate-900 text-xs font-mono text-emerald-300 overflow-x-auto">
              {cliCommand}
            </pre>
          </div>

          {/* Active Policy Violation / Fault Instances */}
          {node.violation && (
            <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-300 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#c91c14] flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-[#e2231a]" />
                  Zero-Trust Policy Violation ({node.violation.severity} ·{" "}
                  {node.violation.category})
                </span>
                <span className="text-[11px] font-mono text-rose-800">
                  {node.violation.cisBenchmark}
                </span>
              </div>
              <p className="text-xs text-rose-950">
                {node.violation.description}
              </p>
            </div>
          )}

          {moTree.faults.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-700">
                Associated APIC Fault Instances (<code>faultInst</code>)
              </div>
              {moTree.faults.map((f) => (
                <div
                  key={f.dn}
                  className="p-3 rounded-lg bg-amber-50/70 border border-amber-300 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-amber-900">
                      Fault {f.code} ({f.severity.toUpperCase()}) — {f.rule}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {f.created}
                    </span>
                  </div>
                  <div className="text-slate-800 mt-1">{f.descr}</div>
                </div>
              ))}
            </div>
          )}

          {/* Managed Object Attributes & Subtree JSON */}
          <div className="rounded-lg bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-[#049fd9]" />
                Managed Object Subtree JSON (<code>imdata</code>)
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(jsonString);
                  setCopiedJson(true);
                  setTimeout(() => setCopiedJson(false), 1800);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold transition"
              >
                {copiedJson ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#52a732]" />
                    Copied JSON
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy IMDATA JSON
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-slate-800 bg-slate-50 overflow-x-auto max-h-[260px]">
              {jsonString}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-600">
            APIC Controller:{" "}
            <code className="text-[#0284c7] font-semibold">{apicBaseUrl}</code>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                onStageTerraformFix(node);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[#e2231a] hover:bg-[#c91c14] text-xs font-bold text-white transition"
            >
              <Wrench className="w-3.5 h-3.5" />
              Stage GitOps Terraform Fix
            </button>
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded bg-white hover:bg-slate-200 border border-slate-300 text-xs font-semibold text-slate-700 transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

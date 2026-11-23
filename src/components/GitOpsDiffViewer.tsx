"use client";

import React, { useState } from "react";
import { diffLines } from "diff";
import type { RemediationArtifact } from "@/lib/gitops-generator";
import {
  ShieldCheck,
  ShieldAlert,
  FileCode2,
  GitCompare,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  GripHorizontal,
} from "lucide-react";

interface Props {
  remediation: RemediationArtifact | null;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  height?: number;
  onHeightChange?: (newHeight: number) => void;
}

export default function GitOpsDiffViewer({
  remediation,
  isMaximized = false,
  onToggleMaximize,
  height = 340,
  onHeightChange,
}: Props) {
  const [activeTab, setActiveTab] = useState<"hcl" | "diff" | "opa">("hcl");
  const [copied, setCopied] = useState(false);
  const [draggingHeight, setDraggingHeight] = useState(false);

  const handleVerticalDragStart = (e: React.MouseEvent) => {
    if (isMaximized || !onHeightChange) return;
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    setDraggingHeight(true);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const nextHeight = Math.max(200, Math.min(860, startHeight + delta));
      onHeightChange(nextHeight);
    };

    const onMouseUp = () => {
      setDraggingHeight(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  if (!remediation) {
    return (
      <div className="rounded-lg bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-3.5 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <FileCode2 className="w-4 h-4 text-[#049fd9]" />
            GitOps Terraform &amp; OPA Diff Viewer
          </span>
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-white hover:bg-sky-50 text-slate-700 hover:text-[#0284c7] border border-slate-300 transition"
              title={
                isMaximized
                  ? "Restore Diff Viewer Size"
                  : "Maximize Diff Viewer to Workspace"
              }
            >
              {isMaximized ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-[#049fd9]" />
                  <span className="hidden sm:inline text-[11px]">Restore</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-[#049fd9]" />
                  <span className="hidden sm:inline text-[11px]">Maximize</span>
                </>
              )}
            </button>
          )}
        </div>
        <div className="p-6 text-center">
          <FileCode2 className="w-8 h-8 text-[#049fd9] mx-auto mb-2" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            APIC GitOps Guardrail Workpane — No Terraform Plan Staged
          </h3>
          <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
            Select any object in the <strong>MIT Tree</strong>, click a node in
            the <strong>Apache ECharts Policy Graph</strong>, or click{" "}
            <code className="text-[#0284c7] font-semibold">
              AI Auto-Fix (.tf)
            </code>{" "}
            on any fault row to generate a declarative{" "}
            <code className="text-[#0284c7] font-semibold">
              CiscoDevNet/aci
            </code>{" "}
            remediation plan and evaluate it against Open Policy Agent (
            <code className="text-[#3f8624] font-semibold">
              policies/aci_guardrails.rego
            </code>
            ).
          </p>
        </div>
      </div>
    );
  }

  const lineDiffs = diffLines(remediation.beforeJson, remediation.afterJson);

  const handleCopy = () => {
    navigator.clipboard.writeText(remediation.terraformHcl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const bodyMaxHeight = isMaximized ? "calc(100vh - 250px)" : `${height}px`;

  return (
    <div className="rounded-lg bg-white border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      {/* Header Banner with Top-Right Maximize/Restore Button */}
      <div className="px-3.5 py-2.5 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {remediation.opaResult.passed ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-bold bg-[#52a732] text-white">
              <ShieldCheck className="w-3.5 h-3.5" />
              OPA Policy Check: PASSED ({remediation.opaResult.checks.length}/
              {remediation.opaResult.checks.length})
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-bold bg-[#e2231a] text-white">
              <ShieldAlert className="w-3.5 h-3.5" />
              OPA Policy Check: BLOCKED
            </span>
          )}
          <span className="text-xs font-mono text-[#0284c7] font-semibold truncate max-w-[240px]">
            {remediation.filePath}
          </span>
        </div>

        {/* View Switcher Tabs + Maximize Button */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setActiveTab("hcl")}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
              activeTab === "hcl"
                ? "bg-[#049fd9] text-white"
                : "text-slate-600 hover:text-slate-900 bg-white border border-slate-200"
            }`}
          >
            Terraform HCL (.tf)
          </button>
          <button
            onClick={() => setActiveTab("diff")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition ${
              activeTab === "diff"
                ? "bg-[#049fd9] text-white"
                : "text-slate-600 hover:text-slate-900 bg-white border border-slate-200"
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            IMDATA Diff
          </button>
          <button
            onClick={() => setActiveTab("opa")}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
              activeTab === "opa"
                ? "bg-[#049fd9] text-white"
                : "text-slate-600 hover:text-slate-900 bg-white border border-slate-200"
            }`}
          >
            OPA Rego ({remediation.opaResult.checks.length})
          </button>

          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-white hover:bg-sky-50 text-slate-700 hover:text-[#0284c7] border border-slate-300 transition"
              title={
                isMaximized
                  ? "Restore Diff Viewer Size"
                  : "Maximize Diff Viewer to Workspace"
              }
            >
              {isMaximized ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-[#049fd9]" />
                  <span className="hidden sm:inline text-[11px]">Restore</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-[#049fd9]" />
                  <span className="hidden sm:inline text-[11px]">Maximize</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "hcl" && (
        <div className="relative">
          <button
            onClick={handleCopy}
            className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 shadow-sm font-semibold transition"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#52a732]" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy HCL
              </>
            )}
          </button>
          <pre
            style={{ maxHeight: bodyMaxHeight }}
            className="p-4 text-xs font-mono leading-relaxed text-slate-800 bg-slate-50 overflow-auto"
          >
            {remediation.terraformHcl}
          </pre>
        </div>
      )}

      {activeTab === "diff" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 bg-white">
          <div
            style={{ maxHeight: bodyMaxHeight }}
            className="p-3 overflow-auto bg-rose-50/30"
          >
            <div className="text-[11px] font-bold text-[#c91c14] uppercase tracking-wider mb-2">
              − Offending APIC Managed Object State (Before)
            </div>
            <pre className="text-[11px] font-mono text-rose-900 leading-relaxed">
              {remediation.beforeJson}
            </pre>
          </div>
          <div
            style={{ maxHeight: bodyMaxHeight }}
            className="p-3 overflow-auto bg-emerald-50/20"
          >
            <div className="text-[11px] font-bold text-[#3f8624] uppercase tracking-wider mb-2">
              + Zero-Trust GitOps Desired State (After)
            </div>
            <pre className="text-[11px] font-mono leading-relaxed">
              {lineDiffs.map((part, idx) => (
                <span
                  key={idx}
                  className={
                    part.added
                      ? "bg-emerald-100/80 text-emerald-950 font-medium block"
                      : part.removed
                      ? "bg-rose-100/80 text-rose-900 line-through block"
                      : "text-slate-700 block"
                  }
                >
                  {part.value}
                </span>
              ))}
            </pre>
          </div>
        </div>
      )}

      {activeTab === "opa" && (
        <div
          style={{ maxHeight: bodyMaxHeight }}
          className="p-4 space-y-2 bg-slate-50 overflow-y-auto"
        >
          <div className="flex items-center justify-between text-xs text-slate-600 pb-2 border-b border-slate-200">
            <span>
              Policy Package:{" "}
              <code className="text-[#0284c7] font-semibold">
                {remediation.opaResult.policyFile} (package aci.guardrails)
              </code>
            </span>
            <span>Engine: {remediation.opaResult.engine}</span>
          </div>
          {remediation.opaResult.checks.map((chk) => (
            <div
              key={chk.ruleId}
              className={`p-2.5 rounded border flex items-start gap-2.5 ${
                chk.passed
                  ? "bg-emerald-50/70 border-emerald-300"
                  : "bg-rose-50 border-rose-300"
              }`}
            >
              {chk.passed ? (
                <CheckCircle2 className="w-4 h-4 text-[#52a732] shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-[#e2231a] shrink-0 mt-0.5" />
              )}
              <div className="text-xs">
                <div className="font-bold text-slate-900">
                  {chk.ruleId}{" "}
                  <span className="font-normal text-slate-600">
                    — {chk.description}
                  </span>
                </div>
                <div
                  className={`mt-0.5 font-mono text-[11px] ${
                    chk.passed ? "text-[#3f8624]" : "text-[#c91c14]"
                  }`}
                >
                  {chk.message}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bottom Draggable Vertical Resize Splitter Bar */}
      {!isMaximized && onHeightChange && (
        <div
          onMouseDown={handleVerticalDragStart}
          className={`h-2.5 w-full cursor-row-resize flex items-center justify-center border-t border-slate-200 transition ${
            draggingHeight
              ? "bg-[#049fd9]/20"
              : "bg-slate-50 hover:bg-sky-100/70"
          }`}
          title="Drag vertically to resize Diff Viewer height"
        >
          <GripHorizontal className="w-4 h-3 text-slate-400" />
        </div>
      )}
    </div>
  );
}

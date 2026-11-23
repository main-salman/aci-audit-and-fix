"use client";

import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import type { AciTenantSnapshot, SecurityViolation } from "@/lib/mock-fabric";
import { Maximize2, Minimize2, GripHorizontal, Layers } from "lucide-react";

export interface SelectedGraphNode {
  id: string;
  name: string;
  nodeType: "TENANT" | "VRF" | "EPG" | "CONTRACT" | "FILTER";
  tenant: string;
  dn: string;
  hasViolation: boolean;
  violation?: SecurityViolation;
  details: Record<string, any>;
}

interface Props {
  tenants: AciTenantSnapshot[];
  violations: SecurityViolation[];
  selectedTenant: string;
  onSelectNode: (node: SelectedGraphNode) => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  height?: number;
  onHeightChange?: (newHeight: number) => void;
}

export default function AciTopologyChart({
  tenants,
  violations,
  selectedTenant,
  onSelectNode,
  isMaximized = false,
  onToggleMaximize,
  height = 440,
  onHeightChange,
}: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const [draggingHeight, setDraggingHeight] = useState(false);

  useEffect(() => {
    if (!chartRef.current) return;

    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current, undefined, {
        renderer: "canvas",
      });
    }

    const chart = instanceRef.current;

    const filteredTenants =
      selectedTenant === "ALL"
        ? tenants
        : tenants.filter((t) => t.name === selectedTenant);

    const categories = [
      { name: "fvTenant (Tenant)", itemStyle: { color: "#049fd9" } },
      { name: "fvCtx (VRF)", itemStyle: { color: "#4f46e5" } },
      { name: "fvAEPg (EPG)", itemStyle: { color: "#52a732" } },
      { name: "vzBrCP (Compliant Contract)", itemStyle: { color: "#0284c7" } },
      { name: "faultInst / Policy Violation", itemStyle: { color: "#e2231a" } },
      { name: "vzFilter (Subject Filter)", itemStyle: { color: "#d97706" } },
    ];

    const nodes: any[] = [];
    const links: any[] = [];
    const nodeMetaMap = new Map<string, SelectedGraphNode>();

    for (const tenant of filteredTenants) {
      const tId = `tenant:${tenant.name}`;
      const tenantViols = violations.filter((v) => v.tenant === tenant.name);

      nodes.push({
        id: tId,
        name: `[fvTenant]\n${tenant.name}`,
        symbolSize: 54,
        category: 0,
        draggable: true,
        itemStyle: {
          color: "#049fd9",
          borderColor: "#0284c7",
          borderWidth: 2.5,
          shadowBlur: 12,
          shadowColor: "rgba(4, 159, 217, 0.3)",
        },
        label: {
          show: true,
          fontWeight: "bold",
          fontSize: 11,
          color: "#0f172a",
          position: "bottom",
        },
      });

      nodeMetaMap.set(tId, {
        id: tId,
        name: tenant.name,
        nodeType: "TENANT",
        tenant: tenant.name,
        dn: tenant.dn,
        hasViolation: tenantViols.length > 0,
        violation: tenantViols[0],
        details: {
          healthScore: `${tenant.healthScore}%`,
          description: tenant.descr,
          activeViolations: tenantViols.length,
          epgCount: tenant.epgs.length,
          contractCount: tenant.contracts.length,
        },
      });

      // VRFs
      for (const vrf of tenant.vrfs) {
        const vrfId = `vrf:${tenant.name}:${vrf.name}`;
        const vrfViol = violations.find(
          (v) =>
            v.tenant === tenant.name &&
            (v.category === "UNENFORCED_VRF" || v.category === "VZANY_EXPOSURE")
        );

        nodes.push({
          id: vrfId,
          name: `[fvCtx] ${vrf.name}\n(${vrf.pcEnfPref.toUpperCase()})`,
          symbolSize: 44,
          category: vrfViol ? 4 : 1,
          draggable: true,
          itemStyle: {
            color: vrfViol ? "#e2231a" : "#4f46e5",
            borderColor: vrfViol ? "#b91c1c" : "#4338ca",
            borderWidth: 2.5,
            shadowBlur: vrfViol ? 16 : 8,
            shadowColor: vrfViol
              ? "rgba(226, 35, 26, 0.45)"
              : "rgba(79, 70, 229, 0.25)",
          },
          label: {
            show: true,
            fontSize: 10.5,
            color: "#1e293b",
            position: "bottom",
          },
        });

        nodeMetaMap.set(vrfId, {
          id: vrfId,
          name: vrf.name,
          nodeType: "VRF",
          tenant: tenant.name,
          dn: `uni/tn-${tenant.name}/ctx-${vrf.name}`,
          hasViolation: Boolean(vrfViol),
          violation: vrfViol,
          details: {
            enforcement: vrf.pcEnfPref,
            vzAnyProvided: vrf.vzAnyProvidedContracts.join(", ") || "None",
            vzAnyConsumed: vrf.vzAnyConsumedContracts.join(", ") || "None",
          },
        });

        links.push({
          source: tId,
          target: vrfId,
          lineStyle: {
            color: vrfViol ? "#e2231a" : "#94a3b8",
            width: vrfViol ? 2.5 : 1.5,
            type: vrfViol ? "dashed" : "solid",
          },
        });
      }

      // EPGs
      for (const epg of tenant.epgs) {
        const epgId = `epg:${tenant.name}:${epg.name}`;
        const isIsolated =
          epg.providedContracts.length === 0 &&
          epg.consumedContracts.length === 0;

        nodes.push({
          id: epgId,
          name: `[fvAEPg]\n${epg.name}`,
          symbolSize: 40,
          category: 2,
          draggable: true,
          itemStyle: {
            color: isIsolated ? "#64748b" : "#52a732",
            borderColor: isIsolated ? "#475569" : "#3f8624",
            borderWidth: 2,
            shadowBlur: 8,
            shadowColor: "rgba(82, 167, 50, 0.25)",
          },
          label: {
            show: true,
            fontSize: 10.5,
            color: "#1e293b",
            position: "bottom",
          },
        });

        nodeMetaMap.set(epgId, {
          id: epgId,
          name: epg.name,
          nodeType: "EPG",
          tenant: tenant.name,
          dn: epg.dn,
          hasViolation: isIsolated,
          details: {
            appProfile: epg.appProfile,
            bridgeDomain: epg.bridgeDomain,
            provides: epg.providedContracts.join(", ") || "None",
            consumes: epg.consumedContracts.join(", ") || "None",
            status: isIsolated ? "Orphan / No Contracts" : "Active",
          },
        });

        const parentVrf = tenant.vrfs[0]
          ? `vrf:${tenant.name}:${tenant.vrfs[0].name}`
          : tId;
        links.push({
          source: parentVrf,
          target: epgId,
          lineStyle: { color: "#94a3b8", width: 1.5 },
        });
      }

      // Contracts & Filters
      for (const contract of tenant.contracts) {
        const cId = `contract:${tenant.name}:${contract.name}`;
        const contractViol = violations.find(
          (v) =>
            v.tenant === tenant.name && v.contractName === contract.name
        );

        nodes.push({
          id: cId,
          name: `${contractViol ? "⚠ " : ""}[vzBrCP] ${contract.name}\nscope:${contract.scope}`,
          symbolSize: contractViol ? 46 : 36,
          category: contractViol ? 4 : 3,
          draggable: true,
          itemStyle: {
            color: contractViol ? "#e2231a" : "#0284c7",
            borderColor: contractViol ? "#991b1b" : "#0369a1",
            borderWidth: contractViol ? 2.5 : 2,
            shadowBlur: contractViol ? 16 : 8,
            shadowColor: contractViol
              ? "rgba(226, 35, 26, 0.45)"
              : "rgba(2, 132, 199, 0.25)",
          },
          label: {
            show: true,
            fontSize: 10.5,
            fontWeight: contractViol ? "bold" : "normal",
            color: contractViol ? "#b91c1c" : "#0f172a",
            position: "bottom",
          },
        });

        nodeMetaMap.set(cId, {
          id: cId,
          name: contract.name,
          nodeType: "CONTRACT",
          tenant: tenant.name,
          dn: contract.dn,
          hasViolation: Boolean(contractViol),
          violation: contractViol,
          details: {
            scope: contract.scope,
            vzAnyEnabled: contract.vzAnyEnabled ? "YES (CRITICAL RISK)" : "No",
            subjects:
              contract.subjects.map((s) => s.name).join(", ") ||
              "0 Subjects (Empty)",
            filters:
              contract.subjects.flatMap((s) => s.filters).join(", ") || "None",
          },
        });

        for (const epg of tenant.epgs) {
          const epgId = `epg:${tenant.name}:${epg.name}`;
          if (epg.consumedContracts.includes(contract.name)) {
            links.push({
              source: epgId,
              target: cId,
              value: "fvRsCons",
              lineStyle: {
                color: contractViol ? "#e2231a" : "#0284c7",
                width: contractViol ? 2.5 : 1.8,
                curveness: 0.15,
              },
            });
          }
          if (epg.providedContracts.includes(contract.name)) {
            links.push({
              source: cId,
              target: epgId,
              value: "fvRsProv",
              lineStyle: {
                color: contractViol ? "#e2231a" : "#52a732",
                width: contractViol ? 2.5 : 1.8,
                curveness: 0.15,
              },
            });
          }
        }

        if (contract.vzAnyEnabled && tenant.vrfs[0]) {
          links.push({
            source: `vrf:${tenant.name}:${tenant.vrfs[0].name}`,
            target: cId,
            value: "vzAny",
            lineStyle: {
              color: "#e2231a",
              width: 3,
              type: "dashed",
            },
          });
        }

        for (const subj of contract.subjects) {
          for (const fltName of subj.filters) {
            const flt = tenant.filters.find((f) => f.name === fltName);
            if (!flt) continue;
            const fId = `filter:${tenant.name}:${flt.name}`;
            const fltViol = violations.find(
              (v) => v.tenant === tenant.name && v.filterName === flt.name
            );

            if (!nodeMetaMap.has(fId)) {
              const portSummary = flt.entries
                .map((e) => `${e.prot}/${e.dFromPort}`)
                .join(", ");
              nodes.push({
                id: fId,
                name: `[vzFilter] ${flt.name}\n(${portSummary})`,
                symbolSize: 32,
                category: fltViol ? 4 : 5,
                draggable: true,
                itemStyle: {
                  color: fltViol ? "#dc2626" : "#d97706",
                  borderColor: fltViol ? "#991b1b" : "#b45309",
                  borderWidth: 2,
                },
                label: {
                  show: true,
                  fontSize: 10,
                  color: "#334155",
                  position: "bottom",
                },
              });

              nodeMetaMap.set(fId, {
                id: fId,
                name: flt.name,
                nodeType: "FILTER",
                tenant: tenant.name,
                dn: flt.dn,
                hasViolation: Boolean(fltViol),
                violation: fltViol,
                details: {
                  entries: flt.entries
                    .map(
                      (e) =>
                        `${e.name}: ${e.prot}:${e.dFromPort}-${e.dToPort} (stateful=${e.stateful})`
                    )
                    .join(" | "),
                },
              });
            }

            links.push({
              source: cId,
              target: fId,
              lineStyle: {
                color: fltViol ? "#e2231a" : "#d97706",
                width: 1.5,
                type: "dotted",
              },
            });
          }
        }
      }
    }

    const option: echarts.EChartsOption = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(255, 255, 255, 0.98)",
        borderColor: "#cbd5e1",
        textStyle: { color: "#0f172a", fontSize: 12 },
        extraCssText: "box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);",
        formatter: (params: any) => {
          if (params.dataType === "node") {
            const meta = nodeMetaMap.get(params.data.id);
            if (!meta) return params.name;
            const statusBadge = meta.hasViolation
              ? `<span style="color:#e2231a;font-weight:bold;">● FAULT / VIOLATION</span>`
              : `<span style="color:#52a732;font-weight:bold;">● HEALTHY (98)</span>`;
            const violHtml = meta.violation
              ? `<div style="margin-top:6px;padding:6px;background:#fef2f2;border-left:3px solid #e2231a;color:#991b1b;font-size:11px;">
                   <b>${meta.violation.severity}:</b> ${meta.violation.title}<br/>
                   <span style="color:#0284c7;">Click node to open APIC Object Action Menu</span>
                 </div>`
              : `<div style="margin-top:4px;color:#0284c7;font-size:11px;">Click node to open APIC Object Action Menu</div>`;
            return `<div style="max-width:330px;white-space:normal;">
              <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:4px;">
                <b>[${meta.nodeType}] ${meta.name}</b>
                ${statusBadge}
              </div>
              <div style="font-family:monospace;font-size:11px;color:#0284c7;margin-bottom:4px;">dn: ${meta.dn}</div>
              ${violHtml}
            </div>`;
          }
          return `${params.data.source} → ${params.data.target}`;
        },
      },
      legend: [
        {
          data: categories.map((c) => c.name),
          bottom: 6,
          left: "center",
          textStyle: { color: "#334155", fontSize: 10.5 },
          itemWidth: 11,
          itemHeight: 11,
        },
      ],
      series: [
        {
          name: "Cisco APIC Managed Object Policy Graph",
          type: "graph",
          layout: "force",
          data: nodes,
          links,
          categories,
          roam: true,
          draggable: true,
          edgeSymbol: ["none", "arrow"],
          edgeSymbolSize: [4, 8],
          force: {
            repulsion: isMaximized ? 700 : 460,
            edgeLength: isMaximized ? [110, 190] : [85, 145],
            gravity: 0.08,
            layoutAnimation: true,
          },
          emphasis: {
            focus: "adjacency",
            lineStyle: { width: 4 },
          },
        },
      ],
    };

    chart.setOption(option, true);
    setTimeout(() => chart.resize(), 40);

    chart.off("click");
    chart.on("click", (params: any) => {
      if (params.dataType === "node" && params.data?.id) {
        const meta = nodeMetaMap.get(params.data.id);
        if (meta) {
          onSelectNode(meta);
        }
      }
    });

    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [tenants, violations, selectedTenant, onSelectNode, isMaximized, height]);

  // Vertical Resize Splitter Drag Handler
  const handleVerticalDragStart = (e: React.MouseEvent) => {
    if (isMaximized || !onHeightChange) return;
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    setDraggingHeight(true);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const nextHeight = Math.max(260, Math.min(920, startHeight + delta));
      onHeightChange(nextHeight);
      instanceRef.current?.resize();
    };

    const onMouseUp = () => {
      setDraggingHeight(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      instanceRef.current?.resize();
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div className="rounded-lg bg-white border border-slate-200 overflow-hidden shadow-sm flex flex-col">
      {/* Section Header with Top-Right Maximize/Minimize Button */}
      <div className="px-3.5 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#049fd9]" />
          <span className="text-xs font-bold text-slate-800">
            APIC Policy Group Topology View (Apache ECharts)
          </span>
          <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-sky-50 border border-sky-200 text-[#0284c7]">
            Click any node for APIC Actions
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-white hover:bg-sky-50 text-slate-700 hover:text-[#0284c7] border border-slate-300 transition"
              title={
                isMaximized
                  ? "Restore Topology Graph Size"
                  : "Maximize Topology Graph to Workspace"
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

      {/* ECharts Canvas */}
      <div
        className="relative w-full"
        style={{
          height: isMaximized ? "calc(100vh - 230px)" : `${height}px`,
        }}
      >
        <div ref={chartRef} className="w-full h-full" />
      </div>

      {/* Bottom Draggable Vertical Resize Splitter Bar */}
      {!isMaximized && onHeightChange && (
        <div
          onMouseDown={handleVerticalDragStart}
          className={`h-2.5 w-full cursor-row-resize flex items-center justify-center border-t border-slate-200 transition ${
            draggingHeight
              ? "bg-[#049fd9]/20"
              : "bg-slate-50 hover:bg-sky-100/70"
          }`}
          title="Drag vertically to resize Topology Graph height"
        >
          <GripHorizontal className="w-4 h-3 text-slate-400" />
        </div>
      )}
    </div>
  );
}

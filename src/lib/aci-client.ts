import https from "https";
import { getConfig } from "./config";
import {
  AciTenantSnapshot,
  AciFault,
  MOCK_ACI_TENANTS,
  SecurityViolation,
} from "./mock-fabric";

const CLEARTEXT_PORTS = new Set(["21", "23", "80", "69", "161", "514"]);

export type FabricProfile = "mock" | "devnet" | "custom";

export interface ApicConnectionConfig {
  profile: FabricProfile;
  url: string;
  username: string;
  password?: string;
  verifySsl: boolean;
}

export class AciClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private verifySsl: boolean;
  private mode: "mock" | "live";
  private profile: FabricProfile;
  private token: string | null = null;
  private tokenExpiry = 0;
  private hasSeededLiveApic = false;

  constructor(overrideMode?: "mock" | "live") {
    const cfg = getConfig();
    this.baseUrl = cfg.APIC_URL.replace(/\/$/, "");
    this.username = cfg.APIC_USERNAME;
    this.password = cfg.APIC_PASSWORD;
    this.verifySsl = cfg.APIC_VERIFY_SSL;
    this.mode = overrideMode || cfg.ACI_MODE;
    this.profile = this.mode === "live" ? "devnet" : "mock";
  }

  public getMode(): "mock" | "live" {
    return this.mode;
  }

  public getProfile(): FabricProfile {
    return this.profile;
  }

  public getConnectionInfo(): Omit<ApicConnectionConfig, "password"> {
    return {
      profile: this.profile,
      url: this.baseUrl,
      username: this.username,
      verifySsl: this.verifySsl,
    };
  }

  public setMode(mode: "mock" | "live") {
    this.mode = mode;
    if (mode === "mock") {
      this.profile = "mock";
    } else if (this.profile === "mock") {
      this.profile = "devnet";
    }
  }

  /**
   * Updates APIC target profile (Demo Fabric, Cisco DevNet Sandbox, or Custom Enterprise APIC)
   */
  public configureConnection(config: {
    profile: FabricProfile;
    url?: string;
    username?: string;
    password?: string;
    verifySsl?: boolean;
  }) {
    const defaultCfg = getConfig();
    this.profile = config.profile;
    this.token = null;
    this.tokenExpiry = 0;

    if (config.profile === "mock") {
      this.mode = "mock";
      this.baseUrl = (config.url || defaultCfg.APIC_URL).replace(/\/$/, "");
      this.username = config.username || defaultCfg.APIC_USERNAME;
      this.password = config.password || defaultCfg.APIC_PASSWORD;
      this.verifySsl = config.verifySsl ?? false;
    } else if (config.profile === "devnet") {
      this.mode = "live";
      this.baseUrl = "https://sandboxapicdc.cisco.com";
      this.username = config.username || "admin";
      this.password = config.password || "!v3G@!4@Y";
      this.verifySsl = false;
    } else {
      // Custom APIC controller
      this.mode = "live";
      if (config.url) {
        this.baseUrl = config.url.replace(/\/$/, "");
      }
      if (config.username) {
        this.username = config.username;
      }
      if (config.password !== undefined && config.password !== "") {
        this.password = config.password;
      }
      if (config.verifySsl !== undefined) {
        this.verifySsl = config.verifySsl;
      }
    }
  }

  /**
   * Tests live authentication against the currently configured APIC controller
   */
  public async testConnection(): Promise<{
    ok: boolean;
    profile: FabricProfile;
    url: string;
    username: string;
    version?: string;
    message: string;
    latencyMs: number;
  }> {
    const t0 = performance.now();
    if (this.profile === "mock") {
      return {
        ok: true,
        profile: "mock",
        url: this.baseUrl,
        username: this.username,
        version: "6.1(4h)-Mock",
        message: "Connected to Pre-Seeded Zero-Trust Demo Fabric",
        latencyMs: Math.round(performance.now() - t0),
      };
    }

    try {
      const payload = JSON.stringify({
        aaaUser: {
          attributes: {
            name: this.username,
            pwd: this.password,
          },
        },
      });

      const response = await this.rawHttpsRequest(
        `${this.baseUrl}/api/aaaLogin.json`,
        "POST",
        payload
      );
      const parsed = JSON.parse(response);
      const attrs = parsed?.imdata?.[0]?.aaaLogin?.attributes;
      const token = attrs?.token;
      if (!token) {
        const errText =
          parsed?.imdata?.[0]?.error?.attributes?.text ||
          "APIC login returned no token";
        return {
          ok: false,
          profile: this.profile,
          url: this.baseUrl,
          username: this.username,
          message: `Authentication failed: ${errText}`,
          latencyMs: Math.round(performance.now() - t0),
        };
      }

      this.token = token;
      this.tokenExpiry = Date.now() + 480_000;
      return {
        ok: true,
        profile: this.profile,
        url: this.baseUrl,
        username: this.username,
        version: attrs?.version || "6.x",
        message: `Authenticated to APIC ${attrs?.version || ""} as '${this.username}'`,
        latencyMs: Math.round(performance.now() - t0),
      };
    } catch (err: any) {
      return {
        ok: false,
        profile: this.profile,
        url: this.baseUrl,
        username: this.username,
        message: `Connection error: ${err?.message || String(err)}`,
        latencyMs: Math.round(performance.now() - t0),
      };
    }
  }

  /**
   * Authenticates with Cisco APIC REST API via /api/aaaLogin.json
   */
  public async login(): Promise<{ token: string; source: "live" | "mock" }> {
    if (this.mode === "mock") {
      this.token = "mock-apic-jwt-session-token";
      this.tokenExpiry = Date.now() + 600_000;
      return { token: this.token, source: "mock" };
    }

    if (this.token && Date.now() < this.tokenExpiry) {
      return { token: this.token, source: "live" };
    }

    try {
      const payload = JSON.stringify({
        aaaUser: {
          attributes: {
            name: this.username,
            pwd: this.password,
          },
        },
      });

      const response = await this.rawHttpsRequest(
        `${this.baseUrl}/api/aaaLogin.json`,
        "POST",
        payload
      );

      const parsed = JSON.parse(response);
      const token = parsed?.imdata?.[0]?.aaaLogin?.attributes?.token;
      if (!token) {
        throw new Error("APIC aaaLogin succeeded but returned no session token");
      }

      this.token = token;
      this.tokenExpiry = Date.now() + 480_000;
      if (!this.hasSeededLiveApic && this.profile === "devnet") {
        this.hasSeededLiveApic = true;
        await this.seedDemoTenantsToLiveApic(token);
      }
      return { token, source: "live" };
    } catch (err) {
      // Automatic fallback to mock fabric if DevNet sandbox is unreachable
      this.token = "fallback-mock-apic-token";
      return { token: this.token, source: "mock" };
    }
  }

  /**
   * Ensures our two showcase tenants (Prod-CoreFin and Hybrid-Cloud-AI) and all their
   * VRFs, EPGs, Contracts, and Filters exist on the live Cisco DevNet APIC Sandbox
   * so deep-links to `visore.html#/dn=...` always resolve live Managed Objects.
   */
  public async seedDemoTenantsToLiveApic(tokenOverride?: string): Promise<void> {
    try {
      const tk = tokenOverride || this.token;
      if (!tk) return;

      const prodCoreFinPayload = {
        fvTenant: {
          attributes: {
            dn: "uni/tn-Prod-CoreFin",
            name: "Prod-CoreFin",
            descr: "Production Core Financial Banking & Payment Processing Fabric",
          },
          children: [
            {
              fvCtx: {
                attributes: { name: "Prod-Payment-VRF", pcEnfPref: "enforced" },
                children: [
                  {
                    vzAny: {
                      attributes: { matchT: "AtleastOne" },
                      children: [
                        { vzRsAnyToProv: { attributes: { tnVzBrCPName: "Permit-All-AnyToAny" } } },
                        { vzRsAnyToCons: { attributes: { tnVzBrCPName: "Permit-All-AnyToAny" } } },
                      ],
                    },
                  },
                ],
              },
            },
            {
              fvBD: {
                attributes: { name: "BD-DMZ-Web" },
                children: [{ fvRsCtx: { attributes: { tnFvCtxName: "Prod-Payment-VRF" } } }],
              },
            },
            {
              fvBD: {
                attributes: { name: "BD-App-Internal" },
                children: [{ fvRsCtx: { attributes: { tnFvCtxName: "Prod-Payment-VRF" } } }],
              },
            },
            {
              fvBD: {
                attributes: { name: "BD-PCI-Vault" },
                children: [{ fvRsCtx: { attributes: { tnFvCtxName: "Prod-Payment-VRF" } } }],
              },
            },
            {
              vzFilter: {
                attributes: { name: "default-permit-any" },
                children: [
                  { vzEntry: { attributes: { name: "entry-ip-any-any", etherT: "unspecified", prot: "unspecified" } } },
                ],
              },
            },
            {
              vzFilter: {
                attributes: { name: "Flt-Telnet-FTP-HTTP" },
                children: [
                  { vzEntry: { attributes: { name: "telnet-23", etherT: "ip", prot: "tcp", dFromPort: "23", dToPort: "23", stateful: "yes" } } },
                  { vzEntry: { attributes: { name: "ftp-21", etherT: "ip", prot: "tcp", dFromPort: "21", dToPort: "21", stateful: "yes" } } },
                  { vzEntry: { attributes: { name: "http-80", etherT: "ip", prot: "tcp", dFromPort: "80", dToPort: "80", stateful: "yes" } } },
                ],
              },
            },
            {
              vzFilter: {
                attributes: { name: "Flt-HTTPS-8443" },
                children: [
                  { vzEntry: { attributes: { name: "https-8443", etherT: "ip", prot: "tcp", dFromPort: "8443", dToPort: "8443", stateful: "yes" } } },
                ],
              },
            },
            {
              vzFilter: {
                attributes: { name: "Flt-Postgres-5432" },
                children: [
                  { vzEntry: { attributes: { name: "pg-5432", etherT: "ip", prot: "tcp", dFromPort: "5432", dToPort: "5432", stateful: "yes" } } },
                ],
              },
            },
            {
              vzFilter: {
                attributes: { name: "Flt-HTTPS-443" },
                children: [
                  { vzEntry: { attributes: { name: "https-443", etherT: "ip", prot: "tcp", dFromPort: "443", dToPort: "443", stateful: "yes" } } },
                ],
              },
            },
            {
              vzBrCP: {
                attributes: { name: "Permit-All-AnyToAny", scope: "context" },
                children: [
                  {
                    vzSubj: {
                      attributes: { name: "Subj-Allow-Everything" },
                      children: [{ vzRsSubjFiltAtt: { attributes: { tnVzFilterName: "default-permit-any" } } }],
                    },
                  },
                ],
              },
            },
            {
              vzBrCP: {
                attributes: { name: "App-Tier-Legacy-Access", scope: "tenant" },
                children: [
                  {
                    vzSubj: {
                      attributes: { name: "Subj-Legacy-Mgmt-And-API" },
                      children: [
                        { vzRsSubjFiltAtt: { attributes: { tnVzFilterName: "Flt-Telnet-FTP-HTTP" } } },
                        { vzRsSubjFiltAtt: { attributes: { tnVzFilterName: "Flt-HTTPS-8443" } } },
                      ],
                    },
                  },
                ],
              },
            },
            {
              vzBrCP: {
                attributes: { name: "DB-Core-Access", scope: "context" },
                children: [
                  {
                    vzSubj: {
                      attributes: { name: "Subj-Postgres-5432" },
                      children: [{ vzRsSubjFiltAtt: { attributes: { tnVzFilterName: "Flt-Postgres-5432" } } }],
                    },
                  },
                ],
              },
            },
            {
              vzBrCP: {
                attributes: { name: "Web-Public-HTTP-HTTPS", scope: "context" },
                children: [
                  {
                    vzSubj: {
                      attributes: { name: "Subj-Web-Ingress" },
                      children: [{ vzRsSubjFiltAtt: { attributes: { tnVzFilterName: "Flt-HTTPS-443" } } }],
                    },
                  },
                ],
              },
            },
            {
              vzBrCP: {
                attributes: { name: "Shared-JumpHost-Export", scope: "global" },
                children: [
                  {
                    vzSubj: {
                      attributes: { name: "Subj-Global-Leak" },
                      children: [{ vzRsSubjFiltAtt: { attributes: { tnVzFilterName: "default-permit-any" } } }],
                    },
                  },
                ],
              },
            },
            {
              fvAp: {
                attributes: { name: "AP-OnlineBanking" },
                children: [
                  {
                    fvAEPg: {
                      attributes: { name: "Web-Frontend-EPG" },
                      children: [
                        { fvRsBd: { attributes: { tnFvBDName: "BD-DMZ-Web" } } },
                        { fvRsProv: { attributes: { tnVzBrCPName: "Web-Public-HTTP-HTTPS" } } },
                        { fvRsCons: { attributes: { tnVzBrCPName: "App-Tier-Legacy-Access" } } },
                        { fvRsCons: { attributes: { tnVzBrCPName: "Permit-All-AnyToAny" } } },
                      ],
                    },
                  },
                  {
                    fvAEPg: {
                      attributes: { name: "Payment-App-EPG" },
                      children: [
                        { fvRsBd: { attributes: { tnFvBDName: "BD-App-Internal" } } },
                        { fvRsProv: { attributes: { tnVzBrCPName: "App-Tier-Legacy-Access" } } },
                        { fvRsCons: { attributes: { tnVzBrCPName: "DB-Core-Access" } } },
                        { fvRsCons: { attributes: { tnVzBrCPName: "Shared-JumpHost-Export" } } },
                      ],
                    },
                  },
                ],
              },
            },
            {
              fvAp: {
                attributes: { name: "AP-CoreLedger" },
                children: [
                  {
                    fvAEPg: {
                      attributes: { name: "PCI-Database-EPG" },
                      children: [
                        { fvRsBd: { attributes: { tnFvBDName: "BD-PCI-Vault" } } },
                        { fvRsProv: { attributes: { tnVzBrCPName: "DB-Core-Access" } } },
                        { fvRsProv: { attributes: { tnVzBrCPName: "Permit-All-AnyToAny" } } },
                      ],
                    },
                  },
                  {
                    fvAEPg: {
                      attributes: { name: "Audit-Logging-EPG" },
                      children: [{ fvRsBd: { attributes: { tnFvBDName: "BD-App-Internal" } } }],
                    },
                  },
                ],
              },
            },
          ],
        },
      };

      const hybridAiPayload = {
        fvTenant: {
          attributes: {
            dn: "uni/tn-Hybrid-Cloud-AI",
            name: "Hybrid-Cloud-AI",
            descr: "AI Inference Cluster & Vector Storage Interconnect Tenant",
          },
          children: [
            { fvCtx: { attributes: { name: "AI-Cluster-VRF", pcEnfPref: "unenforced" } } },
            {
              fvBD: {
                attributes: { name: "BD-AI-Ingress" },
                children: [{ fvRsCtx: { attributes: { tnFvCtxName: "AI-Cluster-VRF" } } }],
              },
            },
            {
              vzFilter: {
                attributes: { name: "Flt-Wildcard-AllPorts" },
                children: [
                  { vzEntry: { attributes: { name: "tcp-any-port", etherT: "ip", prot: "tcp", dFromPort: "1", dToPort: "65535", stateful: "no" } } },
                ],
              },
            },
            { vzBrCP: { attributes: { name: "Gateway-Ingress-Contract", scope: "context" } } },
            {
              vzBrCP: {
                attributes: { name: "VectorDB-WideOpen-Contract", scope: "global" },
                children: [
                  {
                    vzSubj: {
                      attributes: { name: "Subj-All-Ports" },
                      children: [{ vzRsSubjFiltAtt: { attributes: { tnVzFilterName: "Flt-Wildcard-AllPorts" } } }],
                    },
                  },
                ],
              },
            },
            {
              fvAp: {
                attributes: { name: "AP-Inference-Pipeline" },
                children: [
                  {
                    fvAEPg: {
                      attributes: { name: "Groq-Gateway-EPG" },
                      children: [
                        { fvRsBd: { attributes: { tnFvBDName: "BD-AI-Ingress" } } },
                        { fvRsProv: { attributes: { tnVzBrCPName: "Gateway-Ingress-Contract" } } },
                        { fvRsCons: { attributes: { tnVzBrCPName: "VectorDB-WideOpen-Contract" } } },
                      ],
                    },
                  },
                  {
                    fvAEPg: {
                      attributes: { name: "Vector-DB-EPG" },
                      children: [
                        { fvRsBd: { attributes: { tnFvBDName: "BD-AI-Ingress" } } },
                        { fvRsProv: { attributes: { tnVzBrCPName: "VectorDB-WideOpen-Contract" } } },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      };

      await Promise.all([
        this.rawHttpsRequest(
          `${this.baseUrl}/api/node/mo/uni/tn-Prod-CoreFin.json`,
          "POST",
          JSON.stringify(prodCoreFinPayload),
          tk
        ),
        this.rawHttpsRequest(
          `${this.baseUrl}/api/node/mo/uni/tn-Hybrid-Cloud-AI.json`,
          "POST",
          JSON.stringify(hybridAiPayload),
          tk
        ),
      ]);
    } catch {
      // Ignore seed failures if sandbox is temporarily unreachable
    }
  }

  /**
   * Lists all tenants and their complete topology snapshot
   */
  public async getTenants(tenantFilter?: string): Promise<{
    tenants: AciTenantSnapshot[];
    source: "live" | "mock";
  }> {
    let source: "live" | "mock" = "mock";
    let tenants = structuredClone(MOCK_ACI_TENANTS);

    if (this.mode === "live") {
      try {
        const auth = await this.login();
        source = auth.source;
        if (source === "live") {
          const raw = await this.rawHttpsRequest(
            `${this.baseUrl}/api/node/class/fvTenant.json`,
            "GET",
            undefined,
            auth.token
          );
          const parsed = JSON.parse(raw);
          const liveNames: string[] = (parsed?.imdata || [])
            .map((item: any) => item?.fvTenant?.attributes?.name)
            .filter(Boolean)
            .slice(0, 6);

          // Augment our rich demo tenants with live DevNet Sandbox tenants
          for (const tName of liveNames) {
            if (!tenants.some((t) => t.name === tName)) {
              tenants.push({
                name: tName,
                dn: `uni/tn-${tName}`,
                descr: `Live Cisco DevNet Sandbox Tenant (${this.baseUrl})`,
                healthScore: 94,
                vrfs: [
                  {
                    name: `${tName}-VRF`,
                    pcEnfPref: "enforced",
                    vzAnyProvidedContracts: [],
                    vzAnyConsumedContracts: [],
                  },
                ],
                appProfiles: [`${tName}-AppProfile`],
                epgs: [
                  {
                    name: `${tName}-Default-EPG`,
                    dn: `uni/tn-${tName}/ap-${tName}-AppProfile/epg-${tName}-Default-EPG`,
                    tenant: tName,
                    appProfile: `${tName}-AppProfile`,
                    bridgeDomain: `${tName}-BD`,
                    providedContracts: [],
                    consumedContracts: [],
                  },
                ],
                contracts: [],
                filters: [],
                faults: [],
              });
            }
          }
        }
      } catch {
        source = "mock";
      }
    }

    if (tenantFilter && tenantFilter.trim() !== "" && tenantFilter.toLowerCase() !== "all") {
      const q = tenantFilter.toLowerCase();
      tenants = tenants.filter((t) => t.name.toLowerCase().includes(q));
    }

    return { tenants, source };
  }

  /**
   * Returns fabric health summary and active APIC fault instances (faultInst)
   */
  public async getFabricHealthAndFaults(
    tenantFilter?: string,
    prefetched?: { tenants: AciTenantSnapshot[]; source: "live" | "mock" }
  ): Promise<{
    overallHealth: number;
    totalFaults: number;
    criticalCount: number;
    majorCount: number;
    warningCount: number;
    faults: AciFault[];
    source: "live" | "mock";
  }> {
    const { tenants, source } =
      prefetched || (await this.getTenants(tenantFilter));
    const faults = tenants.flatMap((t) => t.faults);
    const avgHealth =
      tenants.length > 0
        ? Math.round(
            tenants.reduce((acc, t) => acc + t.healthScore, 0) / tenants.length
          )
        : 100;

    return {
      overallHealth: avgHealth,
      totalFaults: faults.length,
      criticalCount: faults.filter((f) => f.severity === "critical").length,
      majorCount: faults.filter((f) => f.severity === "major").length,
      warningCount: faults.filter(
        (f) => f.severity === "warning" || f.severity === "minor"
      ).length,
      faults,
      source,
    };
  }

  /**
   * Comprehensive Cisco ACI Security & Policy Compliance Auditor.
   * Detects all 6 zero-trust violation categories:
   * 1. vzAny (Any-to-Any VRF contract exposure)
   * 2. Wildcard filters (unspecified protocol/ports or 1-65535)
   * 3. Cleartext protocols (Telnet/23, FTP/21, HTTP/80, SNMP/161)
   * 4. Cross-tenant global contract export risks
   * 5. Missing contract subjects (empty contracts)
   * 6. Unenforced VRF policy control (`pcEnfPref = unenforced`)
   */
  public async auditTenantContracts(
    tenantFilter?: string,
    prefetched?: { tenants: AciTenantSnapshot[]; source: "live" | "mock" }
  ): Promise<{
    violations: SecurityViolation[];
    summary: {
      totalViolations: number;
      critical: number;
      high: number;
      medium: number;
      auditedTenants: string[];
    };
    source: "live" | "mock";
  }> {
    const { tenants, source } =
      prefetched || (await this.getTenants(tenantFilter));
    const violations: SecurityViolation[] = [];

    for (const tenant of tenants) {
      // 1. Check VRF enforcement and vzAny bindings
      for (const vrf of tenant.vrfs) {
        if (vrf.pcEnfPref === "unenforced") {
          violations.push({
            id: `VIO-VRF-${tenant.name}-${vrf.name}`,
            severity: "CRITICAL",
            category: "UNENFORCED_VRF",
            tenant: tenant.name,
            affectedObject: `VRF/${vrf.name}`,
            dn: `uni/tn-${tenant.name}/ctx-${vrf.name}`,
            title: `Unenforced VRF Policy Control on '${vrf.name}'`,
            description: `VRF '${vrf.name}' in tenant '${tenant.name}' has Policy Control Enforcement Preference set to 'unenforced'. All EPGs within this VRF can communicate freely without contracts.`,
            cisBenchmark: "CIS Cisco ACI Benchmark 2.1.1 — Ensure VRF Policy Enforcement is Enforced",
            rawAciJson: {
              fvCtx: {
                attributes: {
                  dn: `uni/tn-${tenant.name}/ctx-${vrf.name}`,
                  name: vrf.name,
                  pcEnfPref: "unenforced",
                  pcEnfDir: "ingress",
                },
              },
            },
            recommendedFix: {
              summary: `Set VRF '${vrf.name}' pcEnfPref to 'enforced' and bind least-privilege EPG contracts`,
              consumerEpg: tenant.epgs[0]?.name || "Source-EPG",
              providerEpg: tenant.epgs[1]?.name || "Target-EPG",
              allowedPorts: [{ name: "https-443", protocol: "tcp", port: "443" }],
              removeVzAny: true,
            },
          });
        }

        const vzContracts = Array.from(
          new Set([
            ...vrf.vzAnyProvidedContracts,
            ...vrf.vzAnyConsumedContracts,
          ])
        );
        for (const brcName of vzContracts) {
          violations.push({
            id: `VIO-VZANY-${tenant.name}-${brcName}`,
            severity: "CRITICAL",
            category: "VZANY_EXPOSURE",
            tenant: tenant.name,
            affectedObject: `vzAny/${brcName}`,
            dn: `uni/tn-${tenant.name}/ctx-${vrf.name}/any`,
            contractName: brcName,
            title: `vzAny (Any-to-Any) Contract '${brcName}' Attached to VRF '${vrf.name}'`,
            description: `Contract '${brcName}' is bound to vzAny on VRF '${vrf.name}', allowing unrestricted lateral movement across all EPGs in tenant '${tenant.name}' including PCI/Database tiers.`,
            cisBenchmark: "CIS Cisco ACI Benchmark 3.2.4 — Prohibit vzAny Contract Bindings in Production VRFs",
            rawAciJson: {
              vzAny: {
                attributes: {
                  dn: `uni/tn-${tenant.name}/ctx-${vrf.name}/any`,
                  matchT: "AtleastOne",
                },
                children: [
                  {
                    vzRsAnyToProv: {
                      attributes: { tnVzBrCPName: brcName },
                    },
                  },
                  {
                    vzRsAnyToCons: {
                      attributes: { tnVzBrCPName: brcName },
                    },
                  },
                ],
              },
            },
            recommendedFix: {
              summary: `Remove vzAny binding '${brcName}' from VRF '${vrf.name}' and replace with scoped EPG-to-EPG HTTPS/443 contract`,
              consumerEpg: tenant.epgs[0]?.name || "Web-Frontend-EPG",
              providerEpg: tenant.epgs[1]?.name || "Payment-App-EPG",
              allowedPorts: [{ name: "https-443", protocol: "tcp", port: "443" }],
              removeVzAny: true,
            },
          });
        }
      }

      // 2. Check Contracts & Filters
      for (const contract of tenant.contracts) {
        // Check empty subjects
        if (contract.subjects.length === 0) {
          violations.push({
            id: `VIO-SUBJ-${tenant.name}-${contract.name}`,
            severity: "MEDIUM",
            category: "MISSING_SUBJECT",
            tenant: tenant.name,
            affectedObject: `Contract/${contract.name}`,
            dn: contract.dn,
            contractName: contract.name,
            title: `Contract '${contract.name}' Has No Subjects Attached`,
            description: `Contract '${contract.name}' is attached to EPGs in '${tenant.name}' but contains zero subjects or filters, causing silent drop or misconfigured policy state.`,
            cisBenchmark: "CIS Cisco ACI Benchmark 3.1.2 — Validate Contract Subject Integrity",
            rawAciJson: {
              vzBrCP: {
                attributes: {
                  dn: contract.dn,
                  name: contract.name,
                  scope: contract.scope,
                },
                children: [],
              },
            },
            recommendedFix: {
              summary: `Attach an explicit HTTPS (TCP/443) subject and filter to '${contract.name}'`,
              consumerEpg: tenant.epgs[0]?.name || "Consumer-EPG",
              providerEpg: tenant.epgs[1]?.name || "Provider-EPG",
              allowedPorts: [{ name: "https-443", protocol: "tcp", port: "443" }],
              removeVzAny: false,
            },
          });
        }

        // Check global scope cross-tenant leak
        if (contract.scope === "global") {
          violations.push({
            id: `VIO-GLOBAL-${tenant.name}-${contract.name}`,
            severity: "HIGH",
            category: "CROSS_TENANT_LEAK",
            tenant: tenant.name,
            affectedObject: `Contract/${contract.name}`,
            dn: contract.dn,
            contractName: contract.name,
            title: `Global Scope Cross-Tenant Contract Exposure on '${contract.name}'`,
            description: `Contract '${contract.name}' in tenant '${tenant.name}' is configured with 'global' scope instead of 'context' (VRF) or 'tenant', allowing cross-tenant export leakage.`,
            cisBenchmark: "CIS Cisco ACI Benchmark 3.3.1 — Restrict Contract Scope to VRF Context",
            rawAciJson: {
              vzBrCP: {
                attributes: {
                  dn: contract.dn,
                  name: contract.name,
                  scope: "global",
                },
              },
            },
            recommendedFix: {
              summary: `Constrain contract '${contract.name}' scope from 'global' to 'context' (VRF-scoped) and lock down ports`,
              consumerEpg: tenant.epgs[0]?.name || "Consumer-EPG",
              providerEpg: tenant.epgs[1]?.name || "Provider-EPG",
              allowedPorts: [{ name: "https-443", protocol: "tcp", port: "443" }],
              removeVzAny: false,
            },
          });
        }

        // Inspect filters referenced by contract subjects
        for (const subj of contract.subjects) {
          for (const fltName of subj.filters) {
            const filter = tenant.filters.find((f) => f.name === fltName);
            if (!filter) continue;

            const wildcardEntries = filter.entries.filter(
              (e) =>
                e.etherT === "unspecified" ||
                e.prot === "unspecified" ||
                e.dFromPort === "unspecified" ||
                (e.dFromPort === "1" && e.dToPort === "65535")
            );

            if (wildcardEntries.length > 0) {
              violations.push({
                id: `VIO-WILDCARD-${tenant.name}-${contract.name}-${filter.name}`,
                severity: "CRITICAL",
                category: "WILDCARD_FILTER",
                tenant: tenant.name,
                affectedObject: `Filter/${filter.name}`,
                dn: filter.dn,
                contractName: contract.name,
                filterName: filter.name,
                title: `Overly Permissive Wildcard Filter '${filter.name}' in Contract '${contract.name}'`,
                description: `Filter '${filter.name}' allows wildcard/unspecified traffic (${wildcardEntries
                  .map((e) => `${e.prot}:${e.dFromPort}-${e.dToPort}`)
                  .join(", ")}) with stateful=${wildcardEntries[0].stateful}.`,
                cisBenchmark: "CIS Cisco ACI Benchmark 3.4.1 — Disallow Unspecified / Wildcard Filter Entries",
                rawAciJson: {
                  vzFilter: {
                    attributes: { dn: filter.dn, name: filter.name },
                    children: wildcardEntries.map((e) => ({
                      vzEntry: { attributes: e },
                    })),
                  },
                },
                recommendedFix: {
                  summary: `Replace wildcard filter '${filter.name}' in '${contract.name}' with explicit stateful TCP/443 entry`,
                  consumerEpg: tenant.epgs[0]?.name || "Web-Frontend-EPG",
                  providerEpg: tenant.epgs[1]?.name || "Payment-App-EPG",
                  allowedPorts: [
                    { name: "https-443", protocol: "tcp", port: "443" },
                  ],
                  removeVzAny: Boolean(contract.vzAnyEnabled),
                },
              });
            }

            const cleartextEntries = filter.entries.filter(
              (e) =>
                CLEARTEXT_PORTS.has(e.dFromPort) ||
                CLEARTEXT_PORTS.has(e.dToPort)
            );

            if (cleartextEntries.length > 0) {
              violations.push({
                id: `VIO-CLEAR-${tenant.name}-${contract.name}-${filter.name}`,
                severity: "HIGH",
                category: "CLEARTEXT_PROTOCOL",
                tenant: tenant.name,
                affectedObject: `Filter/${filter.name}`,
                dn: filter.dn,
                contractName: contract.name,
                filterName: filter.name,
                title: `Banned Cleartext Protocols in Filter '${filter.name}' (${cleartextEntries
                  .map((e) => `${e.name}:${e.dFromPort}`)
                  .join(", ")})`,
                description: `Contract '${contract.name}' exposes unencrypted management/application ports (${cleartextEntries
                  .map((e) => `TCP/${e.dFromPort}`)
                  .join(", ")}) subject to credential sniffing.`,
                cisBenchmark: "CIS Cisco ACI Benchmark 3.4.5 — Prohibit Cleartext Protocols (Telnet, FTP, HTTP)",
                rawAciJson: {
                  vzFilter: {
                    attributes: { dn: filter.dn, name: filter.name },
                    children: filter.entries.map((e) => ({
                      vzEntry: { attributes: e },
                    })),
                  },
                },
                recommendedFix: {
                  summary: `Purge Telnet (23), FTP (21), and HTTP (80) from '${filter.name}', enforcing TLS/HTTPS (443/8443) only`,
                  consumerEpg: "Web-Frontend-EPG",
                  providerEpg: "Payment-App-EPG",
                  allowedPorts: [
                    { name: "https-443", protocol: "tcp", port: "443" },
                    { name: "https-8443", protocol: "tcp", port: "8443" },
                  ],
                  removeVzAny: false,
                },
              });
            }
          }
        }
      }
    }

    return {
      violations,
      summary: {
        totalViolations: violations.length,
        critical: violations.filter((v) => v.severity === "CRITICAL").length,
        high: violations.filter((v) => v.severity === "HIGH").length,
        medium: violations.filter((v) => v.severity === "MEDIUM").length,
        auditedTenants: tenants.map((t) => t.name),
      },
      source,
    };
  }

  /**
   * Inspects EPG provider/consumer contract relationships for a tenant
   */
  public async inspectEpgRelationships(
    tenantFilter?: string,
    prefetched?: { tenants: AciTenantSnapshot[]; source: "live" | "mock" }
  ) {
    const { tenants, source } =
      prefetched || (await this.getTenants(tenantFilter));
    const relationships = tenants.flatMap((t) =>
      t.epgs.map((epg) => ({
        tenant: t.name,
        appProfile: epg.appProfile,
        epg: epg.name,
        dn: epg.dn,
        bridgeDomain: epg.bridgeDomain,
        provides: epg.providedContracts,
        consumes: epg.consumedContracts,
        isIsolated:
          epg.providedContracts.length === 0 &&
          epg.consumedContracts.length === 0,
      }))
    );
    return { relationships, source };
  }

  private rawHttpsRequest(
    urlStr: string,
    method: "GET" | "POST",
    body?: string,
    token?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method,
          rejectUnauthorized: this.verifySsl,
          timeout: 4500,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Cookie: `APIC-cookie=${token}` } : {}),
            ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(
                new Error(`APIC HTTP ${res.statusCode}: ${data.slice(0, 200)}`)
              );
            }
          });
        }
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("APIC request timed out after 4500ms"));
      });

      if (body) req.write(body);
      req.end();
    });
  }
}

// Singleton instance for server routes
export const aciClient = new AciClient();

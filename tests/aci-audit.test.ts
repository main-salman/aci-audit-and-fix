import { describe, it, expect } from "vitest";
import { AciClient } from "../src/lib/aci-client";
import {
  generateGitOpsRemediation,
  evaluateOpaPolicy,
} from "../src/lib/gitops-generator";
import { executeAciMcpTool, createAciMcpServer } from "../src/mcp/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

describe("Cisco ACI Policy Auditing & GitOps Guardrails Suite", () => {
  it("audits tenants and detects all 6 zero-trust policy violation categories", async () => {
    const client = new AciClient("mock");
    const audit = await client.auditTenantContracts();

    expect(audit.summary.totalViolations).toBeGreaterThanOrEqual(6);
    const categories = new Set(audit.violations.map((v) => v.category));

    expect(categories.has("VZANY_EXPOSURE")).toBe(true);
    expect(categories.has("WILDCARD_FILTER")).toBe(true);
    expect(categories.has("CLEARTEXT_PROTOCOL")).toBe(true);
    expect(categories.has("CROSS_TENANT_LEAK")).toBe(true);
    expect(categories.has("MISSING_SUBJECT")).toBe(true);
    expect(categories.has("UNENFORCED_VRF")).toBe(true);
  });

  it("generates compliant CiscoDevNet/aci Terraform HCL and passes all 6 OPA guardrails", () => {
    const artifact = generateGitOpsRemediation({
      tenant: "Prod-CoreFin",
      vrfName: "Prod-Payment-VRF",
      appProfile: "AP-OnlineBanking",
      contractName: "Permit-All-AnyToAny",
      consumerEpg: "Web-Frontend-EPG",
      providerEpg: "Payment-App-EPG",
      scope: "context",
      allowedPorts: [{ name: "https-443", protocol: "tcp", port: "443" }],
      removeVzAny: true,
      enforceVrf: true,
      stateful: true,
    });

    expect(artifact.opaResult.passed).toBe(true);
    expect(artifact.opaResult.denials).toHaveLength(0);
    expect(artifact.terraformHcl).toContain('resource "aci_contract"');
    expect(artifact.terraformHcl).toContain('pc_enf_pref            = "enforced"');
    expect(artifact.terraformHcl).toContain('d_from_port   = "443"');
  });

  it("blocks non-compliant remediation plans via OPA policy evaluator (vzAny, Cleartext Telnet/23, Global scope)", () => {
    const badOpaInput = {
      vrf: {
        name: "Prod-Payment-VRF",
        pc_enf_pref: "unenforced",
        vz_any_enabled: true,
      },
      contract: {
        name: "Bad-Global-Contract",
        scope: "global",
      },
      filter: {
        name: "Bad-Filter",
        entries: [
          {
            name: "telnet-23",
            ether_t: "ip",
            prot: "tcp",
            d_from_port: "23",
            d_to_port: "23",
            stateful: false,
          },
        ],
      },
    };

    const verdict = evaluateOpaPolicy(badOpaInput);
    expect(verdict.passed).toBe(false);
    expect(verdict.denials.length).toBeGreaterThanOrEqual(4);
  });

  it("exposes and executes all 5 ACI tools over an authentic Model Context Protocol (MCP) Client/Server session", async () => {
    const server = createAciMcpServer();
    const client = new Client(
      { name: "test-mcp-client", version: "1.0.0" },
      { capabilities: {} }
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const toolsList = await client.listTools();
    expect(toolsList.tools.map((t) => t.name)).toEqual([
      "list_tenants",
      "get_fabric_health_and_faults",
      "audit_tenant_contracts",
      "inspect_epg_relationships",
      "generate_gitops_remediation",
    ]);

    const callRes = await client.callTool({
      name: "list_tenants",
      arguments: { tenantFilter: "Prod-CoreFin" },
    });
    const payload = JSON.parse((callRes.content as any[])[0].text);
    expect(payload.tenantCount).toBe(1);
    expect(payload.tenants[0].name).toBe("Prod-CoreFin");

    await client.close();
    await server.close();
  });
});

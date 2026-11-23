import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { aciClient } from "../lib/aci-client";
import {
  generateGitOpsRemediation,
  evaluateOpaPolicy,
  AllowedPortSpec,
} from "../lib/gitops-generator";

/**
 * Tool definitions shared by both the official Model Context Protocol (MCP) Server
 * and the Groq tool-calling orchestrator.
 */
export const ACI_MCP_TOOLS = [
  {
    name: "list_tenants",
    description:
      "List Cisco ACI tenants, VRFs, Application Profiles, EPGs, Contracts, and health scores from the APIC fabric.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tenantFilter: {
          type: ["string", "null"] as any,
          description:
            "Optional tenant name filter (e.g. 'Prod-CoreFin' or 'Hybrid-Cloud-AI'). Omit or pass null to list all tenants.",
        },
      },
    },
  },
  {
    name: "get_fabric_health_and_faults",
    description:
      "Query Cisco APIC active fault instances (faultInst) and fabric health metrics across tenants.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tenantFilter: {
          type: ["string", "null"] as any,
          description: "Optional tenant name to filter faults.",
        },
      },
    },
  },
  {
    name: "audit_tenant_contracts",
    description:
      "Run a comprehensive Zero-Trust Cisco ACI security audit across tenants. Detects vzAny (any-to-any) exposures, wildcard filters (unspecified/1-65535), banned cleartext protocols (Telnet/23, FTP/21, HTTP/80), global cross-tenant contract leaks, empty contract subjects, and unenforced VRFs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tenantFilter: {
          type: ["string", "null"] as any,
          description:
            "Optional tenant name to scope the security audit (e.g. 'Prod-CoreFin'). Omit or pass null to audit all tenants.",
        },
      },
    },
  },
  {
    name: "inspect_epg_relationships",
    description:
      "Inspect Endpoint Group (EPG) provider and consumer contract bindings and identify isolated/unassociated EPGs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tenantFilter: {
          type: ["string", "null"] as any,
          description: "Optional tenant name filter.",
        },
      },
    },
  },
  {
    name: "generate_gitops_remediation",
    description:
      "Generate a GitOps Terraform HCL remediation plan (CiscoDevNet/aci provider) and evaluate it against Open Policy Agent (OPA) guardrails (`policies/aci_guardrails.rego`). ONLY call this tool when the user explicitly asks to generate, stage, fix, or remediate a contract into Terraform. Do NOT call this tool if the user is just asking a question like 'why does this need to be fixed?'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tenant: {
          type: "string",
          description: "Target ACI Tenant name (e.g. 'Prod-CoreFin').",
        },
        vrfName: {
          type: ["string", "null"] as any,
          description: "Target VRF name (e.g. 'Prod-Payment-VRF').",
        },
        appProfile: {
          type: ["string", "null"] as any,
          description: "Application Profile name (e.g. 'AP-OnlineBanking').",
        },
        contractName: {
          type: "string",
          description:
            "Contract name to remediate or create (e.g. 'Permit-All-AnyToAny' or 'App-Tier-Legacy-Access').",
        },
        consumerEpg: {
          type: "string",
          description: "Source/Consumer EPG name (e.g. 'Web-Frontend-EPG').",
        },
        providerEpg: {
          type: "string",
          description: "Destination/Provider EPG name (e.g. 'Payment-App-EPG').",
        },
        scope: {
          type: ["string", "null"] as any,
          description:
            "Contract scope ('context', 'tenant', 'application-profile'). Use 'context' (VRF-scoped) for zero-trust compliance.",
        },
        allowedPorts: {
          type: ["array", "null"] as any,
          description:
            "Explicit list of permitted Layer-4 ports (e.g. [{name: 'https-443', protocol: 'tcp', port: '443'}]).",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              protocol: { type: "string" },
              port: { type: "string" },
            },
            required: ["name", "protocol", "port"],
          },
        },
        removeVzAny: {
          type: ["boolean", "null"] as any,
          description: "Set true to strip vzAny (any-to-any) bindings from VRF.",
        },
        reason: {
          type: ["string", "null"] as any,
          description: "Audit justification for this GitOps remediation.",
        },
      },
      required: ["tenant", "contractName", "consumerEpg", "providerEpg"],
    },
  },
];

/**
 * Executes an MCP tool call by name and returns structured output
 */
export async function executeAciMcpTool(
  name: string,
  args: Record<string, any> = {}
): Promise<any> {
  switch (name) {
    case "list_tenants": {
      const { tenants, source } = await aciClient.getTenants(args.tenantFilter);
      return {
        source,
        tenantCount: tenants.length,
        tenants: tenants.map((t) => ({
          name: t.name,
          dn: t.dn,
          description: t.descr,
          healthScore: t.healthScore,
          vrfs: t.vrfs,
          appProfiles: t.appProfiles,
          epgCount: t.epgs.length,
          contractCount: t.contracts.length,
          faultCount: t.faults.length,
        })),
      };
    }

    case "get_fabric_health_and_faults": {
      return await aciClient.getFabricHealthAndFaults(args.tenantFilter);
    }

    case "audit_tenant_contracts": {
      return await aciClient.auditTenantContracts(args.tenantFilter);
    }

    case "inspect_epg_relationships": {
      return await aciClient.inspectEpgRelationships(args.tenantFilter);
    }

    case "generate_gitops_remediation": {
      const allowedPorts: AllowedPortSpec[] = Array.isArray(args.allowedPorts)
        ? args.allowedPorts
        : [{ name: "https-443", protocol: "tcp", port: "443" }];

      // Look up actual rawAciJson from audit violations if matching contract exists
      const audit = await aciClient.auditTenantContracts(args.tenant);
      const matchedViolation = audit.violations.find(
        (v) =>
          v.contractName === args.contractName ||
          v.affectedObject.includes(args.contractName)
      );

      const artifact = generateGitOpsRemediation({
        tenant: args.tenant || "Prod-CoreFin",
        vrfName: args.vrfName,
        appProfile: args.appProfile,
        contractName: args.contractName || "Permit-All-AnyToAny",
        consumerEpg: args.consumerEpg || "Web-Frontend-EPG",
        providerEpg: args.providerEpg || "Payment-App-EPG",
        scope: args.scope || "context",
        allowedPorts,
        removeVzAny: args.removeVzAny ?? true,
        enforceVrf: true,
        stateful: true,
        reason: args.reason,
        beforeAciJson: matchedViolation?.rawAciJson,
      });

      return artifact;
    }

    default:
      throw new Error(`Unknown ACI MCP tool: ${name}`);
  }
}

/**
 * Creates a compliant @modelcontextprotocol/sdk Server instance
 * that can be connected via StdioServerTransport or InMemoryTransport.
 */
export function createAciMcpServer(): Server {
  const server = new Server(
    {
      name: "cisco-aci-gitops-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ACI_MCP_TOOLS,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    try {
      const result = await executeAciMcpTool(
        name,
        (toolArgs as Record<string, any>) || {}
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error executing tool ${name}: ${error?.message || String(error)}`,
          },
        ],
      };
    }
  });

  return server;
}

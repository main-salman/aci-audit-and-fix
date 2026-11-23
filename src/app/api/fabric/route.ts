import { NextRequest, NextResponse } from "next/server";
import { aciClient, FabricProfile } from "@/lib/aci-client";
import { llmConfigManager } from "@/lib/groq-agent";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenant = searchParams.get("tenant") || undefined;
  const modeParam = searchParams.get("mode") as "mock" | "live" | null;
  const profileParam = searchParams.get("profile") as FabricProfile | null;

  // Only reconfigure profile if explicitly changing to mock or devnet
  // (Do not wipe custom APIC credentials on a read-only GET poll)
  if (
    (profileParam === "mock" || profileParam === "devnet") &&
    profileParam !== aciClient.getProfile()
  ) {
    aciClient.configureConnection({ profile: profileParam });
  } else if (
    (modeParam === "mock" || modeParam === "live") &&
    modeParam !== aciClient.getMode()
  ) {
    aciClient.setMode(modeParam);
  }

  const conn = aciClient.getConnectionInfo();
  const llmInfo = llmConfigManager.getEffectiveSettings();

  // Fetch tenants once and reuse the snapshot across health, audit, and EPG inspection
  const tenantsRes = await aciClient.getTenants(tenant);
  const [healthRes, auditRes, epgRes] = await Promise.all([
    aciClient.getFabricHealthAndFaults(tenant, tenantsRes),
    aciClient.auditTenantContracts(tenant, tenantsRes),
    aciClient.inspectEpgRelationships(tenant, tenantsRes),
  ]);

  const remDir = path.resolve(process.cwd(), "terraform", "remediations");
  let savedRemediations: string[] = [];
  if (fs.existsSync(remDir)) {
    savedRemediations = fs
      .readdirSync(remDir)
      .filter((f) => f.endsWith(".tf"));
  }

  return NextResponse.json({
    apicUrl: conn.url,
    apicUsername: conn.username,
    verifySsl: conn.verifySsl,
    profile: conn.profile,
    mode: aciClient.getMode(),
    llm: {
      model: llmInfo.model,
      keyPreview: llmInfo.keyPreview,
      hasCustomKey: llmInfo.hasCustomKey,
      baseUrl: llmInfo.baseUrl || "",
    },
    source: tenantsRes.source,
    tenants: tenantsRes.tenants,
    health: healthRes,
    audit: auditRes,
    epgRelationships: epgRes.relationships,
    savedRemediations,
  });
}

/**
 * POST /api/fabric — Updates APIC target profile / custom credentials AND/OR Enterprise LLM API Key & Model
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      profile,
      url,
      username,
      password,
      verifySsl,
      llmApiKey,
      llmModel,
      llmBaseUrl,
      testOnly,
      testLlmOnly,
    } = body;

    if (
      llmApiKey !== undefined ||
      llmModel !== undefined ||
      llmBaseUrl !== undefined
    ) {
      llmConfigManager.configure({
        apiKey: llmApiKey,
        model: llmModel,
        baseUrl: llmBaseUrl,
      });
    }

    if (testLlmOnly) {
      const llmTestResult = await llmConfigManager.testLlmConnection();
      const llmInfo = llmConfigManager.getEffectiveSettings();
      return NextResponse.json({
        llm: {
          model: llmInfo.model,
          keyPreview: llmInfo.keyPreview,
          hasCustomKey: llmInfo.hasCustomKey,
          baseUrl: llmInfo.baseUrl || "",
        },
        llmTestResult,
      });
    }

    if (profile) {
      aciClient.configureConnection({
        profile,
        url,
        username,
        password,
        verifySsl,
      });
    }

    const testResult = await aciClient.testConnection();
    const conn = aciClient.getConnectionInfo();
    const llmInfo = llmConfigManager.getEffectiveSettings();

    if (testOnly) {
      return NextResponse.json({
        connection: conn,
        testResult,
        llm: {
          model: llmInfo.model,
          keyPreview: llmInfo.keyPreview,
          hasCustomKey: llmInfo.hasCustomKey,
          baseUrl: llmInfo.baseUrl || "",
        },
      });
    }

    const tenantsRes = await aciClient.getTenants();
    const [healthRes, auditRes] = await Promise.all([
      aciClient.getFabricHealthAndFaults(undefined, tenantsRes),
      aciClient.auditTenantContracts(undefined, tenantsRes),
    ]);

    const remDir = path.resolve(process.cwd(), "terraform", "remediations");
    let savedRemediations: string[] = [];
    if (fs.existsSync(remDir)) {
      savedRemediations = fs
        .readdirSync(remDir)
        .filter((f) => f.endsWith(".tf"));
    }

    return NextResponse.json({
      connection: conn,
      testResult,
      apicUrl: conn.url,
      profile: conn.profile,
      mode: aciClient.getMode(),
      llm: {
        model: llmInfo.model,
        keyPreview: llmInfo.keyPreview,
        hasCustomKey: llmInfo.hasCustomKey,
        baseUrl: llmInfo.baseUrl || "",
      },
      source: tenantsRes.source,
      tenants: tenantsRes.tenants,
      health: healthRes,
      audit: auditRes,
      savedRemediations,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update settings" },
      { status: 500 }
    );
  }
}

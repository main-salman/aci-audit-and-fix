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

  if (
    profileParam === "mock" ||
    profileParam === "devnet" ||
    profileParam === "custom"
  ) {
    aciClient.configureConnection({ profile: profileParam });
  } else if (modeParam === "mock" || modeParam === "live") {
    aciClient.setMode(modeParam);
  }

  const conn = aciClient.getConnectionInfo();
  const llmInfo = llmConfigManager.getEffectiveSettings();

  const [tenantsRes, healthRes, auditRes, epgRes] = await Promise.all([
    aciClient.getTenants(tenant),
    aciClient.getFabricHealthAndFaults(tenant),
    aciClient.auditTenantContracts(tenant),
    aciClient.inspectEpgRelationships(tenant),
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

    const [tenantsRes, healthRes, auditRes] = await Promise.all([
      aciClient.getTenants(),
      aciClient.getFabricHealthAndFaults(),
      aciClient.auditTenantContracts(),
    ]);

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
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update settings" },
      { status: 500 }
    );
  }
}

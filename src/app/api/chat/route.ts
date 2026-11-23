import { NextRequest, NextResponse } from "next/server";
import { runGroqMcpAgent } from "@/lib/groq-agent";
import { generateGitOpsRemediation } from "@/lib/gitops-generator";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Direct one-click remediation generation endpoint support
    if (body.action === "direct_remediate" && body.remediationInput) {
      const artifact = generateGitOpsRemediation(body.remediationInput);
      return NextResponse.json({
        reply: `Generated GitOps Terraform remediation \`${artifact.filePath}\` for contract **${artifact.contractName}** in tenant **${artifact.tenant}**. OPA Rego Policy Check: **${
          artifact.opaResult.passed ? "PASSED" : "BLOCKED"
        }**.`,
        model: "direct-mcp-gitops",
        toolTraces: [
          {
            toolName: "generate_gitops_remediation",
            args: body.remediationInput,
            resultPreview: JSON.stringify(artifact.opaResult, null, 2),
            durationMs: 4,
          },
        ],
        remediation: artifact,
      });
    }

    const { message, history, model, activeContext } = body;
    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const result = await runGroqMcpAgent(
      message,
      history || [],
      model,
      activeContext
    );
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to execute Groq MCP request" },
      { status: 500 }
    );
  }
}

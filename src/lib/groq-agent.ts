import Groq from "groq-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getConfig } from "./config";
import { ACI_MCP_TOOLS, createAciMcpServer } from "../mcp/server";
import { RemediationArtifact } from "./gitops-generator";

export interface McpToolTrace {
  toolName: string;
  args: Record<string, any>;
  resultPreview: string;
  durationMs: number;
}

export interface AgentChatResponse {
  reply: string;
  model: string;
  toolTraces: McpToolTrace[];
  remediation?: RemediationArtifact;
}

export interface LlmRuntimeSettings {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

const VALID_GROQ_MODELS = new Set([
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
]);

class LlmConfigManager {
  private customApiKey: string | null = null;
  private customModel: string | null = null;
  private customBaseUrl: string | null = null;

  public configure(opts: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  }) {
    if (opts.apiKey !== undefined && opts.apiKey.trim() !== "") {
      this.customApiKey = opts.apiKey.trim();
    }
    if (opts.model !== undefined && opts.model.trim() !== "") {
      this.customModel = opts.model.trim();
    }
    if (opts.baseUrl !== undefined) {
      this.customBaseUrl = opts.baseUrl.trim() || null;
    }
  }

  public getEffectiveSettings(): LlmRuntimeSettings & {
    keyPreview: string;
    hasCustomKey: boolean;
  } {
    const cfg = getConfig();
    const apiKey = this.customApiKey || cfg.GROQ_API_KEY;
    const rawModel = this.customModel || cfg.GROQ_MODEL || "openai/gpt-oss-120b";
    const model =
      this.customBaseUrl || VALID_GROQ_MODELS.has(rawModel)
        ? rawModel
        : "openai/gpt-oss-120b";

    const keyPreview =
      apiKey && apiKey.length > 10
        ? `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`
        : "Not Set";

    return {
      apiKey,
      model,
      baseUrl: this.customBaseUrl || undefined,
      keyPreview,
      hasCustomKey: Boolean(this.customApiKey),
    };
  }

  public async testLlmConnection(): Promise<{
    ok: boolean;
    model: string;
    keyPreview: string;
    message: string;
    latencyMs: number;
  }> {
    const t0 = performance.now();
    const settings = this.getEffectiveSettings();
    try {
      const groq = new Groq({
        apiKey: settings.apiKey,
        ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
      });
      const res = await groq.chat.completions.create({
        model: settings.model,
        messages: [{ role: "user", content: "Respond with OK" }],
        max_tokens: 8,
        temperature: 0,
      });
      const reply = res.choices[0]?.message?.content?.trim() || "OK";
      return {
        ok: true,
        model: settings.model,
        keyPreview: settings.keyPreview,
        message: `LLM API Key verified with model '${settings.model}' (response: "${reply}")`,
        latencyMs: Math.round(performance.now() - t0),
      };
    } catch (err: any) {
      return {
        ok: false,
        model: settings.model,
        keyPreview: settings.keyPreview,
        message: `LLM verification failed: ${err?.message || String(err)}`,
        latencyMs: Math.round(performance.now() - t0),
      };
    }
  }
}

export const llmConfigManager = new LlmConfigManager();

const SYSTEM_PROMPT = `You are a Principal Cisco ACI Cloud Network Security & GitOps Architect inside the "ACI Audit and Fix" platform.
You audit live Cisco Application Centric Infrastructure (ACI) fabrics via Model Context Protocol (MCP) tools and help engineers understand AND remediate zero-trust policy violations through declarative GitOps (Terraform + Open Policy Agent guardrails).

Core Operating Principles:
1. Directly answer the engineer's question! If they ask "why does this need to be fixed?", "what is the blast radius?", "explain this violation", or "what is wrong with this contract?", explain the exact security risk, lateral movement blast radius, affected EPGs/VRFs, and CIS Cisco ACI Benchmark impact in clear, conversational detail.
2. Call \`audit_tenant_contracts\`, \`get_fabric_health_and_faults\`, or \`inspect_epg_relationships\` whenever you need live fabric facts (DNs, fault codes, filter ports, EPG bindings).
3. ONLY call \`generate_gitops_remediation\` when the user explicitly asks to fix, remediate, stage, or generate a Terraform plan.
4. Keep your Markdown formatting clean and well-structured using headings (###), bullet points (-), bold labels (**label**), and inline code (\`uni/tn-...\`).`;

export async function runGroqMcpAgent(
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  selectedModel?: string,
  activeContext?: Record<string, any>
): Promise<AgentChatResponse> {
  const llmSettings = llmConfigManager.getEffectiveSettings();
  const requestedModel = selectedModel || llmSettings.model;
  const model =
    llmSettings.baseUrl || VALID_GROQ_MODELS.has(requestedModel)
      ? requestedModel
      : "openai/gpt-oss-120b";

  // Spin up an authentic MCP Client <-> MCP Server transport session
  const mcpServer = createAciMcpServer();
  const mcpClient = new Client(
    { name: "groq-aci-mcp-client", version: "1.0.0" },
    { capabilities: {} }
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    mcpServer.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);

  const toolTraces: McpToolTrace[] = [];
  let latestRemediation: RemediationArtifact | undefined;

  try {
    const groq = new Groq({
      apiKey: llmSettings.apiKey,
      ...(llmSettings.baseUrl ? { baseURL: llmSettings.baseUrl } : {}),
    });

    const groqTools: Groq.Chat.Completions.ChatCompletionTool[] =
      ACI_MCP_TOOLS.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));

    const contextNote = activeContext
      ? `\n\n[Currently Selected UI Context]: ${JSON.stringify(activeContext)}`
      : "";

    const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT + contextNote },
      ...history.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: userMessage },
    ];

    // First Groq inference pass
    const firstPass = await groq.chat.completions.create({
      model,
      messages,
      tools: groqTools,
      tool_choice: "auto",
      temperature: 0.2,
      max_tokens: 2048,
    });

    const assistantMsg = firstPass.choices[0]?.message;
    if (!assistantMsg) {
      throw new Error("LLM returned an empty response");
    }

    messages.push(assistantMsg);

    // Execute any requested MCP tool calls over the MCP client session
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (const toolCall of assistantMsg.tool_calls) {
        const fnName = toolCall.function.name;
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {};
        } catch {
          parsedArgs = {};
        }

        for (const k of Object.keys(parsedArgs)) {
          if (parsedArgs[k] === null) {
            delete parsedArgs[k];
          }
        }

        const t0 = performance.now();
        const mcpRes = await mcpClient.callTool({
          name: fnName,
          arguments: parsedArgs,
        });
        const durationMs = Math.round(performance.now() - t0);

        const rawText =
          (mcpRes.content as any[])?.[0]?.text || JSON.stringify(mcpRes);

        if (fnName === "generate_gitops_remediation") {
          try {
            latestRemediation = JSON.parse(rawText);
          } catch {
            // ignore parse errors
          }
        }

        toolTraces.push({
          toolName: fnName,
          args: parsedArgs,
          resultPreview:
            rawText.length > 600 ? rawText.slice(0, 600) + "..." : rawText,
          durationMs,
        });

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: rawText,
        });
      }

      // Second Groq pass to synthesize final architectural analysis
      const secondPass = await groq.chat.completions.create({
        model,
        messages,
        temperature: 0.2,
        max_tokens: 2048,
      });

      const finalReply =
        secondPass.choices[0]?.message?.content ||
        "Completed MCP tool execution.";

      return {
        reply: finalReply,
        model,
        toolTraces,
        remediation: latestRemediation,
      };
    }

    return {
      reply: assistantMsg.content || "No action required.",
      model,
      toolTraces,
      remediation: latestRemediation,
    };
  } catch (err: any) {
    return {
      reply: `### LLM API Notice\n\nEncountered error while calling model \`${model}\`: \`${err?.message || String(err)}\`. You can update your **LLM API Key** in **Settings**.`,
      model,
      toolTraces,
    };
  } finally {
    await mcpClient.close();
    await mcpServer.close();
  }
}

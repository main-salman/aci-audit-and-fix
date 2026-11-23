import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAciMcpServer } from "./server";

async function main() {
  const server = createAciMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Cisco ACI GitOps MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error in MCP stdio server:", err);
  process.exit(1);
});

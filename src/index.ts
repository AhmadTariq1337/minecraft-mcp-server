#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerConnectionTools } from "./tools/connection.js";
import { registerPerceptionTools } from "./tools/perception.js";
import { registerBuildingTools } from "./tools/building.js";
import { registerInteractionTools } from "./tools/interaction.js";
import { registerMovementTools } from "./tools/movement.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerCombatTools } from "./tools/combat.js";
import { registerFarmingTools } from "./tools/farming.js";
import { registerWorldTools } from "./tools/world.js";
import { registerSocialTools } from "./tools/social.js";
import { registerMiscTools } from "./tools/misc.js";

const server = new McpServer({
  name: "minecraft-mcp-server",
  version: "1.0.0",
});

registerConnectionTools(server);
registerPerceptionTools(server);
registerBuildingTools(server);
registerInteractionTools(server);
registerMovementTools(server);
registerInventoryTools(server);
registerCombatTools(server);
registerFarmingTools(server);
registerWorldTools(server);
registerSocialTools(server);
registerMiscTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("minecraft-mcp-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting minecraft-mcp-server:", error);
  process.exit(1);
});

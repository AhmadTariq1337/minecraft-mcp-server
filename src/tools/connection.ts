import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { connectBot, disconnectBot, getState, requireBot } from "../bot.js";
import { DEFAULT_PORT } from "../constants.js";

function textResult(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

export function registerConnectionTools(server: McpServer): void {
  server.registerTool(
    "minecraft_connect",
    {
      title: "Connect to Minecraft World",
      description: `Connects the bot to a running Minecraft Java Edition world (server, LAN world, or local server jar).

For TLauncher: TLauncher accounts are typically NOT Microsoft-authenticated, so use auth="offline" (this is also correct for cracked/offline-mode servers and singleplayer worlds opened via "Open to LAN"). Use auth="microsoft" only for a real Mojang/Microsoft account joining an online-mode server.

To connect to your own singleplayer world: open the world in Minecraft, press Escape -> "Open to LAN", note the port shown in chat, then call this tool with host="localhost" (or "127.0.0.1") and that port.

Must be called before any other minecraft_* tool.

Returns: { message: string } confirming connection and spawn position.
Errors: connection refused, wrong port, version mismatch, or auth-mode mismatch (offline bot hitting an online-mode server, or vice versa).`,
      inputSchema: {
        host: z.string().min(1).describe('Server address, e.g. "localhost" or an IP/domain'),
        port: z.number().int().min(1).max(65535).default(DEFAULT_PORT).describe("Server port (default 25565)"),
        username: z.string().min(3).max(16).describe("Bot's in-game username (offline mode: any valid name)"),
        version: z
          .string()
          .optional()
          .describe('Minecraft protocol version, e.g. "1.20.4". Omit to auto-detect.'),
        auth: z
          .enum(["offline", "microsoft"])
          .default("offline")
          .describe('"offline" for TLauncher / cracked servers / LAN worlds (default). "microsoft" for a real Mojang account.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ host, port, username, version, auth }) => {
      try {
        const result = await connectBot({ host, port, username, version, auth });
        return textResult(result);
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "minecraft_disconnect",
    {
      title: "Disconnect from Minecraft World",
      description: "Cleanly disconnects the bot from the current world/server. Safe to call even if not connected.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      const result = await disconnectBot();
      return textResult(result);
    }
  );

  server.registerTool(
    "minecraft_status",
    {
      title: "Get Bot & World Status",
      description: `Returns the bot's current health, hunger, position, gamemode, dimension, in-game time, weather, XP, and who else is online.

Returns:
{
  connected: boolean,
  username: string,
  health: number (0-20),
  food: number (0-20),
  position: { x, y, z },
  yaw: number, pitch: number,
  gameMode: string,
  dimension: string,
  isDay: boolean, isRaining: boolean,
  experienceLevel: number,
  heldItem: string | null,
  onlinePlayers: string[]
}

Call minecraft_connect first if this returns connected: false.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      const state = getState();
      if (!state.connected || !state.bot) {
        return textResult({
          connected: false,
          lastError: state.lastError,
          hint: "Call minecraft_connect first.",
        });
      }
      const bot = requireBot();
      const pos = bot.entity.position;
      return textResult({
        connected: true,
        username: bot.username,
        health: bot.health,
        food: bot.food,
        position: { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100, z: Math.round(pos.z * 100) / 100 },
        yaw: Math.round((bot.entity.yaw * 180) / Math.PI),
        pitch: Math.round((bot.entity.pitch * 180) / Math.PI),
        gameMode: bot.game?.gameMode ?? "unknown",
        dimension: bot.game?.dimension ?? "unknown",
        isDay: bot.time?.isDay ?? null,
        isRaining: bot.isRaining ?? false,
        experienceLevel: bot.experience?.level ?? 0,
        heldItem: bot.heldItem?.name ?? null,
        onlinePlayers: Object.keys(bot.players).filter((p) => p !== bot.username),
      });
    }
  );
}

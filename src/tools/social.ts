import { z } from "zod";
import type { Bot, Villager } from "mineflayer";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pathfinderPkg from "mineflayer-pathfinder";
import { requireBot } from "../bot.js";

const { goals } = pathfinderPkg;

function textResult(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(err: unknown) {
  return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
}

async function ensureWithinReach(bot: Bot, target: { x: number; y: number; z: number }, reach: number): Promise<void> {
  const dx = bot.entity.position.x - target.x;
  const dy = bot.entity.position.y - target.y;
  const dz = bot.entity.position.z - target.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > reach) {
    await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, Math.max(1, Math.floor(reach - 1))));
  }
}

export function registerSocialTools(server: McpServer): void {
  server.registerTool(
    "minecraft_whisper",
    {
      title: "Whisper / Direct Message Player",
      description: "Sends a private message to a specific player, visible only to them (uses the server's /msg or /tell equivalent).\n\nReturns: { message: string }",
      inputSchema: {
        username: z.string().min(1),
        message: z.string().min(1).max(256),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ username, message }) => {
      try {
        const bot = requireBot();
        bot.whisper(username, message);
        return textResult({ message: `Whispered to "${username}": "${message}"` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_list_players",
    {
      title: "List Online Players",
      description: "Lists every player currently online, with ping and gamemode.\n\nReturns: { count, players: [{ username, ping, gamemode }] }",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const bot = requireBot();
        const players = Object.values(bot.players).map((p) => ({
          username: p.username,
          ping: p.ping,
          gamemode: p.gamemode,
        }));
        return textResult({ count: players.length, players });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_open_villager",
    {
      title: "Open Villager Trades",
      description: `Walks to and opens trade with a villager (by entity id from minecraft_get_nearby_entities, or the nearest one), and lists its available trades. Stays open until minecraft_close_container is called — use minecraft_trade to execute a trade.

Returns: { message, trades: [{ index, give: string[], receive: string, usesLeft, disabled }] }
Errors: no villager nearby/found.`,
      inputSchema: {
        entity_id: z.number().int().optional().describe("Entity id from minecraft_get_nearby_entities. Omit for nearest villager."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ entity_id }) => {
      try {
        const bot = requireBot();
        let target = entity_id !== undefined ? bot.entities[entity_id] : undefined;
        if (!target) {
          const botPos = bot.entity.position;
          target = Object.values(bot.entities)
            .filter((e) => e && e.name === "villager")
            .sort((a, b) => a.position.distanceTo(botPos) - b.position.distanceTo(botPos))[0];
        }
        if (!target) {
          throw new Error(entity_id !== undefined ? `No entity with id ${entity_id} nearby.` : "No villager found nearby.");
        }
        await ensureWithinReach(bot, target.position, 3);
        const villager = await bot.openVillager(target);
        const trades = villager.trades.map((t, index) => ({
          index,
          give: [t.inputItem1?.name, t.hasItem2 ? t.inputItem2?.name : null].filter((n): n is string => Boolean(n)),
          receive: t.outputItem?.name ?? "unknown",
          usesLeft: t.maximumNbTradeUses - t.nbTradeUses,
          disabled: t.tradeDisabled,
        }));
        return textResult({
          message: `Opened villager trades (${trades.length} available). Use minecraft_trade with a trade index, then minecraft_close_container when done.`,
          trades,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_trade",
    {
      title: "Execute Villager Trade",
      description: `Executes a trade on the currently open villager (call minecraft_open_villager first) by trade index.

Returns: { message }
Errors: no villager open, invalid trade index, trade disabled, or missing required items.`,
      inputSchema: {
        trade_index: z.number().int().min(0),
        times: z.number().int().min(1).max(64).default(1).describe("How many times to repeat the trade."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ trade_index, times }) => {
      try {
        const bot = requireBot();
        const win = bot.currentWindow;
        if (!win || !("trades" in win)) {
          throw new Error("No villager open. Call minecraft_open_villager first.");
        }
        await bot.trade(win as Villager, trade_index, times);
        return textResult({ message: `Executed trade index ${trade_index} x${times}.` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}

import { z } from "zod";
import type { Bot } from "mineflayer";
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

const RIDEABLE_NAMES = new Set(["boat", "chest_boat", "minecart", "chest_minecart", "horse", "donkey", "mule", "pig", "strider", "camel"]);

export function registerMiscTools(server: McpServer): void {
  server.registerTool(
    "minecraft_mount",
    {
      title: "Mount Entity",
      description: `Mounts a rideable entity — boat, minecart, horse, donkey, mule, pig (with saddle), strider, or camel — by entity id (from minecraft_get_nearby_entities) or the nearest rideable one. Walks within reach first.

Returns: { message }
Errors: no rideable entity found nearby.`,
      inputSchema: {
        entity_id: z.number().int().optional().describe("Entity id from minecraft_get_nearby_entities. Omit for nearest rideable entity."),
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
            .filter((e) => e && RIDEABLE_NAMES.has(e.name ?? ""))
            .sort((a, b) => a.position.distanceTo(botPos) - b.position.distanceTo(botPos))[0];
        }
        if (!target) {
          throw new Error(
            entity_id !== undefined
              ? `No entity with id ${entity_id} nearby.`
              : "No rideable entity (boat/minecart/horse/etc) found nearby."
          );
        }
        await ensureWithinReach(bot, target.position, 3);
        bot.mount(target);
        return textResult({ message: `Mounted "${target.name ?? target.type}".` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_dismount",
    {
      title: "Dismount",
      description: "Dismounts whatever entity/vehicle the bot is currently riding. Safe to call even if not mounted.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const bot = requireBot();
        bot.dismount();
        return textResult({ message: "Dismounted." });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_respawn",
    {
      title: "Respawn After Death",
      description: "Respawns the bot at its spawn point/bed after dying. Only needed if the server's auto-respawn is disabled — check minecraft_status for health 0 first.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const bot = requireBot();
        bot.respawn();
        return textResult({ message: "Respawn requested." });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_wait",
    {
      title: "Wait",
      description: "Pauses for a number of seconds — useful for letting things settle (smelting, mob spawning, water flowing) between other tool calls.",
      inputSchema: { seconds: z.number().min(0.1).max(60) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ seconds }) => {
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return textResult({ message: `Waited ${seconds}s.` });
    }
  );
}

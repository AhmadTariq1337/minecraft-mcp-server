import { z } from "zod";
import { Vec3 } from "vec3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireBot } from "../bot.js";
import { MAX_ENTITY_RADIUS, MAX_SCAN_RADIUS, MAX_SCAN_RESULTS } from "../constants.js";
import type { SimpleBlock, SimpleEntity } from "../types.js";

function textResult(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(err: unknown) {
  return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
}

const AIR_NAMES = new Set(["air", "cave_air", "void_air"]);

export function registerPerceptionTools(server: McpServer): void {
  server.registerTool(
    "minecraft_get_position",
    {
      title: "Get Bot Position",
      description: `Returns the bot's exact current coordinates, facing direction, and which block it's standing on/in.

Returns: { x, y, z, yaw, pitch, standingOn: string, dimension: string }`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const bot = requireBot();
        const pos = bot.entity.position;
        const below = bot.blockAt(pos.offset(0, -1, 0));
        return textResult({
          x: Math.round(pos.x * 100) / 100,
          y: Math.round(pos.y * 100) / 100,
          z: Math.round(pos.z * 100) / 100,
          yaw: Math.round((bot.entity.yaw * 180) / Math.PI),
          pitch: Math.round((bot.entity.pitch * 180) / Math.PI),
          standingOn: below?.name ?? "unknown",
          dimension: bot.game?.dimension ?? "unknown",
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_get_nearby_blocks",
    {
      title: "View Nearby Blocks",
      description: `Scans the world around the bot and lists non-air blocks it can see, closest first. This is the bot's "eyes" for terrain/structures — use it before building or navigating.

Args:
  - radius (number, 1-${MAX_SCAN_RADIUS}): how far to scan, in blocks (default 8)
  - block_names (string[], optional): only return blocks matching these exact Minecraft block ids (e.g. ["oak_log", "stone", "chest"]). Omit to return all non-air blocks.

Returns: { count: number, blocks: [{ x, y, z, name }] } capped at ${MAX_SCAN_RESULTS} results.`,
      inputSchema: {
        radius: z.number().int().min(1).max(MAX_SCAN_RADIUS).default(8),
        block_names: z.array(z.string()).optional().describe("Exact block id filter, e.g. ['diamond_ore']"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ radius, block_names }) => {
      try {
        const bot = requireBot();
        const filterSet = block_names && block_names.length ? new Set(block_names) : null;

        const positions = bot.findBlocks({
          point: bot.entity.position,
          maxDistance: radius,
          count: MAX_SCAN_RESULTS,
          matching: (block) => {
            if (!block) return false;
            if (filterSet) return filterSet.has(block.name);
            return !AIR_NAMES.has(block.name);
          },
        });

        const botPos = bot.entity.position;
        const blocks: SimpleBlock[] = positions
          .map((p) => {
            const block = bot.blockAt(p);
            return block ? { x: p.x, y: p.y, z: p.z, name: block.name } : null;
          })
          .filter((b): b is SimpleBlock => b !== null)
          .sort((a, b) => {
            const da = (a.x - botPos.x) ** 2 + (a.y - botPos.y) ** 2 + (a.z - botPos.z) ** 2;
            const db = (b.x - botPos.x) ** 2 + (b.y - botPos.y) ** 2 + (b.z - botPos.z) ** 2;
            return da - db;
          });

        return textResult({ count: blocks.length, blocks });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_get_block_at",
    {
      title: "Inspect Block At Coordinates",
      description: `Looks up a single block at exact world coordinates.

Returns: { x, y, z, name, hardness: number | null, diggable: boolean } or an error if the chunk isn't loaded.`,
      inputSchema: {
        x: z.number().describe("World X coordinate"),
        y: z.number().describe("World Y coordinate"),
        z: z.number().describe("World Z coordinate"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ x, y, z }) => {
      try {
        const bot = requireBot();
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) {
          return textResult({ x, y, z, name: null, error: "Chunk not loaded at this position." });
        }
        return textResult({
          x,
          y,
          z,
          name: block.name,
          hardness: block.hardness ?? null,
          diggable: block.diggable ?? false,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_find_block",
    {
      title: "Find Nearest Block",
      description: `Searches outward from the bot for the nearest block(s) matching a given block name — useful for "find me some water" / "find diamond ore" before navigating or mining.

Returns: { found: boolean, count: number, blocks: [{ x, y, z, name, distance }] }`,
      inputSchema: {
        block_name: z.string().min(1).describe('Exact block id, e.g. "oak_log", "water", "diamond_ore"'),
        max_distance: z.number().int().min(1).max(MAX_SCAN_RADIUS).default(16),
        count: z.number().int().min(1).max(50).default(1).describe("How many matches to return"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ block_name, max_distance, count }) => {
      try {
        const bot = requireBot();
        const positions = bot.findBlocks({
          point: bot.entity.position,
          maxDistance: max_distance,
          count,
          matching: (block) => block?.name === block_name,
        });
        const botPos = bot.entity.position;
        const blocks = positions.map((p) => ({
          x: p.x,
          y: p.y,
          z: p.z,
          name: block_name,
          distance: Math.round(p.distanceTo(botPos) * 100) / 100,
        }));
        return textResult({ found: blocks.length > 0, count: blocks.length, blocks });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_get_nearby_entities",
    {
      title: "View Nearby Entities",
      description: `Lists players, mobs, and other entities near the bot, closest first — the bot's awareness of who/what is around it.

Args:
  - radius (number, 1-${MAX_ENTITY_RADIUS}): search radius in blocks (default 16)
  - type_filter (string, optional): one of "player", "hostile", "mob" (non-hostile mobs/animals), "all" (default "all")

Returns: { count: number, entities: [{ id, type, name, username?, x, y, z, distance }] }`,
      inputSchema: {
        radius: z.number().int().min(1).max(MAX_ENTITY_RADIUS).default(16),
        type_filter: z.enum(["player", "hostile", "mob", "all"]).default("all"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ radius, type_filter }) => {
      try {
        const bot = requireBot();
        const botPos = bot.entity.position;
        const entities: SimpleEntity[] = Object.values(bot.entities)
          .filter((e) => e && e !== bot.entity)
          .map((e) => ({
            id: e.id,
            type: e.type,
            name: e.name ?? e.displayName ?? e.type,
            username: e.username,
            x: Math.round(e.position.x * 10) / 10,
            y: Math.round(e.position.y * 10) / 10,
            z: Math.round(e.position.z * 10) / 10,
            distance: Math.round(e.position.distanceTo(botPos) * 100) / 100,
          }))
          .filter((e) => e.distance <= radius)
          .filter((e) => {
            if (type_filter === "all") return true;
            if (type_filter === "player") return e.type === "player";
            if (type_filter === "hostile") return e.type === "hostile";
            if (type_filter === "mob") return e.type === "mob";
            return true;
          })
          .sort((a, b) => a.distance - b.distance);

        return textResult({ count: entities.length, entities });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_get_inventory",
    {
      title: "View Bot Inventory",
      description: `Returns everything the bot is carrying: hotbar/inventory items, currently held item, and worn armor.

Returns:
{
  items: [{ slot, name, count, displayName }],
  heldItem: string | null,
  armor: { head, torso, legs, feet } (each string | null)
}`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const bot = requireBot();
        const items = bot.inventory.items().map((it) => ({
          slot: it.slot,
          name: it.name,
          count: it.count,
          displayName: it.displayName,
        }));
        const slots = bot.inventory.slots;
        // Standard mineflayer armor slot indices: 5 head, 6 torso, 7 legs, 8 feet
        const armor = {
          head: slots[5]?.name ?? null,
          torso: slots[6]?.name ?? null,
          legs: slots[7]?.name ?? null,
          feet: slots[8]?.name ?? null,
        };
        return textResult({ items, heldItem: bot.heldItem?.name ?? null, armor });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}

import { z } from "zod";
import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pathfinderPkg from "mineflayer-pathfinder";
import { requireBot } from "../bot.js";
import { MAX_BUILD_BLOCKS, PLACE_REACH } from "../constants.js";

const { goals } = pathfinderPkg;

function textResult(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(err: unknown) {
  return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
}

const NEIGHBOR_FACES: Vec3[] = [
  new Vec3(0, -1, 0),
  new Vec3(0, 1, 0),
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
];

async function ensureWithinReach(bot: Bot, target: Vec3, reach: number): Promise<void> {
  if (bot.entity.position.distanceTo(target) > reach) {
    await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, Math.max(1, Math.floor(reach - 1))));
  }
}

/**
 * Places `blockName` at `target`, walking within reach first and finding
 * a solid neighboring block to place against. Throws with an actionable
 * message on failure rather than a raw mineflayer stack trace.
 */
async function placeBlockAt(bot: Bot, target: Vec3, blockName: string): Promise<void> {
  const existing = bot.blockAt(target);
  if (existing && existing.name === blockName) {
    return; // already correct, nothing to do
  }

  const item = bot.inventory.items().find((i) => i.name === blockName);
  if (!item) {
    throw new Error(`Not carrying any "${blockName}" to place. Check minecraft_get_inventory.`);
  }

  await ensureWithinReach(bot, target, PLACE_REACH);

  for (const face of NEIGHBOR_FACES) {
    const refPos = target.minus(face);
    const refBlock = bot.blockAt(refPos);
    if (refBlock && refBlock.boundingBox === "block") {
      await bot.equip(item, "hand");
      await bot.placeBlock(refBlock, face);
      return;
    }
  }

  throw new Error(`No solid block adjacent to (${target.x}, ${target.y}, ${target.z}) to place against.`);
}

export function registerBuildingTools(server: McpServer): void {
  server.registerTool(
    "minecraft_place_block",
    {
      title: "Place Block",
      description: `Places one block from the bot's inventory at the given world coordinates. Automatically walks within reach first and finds a solid neighboring block to place against. The target coordinates must currently be empty (air) and adjacent to at least one solid block — you can't place a block floating in mid-air.

Returns: { message: string }
Errors: item not in inventory, no solid neighbor to place against, or unreachable.`,
      inputSchema: {
        x: z.number(),
        y: z.number(),
        z: z.number(),
        block_name: z.string().min(1).describe('Exact block/item id in inventory, e.g. "oak_planks", "cobblestone", "torch"'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ x, y, z, block_name }) => {
      try {
        const bot = requireBot();
        await placeBlockAt(bot, new Vec3(x, y, z), block_name);
        return textResult({ message: `Placed "${block_name}" at (${x}, ${y}, ${z}).` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_dig_block",
    {
      title: "Dig / Break Block",
      description: `Mines/breaks the block at the given coordinates. Automatically walks within reach first. Drops fall to the ground — use minecraft_collect_block instead if you also want the bot to auto-pick-up the drops.

Returns: { message: string, block: string }
Errors: block not diggable (e.g. bedrock, air), unreachable, or missing required tool.`,
      inputSchema: { x: z.number(), y: z.number(), z: z.number() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ x, y, z }) => {
      try {
        const bot = requireBot();
        const target = new Vec3(x, y, z);
        const block = bot.blockAt(target);
        if (!block || block.name === "air") {
          return textResult({ message: `Nothing to dig at (${x}, ${y}, ${z}) — already air.`, block: block?.name ?? "air" });
        }
        if (!block.diggable) {
          throw new Error(`"${block.name}" at (${x}, ${y}, ${z}) is not diggable.`);
        }
        await ensureWithinReach(bot, target, 4.5);
        await bot.dig(block);
        return textResult({ message: `Dug "${block.name}" at (${x}, ${y}, ${z}).`, block: block.name });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_build_structure",
    {
      title: "Build Cuboid Structure",
      description: `Fills a cuboid region between two corner coordinates with a block from inventory — for walls, floors, platforms, boxes. Builds bottom-up so each block has something to rest against.

Args:
  - hollow (boolean): if true, only builds the outer shell (walls/floor/ceiling) instead of a solid block. Good for rooms.
  - Region is capped at ${MAX_BUILD_BLOCKS} blocks total; oversized requests are truncated.

Returns: { placed, skipped, failed, message }. Blocks that already match are skipped; blocks with no solid neighbor available yet are reported as failed rather than aborting the whole build.`,
      inputSchema: {
        x1: z.number(),
        y1: z.number(),
        z1: z.number(),
        x2: z.number(),
        y2: z.number(),
        z2: z.number(),
        block_name: z.string().min(1).describe('Exact block/item id in inventory, e.g. "cobblestone"'),
        hollow: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ x1, y1, z1, x2, y2, z2, block_name, hollow }) => {
      try {
        const bot = requireBot();
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);

        const coords: Vec3[] = [];
        outer: for (let y = minY; y <= maxY; y++) {
          for (let z = minZ; z <= maxZ; z++) {
            for (let x = minX; x <= maxX; x++) {
              const onShell = x === minX || x === maxX || y === minY || y === maxY || z === minZ || z === maxZ;
              if (!hollow || onShell) coords.push(new Vec3(x, y, z));
              if (coords.length >= MAX_BUILD_BLOCKS) break outer;
            }
          }
        }

        let placed = 0;
        let skipped = 0;
        let failed = 0;
        for (const pos of coords) {
          try {
            const existing = bot.blockAt(pos);
            if (existing && existing.name === block_name) {
              skipped++;
              continue;
            }
            await placeBlockAt(bot, pos, block_name);
            placed++;
          } catch {
            failed++;
          }
        }

        const requestedCount = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
        const truncated = requestedCount > MAX_BUILD_BLOCKS;

        return textResult({
          placed,
          skipped,
          failed,
          message: `Build finished: ${placed} placed, ${skipped} already correct, ${failed} failed (no reference block yet / out of material).${
            truncated ? ` Region truncated to ${MAX_BUILD_BLOCKS} blocks.` : ""
          }`,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_clear_area",
    {
      title: "Clear / Dig Out Area",
      description: `Digs out (breaks) every non-air, diggable block in a cuboid region between two corners — for clearing land or hollowing out a room. Digs top-down.

Region is capped at ${MAX_BUILD_BLOCKS} blocks total.

Returns: { dug: number, skipped: number, message: string }`,
      inputSchema: {
        x1: z.number(),
        y1: z.number(),
        z1: z.number(),
        x2: z.number(),
        y2: z.number(),
        z2: z.number(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ x1, y1, z1, x2, y2, z2 }) => {
      try {
        const bot = requireBot();
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);

        const coords: Vec3[] = [];
        outer: for (let y = maxY; y >= minY; y--) {
          for (let z = minZ; z <= maxZ; z++) {
            for (let x = minX; x <= maxX; x++) {
              coords.push(new Vec3(x, y, z));
              if (coords.length >= MAX_BUILD_BLOCKS) break outer;
            }
          }
        }

        let dug = 0;
        let skipped = 0;
        for (const pos of coords) {
          const block = bot.blockAt(pos);
          if (!block || block.name === "air" || !block.diggable) {
            skipped++;
            continue;
          }
          await ensureWithinReach(bot, pos, 4.5);
          await bot.dig(block);
          dug++;
        }

        return textResult({ dug, skipped, message: `Cleared ${dug} blocks (${skipped} were already air/undiggable).` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}

import { z } from "zod";
import { Vec3 } from "vec3";
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

async function ensureWithinReach(bot: Bot, target: Vec3, reach: number): Promise<void> {
  if (bot.entity.position.distanceTo(target) > reach) {
    await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, Math.max(1, Math.floor(reach - 1))));
  }
}

const TILLABLE = new Set(["grass_block", "dirt", "dirt_path", "podzol", "coarse_dirt"]);

const CROP_MAX_AGE: Record<string, number> = {
  wheat: 7,
  carrots: 7,
  potatoes: 7,
  beetroots: 3,
  nether_wart: 3,
};

export function registerFarmingTools(server: McpServer): void {
  server.registerTool(
    "minecraft_till_soil",
    {
      title: "Till Soil Into Farmland",
      description: `Equips a hoe and tills the dirt/grass block at the given coordinates into farmland, ready for planting. Walks within reach first.

Returns: { message }
Errors: no hoe in inventory, block isn't tillable, or already farmland.`,
      inputSchema: { x: z.number(), y: z.number(), z: z.number() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ x, y, z }) => {
      try {
        const bot = requireBot();
        const pos = new Vec3(x, y, z);
        const block = bot.blockAt(pos);
        if (!block) {
          throw new Error(`Chunk not loaded at (${x}, ${y}, ${z}).`);
        }
        if (block.name === "farmland") {
          return textResult({ message: `Already farmland at (${x}, ${y}, ${z}).` });
        }
        if (!TILLABLE.has(block.name)) {
          throw new Error(`"${block.name}" can't be tilled — needs to be grass, dirt, podzol, or a dirt path.`);
        }
        const hoe = bot.inventory.items().find((i) => i.name.endsWith("_hoe"));
        if (!hoe) {
          throw new Error("No hoe in inventory.");
        }
        await ensureWithinReach(bot, pos, 4.5);
        await bot.equip(hoe, "hand");
        await bot.activateBlock(block);
        return textResult({ message: `Tilled (${x}, ${y}, ${z}) into farmland.` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_plant_seed",
    {
      title: "Plant Seed / Crop",
      description: `Plants a seed item on farmland at the given coordinates (till it first with minecraft_till_soil). Works for any plantable item: seeds, carrots, potatoes, beetroot_seeds, melon/pumpkin seeds, nether_wart (on soul sand).

Returns: { message }
Errors: target block isn't farmland/soul sand, space above is occupied, or seed not in inventory.`,
      inputSchema: {
        x: z.number(),
        y: z.number(),
        z: z.number(),
        seed_item: z.string().min(1).describe('e.g. "wheat_seeds", "carrot", "potato", "beetroot_seeds", "nether_wart"'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ x, y, z, seed_item }) => {
      try {
        const bot = requireBot();
        const pos = new Vec3(x, y, z);
        const base = bot.blockAt(pos);
        if (!base || (base.name !== "farmland" && base.name !== "soul_sand")) {
          throw new Error(`Block at (${x}, ${y}, ${z}) is "${base?.name ?? "unknown"}", not farmland/soul_sand. Till it first.`);
        }
        const above = bot.blockAt(pos.offset(0, 1, 0));
        if (above && above.name !== "air") {
          throw new Error(`Space above (${x}, ${y + 1}, ${z}) is occupied by "${above.name}".`);
        }
        const seed = bot.inventory.items().find((i) => i.name === seed_item);
        if (!seed) {
          throw new Error(`Not carrying any "${seed_item}".`);
        }
        await ensureWithinReach(bot, pos, 4.5);
        await bot.equip(seed, "hand");
        await bot.placeBlock(base, new Vec3(0, 1, 0));
        return textResult({ message: `Planted "${seed_item}" at (${x}, ${y + 1}, ${z}).` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_harvest_crop",
    {
      title: "Harvest Crop",
      description: `Breaks a fully-grown crop block at the given coordinates. For known crop types (wheat, carrots, potatoes, beetroots, nether_wart) this checks maturity first and refuses to harvest early unless force=true.

Returns: { message, block: string }
Errors: nothing there, crop not fully grown (unless force=true), or not diggable.`,
      inputSchema: {
        x: z.number(),
        y: z.number(),
        z: z.number(),
        force: z.boolean().default(false).describe("Harvest even if the crop isn't fully grown yet."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ x, y, z, force }) => {
      try {
        const bot = requireBot();
        const pos = new Vec3(x, y, z);
        const block = bot.blockAt(pos);
        if (!block || block.name === "air") {
          throw new Error(`Nothing to harvest at (${x}, ${y}, ${z}).`);
        }
        const maxAge = CROP_MAX_AGE[block.name];
        if (maxAge !== undefined && !force) {
          const props = block.getProperties();
          const age = Number(props.age ?? maxAge);
          if (age < maxAge) {
            throw new Error(`"${block.name}" isn't fully grown yet (age ${age}/${maxAge}). Pass force=true to harvest anyway.`);
          }
        }
        if (!block.diggable) {
          throw new Error(`"${block.name}" is not diggable.`);
        }
        await ensureWithinReach(bot, pos, 4.5);
        await bot.dig(block);
        return textResult({ message: `Harvested "${block.name}" at (${x}, ${y}, ${z}).`, block: block.name });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}

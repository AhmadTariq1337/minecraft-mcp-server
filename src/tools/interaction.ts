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

export function registerInteractionTools(server: McpServer): void {
  server.registerTool(
    "minecraft_chat",
    {
      title: "Send Chat Message",
      description:
        "Sends a message in in-game chat, visible to all players on the server. Also works for chat commands if the message starts with '/' and the bot has permission.",
      inputSchema: { message: z.string().min(1).max(256) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ message }) => {
      try {
        const bot = requireBot();
        bot.chat(message);
        return textResult({ message: `Sent: "${message}"` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_equip_item",
    {
      title: "Equip / Hold Item",
      description: `Equips an item from inventory to the bot's hand or an armor slot.

Returns: { message: string }
Errors: item not found in inventory.`,
      inputSchema: {
        item_name: z.string().min(1),
        destination: z.enum(["hand", "off-hand", "head", "torso", "legs", "feet"]).default("hand"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ item_name, destination }) => {
      try {
        const bot = requireBot();
        const item = bot.inventory.items().find((i) => i.name === item_name);
        if (!item) {
          throw new Error(`"${item_name}" not found in inventory.`);
        }
        await bot.equip(item, destination);
        return textResult({ message: `Equipped "${item_name}" to ${destination}.` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_toss_item",
    {
      title: "Drop Item",
      description: "Drops item(s) from inventory onto the ground in front of the bot.\n\nReturns: { message: string }",
      inputSchema: {
        item_name: z.string().min(1),
        count: z.number().int().min(1).max(64).optional().describe("Omit to drop the entire stack."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ item_name, count }) => {
      try {
        const bot = requireBot();
        const item = bot.inventory.items().find((i) => i.name === item_name);
        if (!item) {
          throw new Error(`"${item_name}" not found in inventory.`);
        }
        if (count) {
          await bot.toss(item.type, null, count);
        } else {
          await bot.tossStack(item);
        }
        return textResult({ message: `Dropped ${count ?? item.count}x "${item_name}".` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_craft_item",
    {
      title: "Craft Item",
      description: `Crafts an item using a recipe the bot currently has ingredients for. If the recipe needs a 3x3 grid, pass use_crafting_table=true and make sure a crafting table is within a few blocks (minecraft_find_block "crafting_table", or minecraft_place_block one first).

Returns: { message: string, crafted: string, count: number }
Errors: unknown item, no known recipe fits current inventory, or no crafting table in reach when one is required.`,
      inputSchema: {
        item_name: z.string().min(1).describe('Exact item id to craft, e.g. "stick", "wooden_pickaxe"'),
        count: z.number().int().min(1).max(64).default(1),
        use_crafting_table: z.boolean().default(false).describe("Set true for 3x3 recipes; requires a nearby crafting table."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ item_name, count, use_crafting_table }) => {
      try {
        const bot = requireBot();
        const itemData = bot.registry.itemsByName[item_name];
        if (!itemData) {
          throw new Error(`Unknown item id "${item_name}".`);
        }

        let craftingTable = null;
        if (use_crafting_table) {
          const tableBlockId = bot.registry.blocksByName["crafting_table"]?.id;
          if (tableBlockId === undefined) {
            throw new Error("crafting_table block not found in this version's registry.");
          }
          craftingTable = bot.findBlock({ matching: tableBlockId, maxDistance: 4 });
          if (!craftingTable) {
            throw new Error("No crafting table within reach. Place one with minecraft_place_block first.");
          }
        }

        const recipes = bot.recipesFor(itemData.id, null, 1, craftingTable);
        if (!recipes.length) {
          throw new Error(
            `No available recipe for "${item_name}" with current inventory${
              use_crafting_table ? "" : " (try use_crafting_table=true if this needs a 3x3 grid)"
            }.`
          );
        }

        await bot.craft(recipes[0], count, craftingTable ?? undefined);
        return textResult({ message: `Crafted ${count}x "${item_name}".`, crafted: item_name, count });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_attack_entity",
    {
      title: "Attack Entity",
      description: `Attacks a specific entity by id (from minecraft_get_nearby_entities), or the nearest hostile mob if no id is given. Swings the bot's currently equipped weapon once — call repeatedly for multiple hits.

Returns: { message: string, target: string }
Errors: entity not found / out of reach, or no hostile mobs nearby (when entity_id omitted).`,
      inputSchema: {
        entity_id: z.number().int().optional().describe("Entity id from minecraft_get_nearby_entities. Omit to attack nearest hostile mob."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ entity_id }) => {
      try {
        const bot = requireBot();
        let target = entity_id !== undefined ? bot.entities[entity_id] : undefined;
        if (!target) {
          const botPos = bot.entity.position;
          target = Object.values(bot.entities)
            .filter((e) => e && e.type === "hostile")
            .sort((a, b) => a.position.distanceTo(botPos) - b.position.distanceTo(botPos))[0];
        }
        if (!target) {
          throw new Error(entity_id !== undefined ? `No entity with id ${entity_id} nearby.` : "No hostile mobs nearby.");
        }
        await bot.attack(target);
        const label = target.name ?? target.username ?? target.type;
        return textResult({ message: `Attacked "${label}".`, target: label });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_activate_block",
    {
      title: "Use / Activate Block",
      description: `Right-clicks a block at the given coordinates — opens chests/doors/trapdoors/furnaces, presses buttons, pulls levers, opens the crafting-table UI, etc. Walks within reach first.

Returns: { message: string, block: string }
Errors: no block there, or unreachable.`,
      inputSchema: { x: z.number(), y: z.number(), z: z.number() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ x, y, z }) => {
      try {
        const bot = requireBot();
        const target = new Vec3(x, y, z);
        const block = bot.blockAt(target);
        if (!block || block.name === "air") {
          throw new Error(`No block at (${x}, ${y}, ${z}) to activate.`);
        }
        await ensureWithinReach(bot, target, 4.5);
        await bot.activateBlock(block);
        return textResult({ message: `Activated "${block.name}" at (${x}, ${y}, ${z}).`, block: block.name });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_eat",
    {
      title: "Eat Food",
      description: `Equips a food item from inventory and eats it to restore hunger.

Returns: { message: string }
Errors: item not found, item isn't food, or the bot can't eat right now (food already full).`,
      inputSchema: { item_name: z.string().min(1).describe('e.g. "cooked_beef", "bread", "apple"') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ item_name }) => {
      try {
        const bot = requireBot();
        const item = bot.inventory.items().find((i) => i.name === item_name);
        if (!item) {
          throw new Error(`"${item_name}" not found in inventory.`);
        }
        await bot.equip(item, "hand");
        await bot.consume();
        return textResult({ message: `Ate "${item_name}".` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_sleep",
    {
      title: "Sleep in Bed",
      description: `Finds the nearest bed (or one at given coordinates) and sleeps in it. Only works at night/during thunderstorms, and only if the bed is safe (no monsters nearby).

Returns: { message: string }
Errors: no bed found nearby, not night, monsters nearby, or bed occupied/unsafe.`,
      inputSchema: {
        x: z.number().optional(),
        y: z.number().optional(),
        z: z.number().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ x, y, z }) => {
      try {
        const bot = requireBot();
        let bedBlock;
        if (x !== undefined && y !== undefined && z !== undefined) {
          bedBlock = bot.blockAt(new Vec3(x, y, z));
        } else {
          bedBlock = bot.findBlock({
            matching: (block) => Boolean(block?.name?.endsWith("_bed")),
            maxDistance: 16,
          });
        }
        if (!bedBlock) {
          throw new Error("No bed found nearby. Craft/place one first, or pass coordinates.");
        }
        await ensureWithinReach(bot, bedBlock.position, 4.5);
        await bot.sleep(bedBlock);
        return textResult({
          message: `Sleeping in bed at (${bedBlock.position.x}, ${bedBlock.position.y}, ${bedBlock.position.z}).`,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_collect_block",
    {
      title: "Collect Blocks (Mine + Pick Up)",
      description: `Finds the nearest matching block(s), mines them, and automatically walks over to pick up the drops — more convenient than minecraft_dig_block when you actually want the item in inventory (e.g. "get me some wood").

Returns: { message: string, requested: number }
Errors: no matching blocks within range, or a dig/pickup failure partway through.`,
      inputSchema: {
        block_name: z.string().min(1).describe('e.g. "oak_log", "stone", "dirt"'),
        count: z.number().int().min(1).max(64).default(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ block_name, count }) => {
      try {
        const bot = requireBot();
        const positions = bot.findBlocks({
          point: bot.entity.position,
          maxDistance: 32,
          count,
          matching: (block) => block?.name === block_name,
        });
        if (!positions.length) {
          throw new Error(`No "${block_name}" found within range.`);
        }
        const blocks = positions.map((p) => bot.blockAt(p)).filter((b): b is NonNullable<typeof b> => b !== null);
        await bot.collectBlock.collect(blocks);
        return textResult({ message: `Collected up to ${blocks.length}x "${block_name}".`, requested: count });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}

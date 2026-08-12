import { z } from "zod";
import { Vec3 } from "vec3";
import prismarineItemLoader from "prismarine-item";
import type { Item as PrismarineItem } from "prismarine-item";
import type { Bot, Chest, Dispenser } from "mineflayer";
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

// prismarine-item's shipped .d.ts declares `export default function loader(...)`,
// but the package is plain CommonJS (module.exports = loader, no .default property).
// Under moduleResolution "NodeNext" this mistypes the import as the whole module
// namespace instead of the function. It's correctly callable at runtime (Node's
// native ESM/CJS interop resolves the default to module.exports itself) — this
// just restores the accurate type once, here, instead of casting at every call site.
const loadItem = prismarineItemLoader as unknown as (version: string | object) => typeof PrismarineItem;

async function ensureWithinReach(bot: Bot, target: Vec3, reach: number): Promise<void> {
  if (bot.entity.position.distanceTo(target) > reach) {
    await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, Math.max(1, Math.floor(reach - 1))));
  }
}

export function registerInventoryTools(server: McpServer): void {
  server.registerTool(
    "minecraft_open_container",
    {
      title: "Open Container",
      description: `Opens a chest, trapped chest, barrel, shulker box, dispenser, or dropper at the given coordinates and lists its contents. Walks within reach first. The container stays open until minecraft_close_container is called — minecraft_container_deposit/withdraw act on whatever is currently open.

Returns: { message, containerType: string, items: [{ slot, name, count }] }
Errors: no container block there, or unreachable.`,
      inputSchema: { x: z.number(), y: z.number(), z: z.number() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ x, y, z }) => {
      try {
        const bot = requireBot();
        const target = new Vec3(x, y, z);
        const block = bot.blockAt(target);
        if (!block || block.name === "air") {
          throw new Error(`No container block at (${x}, ${y}, ${z}).`);
        }
        await ensureWithinReach(bot, target, 4.5);
        const win = await bot.openContainer(block);
        const items = win.containerItems().map((it) => ({ slot: it.slot, name: it.name, count: it.count }));
        return textResult({ message: `Opened "${block.name}" at (${x}, ${y}, ${z}).`, containerType: block.name, items });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_container_deposit",
    {
      title: "Deposit Item Into Container",
      description: `Moves an item from the bot's inventory into the currently open container. Call minecraft_open_container first.

Returns: { message }
Errors: no container open, or item not carried.`,
      inputSchema: {
        item_name: z.string().min(1),
        count: z.number().int().min(1).max(64).optional().describe("Omit to deposit the entire carried stack."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ item_name, count }) => {
      try {
        const bot = requireBot();
        const win = bot.currentWindow;
        if (!win || !("deposit" in win)) {
          throw new Error("No container open. Call minecraft_open_container first.");
        }
        const itemData = bot.registry.itemsByName[item_name];
        if (!itemData) {
          throw new Error(`Unknown item id "${item_name}".`);
        }
        const held = bot.inventory.items().find((i) => i.name === item_name);
        const amount = count ?? held?.count;
        if (!amount) {
          throw new Error(`Not carrying any "${item_name}".`);
        }
        await (win as Chest | Dispenser).deposit(itemData.id, null, amount);
        return textResult({ message: `Deposited ${amount}x "${item_name}".` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_container_withdraw",
    {
      title: "Withdraw Item From Container",
      description: `Moves an item from the currently open container into the bot's inventory. Call minecraft_open_container first.

Returns: { message }
Errors: no container open, or item not present in the container.`,
      inputSchema: {
        item_name: z.string().min(1),
        count: z.number().int().min(1).max(64).optional().describe("Omit to withdraw the entire stack found."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ item_name, count }) => {
      try {
        const bot = requireBot();
        const win = bot.currentWindow;
        if (!win || !("withdraw" in win)) {
          throw new Error("No container open. Call minecraft_open_container first.");
        }
        const itemData = bot.registry.itemsByName[item_name];
        if (!itemData) {
          throw new Error(`Unknown item id "${item_name}".`);
        }
        const inContainer = win.containerItems().find((i) => i.name === item_name);
        const amount = count ?? inContainer?.count;
        if (!amount) {
          throw new Error(`"${item_name}" not found in the open container.`);
        }
        await (win as Chest | Dispenser).withdraw(itemData.id, null, amount);
        return textResult({ message: `Withdrew ${amount}x "${item_name}".` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_close_container",
    {
      title: "Close Container / UI",
      description:
        "Closes whatever container, furnace, or villager-trade UI is currently open. Safe to call even if nothing is open.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const bot = requireBot();
        if (bot.currentWindow) {
          bot.closeWindow(bot.currentWindow);
        }
        return textResult({ message: "Closed." });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_use_furnace",
    {
      title: "Smelt / Cook Item in Furnace",
      description: `Opens a furnace (or blast furnace / smoker) at the given coordinates, loads input material and fuel from the bot's inventory, waits for smelting to progress, then collects whatever output is ready and closes the furnace. One call handles the whole loop.

Args:
  - input_item: material to smelt, e.g. "raw_iron", "raw_beef", "sand"
  - fuel_item: fuel to burn, e.g. "coal", "oak_planks". Omit if the furnace already has fuel loaded.
  - count: how many items to smelt (default 1)
  - wait_seconds: how long to wait before collecting output (default 12; vanilla smelting is ~10s/item with normal fuel). Call again to collect more once it's finished.

Returns: { message, collected: number, itemName: string | null }
Errors: no furnace there, missing input/fuel in inventory, or unreachable.`,
      inputSchema: {
        x: z.number(),
        y: z.number(),
        z: z.number(),
        input_item: z.string().min(1),
        fuel_item: z.string().optional(),
        count: z.number().int().min(1).max(64).default(1),
        wait_seconds: z.number().min(1).max(120).default(12),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ x, y, z, input_item, fuel_item, count, wait_seconds }) => {
      try {
        const bot = requireBot();
        const target = new Vec3(x, y, z);
        const block = bot.blockAt(target);
        if (!block || block.name === "air") {
          throw new Error(`No furnace at (${x}, ${y}, ${z}).`);
        }
        await ensureWithinReach(bot, target, 4.5);
        const furnace = await bot.openFurnace(block);

        try {
          const inputData = bot.registry.itemsByName[input_item];
          if (!inputData) {
            throw new Error(`Unknown item id "${input_item}".`);
          }
          const heldInput = bot.inventory.items().find((i) => i.name === input_item);
          if (!heldInput || heldInput.count < count) {
            throw new Error(`Not carrying ${count}x "${input_item}".`);
          }
          await furnace.putInput(inputData.id, null, count);

          if (fuel_item) {
            const fuelData = bot.registry.itemsByName[fuel_item];
            if (!fuelData) {
              throw new Error(`Unknown item id "${fuel_item}".`);
            }
            const heldFuel = bot.inventory.items().find((i) => i.name === fuel_item);
            if (!heldFuel) {
              throw new Error(`Not carrying any "${fuel_item}".`);
            }
            await furnace.putFuel(fuelData.id, null, Math.min(heldFuel.count, count));
          }

          await new Promise((resolve) => setTimeout(resolve, wait_seconds * 1000));

          let collected = 0;
          let itemName: string | null = null;
          try {
            const out = await furnace.takeOutput();
            collected = out.count;
            itemName = out.name;
          } catch {
            // nothing finished cooking yet
          }

          return textResult({
            message: collected
              ? `Collected ${collected}x "${itemName}" from the furnace.`
              : "No output ready yet — call minecraft_use_furnace again (with a longer wait_seconds, or omitting input/fuel) to keep collecting.",
            collected,
            itemName,
          });
        } finally {
          furnace.close();
        }
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_give_item",
    {
      title: "Give Item (Creative Mode)",
      description: `Spawns an item stack directly into the bot's inventory. Only works while the bot is in creative gamemode.

Returns: { message }
Errors: bot not in creative mode, unknown item id, or inventory full.`,
      inputSchema: {
        item_name: z.string().min(1).describe('Exact item id, e.g. "diamond_block", "oak_planks"'),
        count: z.number().int().min(1).max(64).default(64),
        slot: z.number().int().min(9).max(44).optional().describe("Specific inventory slot (9-44). Omit to auto-pick an empty slot."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ item_name, count, slot }) => {
      try {
        const bot = requireBot();
        if (bot.game?.gameMode !== "creative") {
          throw new Error(
            `Bot is in "${bot.game?.gameMode ?? "unknown"}" mode. minecraft_give_item only works in creative ` +
              "(server/singleplayer: /gamemode creative <bot username>)."
          );
        }
        const itemData = bot.registry.itemsByName[item_name];
        if (!itemData) {
          throw new Error(`Unknown item id "${item_name}".`);
        }
        const targetSlot = slot ?? bot.inventory.firstEmptyInventorySlot() ?? undefined;
        if (targetSlot === undefined) {
          throw new Error("Inventory is full. Pass an explicit slot to overwrite, or free up space first.");
        }
        const ItemClass = loadItem(bot.registry);
        const item = new ItemClass(itemData.id, count);
        await bot.creative.setInventorySlot(targetSlot, item);
        return textResult({ message: `Gave ${count}x "${item_name}" (slot ${targetSlot}).` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_move_item_slot",
    {
      title: "Move Item Between Inventory Slots",
      description: `Moves an item stack from one inventory slot to another, for organizing the hotbar/inventory. Slot map: 0 crafting output, 1-4 crafting grid, 5-8 armor, 9-35 main inventory, 36-44 hotbar, 45 off-hand.

Returns: { message }`,
      inputSchema: {
        from_slot: z.number().int().min(0).max(45),
        to_slot: z.number().int().min(0).max(45),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ from_slot, to_slot }) => {
      try {
        const bot = requireBot();
        await bot.moveSlotItem(from_slot, to_slot);
        return textResult({ message: `Moved item from slot ${from_slot} to slot ${to_slot}.` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}

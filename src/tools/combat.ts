import { z } from "zod";
import { Vec3 } from "vec3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireBot } from "../bot.js";

function textResult(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(err: unknown) {
  return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
}

export function registerCombatTools(server: McpServer): void {
  server.registerTool(
    "minecraft_set_sprint",
    {
      title: "Toggle Sprint",
      description: "Turns sprinting on or off. Sprint state persists across movement until toggled off or the bot stops.",
      inputSchema: { sprint: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ sprint }) => {
      try {
        const bot = requireBot();
        bot.setControlState("sprint", sprint);
        return textResult({ message: `Sprint ${sprint ? "on" : "off"}.` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_set_sneak",
    {
      title: "Toggle Sneak",
      description: "Turns sneaking (crouching) on or off — prevents falling off edges and hides the bot's nametag/hides it from some mobs.",
      inputSchema: { sneak: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ sneak }) => {
      try {
        const bot = requireBot();
        bot.setControlState("sneak", sneak);
        return textResult({ message: `Sneak ${sneak ? "on" : "off"}.` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_use_held_item",
    {
      title: "Start / Stop Using Held Item",
      description: `Starts or stops "using" the currently equipped item — this is the generic right-click-and-hold action: raising a shield to block, drawing back a bow/crossbow, drinking a potion, using a fishing rod, blocking with a sword (1.9+), etc. Pair with minecraft_shoot_bow for a ready-made bow-firing flow, or call this directly for shields/potions.

Returns: { message }`,
      inputSchema: {
        action: z.enum(["start", "stop"]),
        offhand: z.boolean().default(false).describe("Use the off-hand item instead of the main hand (e.g. off-hand shield)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ action, offhand }) => {
      try {
        const bot = requireBot();
        if (action === "start") {
          bot.activateItem(offhand);
          return textResult({ message: `Started using ${offhand ? "off-hand" : "main-hand"} item.` });
        }
        bot.deactivateItem();
        return textResult({ message: "Stopped using held item." });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_shoot_bow",
    {
      title: "Shoot Bow",
      description: `Equips a bow, optionally aims at a target point, draws it back for charge_ms, then fires. A full draw (~1000ms+) does full damage; shorter draws do less.

Returns: { message }
Errors: no bow in inventory.`,
      inputSchema: {
        target_x: z.number().optional(),
        target_y: z.number().optional(),
        target_z: z.number().optional(),
        charge_ms: z.number().int().min(200).max(3000).default(1200),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ target_x, target_y, target_z, charge_ms }) => {
      try {
        const bot = requireBot();
        const bow = bot.inventory.items().find((i) => i.name === "bow" || i.name === "crossbow");
        if (!bow) {
          throw new Error('No "bow" or "crossbow" in inventory.');
        }
        await bot.equip(bow, "hand");
        if (target_x !== undefined && target_y !== undefined && target_z !== undefined) {
          await bot.lookAt(new Vec3(target_x, target_y, target_z), true);
        }
        bot.activateItem();
        await new Promise((resolve) => setTimeout(resolve, charge_ms));
        bot.deactivateItem();
        return textResult({ message: `Fired ${bow.name} after a ${charge_ms}ms draw.` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}

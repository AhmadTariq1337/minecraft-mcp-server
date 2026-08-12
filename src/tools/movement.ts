import { z } from "zod";
import { Vec3 } from "vec3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pathfinderPkg from "mineflayer-pathfinder";
import { requireBot } from "../bot.js";
import { MOVE_TIMEOUT_MS } from "../constants.js";

const { goals } = pathfinderPkg;

function textResult(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(err: unknown) {
  return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function registerMovementTools(server: McpServer): void {
  server.registerTool(
    "minecraft_goto_position",
    {
      title: "Walk To Coordinates",
      description: `Paths the bot to a target position using pathfinding (navigates around obstacles, up stairs, across gaps it can jump). Blocking call — resolves once the bot arrives or pathfinding times out (${MOVE_TIMEOUT_MS / 1000}s).

Returns: { message: string, position: { x, y, z } } on arrival.
Errors: unreachable destination, timeout, or no path found.`,
      inputSchema: {
        x: z.number(),
        y: z.number(),
        z: z.number(),
        range: z.number().min(0).max(10).default(1).describe("How close counts as 'arrived', in blocks. 0 = exact block."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ x, y, z, range }) => {
      try {
        const bot = requireBot();
        await withTimeout(bot.pathfinder.goto(new goals.GoalNear(x, y, z, range)), MOVE_TIMEOUT_MS, "Pathfinding");
        const pos = bot.entity.position;
        return textResult({
          message: `Arrived near (${x}, ${y}, ${z}).`,
          position: { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100, z: Math.round(pos.z * 100) / 100 },
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_goto_player",
    {
      title: "Walk To Player",
      description: `Paths the bot to stand near a named online player. Blocking call.

Returns: { message: string, position } on arrival.
Errors: player not found/not loaded, or unreachable.`,
      inputSchema: {
        username: z.string().min(1),
        range: z.number().min(0).max(10).default(2),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ username, range }) => {
      try {
        const bot = requireBot();
        const target = bot.players[username]?.entity;
        if (!target) {
          throw new Error(`Player "${username}" not found (not online, or too far to be loaded into view).`);
        }
        await withTimeout(bot.pathfinder.goto(new goals.GoalFollow(target, range)), MOVE_TIMEOUT_MS, "Pathfinding");
        const pos = bot.entity.position;
        return textResult({
          message: `Arrived near "${username}".`,
          position: { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100, z: Math.round(pos.z * 100) / 100 },
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_follow_player",
    {
      title: "Follow / Stop Following Player",
      description: `Starts (or stops) continuously following a named player at a set distance. Unlike minecraft_goto_player this does NOT block — the bot keeps following in the background until minecraft_stop is called or this tool is called again with stop=true.

Returns: { message: string }`,
      inputSchema: {
        username: z.string().min(1),
        range: z.number().min(1).max(10).default(3),
        stop: z.boolean().default(false).describe("Set true to stop following."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ username, range, stop }) => {
      try {
        const bot = requireBot();
        if (stop) {
          bot.pathfinder.stop();
          return textResult({ message: "Stopped following." });
        }
        const target = bot.players[username]?.entity;
        if (!target) {
          throw new Error(`Player "${username}" not found (not online, or too far to be loaded into view).`);
        }
        bot.pathfinder.setGoal(new goals.GoalFollow(target, range), true);
        return textResult({
          message: `Now following "${username}" at range ${range}. Call minecraft_follow_player with stop=true to end.`,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_look_at",
    {
      title: "Look At Coordinates",
      description: "Turns the bot's head/body to face a specific point. Purely cosmetic/aiming — doesn't move the bot. Useful before minecraft_attack_entity or minecraft_activate_block for precision.",
      inputSchema: { x: z.number(), y: z.number(), z: z.number() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ x, y, z }) => {
      try {
        const bot = requireBot();
        await bot.lookAt(new Vec3(x, y, z), true);
        return textResult({ message: `Looking at (${x}, ${y}, ${z}).` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_stop",
    {
      title: "Stop Moving",
      description: "Cancels any active pathfinding goal (goto/follow) and releases all movement keys. Use this to interrupt movement in progress.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const bot = requireBot();
        bot.pathfinder.stop();
        bot.clearControlStates();
        return textResult({ message: "Stopped." });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_jump",
    {
      title: "Jump",
      description: "Makes the bot jump once in place.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async () => {
      try {
        const bot = requireBot();
        bot.setControlState("jump", true);
        await new Promise((resolve) => setTimeout(resolve, 250));
        bot.setControlState("jump", false);
        return textResult({ message: "Jumped." });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}

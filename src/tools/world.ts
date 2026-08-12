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

const DIRECTION_OFFSETS: Record<string, [number, number, number]> = {
  north: [0, 0, -10],
  south: [0, 0, 10],
  east: [10, 0, 0],
  west: [-10, 0, 0],
  up: [0, 10, 0],
  down: [0, -10, 0],
};

export function registerWorldTools(server: McpServer): void {
  server.registerTool(
    "minecraft_get_biome_at",
    {
      title: "Get Biome At Coordinates",
      description: "Looks up the biome at exact world coordinates.\n\nReturns: { x, y, z, biome: string | null }",
      inputSchema: { x: z.number(), y: z.number(), z: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ x, y, z }) => {
      try {
        const bot = requireBot();
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) {
          return textResult({ x, y, z, biome: null, error: "Chunk not loaded at this position." });
        }
        return textResult({ x, y, z, biome: block.biome?.name ?? "unknown" });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_get_light_at",
    {
      title: "Get Light Level At Coordinates",
      description: `Returns light levels at a block — useful for checking if an area is safe from mob spawns (block light < 8 with sky light 0 at night is generally spawnable).

Returns: { x, y, z, light: number (0-15, total), skyLight: number (0-15) }`,
      inputSchema: { x: z.number(), y: z.number(), z: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ x, y, z }) => {
      try {
        const bot = requireBot();
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) {
          return textResult({ x, y, z, error: "Chunk not loaded at this position." });
        }
        return textResult({ x, y, z, light: block.light, skyLight: block.skyLight });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_get_time",
    {
      title: "Get World Time",
      description: `Returns the current in-game time and weather.

Returns: { timeOfDay: number (0-24000 ticks), day: number, isDay: boolean, moonPhase: number (0-7), isRaining: boolean }`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const bot = requireBot();
        const t = bot.time;
        return textResult({
          timeOfDay: t.timeOfDay,
          day: t.day,
          isDay: t.isDay,
          moonPhase: t.moonPhase,
          isRaining: bot.isRaining,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_look_direction",
    {
      title: "Look In Compass Direction",
      description: 'Turns the bot to face a compass direction (north/south/east/west) or straight up/down. Purely cosmetic/aiming — does not move the bot.',
      inputSchema: { direction: z.enum(["north", "south", "east", "west", "up", "down"]) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ direction }) => {
      try {
        const bot = requireBot();
        const [dx, dy, dz] = DIRECTION_OFFSETS[direction];
        const pos = bot.entity.position;
        await bot.lookAt(new Vec3(pos.x + dx, pos.y + dy, pos.z + dz), true);
        return textResult({ message: `Looking ${direction}.` });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "minecraft_read_sign",
    {
      title: "Read Sign Text",
      description: "Reads the text written on a sign at the given coordinates.\n\nReturns: { x, y, z, front: string, back: string | null }",
      inputSchema: { x: z.number(), y: z.number(), z: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ x, y, z }) => {
      try {
        const bot = requireBot();
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) {
          throw new Error(`Chunk not loaded at (${x}, ${y}, ${z}).`);
        }
        if (!block.name.includes("sign")) {
          throw new Error(`"${block.name}" at (${x}, ${y}, ${z}) is not a sign.`);
        }
        const [front, back] = block.getSignText();
        return textResult({ x, y, z, front, back: back ?? null });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}

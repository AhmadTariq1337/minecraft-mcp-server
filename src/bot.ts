import mineflayer, { type Bot } from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { plugin as collectBlockPlugin } from "mineflayer-collectblock";
import type { BotState, ConnectionOptions } from "./types.js";

const { pathfinder, Movements } = pathfinderPkg;

const state: BotState = {
  bot: null,
  options: null,
  connected: false,
  spawned: false,
  lastError: null,
};

export function getState(): BotState {
  return state;
}

/**
 * Returns the live bot instance or throws an actionable error the LLM
 * can relay to the user instead of a raw stack trace.
 */
export function requireBot(): Bot {
  if (!state.bot || !state.spawned) {
    throw new Error(
      "Not connected to a Minecraft world. Call minecraft_connect first " +
        "(host, port, username, and auth: 'offline' for TLauncher / cracked servers)."
    );
  }
  return state.bot;
}

export function connectBot(options: ConnectionOptions): Promise<{ message: string }> {
  return new Promise((resolve, reject) => {
    if (state.bot) {
      try {
        state.bot.end();
      } catch {
        // ignore
      }
      state.bot = null;
      state.connected = false;
      state.spawned = false;
    }

    state.options = options;
    state.lastError = null;

    let bot: Bot;
    try {
      bot = mineflayer.createBot({
        host: options.host,
        port: options.port,
        username: options.username,
        version: options.version || undefined,
        auth: options.auth === "microsoft" ? "microsoft" : "offline",
        password: options.password,
        checkTimeoutInterval: 30_000,
      });
    } catch (err) {
      reject(new Error(`Failed to create bot: ${(err as Error).message}`));
      return;
    }

    state.bot = bot;

    bot.loadPlugin(pathfinder);
    bot.loadPlugin(collectBlockPlugin);

    const onError = (err: Error) => {
      state.lastError = err.message;
      cleanup();
      reject(
        new Error(
          `Could not connect to ${options.host}:${options.port} as "${options.username}". ` +
            `Underlying error: ${err.message}. ` +
            "Check the world is open to LAN / the server is running, the port matches, " +
            "and that auth mode ('offline' vs 'microsoft') matches how the server expects you to log in."
        )
      );
    };

    const onKicked = (reason: unknown) => {
      state.lastError = typeof reason === "string" ? reason : JSON.stringify(reason);
      cleanup();
      reject(new Error(`Kicked from server before spawning: ${state.lastError}`));
    };

    const onSpawn = () => {
      state.connected = true;
      state.spawned = true;
      bot.removeListener("error", onError);
      bot.removeListener("kicked", onKicked);

      const movements = new Movements(bot);
      bot.pathfinder.setMovements(movements);

      bot.once("end", (reason: string) => {
        state.connected = false;
        state.spawned = false;
        state.lastError = reason;
      });

      resolve({
        message: `Connected as "${options.username}" to ${options.host}:${options.port}. Spawned at ${Math.floor(
          bot.entity.position.x
        )}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}.`,
      });
    };

    function cleanup() {
      bot.removeListener("error", onError);
      bot.removeListener("kicked", onKicked);
      bot.removeListener("spawn", onSpawn);
      state.bot = null;
      state.connected = false;
      state.spawned = false;
    }

    bot.once("error", onError);
    bot.once("kicked", onKicked);
    bot.once("spawn", onSpawn);
  });
}

export async function disconnectBot(): Promise<{ message: string }> {
  if (!state.bot) {
    return { message: "Already disconnected." };
  }
  const wasUser = state.options?.username ?? "bot";
  state.bot.end();
  state.bot = null;
  state.connected = false;
  state.spawned = false;
  return { message: `Disconnected "${wasUser}".` };
}

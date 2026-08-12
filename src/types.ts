import type { Bot } from "mineflayer";

export interface ConnectionOptions {
  host: string;
  port: number;
  username: string;
  version?: string;
  auth: "offline" | "microsoft";
  password?: string;
}

export interface BotState {
  bot: Bot | null;
  options: ConnectionOptions | null;
  connected: boolean;
  spawned: boolean;
  lastError: string | null;
}

export interface SimpleBlock {
  x: number;
  y: number;
  z: number;
  name: string;
}

export interface SimpleEntity {
  id: number;
  type: string;
  name: string;
  username?: string;
  x: number;
  y: number;
  z: number;
  distance: number;
}

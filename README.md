<div align="center">

```
██╗   ██╗██╗███╗   ██╗███████╗ ██████╗██████╗  █████╗ ███████╗████████╗
██║   ██║██║████╗  ██║██╔════╝██╔════╝██╔══██╗██╔══██╗██╔════╝╚══██╔══╝
██╔████╔╝██║██╔██╗ ██║█████╗  ██║     ██████╔╝███████║█████╗     ██║
╚██╔╝██╔╝██║██║╚██╗██║██╔══╝  ██║     ██╔══██╗██╔══██║██╔══╝     ██║
 ╚═╝ ╚═╝ ██║██║ ╚████║███████╗╚██████╗██║  ██║██║  ██║██║        ██║
         ╚═╝╚═╝  ╚═══╝╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝        ╚═╝
            M   C   P       S   E   R   V   E   R
```

### 🟫🟩🟫  Give any AI agent a body inside Minecraft.  🟫🟩🟫

*Connect · Build · Mine · Fight · Farm · Trade · Chat — one MCP server, any AI, any world.*

[![MIT License](https://img.shields.io/badge/license-MIT-44cc44?style=for-the-badge)](./LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-6b8e23?style=for-the-badge)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/protocol-MCP-8b5a2b?style=for-the-badge)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-4287f5?style=for-the-badge)](https://www.typescriptlang.org/)

</div>

---

## ⛏️ What is this?

**minecraft-mcp-server** is a [Model Context Protocol](https://modelcontextprotocol.io) server that puts an AI agent *inside* a real Minecraft Java Edition world through [mineflayer](https://github.com/PrismarineJS/mineflayer). It exposes **61 tools** covering movement, building, mining, combat, farming, inventory, villager trading, and world perception — so any MCP-compatible client can spawn a bot that actually sees the world, walks around it, and acts on it.

This is **not tied to any single AI product**. It speaks plain MCP over stdio, so it works with **any MCP host** — Claude Desktop, Claude Code, Cursor, Cline, Windsurf, your own custom MCP client, or anything else that can launch a local MCP server. If your agent can talk MCP, it can play Minecraft.

> Built for singleplayer worlds opened via *"Open to LAN"*, offline-mode/cracked servers (e.g. TLauncher), and standard online-mode servers.

---

## 🧰 Tool chest — what your agent can do

| Category | Tools |
|---|---|
| 🔌 **Connection** | connect, disconnect, status |
| 👀 **Perception** | position, nearby blocks, block lookup, find block, nearby entities, inventory |
| 🚶 **Movement** | goto position, goto player, follow player, look at, look direction, stop, jump |
| 🧱 **Building** | place block, dig block, build cuboid structure, clear area |
| 🖐️ **Interaction** | chat, equip item, toss item, craft item, attack entity, activate block, eat, sleep, collect block (mine + auto-pickup) |
| 🎒 **Inventory** | open/deposit/withdraw/close container, use furnace, give item (creative), move item slot |
| ⚔️ **Combat** | sprint, sneak, use held item (block/draw/drink), shoot bow |
| 🌾 **Farming** | till soil, plant seed, harvest crop |
| 🌍 **World** | biome lookup, light level, get time, read sign |
| 🗣️ **Social** | whisper, list players, open villager trades, execute trade |
| 🧭 **Misc** | mount, dismount, respawn, wait |

Every tool returns structured JSON and actionable error messages — no raw stack traces dumped on your agent.

---

## 📦 Installation

```bash
git clone https://github.com/AhmadTariq1337/minecraft-mcp-server.git
cd minecraft-mcp-server
npm install
npm run build
```

This compiles TypeScript from `src/` into `dist/`, producing `dist/index.js` — the entry point your MCP host will launch.

---

## 🔧 Configuring your MCP client

Any host that supports local (stdio) MCP servers can use this. The server is launched as:

```bash
node /path/to/minecraft-mcp-server/dist/index.js
```

### Claude Desktop / Claude Code

Add to your MCP config (`claude_desktop_config.json` or equivalent):

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "node",
      "args": ["/absolute/path/to/minecraft-mcp-server/dist/index.js"]
    }
  }
}
```

### Cursor / Cline / Windsurf / other MCP hosts

The pattern is the same everywhere — point your client's MCP server config at `node` + the absolute path to `dist/index.js`. Consult your client's docs for where that config file lives.

> 🔑 No API keys, no cloud dependency. Everything runs locally over stdio.

---

## 🎮 Quick start in-game

1. Open your Minecraft world (singleplayer works great).
2. Press **Escape → Open to LAN** — note the port number shown in chat.
3. Ask your agent to connect:
   > *"Connect to localhost on port `<port>` as `<bot-name>`, auth offline."*
4. That's it — your agent can now see the world, move, mine, build, and chat.

```json
{
  "host": "localhost",
  "port": 12345,
  "username": "AgentBot",
  "auth": "offline"
}
```

Use `auth: "microsoft"` only if connecting with a real Mojang/Microsoft account to an online-mode server.

---

## 🧱 Supported Minecraft versions

This server rides on [mineflayer](https://github.com/PrismarineJS/mineflayer), which determines actual protocol support. At time of writing, the published mineflayer release supports up through Minecraft **1.21.x**. Mojang's 2026 `year.drop` versioning scheme (e.g. `26.1.x`) is **not yet supported** upstream — connecting to a newer world will fail with a protocol/version mismatch until mineflayer ships support. Older clients like **OptiFine 1.21.11** or vanilla **1.21.x** work out of the box.

If you hit a version-mismatch error, launch a world on a supported version (TLauncher makes this easy) while upstream support catches up.

---

## 🏗️ Project layout

```
minecraft-mcp-server/
├── src/
│   ├── index.ts           entry point — registers every tool group
│   ├── bot.ts              mineflayer connection lifecycle
│   ├── types.ts             shared types
│   ├── constants.ts        tunable limits (scan radius, timeouts, etc.)
│   └── tools/
│       ├── connection.ts
│       ├── perception.ts
│       ├── movement.ts
│       ├── building.ts
│       ├── interaction.ts
│       ├── inventory.ts
│       ├── combat.ts
│       ├── farming.ts
│       ├── world.ts
│       ├── social.ts
│       └── misc.ts
└── dist/                    compiled output (npm run build)
```

---

## 🤝 Contributing

Issues and PRs welcome — especially around mineflayer version-support tracking, new tool coverage, and better pathfinding heuristics. Keep tool descriptions actionable (what it does, what it returns, common error cases) so any agent — not just one AI vendor's — can use them well without guesswork.

---

## 📜 License

MIT — see [LICENSE](./LICENSE).

<div align="center">

🟩🟫🟩🟫🟩 *Built block by block.* 🟩🟫🟩🟫🟩

</div>

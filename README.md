# Korex — Open-Source Discord Bot Core

<p align="center">
  <img src="assets/banner.png" alt="Korex Bot" width="600" />
</p>

<p align="center">
  <a href="https://korex.dev">Website</a> ·
  <a href="https://panel.korex.dev">Dashboard</a> ·
  <a href="https://discord.gg/korex">Discord</a>
</p>

---

**Korex** is a professional, production-ready Discord bot built with TypeScript and Discord.js v14. This repository contains the open-source core — moderation, economy, leveling, music, giveaways, polls, auto-responses, and the full addon infrastructure. Premium addon implementations are available exclusively on [korex.dev](https://korex.dev).

---

## Features

- **Moderation** — warn, mute, kick, ban, auto-mod, word/link/caps filters
- **Economy** — currency, daily/weekly rewards, shop, inventory, bank
- **Leveling** — XP system, level roles, leaderboards, voice XP
- **Music** — SoundCloud playback via discord-player v7
- **Giveaways** — full giveaway lifecycle with requirements and re-roll
- **Polls** — multi-option polls with time limits and restrictions
- **Auto-responses** — trigger-based responses (exact, contains, regex)
- **Suggestions** — channel-based suggestion board with voting
- **Reaction roles** — buttons and select menus, multiple assignment modes
- **Welcome / Goodbye** — embeds, DMs, auto-role on join, verification flow
- **Logging** — granular event logging across categorised channels
- **Invite tracking** — tracks inviter per member join
- **Premium addon system** — infrastructure to load, license-check, and manage optional premium modules per guild

---

## Premium Addons

The following premium addons extend the core bot and are sold as monthly subscriptions. Their source code is not included in this repository — see [korex.dev/addons](https://korex.dev/addons) for details.

| Addon | Price | Description |
|---|---|---|
| Tickets | $2.99/mo | Advanced support ticket system with categories, SLA, transcripts |
| Staff | $2.99/mo | Staff activity tracking, sessions, departments |
| Forms | $2.99/mo | Custom form builder with approval workflows |
| Links | $2.99/mo | Branded link shortener with analytics |
| Paste | $2.99/mo | Code and text sharing with syntax highlighting |
| Analytics Pro | $2.99/mo | Advanced guild analytics with AI insights |
| Events | $2.99/mo | Event scheduling, RSVP, Google/Outlook calendar sync |
| Store | $2.99/mo | Digital and physical product store with PayPal integration |
| Music DJ IA | $4.99/mo | Enhanced music with AI-generated songs via MusicGPT |
| AI Assistant | $4.99/mo | Chatbot, AI moderation, sentiment analysis, FAQ |
| **Bundle** | **$14.99/mo** | All 8 core addons in one subscription |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Discord | Discord.js v14 |
| Database | PostgreSQL 15 + Prisma ORM |
| Cache | Redis 7 |
| Music | discord-player v7 + SoundCloud |
| Process Manager | PM2 |

---

## Project Structure

```
src/
├── addons/             # Addon infrastructure (types, loader — no premium source)
├── client/             # KorexClient, managers, base structures
│   ├── managers/       # CommandManager, EventManager, AddonManager, etc.
│   └── structures/     # Command, Event, Addon base classes
├── commands/           # Core slash and prefix commands
├── components/         # Discord component interaction handlers
├── config/             # Bot configuration constants
├── database/           # Prisma schema, migrations, Redis cache
├── events/             # Discord.js event handlers
├── languages/          # i18n strings (English + Spanish)
├── middleware/         # Rate limiting
├── monitoring/         # Health monitor
├── services/           # Business logic (economy, levels, moderation, etc.)
├── sharding/           # Sharding manager for large deployments
└── utils/              # Logger, helpers, i18n loader
```

---

## Getting Started

### Prerequisites

- Node.js >= 20
- PostgreSQL 15
- Redis 7

### Installation

```bash
git clone https://github.com/koyere/korex_public.git
cd korex_public

npm install

# Copy and fill environment variables
cp .env.example .env
```

### Environment Variables

```env
# Required
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DATABASE_URL=postgresql://user:pass@localhost:5432/korex
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_64_char_hex_secret
ENCRYPTION_KEY=your_32_char_hex_key

# Optional
API_PORT=3000
DASHBOARD_URL=https://your-dashboard.com
ENABLE_SHARDING=false
```

### Database Setup

```bash
# Generate Prisma client
npx prisma generate --schema src/database/prisma/schema.prisma

# Push schema to database (development)
npx prisma db push --schema src/database/prisma/schema.prisma

# Or run migrations (production)
npx prisma migrate deploy --schema src/database/prisma/schema.prisma
```

### Running

```bash
# Development (hot reload)
npm run dev

# Production build
npm run build
npm start

# With sharding (2500+ guilds)
npm run start:sharding
```

---

## Addon System

Korex has a first-class addon system that allows optional modules to be loaded, licensed, and enabled per guild at runtime.

### How it works

1. Each addon lives in `src/addons/{addon-name}/` and exports an `Addon` class
2. The `AddonManager` loads addons on startup, verifying an environment license key
3. `AddonSyncService` uses Redis Pub/Sub to sync addon state across shards
4. `AddonLicense` records in the database track per-guild activation and PayPal subscription IDs
5. Addons can be enabled/disabled per guild without restarting the bot

### Creating an addon

```typescript
// src/addons/my-addon/index.ts
import { Addon } from '../types/addon.types';

export default class MyAddon extends Addon {
  async onLoad() { /* register commands and events */ }
  async onEnable(guildId: string) { /* guild-specific setup */ }
  async onDisable(guildId: string) { /* cleanup */ }
}
```

```typescript
// src/addons/my-addon/addon.config.ts
export const config = {
  name: 'my-addon',
  displayName: 'My Addon',
  version: '1.0.0',
  description: 'Does something useful.',
};
```

Set the license key in `.env`: `ADDON_MY_ADDON_LICENSE=your-key`

---

## Sharding

For bots in 2,500+ guilds, enable sharding:

```bash
ENABLE_SHARDING=true npm run start:sharding
```

The `ShardingManager` (`src/sharding/`) automatically calculates shard count, monitors health, and gracefully restarts failed shards.

---

## i18n

Commands and bot messages support English and Spanish out of the box. Language files are in `src/languages/`. To add a new language, duplicate `en.json` and translate the values, then add the locale code to `src/utils/i18n.ts`.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development mode with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Jest tests |
| `npm run db:studio` | Open Prisma Studio |

---

## Contributing

Pull requests are welcome for the core bot. Premium addon implementations are not accepted in this repository.

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit using conventional commits: `git commit -m "feat: add something"`
4. Open a pull request

Please ensure `npm run typecheck` and `npm run lint` pass before submitting.

---

## License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for details.

Premium addons and the commercial Korex service are subject to separate terms at [korex.dev/terms](https://korex.dev/terms).

---

**© 2024–2026 [Koyere Dev](https://korex.dev)**

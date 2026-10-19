# Korex — Open-Source Discord Bot Core

<p align="center">
  <a href="https://korex.dev">Website</a> ·
  <a href="https://panel.korex.dev">Dashboard</a> ·
  <a href="https://discord.gg/korex">Discord</a>
</p>

---

**Korex** is a production-ready Discord bot built with TypeScript and Discord.js v14. This repository contains the open-source **core** of the bot: every free module (moderation, verification, auto-roles, economy, levels, music, giveaways, polls, suggestions, logging and more) plus the add-on infrastructure. Premium add-ons and the hosted web dashboard are not part of this repository; premium add-ons are available at [korex.dev](https://korex.dev).

---

## Features

### Moderation and security
- **Moderation** — `/warn`, `/mute`, `/unmute`, `/timeout`, `/kick`, `/ban`, `/unban`, `/tempban`, `/massban`, `/purge`, `/clear`, `/slowmode`, `/lockdown`, `/nuke`, `/modlogs`, with automatic warn escalation.
- **Auto-moderation** — message spam, attachment spam, word, link and caps filters, ghost-ping protection, ignored channels and roles.
- **Anti-raid** — detects join floods in a configurable window, optionally filters by account age, applies an action (alert, timeout, kick or ban) and can lock channels or force verification while raid mode lasts. Raid state is persisted, so the previous state is restored even after a restart. `/antiraid status` and `/antiraid end`.
- **Honeypot** — trap channel, new-account filter and join-flood detection that act on bots and raid accounts.
- **Verification** — button, reaction or **image captcha** verification (`/verification`), with attempt limits enforced atomically in Redis.

### Community
- **Welcome and goodbye** — embeds, DMs and generated welcome images (`/welcome-image`).
- **Auto-roles** — join roles (with optional delay, persisted across restarts) and reaction / button / select-menu role panels (`/autoroles`), with role safety checks so dangerous roles cannot be self-assigned.
- **Invite tracking and rewards** — tracks who invited each member, leaderboards, manual adjustments and **invite rewards**: roles granted automatically when a member reaches an invite threshold (`/invites`).
- **Giveaways** — full lifecycle with requirements (roles, account age, invites) and re-rolls (`/giveaway`).
- **Polls** — simple, multiple-choice, dropdown and ranking polls with time limits (`/poll`).
- **Suggestions** — suggestion board with voting, categories, priorities and staff review (`/suggest`, `/suggestions`).
- **Starboard** — reposts popular messages to a highlight channel (`/starboard`).
- **Sticky messages** — messages that stay at the bottom of a channel (`/sticky`).
- **Auto-responses** — trigger-based replies and actions (exact, contains, regex) (`/autoresponse`).

### Engagement
- **Levels** — text and voice XP, level roles, `/rank` and `/leaderboard`.
- **Economy** — wallet and bank, `/daily`, `/weekly`, `/work`, `/pay`, `/deposit`, `/withdraw`, `/shop` and `/inventory`.
- **Music** — playback via discord-player v7 (`/play`, `/pause`, `/skip`, `/stop`, `/queue`, `/nowplaying`, `/volume`) with button controls.
- **Fun** — `/8ball`, `/coinflip`, `/dice`, `/rps`, `/guess`, `/joke`, `/meme`, `/advice`, `/cat`, `/dog`, `/hug`, `/pat`, `/kiss`, `/slap`, `/compliment`.
- **Utility** — `/help`, `/ping`, `/botinfo`, `/serverinfo`, `/userinfo`, `/avatar`, `/stats`, `/timestamp`, `/invite`.

### Platform
- **Prefix and mention commands** — slash commands can also be used with a text prefix (default `!`) or by mentioning the bot. Arguments are parsed against the slash command definition, and the same permission checks, cooldowns and command pipeline are applied.
- **Logging** — granular event logging to dedicated channels.
- **i18n** — English and Spanish, per guild (`/language`). Slash command descriptions are in English with Spanish localizations.
- **Add-on system** — infrastructure to load, license-check and enable optional modules per guild at runtime.
- **Production tooling** — health monitor, structured logging, rate limiting, scheduled database backups and sharding.

> Some settings (for example the custom prefix, honeypot or advanced anti-raid options) are edited from the hosted dashboard at korex.dev, which is not part of this repository. In a self-hosted deployment they use their defaults and are stored in the corresponding database columns.

---

## Premium add-ons

Premium add-ons extend the core and are sold as subscriptions at [korex.dev](https://korex.dev). Their source code is not included in this repository. The core only contains the infrastructure that loads them (`src/addons/types`, `AddonManager`, `AddonSyncService`).

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Discord | Discord.js v14 |
| Database | PostgreSQL 15 + Prisma ORM |
| Cache / locks | Redis 7 |
| Music | discord-player v7 |
| Tests | Jest + ts-jest |
| Process manager | PM2 |

---

## Project structure

```
src/
├── addons/             # Add-on infrastructure (types only — no premium source)
├── backup/             # Scheduled database backups
├── client/             # KorexClient, managers, base structures
│   ├── managers/       # CommandManager, EventManager, AddonManager, ...
│   ├── prefix/         # Prefix/mention command parser and permissions
│   └── structures/     # Command, Event, Component, Addon base classes
├── commands/           # Slash commands (also usable with a prefix)
├── components/         # Button, select menu and modal handlers
├── config/             # Bot configuration
├── database/           # Prisma schema, Redis cache, optimizer
├── events/             # Discord.js event handlers
├── languages/          # Locale files (en, es) and slash localizations
├── logging/            # Production logger
├── middleware/         # Rate limiting, add-on middleware
├── monitoring/         # Health monitor
├── services/           # Business logic (moderation, economy, levels, ...)
├── sharding/           # Sharding manager for large deployments
└── utils/              # Logger, i18n loader, helpers
prisma/migrations/      # SQL migrations
tests/                  # Jest tests
```

---

## Getting started

### Prerequisites

- Node.js >= 20
- PostgreSQL 15
- Redis 7

### Installation

```bash
git clone https://github.com/koyere/korex_public.git
cd korex_public

npm install

# Copy and fill in the environment variables
cp .env.example .env
```

### Environment variables

```env
# Required
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DATABASE_URL=postgresql://user:pass@localhost:5432/korex
REDIS_URL=redis://localhost:6379

# Optional
DISCORD_DEV_GUILD_ID=        # register commands instantly in one guild while developing
DEFAULT_PREFIX=!
DEFAULT_LANGUAGE=en
MUSIC_ENABLED=true
ENABLE_SHARDING=false
```

See `.env.example` for the full list.

### Database setup

```bash
# Generate the Prisma client
npm run db:generate

# Push the schema to the database (development)
npm run db:push

# Or apply the migrations (production)
npx prisma migrate deploy --schema src/database/prisma/schema.prisma
```

### Running

```bash
# Development (hot reload)
npm run dev

# Production build
npm run build
npm start

# With sharding (2,500+ guilds)
npm run start:sharding
```

---

## Add-on system

Optional modules can be loaded, licensed and enabled per guild at runtime.

1. Each add-on lives in `src/addons/<addon-name>/` with an `addon.config.ts` and an `index.ts` whose default export extends the `Addon` base class.
2. On startup `AddonManager` loads every add-on folder and checks the license key from `ADDON_<NAME>_LICENSE`.
3. `AddonSyncService` uses Redis Pub/Sub to keep add-on state in sync across shards.
4. `AddonLicense` records track per-guild activation.
5. Add-ons can be enabled or disabled per guild without restarting the bot.

```typescript
// src/addons/my-addon/index.ts
import { Addon } from '../../client/structures/Addon';

export default class MyAddon extends Addon {
  async onLoad() { /* register commands and events */ }
  async onUnload() { /* release resources */ }
  async onEnable(guildId: string) { /* guild-specific setup */ }
  async onDisable(guildId: string) { /* cleanup */ }
}
```

```typescript
// src/addons/my-addon/addon.config.ts
import { AddonConfig } from '../types/addon.types';

export const myAddonConfig: AddonConfig = {
  name: 'my-addon',
  displayName: 'My Add-on',
  description: 'Does something useful.',
  version: '1.0.0',
  author: 'You',
  // ...see AddonConfig for the remaining fields
};
```

---

## Sharding

For bots in 2,500+ guilds:

```bash
ENABLE_SHARDING=true npm run start:sharding
```

The `ShardingManager` (`src/sharding/`) calculates the shard count, monitors shard health and restarts failed shards.

---

## i18n

Bot messages are translated in `src/languages/en.json` and `src/languages/es.json`. Slash command descriptions are written in English in the code and localized to Spanish through `src/languages/slash/es.json`. To add a language, duplicate `en.json`, translate the values and register the locale in `src/utils/i18n.ts`.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development mode with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Jest tests |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:studio` | Open Prisma Studio |

The captcha Redis tests need a disposable Redis instance: `REDIS_TEST_URL=redis://127.0.0.1:6399 npm test`. Without it they are skipped.

---

## Contributing

Pull requests for the core are welcome. Premium add-on implementations are not accepted in this repository.

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit using conventional commits: `git commit -m "feat: add something"`
4. Open a pull request

Please make sure `npm run typecheck`, `npm test` and `npm run lint` pass before submitting.

---

## License

This project is licensed under the **GNU General Public License v3.0** — see [LICENSE](LICENSE) for details.

Premium add-ons and the hosted Korex service are subject to separate terms at [korex.dev/terms](https://korex.dev/terms).

---

**© 2024–2026 [Koyere Dev](https://korex.dev)**

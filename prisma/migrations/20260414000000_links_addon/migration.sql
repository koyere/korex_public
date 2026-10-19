-- Migration: links_addon
-- Short link management system with click analytics

-- link_configs: per-guild settings
CREATE TABLE IF NOT EXISTS "link_configs" (
  "id"                TEXT NOT NULL,
  "guildId"           TEXT NOT NULL,
  "domain"            TEXT NOT NULL DEFAULT 'link.korex.dev',
  "logChannelId"      TEXT,
  "notifyHighTraffic" BOOLEAN NOT NULL DEFAULT true,
  "highTrafficThreshold" INTEGER NOT NULL DEFAULT 100,
  "requireApproval"   BOOLEAN NOT NULL DEFAULT false,
  "moderatorRoles"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allowedRoles"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "linksPerUser"      INTEGER NOT NULL DEFAULT 50,
  "linksPerDay"       INTEGER NOT NULL DEFAULT 20,
  "defaultExpireDays" INTEGER,
  "qrEnabled"         BOOLEAN NOT NULL DEFAULT true,
  "qrSize"            INTEGER NOT NULL DEFAULT 200,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "link_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "link_configs_guildId_key" ON "link_configs"("guildId");
ALTER TABLE "link_configs" DROP CONSTRAINT IF EXISTS "link_configs_guildId_fkey";
ALTER TABLE "link_configs" ADD CONSTRAINT "link_configs_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- short_links: the actual links
CREATE TABLE IF NOT EXISTS "short_links" (
  "id"            TEXT NOT NULL,
  "guildId"       TEXT NOT NULL,
  "createdBy"     TEXT NOT NULL,
  "slug"          TEXT NOT NULL,
  "destination"   TEXT NOT NULL,
  "title"         TEXT,
  "description"   TEXT,
  "password"      TEXT,
  "expiresAt"     TIMESTAMP(3),
  "maxClicks"     INTEGER,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "approved"      BOOLEAN NOT NULL DEFAULT true,
  "totalClicks"   INTEGER NOT NULL DEFAULT 0,
  "uniqueClicks"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "short_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "short_links_guildId_slug_key" ON "short_links"("guildId", "slug");
CREATE INDEX IF NOT EXISTS "short_links_guildId_idx"   ON "short_links"("guildId");
CREATE INDEX IF NOT EXISTS "short_links_createdBy_idx" ON "short_links"("createdBy");
CREATE INDEX IF NOT EXISTS "short_links_slug_idx"      ON "short_links"("slug");
ALTER TABLE "short_links" DROP CONSTRAINT IF EXISTS "short_links_guildId_fkey";
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- link_clicks: individual click events for analytics
CREATE TABLE IF NOT EXISTS "link_clicks" (
  "id"         TEXT NOT NULL,
  "linkId"     TEXT NOT NULL,
  "guildId"    TEXT NOT NULL,
  "ip"         TEXT,
  "country"    TEXT,
  "city"       TEXT,
  "device"     TEXT,
  "browser"    TEXT,
  "os"         TEXT,
  "referrer"   TEXT,
  "userAgent"  TEXT,
  "clickedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "link_clicks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "link_clicks_linkId_idx"    ON "link_clicks"("linkId");
CREATE INDEX IF NOT EXISTS "link_clicks_guildId_idx"   ON "link_clicks"("guildId");
CREATE INDEX IF NOT EXISTS "link_clicks_clickedAt_idx" ON "link_clicks"("clickedAt");
ALTER TABLE "link_clicks" DROP CONSTRAINT IF EXISTS "link_clicks_linkId_fkey";
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_linkId_fkey"
  FOREIGN KEY ("linkId") REFERENCES "short_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────
-- Migration: 20260328000000_premium_billing_system
-- Adds payment tracking to addon_licenses and creates the guild_premiums table
-- ─────────────────────────────────────────────────────────────────

-- 1. New fields in addon_licenses
ALTER TABLE "addon_licenses"
  ADD COLUMN IF NOT EXISTS "suspendedAt"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentFailures"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastPaymentFailedAt"   TIMESTAMP(3);

-- 2. guild_premiums table (Basic/Pro plans per server)
CREATE TABLE IF NOT EXISTS "guild_premiums" (
    "id"                   TEXT         NOT NULL,
    "guildId"              TEXT         NOT NULL,
    "planId"               TEXT         NOT NULL,
    "userId"               TEXT         NOT NULL,
    "paypalSubscriptionId" TEXT,
    "status"               TEXT         NOT NULL DEFAULT 'ACTIVE',
    "isDemo"               BOOLEAN      NOT NULL DEFAULT false,
    "startedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"            TIMESTAMP(3) NOT NULL,
    "cancelledAt"          TIMESTAMP(3),
    "suspendedAt"          TIMESTAMP(3),
    "paymentFailures"      INTEGER      NOT NULL DEFAULT 0,
    "lastPaymentFailedAt"  TIMESTAMP(3),
    "usageAutoResponses"   INTEGER      NOT NULL DEFAULT 0,
    "usageGiveaways"       INTEGER      NOT NULL DEFAULT 0,
    "usagePolls"           INTEGER      NOT NULL DEFAULT 0,
    "usageCustomCommands"  INTEGER      NOT NULL DEFAULT 0,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_premiums_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "guild_premiums_guildId_key" ON "guild_premiums"("guildId");
CREATE INDEX IF NOT EXISTS "guild_premiums_guildId_idx"  ON "guild_premiums"("guildId");
CREATE INDEX IF NOT EXISTS "guild_premiums_status_idx"   ON "guild_premiums"("status");
CREATE INDEX IF NOT EXISTS "guild_premiums_expiresAt_idx" ON "guild_premiums"("expiresAt");

ALTER TABLE "guild_premiums"
  ADD CONSTRAINT "guild_premiums_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

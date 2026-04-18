-- Migration: tickets_addon
-- Adds all tables for the Tickets addon

-- Enums
DO $$ BEGIN
  CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'CLAIMED', 'PENDING', 'CLOSED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- TicketConfig
CREATE TABLE IF NOT EXISTS "ticket_configs" (
  "id"                    TEXT NOT NULL,
  "guildId"               TEXT NOT NULL,
  "transcriptChannelId"   TEXT,
  "logChannelId"          TEXT,
  "categoryDiscordId"     TEXT,
  "maxOpenPerUser"        INTEGER NOT NULL DEFAULT 3,
  "autoCloseEnabled"      BOOLEAN NOT NULL DEFAULT true,
  "autoCloseHours"        INTEGER NOT NULL DEFAULT 48,
  "warningEnabled"        BOOLEAN NOT NULL DEFAULT true,
  "warningHours"          INTEGER NOT NULL DEFAULT 1,
  "warningDM"             BOOLEAN NOT NULL DEFAULT true,
  "deleteOnClose"         BOOLEAN NOT NULL DEFAULT false,
  "requireTopic"          BOOLEAN NOT NULL DEFAULT true,
  "dmOnCreate"            BOOLEAN NOT NULL DEFAULT true,
  "dmOnClose"             BOOLEAN NOT NULL DEFAULT true,
  "pingStaffOnCreate"     BOOLEAN NOT NULL DEFAULT true,
  "namingScheme"          TEXT NOT NULL DEFAULT 'ticket-{number}',
  "welcomeMessage"        TEXT,
  "closeMessage"          TEXT,
  "outsideHoursMessage"   TEXT,
  "scheduleEnabled"       BOOLEAN NOT NULL DEFAULT false,
  "scheduleTimezone"      TEXT NOT NULL DEFAULT 'UTC',
  "scheduleWeekdays"      INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  "scheduleOpenHour"      INTEGER NOT NULL DEFAULT 9,
  "scheduleCloseHour"     INTEGER NOT NULL DEFAULT 18,
  "blacklistedUsers"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_configs_guildId_key" ON "ticket_configs"("guildId");
ALTER TABLE "ticket_configs" DROP CONSTRAINT IF EXISTS "ticket_configs_guildId_fkey";
ALTER TABLE "ticket_configs" ADD CONSTRAINT "ticket_configs_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TicketCategory
CREATE TABLE IF NOT EXISTS "ticket_categories" (
  "id"                TEXT NOT NULL,
  "configId"          TEXT NOT NULL,
  "guildId"           TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "description"       TEXT,
  "emoji"             TEXT,
  "order"             INTEGER NOT NULL DEFAULT 0,
  "categoryDiscordId" TEXT,
  "staffRoles"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "pingRoles"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allowedRoles"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "blockedRoles"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "readOnlyRoles"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "maxOpenPerUser"    INTEGER,
  "autoCloseEnabled"  BOOLEAN,
  "autoCloseHours"    INTEGER,
  "defaultPriority"   "TicketPriority" NOT NULL DEFAULT 'NORMAL',
  "welcomeMessage"    TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_categories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ticket_categories_configId_idx" ON "ticket_categories"("configId");
CREATE INDEX IF NOT EXISTS "ticket_categories_guildId_idx"  ON "ticket_categories"("guildId");
ALTER TABLE "ticket_categories" DROP CONSTRAINT IF EXISTS "ticket_categories_configId_fkey";
ALTER TABLE "ticket_categories" ADD CONSTRAINT "ticket_categories_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "ticket_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TicketCategoryQuestion
CREATE TABLE IF NOT EXISTS "ticket_category_questions" (
  "id"          TEXT NOT NULL,
  "categoryId"  TEXT NOT NULL,
  "order"       INTEGER NOT NULL DEFAULT 0,
  "label"       TEXT NOT NULL,
  "placeholder" TEXT,
  "type"        TEXT NOT NULL DEFAULT 'short',
  "options"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "required"    BOOLEAN NOT NULL DEFAULT true,
  "minLength"   INTEGER,
  "maxLength"   INTEGER,
  CONSTRAINT "ticket_category_questions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ticket_category_questions_categoryId_idx" ON "ticket_category_questions"("categoryId");
ALTER TABLE "ticket_category_questions" DROP CONSTRAINT IF EXISTS "ticket_category_questions_categoryId_fkey";
ALTER TABLE "ticket_category_questions" ADD CONSTRAINT "ticket_category_questions_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "ticket_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TicketPriorityRule
CREATE TABLE IF NOT EXISTS "ticket_priority_rules" (
  "id"         TEXT NOT NULL,
  "configId"   TEXT NOT NULL,
  "guildId"    TEXT NOT NULL,
  "roleId"     TEXT NOT NULL,
  "priority"   "TicketPriority" NOT NULL,
  "categoryId" TEXT,
  "label"      TEXT,
  CONSTRAINT "ticket_priority_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ticket_priority_rules_configId_idx" ON "ticket_priority_rules"("configId");
ALTER TABLE "ticket_priority_rules" DROP CONSTRAINT IF EXISTS "ticket_priority_rules_configId_fkey";
ALTER TABLE "ticket_priority_rules" ADD CONSTRAINT "ticket_priority_rules_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "ticket_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TicketPanel
CREATE TABLE IF NOT EXISTS "ticket_panels" (
  "id"           TEXT NOT NULL,
  "configId"     TEXT NOT NULL,
  "guildId"      TEXT NOT NULL,
  "channelId"    TEXT NOT NULL,
  "messageId"    TEXT NOT NULL,
  "title"        TEXT NOT NULL DEFAULT '🎫 Sistema de Soporte',
  "description"  TEXT NOT NULL DEFAULT 'Abre un ticket para recibir ayuda del equipo.',
  "color"        TEXT NOT NULL DEFAULT '#00D9FF',
  "imageUrl"     TEXT,
  "thumbnailUrl" TEXT,
  "footerText"   TEXT,
  "panelType"    TEXT NOT NULL DEFAULT 'buttons',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_panels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_panels_messageId_key" ON "ticket_panels"("messageId");
CREATE INDEX IF NOT EXISTS "ticket_panels_configId_idx" ON "ticket_panels"("configId");
ALTER TABLE "ticket_panels" DROP CONSTRAINT IF EXISTS "ticket_panels_configId_fkey";
ALTER TABLE "ticket_panels" ADD CONSTRAINT "ticket_panels_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "ticket_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TicketPanelCategory (join table)
CREATE TABLE IF NOT EXISTS "ticket_panel_categories" (
  "panelId"    TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "order"      INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ticket_panel_categories_pkey" PRIMARY KEY ("panelId", "categoryId")
);
ALTER TABLE "ticket_panel_categories" DROP CONSTRAINT IF EXISTS "ticket_panel_categories_panelId_fkey";
ALTER TABLE "ticket_panel_categories" ADD CONSTRAINT "ticket_panel_categories_panelId_fkey"
  FOREIGN KEY ("panelId") REFERENCES "ticket_panels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_panel_categories" DROP CONSTRAINT IF EXISTS "ticket_panel_categories_categoryId_fkey";
ALTER TABLE "ticket_panel_categories" ADD CONSTRAINT "ticket_panel_categories_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "ticket_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TicketTemplate
CREATE TABLE IF NOT EXISTS "ticket_templates" (
  "id"        TEXT NOT NULL,
  "configId"  TEXT NOT NULL,
  "guildId"   TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ticket_templates_configId_idx" ON "ticket_templates"("configId");
ALTER TABLE "ticket_templates" DROP CONSTRAINT IF EXISTS "ticket_templates_configId_fkey";
ALTER TABLE "ticket_templates" ADD CONSTRAINT "ticket_templates_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "ticket_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TicketTag
CREATE TABLE IF NOT EXISTS "ticket_tags" (
  "id"       TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "guildId"  TEXT NOT NULL,
  "name"     TEXT NOT NULL,
  "emoji"    TEXT,
  "color"    TEXT NOT NULL DEFAULT '#5865F2',
  CONSTRAINT "ticket_tags_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_tags_configId_name_key" ON "ticket_tags"("configId", "name");
CREATE INDEX IF NOT EXISTS "ticket_tags_configId_idx" ON "ticket_tags"("configId");
ALTER TABLE "ticket_tags" DROP CONSTRAINT IF EXISTS "ticket_tags_configId_fkey";
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "ticket_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ticket
CREATE TABLE IF NOT EXISTS "tickets" (
  "id"              TEXT NOT NULL,
  "ticketNumber"    INTEGER NOT NULL,
  "guildId"         TEXT NOT NULL,
  "channelId"       TEXT NOT NULL,
  "authorId"        TEXT NOT NULL,
  "configId"        TEXT NOT NULL,
  "categoryId"      TEXT,
  "panelId"         TEXT,
  "status"          "TicketStatus" NOT NULL DEFAULT 'OPEN',
  "priority"        "TicketPriority" NOT NULL DEFAULT 'NORMAL',
  "priorityReason"  TEXT,
  "topic"           TEXT,
  "answers"         JSONB,
  "tags"            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "claimedBy"       TEXT,
  "claimedAt"       TIMESTAMP(3),
  "closedBy"        TEXT,
  "closeReason"     TEXT,
  "closedAt"        TIMESTAMP(3),
  "moveHistory"     JSONB,
  "transferHistory" JSONB,
  "firstResponseAt" TIMESTAMP(3),
  "lastActivityAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "slaDeadline"     TIMESTAMP(3),
  "rating"          INTEGER,
  "feedback"        TEXT,
  "ratedAt"         TIMESTAMP(3),
  "warningSentAt"   TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tickets_channelId_key"             ON "tickets"("channelId");
CREATE UNIQUE INDEX IF NOT EXISTS "tickets_guildId_ticketNumber_key"  ON "tickets"("guildId", "ticketNumber");
CREATE INDEX IF NOT EXISTS "tickets_guildId_idx"        ON "tickets"("guildId");
CREATE INDEX IF NOT EXISTS "tickets_authorId_idx"       ON "tickets"("authorId");
CREATE INDEX IF NOT EXISTS "tickets_status_idx"         ON "tickets"("status");
CREATE INDEX IF NOT EXISTS "tickets_categoryId_idx"     ON "tickets"("categoryId");
CREATE INDEX IF NOT EXISTS "tickets_lastActivityAt_idx" ON "tickets"("lastActivityAt");
CREATE INDEX IF NOT EXISTS "tickets_slaDeadline_idx"    ON "tickets"("slaDeadline");
ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_guildId_fkey";
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_configId_fkey";
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "ticket_configs"("id") ON UPDATE CASCADE;
ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_categoryId_fkey";
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "ticket_categories"("id") ON UPDATE CASCADE;

-- TicketParticipant
CREATE TABLE IF NOT EXISTS "ticket_participants" (
  "id"       TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "userId"   TEXT NOT NULL,
  "addedBy"  TEXT NOT NULL,
  "addedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_participants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_participants_ticketId_userId_key" ON "ticket_participants"("ticketId", "userId");
CREATE INDEX IF NOT EXISTS "ticket_participants_ticketId_idx" ON "ticket_participants"("ticketId");
ALTER TABLE "ticket_participants" DROP CONSTRAINT IF EXISTS "ticket_participants_ticketId_fkey";
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TicketMessage
CREATE TABLE IF NOT EXISTS "ticket_messages" (
  "id"          TEXT NOT NULL,
  "ticketId"    TEXT NOT NULL,
  "authorId"    TEXT NOT NULL,
  "content"     TEXT NOT NULL,
  "attachments" JSONB NOT NULL DEFAULT '[]',
  "isStaff"     BOOLEAN NOT NULL DEFAULT false,
  "isNote"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ticket_messages_ticketId_idx"  ON "ticket_messages"("ticketId");
CREATE INDEX IF NOT EXISTS "ticket_messages_createdAt_idx" ON "ticket_messages"("createdAt");
ALTER TABLE "ticket_messages" DROP CONSTRAINT IF EXISTS "ticket_messages_ticketId_fkey";
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TicketTranscript
CREATE TABLE IF NOT EXISTS "ticket_transcripts" (
  "id"           TEXT NOT NULL,
  "ticketId"     TEXT NOT NULL,
  "htmlContent"  TEXT NOT NULL,
  "messageCount" INTEGER NOT NULL,
  "participants" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "closedBy"     TEXT NOT NULL,
  "closeReason"  TEXT,
  "rating"       INTEGER,
  "feedback"     TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_transcripts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_transcripts_ticketId_key" ON "ticket_transcripts"("ticketId");
ALTER TABLE "ticket_transcripts" DROP CONSTRAINT IF EXISTS "ticket_transcripts_ticketId_fkey";
ALTER TABLE "ticket_transcripts" ADD CONSTRAINT "ticket_transcripts_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

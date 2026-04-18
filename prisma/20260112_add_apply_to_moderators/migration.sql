-- Add applyToModerators field to moderation_configs
ALTER TABLE "moderation_configs" ADD COLUMN "applyToModerators" BOOLEAN NOT NULL DEFAULT false;

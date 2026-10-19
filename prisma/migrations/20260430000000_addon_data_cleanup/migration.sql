-- Migration: addon_data_cleanup
-- Adds data-lifecycle tracking fields to addon_licenses.
-- These support the 30-day grace period: day 29 warning DM, day 30 permanent deletion.

ALTER TABLE "addon_licenses"
  ADD COLUMN "dataWarnedAt"  TIMESTAMP(3),
  ADD COLUMN "dataDeletedAt" TIMESTAMP(3);

-- Index for the cleanup job query: non-deleted licenses past grace period
CREATE INDEX "addon_licenses_dataDeletedAt_idx" ON "addon_licenses"("dataDeletedAt");

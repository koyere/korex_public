/**
 * Migration Script: Unify AutoRoles in GuildConfig
 * 
 * This script migrates autoRoles data from WelcomeConfig to GuildConfig
 * to have a single source of truth for all autorole configurations.
 * 
 * Steps:
 * 1. Read all WelcomeConfig records with autoRoles
 * 2. Migrate data to GuildConfig.autoRoleJoinRoles
 * 3. Verify data integrity
 * 4. Clear autoRoles from WelcomeConfig (will be removed from schema later)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MigrationStats {
  total: number;
  migrated: number;
  skipped: number;
  errors: number;
}

async function migrateAutoRoles(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0
  };

  console.log('🚀 Starting AutoRoles migration...\n');

  try {
    // Step 1: Get all WelcomeConfig records with autoRoles
    const welcomeConfigs = await prisma.welcomeConfig.findMany({
      where: {
        autoRoles: {
          isEmpty: false
        }
      },
      select: {
        guildId: true,
        autoRoles: true,
        autoRoleEnabled: true
      }
    });

    stats.total = welcomeConfigs.length;
    console.log(`📊 Found ${stats.total} guilds with autoRoles configured\n`);

    // Step 2: Migrate each guild
    for (const config of welcomeConfigs) {
      try {
        console.log(`Processing guild: ${config.guildId}`);
        console.log(`  - AutoRoles: ${config.autoRoles.length} roles`);
        console.log(`  - Enabled: ${config.autoRoleEnabled}`);

        // Get or create GuildConfig
        let guildConfig = await prisma.guildConfig.findUnique({
          where: { guildId: config.guildId }
        });

        if (!guildConfig) {
          console.log(`  ⚠️  GuildConfig not found, creating...`);
          guildConfig = await prisma.guildConfig.create({
            data: {
              guildId: config.guildId,
              autoRoleEnabled: config.autoRoleEnabled,
              autoRoleJoinRoles: config.autoRoles,
              autoRoleLevelRoles: [],
              autoRoleBoostRoles: []
            }
          });
          console.log(`  ✅ Created GuildConfig with autoRoles`);
        } else {
          // Update existing GuildConfig
          const existingJoinRoles = (guildConfig.autoRoleJoinRoles as any) || [];
          
          // Merge roles (avoid duplicates)
          const mergedRoles = Array.from(new Set([...existingJoinRoles, ...config.autoRoles]));
          
          await prisma.guildConfig.update({
            where: { guildId: config.guildId },
            data: {
              autoRoleEnabled: config.autoRoleEnabled,
              autoRoleJoinRoles: mergedRoles
            }
          });
          console.log(`  ✅ Updated GuildConfig (merged ${mergedRoles.length} roles)`);
        }

        stats.migrated++;
        console.log(`  ✅ Migration successful\n`);

      } catch (error) {
        stats.errors++;
        console.error(`  ❌ Error migrating guild ${config.guildId}:`, error);
        console.log('');
      }
    }

    // Step 3: Verify migration
    console.log('\n🔍 Verifying migration...');
    const verifyCount = await prisma.guildConfig.count({
      where: {
        autoRoleJoinRoles: {
          not: []
        }
      }
    });
    console.log(`✅ Verified: ${verifyCount} guilds have autoRoleJoinRoles configured\n`);

    // Step 4: Clear autoRoles from WelcomeConfig (optional, for cleanup)
    console.log('🧹 Cleaning up WelcomeConfig.autoRoles...');
    const clearResult = await prisma.welcomeConfig.updateMany({
      where: {
        autoRoles: {
          isEmpty: false
        }
      },
      data: {
        autoRoles: []
      }
    });
    console.log(`✅ Cleared autoRoles from ${clearResult.count} WelcomeConfig records\n`);

  } catch (error) {
    console.error('❌ Fatal error during migration:', error);
    throw error;
  }

  return stats;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AutoRoles Migration: WelcomeConfig → GuildConfig');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    const stats = await migrateAutoRoles();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Migration Summary');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total guilds processed: ${stats.total}`);
    console.log(`Successfully migrated:  ${stats.migrated} ✅`);
    console.log(`Skipped:                ${stats.skipped}`);
    console.log(`Errors:                 ${stats.errors} ${stats.errors > 0 ? '❌' : ''}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    if (stats.errors === 0) {
      console.log('🎉 Migration completed successfully!\n');
    } else {
      console.log('⚠️  Migration completed with errors. Please review the logs.\n');
    }

  } catch (error) {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

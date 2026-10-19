#!/usr/bin/env node

/**
 * Korex Sharding Manager Entry Point
 * This file is run to start the sharding system
 */

import { KorexShardingManager } from './sharding/ShardingManager';
import { createLogger } from './utils/Logger';
import figlet from 'figlet';
import chalk from 'chalk';

const logger = createLogger('shard-manager');

// Startup banner
function showBanner(): void {
  console.log(
    chalk.cyan(
      figlet.textSync('KOREX', {
        font: 'ANSI Shadow',
        horizontalLayout: 'default',
        verticalLayout: 'default'
      })
    )
  );
  
  console.log(chalk.blue('═'.repeat(60)));
  console.log(chalk.white.bold('🚀 KOREX SHARDING MANAGER'));
  console.log(chalk.gray('The Core of Your Community - Production Ready'));
  console.log(chalk.blue('═'.repeat(60)));
  console.log();
}

async function main(): Promise<void> {
  try {
    // Show banner
    showBanner();

    // Validate critical environment variables
    const requiredEnvVars = [
      'DISCORD_TOKEN',
      'DATABASE_URL',
      'REDIS_URL',
      'JWT_SECRET',
      'ENCRYPTION_KEY'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      logger.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
      process.exit(1);
    }

    // Create and configure the sharding manager
    const shardManager = new KorexShardingManager();

    // Event handlers for the sharding manager
    shardManager.on('ready', () => {
      logger.info('🎉 All shards are ready! Korex is now operational.');
    });

    shardManager.on('shardReady', (shardId: number) => {
      logger.info(`✅ Shard ${shardId} is ready`);
    });

    shardManager.on('shardDeath', (shardId: number) => {
      logger.error(`💀 Shard ${shardId} died`);
    });

    shardManager.on('shardError', (shardId: number, error: Error) => {
      logger.error(`❌ Shard ${shardId} error:`, error);
    });

    shardManager.on('shardMaxRestartsExceeded', (shardId: number) => {
      logger.error(`🚨 Shard ${shardId} exceeded maximum restart attempts`);
    });

    shardManager.on('statsUpdate', (stats) => {
      logger.info(`📊 Global Stats: ${stats.totalGuilds} guilds, ${stats.totalUsers} users, ${stats.readyShards}/${stats.totalShards} shards`);
    });

    // Start the sharding manager
    await shardManager.start();

    // Set up handlers for process commands
    process.on('message', async (message: any) => {
      if (typeof message !== 'object') return;

      switch (message.type) {
        case 'RESTART_ALL_SHARDS':
          logger.info('📨 Received restart all shards command');
          await shardManager.restartAllShards();
          break;

        case 'GET_STATS':
          const stats = await shardManager.getGlobalStats();

          process.send?.({ type: 'STATS_RESPONSE', data: stats });
          break;

        case 'RESTART_SHARD':
          if (typeof message.shardId === 'number') {
            logger.info(`📨 Received restart shard ${message.shardId} command`);
            await shardManager.restartShard(message.shardId);
          }
          break;

      }
    });

    // Periodic statistics
    setInterval(async () => {
      try {
        const stats = await shardManager.getGlobalStats();
        const shardStats = shardManager.getShardStats();
        
        logger.info(`📈 System Status:`);
        logger.info(`   Shards: ${stats.readyShards}/${stats.totalShards} ready`);
        logger.info(`   Guilds: ${stats.totalGuilds.toLocaleString()}`);
        logger.info(`   Users: ${stats.totalUsers.toLocaleString()}`);
        logger.info(`   Avg Ping: ${stats.averagePing}ms`);
        logger.info(`   Memory: ${Math.round(stats.totalMemory / 1024 / 1024)}MB`);
        logger.info(`   Uptime: ${Math.round(stats.uptime / 1000 / 60)} minutes`);

        // Show the status of each shard
        shardStats.forEach(shard => {
          const memoryMB = Math.round(shard.memory.heapUsed / 1024 / 1024);
          const status = shard.status === 'ready' ? '✅' : '⚠️';

          logger.debug(`   ${status} Shard ${shard.id}: ${shard.guilds} guilds, ${shard.ping}ms, ${memoryMB}MB`);
        });

      } catch (error) {
        logger.error('Error collecting periodic stats:', error);
      }
    }, 300000); // Every 5 minutes

  } catch (error) {
    logger.error('❌ Fatal error in sharding manager:', error);
    process.exit(1);
  }
}

// Uncaught error handling
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start
main().catch((error) => {
  logger.error('Failed to start sharding manager:', error);
  process.exit(1);
});
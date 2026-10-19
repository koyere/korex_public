#!/usr/bin/env tsx
/**
 * Health Check script for Korex
 * Checks the status of the system and all its components
 */

import { KorexClient } from '../src/client/KorexClient';
import { createLogger } from '../src/utils/Logger';

const logger = createLogger('health-check');

async function performHealthCheck() {
  logger.info('🔍 Starting system health check...');

  try {
    // Create a temporary client for the health check
    const client = new KorexClient();
    
    // Connect only to the required services
    await client.database.connect();
    await client.redis.connect();

    // Run the full health check
    const health = await client.healthCheck();
    
    // Show results
    logger.info('📊 Health Check Results:');
    logger.info(`Overall Status: ${health.status}`);
    
    Object.entries(health.checks).forEach(([service, check]) => {
      const status = check.status === 'ok' ? '✅' : '❌';
      logger.info(`${status} ${service}: ${check.status}`);
      
      if (check.latency) {
        logger.info(`   Latency: ${check.latency}ms`);
      }
      
      if (check.error) {
        logger.error(`   Error: ${check.error}`);
      }
    });

    // Production health check if available
    if (health.production) {
      logger.info('🏭 Production Health:');
      logger.info(`Status: ${health.production.overall}`);
      logger.info(`Uptime: ${Math.round(health.production.uptime / 60)} minutes`);
      
      health.production.checks.forEach(check => {
        const status = check.status === 'healthy' ? '✅' : 
                      check.status === 'degraded' ? '⚠️' : '❌';
        logger.info(`${status} ${check.name}: ${check.status} (${check.responseTime}ms)`);
      });
    }

    // Disconnect
    await client.database.disconnect();
    await client.redis.disconnect();

    // Exit code based on status
    const exitCode = health.status === 'healthy' ? 0 : 
                     health.status === 'degraded' ? 1 : 2;
    
    logger.info(`✅ Health check completed with status: ${health.status}`);
    process.exit(exitCode);

  } catch (error) {
    logger.error('❌ Health check failed:', error);
    process.exit(3);
  }
}

// Run if called directly
if (require.main === module) {
  performHealthCheck();
}

export { performHealthCheck };
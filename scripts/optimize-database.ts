#!/usr/bin/env tsx
/**
 * Database Optimization Script for Korex
 * Runs DB optimizations to improve performance
 */

import { PrismaClient } from '@prisma/client';
import { DatabaseOptimizer } from '../src/database/optimization/DatabaseOptimizer';
import { createLogger } from '../src/utils/Logger';

const logger = createLogger('db-optimizer');

async function optimizeDatabase() {
  logger.info('🔧 Starting database optimization...');

  const prisma = new PrismaClient();
  const optimizer = new DatabaseOptimizer(prisma);

  try {
    // Run full optimizations
    const results = await optimizer.optimizeDatabase();
    
    // Show results
    logger.info('📊 Optimization Results:');
    
    let successCount = 0;
    let failureCount = 0;
    
    results.forEach(result => {
      if (result.success) {
        successCount++;
        logger.info(`✅ ${result.operation} (${result.duration}ms)`);
        if (result.details) {
          logger.info(`   ${result.details}`);
        }
      } else {
        failureCount++;
        logger.error(`❌ ${result.operation}`);
        if (result.error) {
          logger.error(`   Error: ${result.error}`);
        }
      }
    });

    // Run VACUUM ANALYZE
    logger.info('🧹 Running VACUUM ANALYZE...');
    const vacuumResults = await optimizer.vacuumAnalyze();
    
    vacuumResults.forEach(result => {
      if (result.success) {
        logger.info(`✅ ${result.operation} (${result.duration}ms)`);
      } else {
        logger.error(`❌ ${result.operation}: ${result.error}`);
      }
    });

    // Check DB health
    logger.info('🏥 Checking database health...');
    const health = await optimizer.checkDatabaseHealth();
    
    logger.info(`Database Status: ${health.connectionStatus}`);
    logger.info(`Average Query Time: ${health.averageQueryTime}ms`);
    logger.info(`Active Connections: ${health.connectionCount}`);
    
    if (health.recommendations.length > 0) {
      logger.info('💡 Recommendations:');
      health.recommendations.forEach(rec => {
        logger.info(`   - ${rec}`);
      });
    }

    logger.info(`✅ Database optimization completed (${successCount} successful, ${failureCount} failed)`);
    
    await prisma.$disconnect();
    process.exit(failureCount > 0 ? 1 : 0);

  } catch (error) {
    logger.error('❌ Database optimization failed:', error);
    await prisma.$disconnect();
    process.exit(2);
  }
}

// Run if called directly
if (require.main === module) {
  optimizeDatabase();
}

export { optimizeDatabase };
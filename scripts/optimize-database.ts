#!/usr/bin/env tsx
/**
 * Script de Optimización de Base de Datos para Korex
 * Ejecuta optimizaciones de BD para mejorar el rendimiento
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
    // Ejecutar optimizaciones completas
    const results = await optimizer.optimizeDatabase();
    
    // Mostrar resultados
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

    // Ejecutar VACUUM ANALYZE
    logger.info('🧹 Running VACUUM ANALYZE...');
    const vacuumResults = await optimizer.vacuumAnalyze();
    
    vacuumResults.forEach(result => {
      if (result.success) {
        logger.info(`✅ ${result.operation} (${result.duration}ms)`);
      } else {
        logger.error(`❌ ${result.operation}: ${result.error}`);
      }
    });

    // Verificar salud de la BD
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

// Ejecutar si es llamado directamente
if (require.main === module) {
  optimizeDatabase();
}

export { optimizeDatabase };
#!/usr/bin/env tsx
/**
 * Script de Health Check para Korex
 * Verifica el estado del sistema y todos sus componentes
 */

import { KorexClient } from '../src/client/KorexClient';
import { createLogger } from '../src/utils/Logger';

const logger = createLogger('health-check');

async function performHealthCheck() {
  logger.info('🔍 Starting system health check...');

  try {
    // Crear cliente temporal para health check
    const client = new KorexClient();
    
    // Conectar solo a servicios necesarios
    await client.database.connect();
    await client.redis.connect();

    // Realizar health check completo
    const health = await client.healthCheck();
    
    // Mostrar resultados
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

    // Health check de producción si está disponible
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

    // Desconectar
    await client.database.disconnect();
    await client.redis.disconnect();

    // Exit code basado en el estado
    const exitCode = health.status === 'healthy' ? 0 : 
                     health.status === 'degraded' ? 1 : 2;
    
    logger.info(`✅ Health check completed with status: ${health.status}`);
    process.exit(exitCode);

  } catch (error) {
    logger.error('❌ Health check failed:', error);
    process.exit(3);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  performHealthCheck();
}

export { performHealthCheck };
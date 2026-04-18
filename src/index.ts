import 'dotenv/config';
import { KorexClient } from './client/KorexClient';
import { logger } from './utils/Logger';

// Verificar Node.js version
const nodeVersion = process.version;
const requiredVersion = 'v18.0.0';

if (nodeVersion < requiredVersion) {
  logger.error(
    `❌ Node.js ${requiredVersion} o superior requerido. Versión actual: ${nodeVersion}`
  );
  process.exit(1);
}

// Crear instancia del cliente
const client = new KorexClient();

// Función principal
async function main() {
  try {
    // Mostrar banner
    showBanner();

    // Iniciar el bot
    await client.start();

    // Configurar handlers de proceso
    setupProcessHandlers();
  } catch (error) {
    logger.error('❌ Error fatal durante la inicialización:', error);
    process.exit(1);
  }
}

/**
 * Mostrar banner de inicio
 */
function showBanner() {
  const banner = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ██╗  ██╗ ██████╗ ██████╗ ███████╗██╗  ██╗                ║
║   ██║ ██╔╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝                ║
║   █████╔╝ ██║   ██║██████╔╝█████╗   ╚███╔╝                 ║
║   ██╔═██╗ ██║   ██║██╔══██╗██╔══╝   ██╔██╗                 ║
║   ██║  ██╗╚██████╔╝██║  ██║███████╗██╔╝ ██╗                ║
║   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝                ║
║                                                              ║
║              "The Core of Your Community"                    ║
║                                                              ║
║  Version: ${(process.env.npm_package_version || '1.0.0').padEnd(8)} │ Environment: ${(process.env.NODE_ENV || 'development').padEnd(11)} ║
║  Node.js: ${nodeVersion.padEnd(8)} │ Platform: ${process.platform.padEnd(14)} ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

  console.log(banner);
}

/**
 * Configurar handlers de señales del proceso
 */
function setupProcessHandlers() {
  // Graceful shutdown en SIGINT (Ctrl+C)
  process.on('SIGINT', async () => {
    logger.info('📡 Señal SIGINT recibida, iniciando apagado graceful...');
    await client.shutdown(0);
  });

  // Graceful shutdown en SIGTERM
  process.on('SIGTERM', async () => {
    logger.info('📡 Señal SIGTERM recibida, iniciando apagado graceful...');
    await client.shutdown(0);
  });

  // Manejar excepciones no capturadas
  process.on('uncaughtException', (error) => {
    logger.error('💥 Excepción no capturada:', error);

    // Intentar apagado graceful, pero con timeout
    const shutdownTimeout = setTimeout(() => {
      logger.error('⏰ Timeout en apagado graceful, forzando salida');
      process.exit(1);
    }, 10000); // 10 segundos

    client.shutdown(1).finally(() => {
      clearTimeout(shutdownTimeout);
    });
  });

  // Manejar promesas rechazadas no manejadas
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('🚫 Promesa rechazada no manejada:', reason);
    logger.error('En promesa:', promise);

    // No salir inmediatamente, solo loggear
    // En producción podrías querer salir dependiendo de la severidad
  });

  // Manejar advertencias
  process.on('warning', (warning) => {
    logger.warn('⚠️ Advertencia del proceso:', {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    });
  });

  // Información de memoria cada 30 minutos en desarrollo
  if (process.env.NODE_ENV === 'development') {
    setInterval(
      () => {
        const memUsage = process.memoryUsage();
        const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

        logger.debug('📊 Uso de memoria:', {
          rss: formatBytes(memUsage.rss),
          heapTotal: formatBytes(memUsage.heapTotal),
          heapUsed: formatBytes(memUsage.heapUsed),
          external: formatBytes(memUsage.external),
        });
      },
      30 * 60 * 1000
    ); // 30 minutos
  }

  logger.info('✅ Handlers de proceso configurados');
}

// Ejecutar función principal
main().catch((error) => {
  logger.error('💀 Error fatal en función principal:', error);
  process.exit(1);
});

// Exportar cliente para uso en tests o scripts
export { client };

import 'dotenv/config';
import { KorexClient } from './client/KorexClient';
import { logger } from './utils/Logger';

// Check Node.js version
const nodeVersion = process.version;
const requiredVersion = 'v18.0.0';

if (nodeVersion < requiredVersion) {
  logger.error(
    `❌ Node.js ${requiredVersion} or higher required. Current version: ${nodeVersion}`
  );
  process.exit(1);
}

// Create client instance
const client = new KorexClient();

// Main function
async function main() {
  try {
    // Show banner
    showBanner();

    // Start the bot
    await client.start();

    // Set up process handlers
    setupProcessHandlers();
  } catch (error) {
    logger.error('❌ Fatal error during initialization:', error);
    process.exit(1);
  }
}

/**
 * Show startup banner
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
 * Set up process signal handlers
 */
function setupProcessHandlers() {
  // Graceful shutdown on SIGINT (Ctrl+C)
  process.on('SIGINT', async () => {
    logger.info('📡 SIGINT received, starting graceful shutdown...');
    await client.shutdown(0);
  });

  // Graceful shutdown on SIGTERM
  process.on('SIGTERM', async () => {
    logger.info('📡 SIGTERM received, starting graceful shutdown...');
    await client.shutdown(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('💥 Uncaught exception:', error);

    // Try graceful shutdown, but with a timeout
    const shutdownTimeout = setTimeout(() => {
      logger.error('⏰ Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10000); // 10 seconds

    client.shutdown(1).finally(() => {
      clearTimeout(shutdownTimeout);
    });
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('🚫 Unhandled promise rejection:', reason);
    logger.error('In promise:', promise);

    // Don't exit immediately, just log
    // In production you may want to exit depending on severity
  });

  // Handle warnings
  process.on('warning', (warning) => {
    logger.warn('⚠️ Process warning:', {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    });
  });

  // Memory info every 30 minutes in development
  if (process.env.NODE_ENV === 'development') {
    setInterval(
      () => {
        const memUsage = process.memoryUsage();
        const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

        logger.debug('📊 Memory usage:', {
          rss: formatBytes(memUsage.rss),
          heapTotal: formatBytes(memUsage.heapTotal),
          heapUsed: formatBytes(memUsage.heapUsed),
          external: formatBytes(memUsage.external),
        });
      },
      30 * 60 * 1000
    ); // 30 minutes
  }

  logger.info('✅ Process handlers configured');
}

// Run main function
main().catch((error) => {
  logger.error('💀 Fatal error in main function:', error);
  process.exit(1);
});

// Export client for use in tests or scripts
export { client };

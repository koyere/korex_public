import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';
import crypto from 'crypto';

export interface LicenseInfo {
  id: string;
  addonId: string;
  guildId: string;
  type: 'FREE' | 'PREMIUM' | 'ENTERPRISE';
  expiresAt: Date | null;
  features: string[];
  isActive: boolean;
  metadata: Record<string, any>;
}

export interface LicenseValidationResult {
  valid: boolean;
  license: LicenseInfo | null;
  reason?: string;
  remainingDays?: number;
}

export class LicenseService {
  private static instance: LicenseService;
  private logger = logger;
  private db: DatabaseManager;
  private licenseCache = new Map<string, LicenseInfo>();

  private constructor(db: DatabaseManager) {
    this.db = db;
  }

  public static getInstance(db?: DatabaseManager): LicenseService {
    if (!LicenseService.instance) {
      if (!db) {
        throw new Error('DatabaseManager is required for first initialization');
      }
      LicenseService.instance = new LicenseService(db);
    }

    return LicenseService.instance;
  }

  /**
   * Validates a license for a specific addon in a server
   */
  public async validateLicense(
    addonId: string,
    guildId: string,
    requiredFeature?: string
  ): Promise<LicenseValidationResult> {
    try {
      const cacheKey = `${addonId}:${guildId}`;

      // Check cache first
      let license = this.licenseCache.get(cacheKey);

      if (!license) {
        // Look up in database
        const dbLicense = await this.db.prisma.license.findFirst({
          where: {
            addonId,
            guildId,
            isActive: true,
          },
        });

        if (!dbLicense) {
          return {
            valid: false,
            license: null,
            reason: 'No license found for this addon',
          };
        }

        license = {
          id: dbLicense.id,
          addonId: dbLicense.addonId,
          guildId: dbLicense.guildId,
          type: dbLicense.type as 'FREE' | 'PREMIUM' | 'ENTERPRISE',
          expiresAt: dbLicense.expiresAt || null,
          features: dbLicense.features as string[],
          isActive: dbLicense.isActive,
          metadata: (dbLicense.metadata as Record<string, any>) || {},
        };

        // Cache for 5 minutes
        this.licenseCache.set(cacheKey, license);
        setTimeout(() => this.licenseCache.delete(cacheKey), 5 * 60 * 1000);
      }

      // Check whether the license has expired
      if (license.expiresAt && license.expiresAt < new Date()) {
        await this.deactivateLicense(license.id);

        return {
          valid: false,
          license: null,
          reason: 'License has expired',
        };
      }

      // Check specific feature if required
      if (requiredFeature && !license.features.includes(requiredFeature)) {
        return {
          valid: false,
          reason: `Feature '${requiredFeature}' not included in license`,
          license,
        };
      }

      // Compute remaining days if it has an expiration
      let remainingDays: number | undefined;

      if (license.expiresAt) {
        const diffTime = license.expiresAt.getTime() - new Date().getTime();

        remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }

      return {
        valid: true,
        license,
        ...(remainingDays !== undefined && { remainingDays }),
      };
    } catch (error) {
      this.logger.error('Error validating license:', error);

      return {
        valid: false,
        license: null,
        reason: 'Internal error validating license',
      };
    }
  }

  /**
   * Creates a new license
   */
  public async createLicense(
    addonId: string,
    guildId: string,
    type: 'FREE' | 'PREMIUM' | 'ENTERPRISE',
    features: string[],
    expiresAt?: Date,
    metadata?: Record<string, any>
  ): Promise<LicenseInfo> {
    try {
      const licenseId = this.generateLicenseId();

      const dbLicense = await this.db.prisma.license.create({
        data: {
          id: licenseId,
          addonId,
          guildId,
          type,
          features,
          expiresAt: expiresAt || null,
          isActive: true,
          metadata: metadata || {},
        },
      });

      const license: LicenseInfo = {
        id: dbLicense.id,
        addonId: dbLicense.addonId,
        guildId: dbLicense.guildId,
        type: dbLicense.type as 'FREE' | 'PREMIUM' | 'ENTERPRISE',
        expiresAt: dbLicense.expiresAt || null,
        features: dbLicense.features as string[],
        isActive: dbLicense.isActive,
        metadata: (dbLicense.metadata as Record<string, any>) || {},
      };

      // Clear cache to force a reload
      const cacheKey = `${addonId}:${guildId}`;

      this.licenseCache.delete(cacheKey);

      this.logger.info(`License created: ${licenseId} for addon ${addonId} in guild ${guildId}`);

      return license;
    } catch (error) {
      this.logger.error('Error creating license:', error);
      throw new Error('Failed to create license');
    }
  }

  /**
   * Deactivates a license
   */
  public async deactivateLicense(licenseId: string): Promise<void> {
    try {
      await this.db.prisma.license.update({
        where: { id: licenseId },
        data: { isActive: false },
      });

      // Clear related cache
      for (const [key, license] of this.licenseCache.entries()) {
        if (license.id === licenseId) {
          this.licenseCache.delete(key);
          break;
        }
      }

      this.logger.info(`License deactivated: ${licenseId}`);
    } catch (error) {
      this.logger.error('Error deactivating license:', error);
      throw new Error('Failed to deactivate license');
    }
  }

  /**
   * Gets all licenses of a server
   */
  public async getGuildLicenses(guildId: string): Promise<LicenseInfo[]> {
    try {
      const dbLicenses = await this.db.prisma.license.findMany({
        where: {
          guildId,
          isActive: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return dbLicenses.map((license) => ({
        id: license.id,
        addonId: license.addonId,
        guildId: license.guildId,
        type: license.type as 'FREE' | 'PREMIUM' | 'ENTERPRISE',
        expiresAt: license.expiresAt || null,
        features: license.features as string[],
        isActive: license.isActive,
        metadata: (license.metadata as Record<string, any>) || {},
      }));
    } catch (error) {
      this.logger.error('Error getting guild licenses:', error);

      return [];
    }
  }

  /**
   * Checks whether an addon has a free license available
   */
  public async hasFreeLicense(addonId: string, guildId: string): Promise<boolean> {
    const validation = await this.validateLicense(addonId, guildId);

    return validation.valid && validation.license?.type === 'FREE';
  }

  /**
   * Checks whether an addon has a premium license
   */
  public async hasPremiumLicense(addonId: string, guildId: string): Promise<boolean> {
    const validation = await this.validateLicense(addonId, guildId);

    return validation.valid && ['PREMIUM', 'ENTERPRISE'].includes(validation.license?.type || '');
  }

  /**
   * Generates a unique ID for the license
   */
  private generateLicenseId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');

    return `lic_${timestamp}_${random}`;
  }

  /**
   * Clears the license cache
   */
  public clearCache(): void {
    this.licenseCache.clear();
    this.logger.debug('License cache cleared');
  }

  /**
   * Gets license statistics
   */
  public async getLicenseStats(): Promise<{
    total: number;
    active: number;
    expired: number;
    byType: Record<string, number>;
  }> {
    try {
      const [total, active, expired, byType] = await Promise.all([
        this.db.prisma.license.count(),
        this.db.prisma.license.count({ where: { isActive: true } }),
        this.db.prisma.license.count({
          where: {
            isActive: false,
            expiresAt: { lt: new Date() },
          },
        }),
        this.db.prisma.license.groupBy({
          by: ['type'],
          _count: { type: true },
          where: { isActive: true },
        }),
      ]);

      const typeStats: Record<string, number> = {};

      byType.forEach((item) => {
        typeStats[item.type] = item._count.type;
      });

      return {
        total,
        active,
        expired,
        byType: typeStats,
      };
    } catch (error) {
      this.logger.error('Error getting license stats:', error);

      return {
        total: 0,
        active: 0,
        expired: 0,
        byType: {},
      };
    }
  }
}

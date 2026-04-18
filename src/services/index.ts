// Servicios Base del Bot KOREX
export { LicenseService } from './LicenseService';
export { ErrorHandler } from './ErrorHandler';
export { ModerationService } from './ModerationService';
export { EconomyService } from './EconomyService';
export { LevelService } from './LevelService';

// Tipos exportados
export type { LicenseInfo, LicenseValidationResult } from './LicenseService';

export type { ErrorContext, ErrorReport } from './ErrorHandler';

export type { ModerationAction, ModerationConfig, AutoModRule } from './ModerationService';

export type { EconomyUser, EconomyConfig, TransactionResult } from './EconomyService';

export type { LevelUser, LevelConfig, LevelUpResult } from './LevelService';

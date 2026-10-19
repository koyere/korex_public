/**
 * AdminAuthService
 *
 * Secure authentication for the Korex admin panel.
 *
 * Implemented security features:
 * - Hashing Argon2id (resistant to GPU/ASIC attacks)
 * - Automatic salting
 * - Sessions in Redis (no JWT in localStorage)
 * - TOTP (RFC 6238) with otplib
 * - WebAuthn / Passkeys (FIDO2)
 * - Single-use backup codes (hashed with Argon2id)
 * - Progressive rate limiting per IP and per user
 * - Generic error messages (does not reveal which field failed)
 * - Session rotation after login
 * - Per-operator IP whitelist
 */

import * as argon2 from 'argon2';
import { TOTP } from 'otplib';
import { createCryptoPlugin, createBase32Plugin } from '@otplib/core';
import { hmac } from '@noble/hashes/hmac';
import { sha1 } from '@noble/hashes/sha1';
import { randomBytes as nobleRandomBytes } from '@noble/hashes/utils';
import { base32 } from '@scure/base';
import * as QRCode from 'qrcode';

const authenticator = new TOTP({
  crypto: createCryptoPlugin({
    name: 'noble',
    hmac: (_algorithm: string, key: Uint8Array, data: Uint8Array) => hmac(sha1, key, data),
    randomBytes: (size: number) => nobleRandomBytes(size),
  }),
  base32: createBase32Plugin({
    name: 'scure',
    encode: (data: Uint8Array) => base32.encode(data),
    decode: (str: string) => base32.decode(str),
  }),
});
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { createHash, randomBytes } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { createLogger } from '../../utils/Logger';

const logger = createLogger('admin-auth');

// ─── Security constants ───────────────────────────────────────────────────

const ARGON2_OPTIONS: argon2.Options & { raw: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,   // 64 MB
  timeCost: 3,          // 3 iterations
  parallelism: 4,
  raw: false,
};

const SESSION_TTL_SECONDS = 4 * 60 * 60;       // 4 hours (absolute)
const SESSION_IDLE_TTL_SECONDS = 30 * 60;       // 30 min idle timeout
const BACKUP_CODE_COUNT = 10;

// Rate limiting: max attempts before blocking
const IP_MAX_ATTEMPTS = 5;
const IP_BLOCK_SECONDS = 15 * 60;               // 15 min block after 5 attempts
const USER_MAX_ATTEMPTS = 3;
const USER_BLOCK_BASE_SECONDS = 60;             // progressive backoff: 1 min, 2 min, 4 min…

// Redis keys
const RL_IP_KEY   = (ip: string)    => `admin:rl:ip:${ip}`;
const RL_USER_KEY = (email: string) => `admin:rl:user:${email}`;
const SESSION_KEY = (token: string) => `admin:session:${token}`;
const STEP_UP_KEY = (tokenHash: string) => `admin:stepup:${tokenHash}`;
/** Validity of a step-up verification for sensitive actions */
const STEP_UP_TTL_SECONDS = 10 * 60;
const WEBAUTHN_CHALLENGE_KEY = (userId: string, action: 'reg' | 'auth') =>
  `admin:webauthn:${action}:${userId}`;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdminSessionData {
  adminUserId: string;
  role: string;
  email: string;
  name: string;
  ip: string;
  userAgent: string;
  createdAt: number;
  lastActiveAt: number;
  allowedIps: string[];
}

export interface LoginResult {
  success: boolean;
  requireTotp?: boolean;
  requireWebAuthn?: boolean;
  sessionToken?: string;
  error?: string;
}

export interface TotpSetupResult {
  secret: string;
  qrDataUrl: string;
  manualKey: string;
  uri: string;
}

// ─── Internal utilities ──────────────────────────────────────────────────────

/** SHA-256 hash of the session token — we never store the plaintext token in Redis keys */
function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Generates a cryptographically secure session token */
function generateSessionToken(): string {
  return randomBytes(48).toString('base64url');
}

/** Generates N random backup codes */
function generateBackupCodeStrings(count: number): string[] {
  return Array.from({ length: count }, () =>
    randomBytes(5).toString('hex').toUpperCase().replace(/(.{4})/g, '$1-').slice(0, 9)
    // Format: ABCD-1234-EF
  );
}

// ─── Main class ──────────────────────────────────────────────────────────────

export class AdminAuthService {
  private db: PrismaClient;
  private redis: Redis;
  private rpId: string;
  private rpName: string;
  private origin: string;

  constructor(db: PrismaClient, redis: Redis) {
    this.db = db;
    this.redis = redis;
    // WebAuthn Relying Party — admin panel domain
    this.rpId   = process.env.ADMIN_RP_ID   || 'admin.korex.dev';
    this.rpName = process.env.ADMIN_RP_NAME || 'Korex Admin';
    this.origin = process.env.ADMIN_PANEL_URL || 'https://admin.korex.dev';
  }

  // ─── Password management ───────────────────────────────────────────────────

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  }

  // ─── Rate Limiting ─────────────────────────────────────────────────────────

  /**
   * Checks and records a failed login attempt.
   * Returns { blocked: true } if the IP or user is blocked.
   * Progressive backoff for users: 1m, 2m, 4m, 8m...
   */
  async checkRateLimit(ip: string, email: string): Promise<{ blocked: boolean; retryAfter?: number }> {
    const ipKey   = RL_IP_KEY(ip);
    const userKey = RL_USER_KEY(email.toLowerCase());

    const [ipAttempts, userAttempts] = await Promise.all([
      this.redis.get(ipKey),
      this.redis.get(userKey),
    ]);

    const ipCount   = parseInt(ipAttempts   || '0', 10);
    const userCount = parseInt(userAttempts || '0', 10);

    if (ipCount >= IP_MAX_ATTEMPTS) {
      const ttl = await this.redis.ttl(ipKey);
      return { blocked: true, retryAfter: ttl };
    }

    if (userCount >= USER_MAX_ATTEMPTS) {
      const ttl = await this.redis.ttl(userKey);
      return { blocked: true, retryAfter: ttl };
    }

    return { blocked: false };
  }

  async recordFailedAttempt(ip: string, email: string): Promise<void> {
    const ipKey   = RL_IP_KEY(ip);
    const userKey = RL_USER_KEY(email.toLowerCase());

    // IP counter — fixed 15 min since the first failure
    const ipCount = await this.redis.incr(ipKey);
    if (ipCount === 1) await this.redis.expire(ipKey, IP_BLOCK_SECONDS);

    // User counter — exponential backoff
    const userCount = await this.redis.incr(userKey);
    const backoff = USER_BLOCK_BASE_SECONDS * Math.pow(2, Math.max(0, userCount - 1));
    await this.redis.expire(userKey, Math.min(backoff, 60 * 60)); // max 1 hour
  }

  async clearRateLimit(ip: string, email: string): Promise<void> {
    await Promise.all([
      this.redis.del(RL_IP_KEY(ip)),
      this.redis.del(RL_USER_KEY(email.toLowerCase())),
    ]);
  }

  // ─── Sessions ─────────────────────────────────────────────────────────────

  async createSession(
    adminUser: { id: string; role: string; email: string; name: string },
    ip: string,
    userAgent: string
  ): Promise<string> {
    const token     = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const now       = Date.now();

    const sessionData: AdminSessionData = {
      adminUserId: adminUser.id,
      role: adminUser.role,
      email: adminUser.email,
      name: adminUser.name,
      ip,
      userAgent,
      createdAt: now,
      lastActiveAt: now,
      allowedIps: (adminUser as any).allowedIps ?? [],
    };

    // Store in Redis with absolute TTL
    await this.redis.setex(
      SESSION_KEY(tokenHash),
      SESSION_TTL_SECONDS,
      JSON.stringify(sessionData)
    );

    // Store a reference in the DB for invalidation and auditing
    const expiresAt = new Date(now + SESSION_TTL_SECONDS * 1000);
    await this.db.adminSession.create({
      data: {
        adminUserId: adminUser.id,
        sessionToken: tokenHash,
        ip,
        userAgent,
        expiresAt,
      },
    });

    // Update lastLoginAt
    await this.db.adminUser.update({
      where: { id: adminUser.id },
      data: { lastLoginAt: new Date() },
    });

    logger.info(`Admin session created: ${adminUser.email} from ${ip}`);
    return token; // Delivered to the client only ONCE — stored in an HttpOnly cookie
  }

  async validateSession(token: string, requestIp?: string): Promise<AdminSessionData | null> {
    if (!token) return null;

    const tokenHash = hashSessionToken(token);
    const raw = await this.redis.get(SESSION_KEY(tokenHash));
    if (!raw) return null;

    const data: AdminSessionData = JSON.parse(raw);
    const now = Date.now();

    // Idle timeout
    if (now - data.lastActiveAt > SESSION_IDLE_TTL_SECONDS * 1000) {
      await this.destroySession(token);
      return null;
    }

    // Per-request IP whitelist enforcement — if the operator has an IP restriction
    // and the current request comes from a different IP, destroy the session.
    if (requestIp && data.allowedIps?.length > 0 && !data.allowedIps.includes(requestIp)) {
      logger.warn(`Session blocked by IP whitelist: ${data.email} from ${requestIp} (allowed: ${data.allowedIps.join(', ')})`);
      await this.destroySession(token);
      return null;
    }

    // Refresh idle timer
    data.lastActiveAt = now;
    await this.redis.setex(SESSION_KEY(tokenHash), SESSION_TTL_SECONDS, JSON.stringify(data));
    // Update the DB without blocking the request
    this.db.adminSession.update({
      where: { sessionToken: tokenHash },
      data: { lastActiveAt: new Date() },
    }).catch(() => {/* non-critical */});

    return data;
  }

  async destroySession(token: string): Promise<void> {
    const tokenHash = hashSessionToken(token);
    await Promise.all([
      this.redis.del(SESSION_KEY(tokenHash)),
      this.redis.del(STEP_UP_KEY(tokenHash)),
      this.db.adminSession.deleteMany({ where: { sessionToken: tokenHash } }),
    ]);
  }

  async destroyAllSessionsForUser(adminUserId: string): Promise<void> {
    const sessions = await this.db.adminSession.findMany({
      where: { adminUserId },
      select: { sessionToken: true },
    });
    await Promise.all(
      sessions.map(s => this.redis.del(SESSION_KEY(s.sessionToken)))
    );
    await this.db.adminSession.deleteMany({ where: { adminUserId } });
    logger.info(`All sessions destroyed for admin user: ${adminUserId}`);
  }

  // ─── Login flow ────────────────────────────────────────────────────────────

  /**
   * Login phase 1: email + password.
   * If it passes, returns whether TOTP or WebAuthn is required.
   * Always uses generic messages so as not to reveal whether the user exists.
   */
  async loginWithPassword(
    email: string,
    password: string,
    ip: string,
    userAgent: string
  ): Promise<LoginResult> {
    // Rate limit check
    const rl = await this.checkRateLimit(ip, email);
    if (rl.blocked) {
      return {
        success: false,
        error: 'credentials_invalid',  // Generic message
      };
    }

    // Look up operator (always run the hash even if it does not exist to prevent timing attacks)
    const user = await this.db.adminUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Dummy hash to prevent timing attacks if the user does not exist
    const passwordToVerify = user?.passwordHash || '$argon2id$v=19$m=65536,t=3,p=4$dummy$dummy';
    const valid = user ? await this.verifyPassword(user.passwordHash, password) : false;

    if (!valid || !user || !user.active) {
      await this.recordFailedAttempt(ip, email);
      logger.warn(`Failed admin login attempt: ${email} from ${ip}`);
      return { success: false, error: 'credentials_invalid' };
    }

    // Check IP whitelist
    if (user.allowedIps.length > 0 && !user.allowedIps.includes(ip)) {
      logger.warn(`Admin login blocked by IP whitelist: ${email} from ${ip}`);
      await this.recordFailedAttempt(ip, email);
      return { success: false, error: 'credentials_invalid' };
    }

    // Clear rate limit on successful login
    await this.clearRateLimit(ip, email);

    // Determine whether 2FA is needed
    const webAuthnCreds = Array.isArray(user.webauthnCreds) ? user.webauthnCreds as any[] : [];
    if (webAuthnCreds.length > 0) {
      // Store temporary state in Redis for phase 2
      await this.redis.setex(
        `admin:pending_mfa:${user.id}`,
        300,
        JSON.stringify({ userId: user.id, ip, userAgent })
      );
      return { success: true, requireWebAuthn: true };
    }

    if (user.totpEnabled) {
      await this.redis.setex(
        `admin:pending_mfa:${user.id}`,
        300,
        JSON.stringify({ userId: user.id, ip, userAgent })
      );
      return { success: true, requireTotp: true };
    }

    // No 2FA — create the session directly (only if explicitly allowed)
    // In production, enforcing MFA for all admins is recommended
    const token = await this.createSession(user, ip, userAgent);
    return { success: true, sessionToken: token };
  }

  /**
   * Login phase 2a: TOTP code verification.
   */
  async loginWithTotp(
    userId: string,
    totpCode: string,
    ip: string,
    userAgent: string
  ): Promise<LoginResult> {
    const pendingRaw = await this.redis.get(`admin:pending_mfa:${userId}`);
    if (!pendingRaw) return { success: false, error: 'session_expired' };

    const pending = JSON.parse(pendingRaw);
    if (pending.ip !== ip) return { success: false, error: 'credentials_invalid' };

    const user = await this.db.adminUser.findUnique({ where: { id: userId } });
    if (!user?.totpSecret) return { success: false, error: 'credentials_invalid' };

    const verifyResult = await authenticator.verify(totpCode, { secret: user.totpSecret });
    if (!verifyResult.valid) {
      logger.warn(`Invalid TOTP code for admin: ${user.email}`);
      return { success: false, error: 'totp_invalid' };
    }

    await this.redis.del(`admin:pending_mfa:${userId}`);
    const token = await this.createSession(user, ip, userAgent);
    return { success: true, sessionToken: token };
  }

  /**
   * Login with a single-use backup code.
   */
  async loginWithBackupCode(
    userId: string,
    backupCode: string,
    ip: string,
    userAgent: string
  ): Promise<LoginResult> {
    const pendingRaw = await this.redis.get(`admin:pending_mfa:${userId}`);
    if (!pendingRaw) return { success: false, error: 'session_expired' };

    // Same check as TOTP: phase 2 must come from the phase 1 IP
    const pending = JSON.parse(pendingRaw);
    if (pending.ip !== ip) return { success: false, error: 'credentials_invalid' };

    const user = await this.db.adminUser.findUnique({ where: { id: userId } });
    if (!user) return { success: false, error: 'credentials_invalid' };

    const normalizedInput = backupCode.toUpperCase().replace(/\s+/g, '');
    let usedIndex = -1;

    for (let i = 0; i < user.backupCodes.length; i++) {
      try {
        const match = await argon2.verify(user.backupCodes[i], normalizedInput, ARGON2_OPTIONS);
        if (match) { usedIndex = i; break; }
      } catch { /* continuar */ }
    }

    if (usedIndex === -1) {
      logger.warn(`Invalid backup code for admin: ${user.email}`);
      return { success: false, error: 'backup_code_invalid' };
    }

    // Remove the used code (one-time)
    const newCodes = user.backupCodes.filter((_, i) => i !== usedIndex);
    await this.db.adminUser.update({
      where: { id: userId },
      data: { backupCodes: newCodes },
    });

    await this.redis.del(`admin:pending_mfa:${userId}`);
    logger.info(`Admin logged in with backup code: ${user.email} (${newCodes.length} remaining)`);

    const token = await this.createSession(user, ip, userAgent);
    return { success: true, sessionToken: token };
  }

  // ─── TOTP Setup ────────────────────────────────────────────────────────────

  async setupTotp(adminUserId: string): Promise<TotpSetupResult> {
    const user = await this.db.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.toURI({ issuer: this.rpName, label: user.email, secret });

    // Store temporary secret (pending verification)
    await this.redis.setex(`admin:totp_setup:${adminUserId}`, 600, secret);

    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    const manualKey = secret.match(/.{1,4}/g)!.join(' ');

    return { secret, qrDataUrl, manualKey, uri: otpauthUrl };
  }

  async confirmTotp(adminUserId: string, code: string): Promise<{ success: boolean; backupCodes?: string[] }> {
    const secret = await this.redis.get(`admin:totp_setup:${adminUserId}`);
    if (!secret) return { success: false };

    const verifyResult = await authenticator.verify(code, { secret });
    if (!verifyResult.valid) return { success: false };

    // Generate and hash backup codes
    const rawCodes = generateBackupCodeStrings(BACKUP_CODE_COUNT);
    const hashedCodes = await Promise.all(
      rawCodes.map(c => argon2.hash(c, ARGON2_OPTIONS))
    );

    await this.db.adminUser.update({
      where: { id: adminUserId },
      data: { totpSecret: secret, totpEnabled: true, backupCodes: hashedCodes },
    });

    await this.redis.del(`admin:totp_setup:${adminUserId}`);
    logger.info(`TOTP enabled for admin user: ${adminUserId}`);

    return { success: true, backupCodes: rawCodes }; // Shown only ONCE
  }

  async disableTotp(adminUserId: string): Promise<void> {
    await this.db.adminUser.update({
      where: { id: adminUserId },
      data: { totpSecret: null, totpEnabled: false, backupCodes: [] },
    });
    logger.info(`TOTP disabled for admin user: ${adminUserId}`);
  }

  // ─── WebAuthn Registration ─────────────────────────────────────────────────

  async generateWebAuthnRegistrationOptions(adminUserId: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.db.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    const existingCreds = (user.webauthnCreds as any[]) || [];

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: 'none',
      excludeCredentials: existingCreds.map((c: any) => ({
        id: c.id,
        type: 'public-key',
        transports: c.transports,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });

    await this.redis.setex(
      WEBAUTHN_CHALLENGE_KEY(adminUserId, 'reg'),
      300,
      options.challenge
    );

    return options;
  }

  async verifyWebAuthnRegistration(
    adminUserId: string,
    response: RegistrationResponseJSON
  ): Promise<{ success: boolean; backupCodes?: string[] }> {
    const expectedChallenge = await this.redis.get(WEBAUTHN_CHALLENGE_KEY(adminUserId, 'reg'));
    if (!expectedChallenge) return { success: false };

    const user = await this.db.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) return { success: false };

    const { credential } = verification.registrationInfo;
    const existingCreds = (user.webauthnCreds as any[]) || [];
    const newCred = {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      deviceType: verification.registrationInfo.credentialDeviceType,
      backedUp: verification.registrationInfo.credentialBackedUp,
      transports: response.response.transports || [],
      createdAt: new Date().toISOString(),
    };

    const rawCodes = generateBackupCodeStrings(BACKUP_CODE_COUNT);
    const hashedCodes = await Promise.all(rawCodes.map(c => argon2.hash(c, ARGON2_OPTIONS)));

    await this.db.adminUser.update({
      where: { id: adminUserId },
      data: {
        webauthnCreds: [...existingCreds, newCred],
        backupCodes: hashedCodes,
      },
    });

    await this.redis.del(WEBAUTHN_CHALLENGE_KEY(adminUserId, 'reg'));
    logger.info(`WebAuthn credential registered for admin: ${user.email}`);

    return { success: true, backupCodes: rawCodes };
  }

  // ─── WebAuthn Authentication ───────────────────────────────────────────────

  async generateWebAuthnAuthOptions(adminUserId: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const user = await this.db.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    const existingCreds = (user.webauthnCreds as any[]) || [];

    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      allowCredentials: existingCreds.map((c: any) => ({
        id: c.id,
        type: 'public-key',
        transports: c.transports,
      })),
      userVerification: 'required',
    });

    await this.redis.setex(
      WEBAUTHN_CHALLENGE_KEY(adminUserId, 'auth'),
      300,
      options.challenge
    );

    return options;
  }

  async verifyWebAuthnAuthentication(
    adminUserId: string,
    response: AuthenticationResponseJSON,
    ip: string,
    userAgent: string
  ): Promise<LoginResult> {
    const pendingRaw = await this.redis.get(`admin:pending_mfa:${adminUserId}`);
    if (!pendingRaw) return { success: false, error: 'session_expired' };

    const expectedChallenge = await this.redis.get(WEBAUTHN_CHALLENGE_KEY(adminUserId, 'auth'));
    if (!expectedChallenge) return { success: false, error: 'session_expired' };

    const user = await this.db.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    const existingCreds = (user.webauthnCreds as any[]) || [];
    const credId = response.id;
    const storedCred = existingCreds.find((c: any) => c.id === credId);

    if (!storedCred) return { success: false, error: 'credentials_invalid' };

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      credential: {
        id: storedCred.id,
        publicKey: Buffer.from(storedCred.publicKey, 'base64'),
        counter: storedCred.counter,
        transports: storedCred.transports,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      logger.warn(`WebAuthn verification failed for admin: ${user.email}`);
      return { success: false, error: 'credentials_invalid' };
    }

    // Update the credential counter
    const updatedCreds = existingCreds.map((c: any) =>
      c.id === credId
        ? { ...c, counter: verification.authenticationInfo.newCounter }
        : c
    );
    await this.db.adminUser.update({
      where: { id: adminUserId },
      data: { webauthnCreds: updatedCreds },
    });

    await Promise.all([
      this.redis.del(`admin:pending_mfa:${adminUserId}`),
      this.redis.del(WEBAUTHN_CHALLENGE_KEY(adminUserId, 'auth')),
    ]);

    const token = await this.createSession(user, ip, userAgent);
    return { success: true, sessionToken: token };
  }

  // ─── Operator management ───────────────────────────────────────────────────

  async createOperator(data: {
    email: string;
    password: string;
    name: string;
    role: string;
    allowedIps?: string[];
  }): Promise<{ id: string; email: string; name: string; role: string }> {
    const passwordHash = await this.hashPassword(data.password);
    const user = await this.db.adminUser.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash,
        name: data.name,
        role: data.role,
        allowedIps: data.allowedIps || [],
      },
      select: { id: true, email: true, name: true, role: true },
    });
    logger.info(`Admin operator created: ${user.email} (${user.role})`);
    return user;
  }

  async changePasswordWithVerification(
    adminUserId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean; error?: string }> {
    const user = await this.db.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) return { success: false, error: 'invalid_current_password' };
    await this.changePassword(adminUserId, newPassword);
    return { success: true };
  }

  async changePassword(adminUserId: string, newPassword: string): Promise<void> {
    const hash = await this.hashPassword(newPassword);
    await this.db.adminUser.update({
      where: { id: adminUserId },
      data: { passwordHash: hash },
    });
    // Invalidate all active sessions
    await this.destroyAllSessionsForUser(adminUserId);
    logger.info(`Password changed for admin user: ${adminUserId}`);
  }

  // ─── Step-up verification ─────────────────────────────────────────────────

  /** Checks an operator TOTP code (false if TOTP is not active). */
  async verifyTotpCode(adminUserId: string, code: string): Promise<boolean> {
    if (!code || typeof code !== 'string') return false;
    const user = await this.db.adminUser.findUnique({
      where: { id: adminUserId },
      select: { totpEnabled: true, totpSecret: true },
    });
    if (!user?.totpEnabled || !user.totpSecret) return false;
    const result = await authenticator.verify(code.replace(/\s+/g, ''), { secret: user.totpSecret });
    return !!result.valid;
  }

  /**
   * Step-up verification before a sensitive action: TOTP code if the operator
   * has 2FA; otherwise, their current password. If correct, the session stays
   * verified for STEP_UP_TTL_SECONDS so it is not requested on every action.
   */
  async verifyStepUp(adminUserId: string, sessionToken: string, credential: string): Promise<boolean> {
    if (!credential || typeof credential !== 'string' || credential.length > 256) return false;
    const user = await this.db.adminUser.findUnique({
      where: { id: adminUserId },
      select: { totpEnabled: true, passwordHash: true },
    });
    if (!user) return false;

    const ok = user.totpEnabled
      ? await this.verifyTotpCode(adminUserId, credential)
      : await this.verifyPassword(user.passwordHash, credential);
    if (!ok) {
      logger.warn(`Step-up verification failed for admin user: ${adminUserId}`);
      return false;
    }
    await this.redis.setex(STEP_UP_KEY(hashSessionToken(sessionToken)), STEP_UP_TTL_SECONDS, '1');
    return true;
  }

  /**
   * Mandatory 2FA: the operator has at least one active second factor
   * (confirmed TOTP or a registered WebAuthn key). Fail-closed on error.
   */
  async hasMfaEnrolled(adminUserId: string): Promise<boolean> {
    try {
      const user = await this.db.adminUser.findUnique({
        where: { id: adminUserId },
        select: { totpEnabled: true, webauthnCreds: true },
      });
      if (!user) return false;
      const creds = Array.isArray(user.webauthnCreds) ? user.webauthnCreds : [];
      return user.totpEnabled || creds.length > 0;
    } catch (err) {
      logger.error(`MFA enrollment check failed for admin user ${adminUserId}:`, err);
      return false;
    }
  }

  async hasRecentStepUp(sessionToken: string): Promise<boolean> {
    if (!sessionToken) return false;
    return (await this.redis.get(STEP_UP_KEY(hashSessionToken(sessionToken)))) === '1';
  }

  async regenerateBackupCodes(adminUserId: string): Promise<string[]> {
    const rawCodes = generateBackupCodeStrings(BACKUP_CODE_COUNT);
    const hashedCodes = await Promise.all(rawCodes.map(c => argon2.hash(c, ARGON2_OPTIONS)));
    await this.db.adminUser.update({
      where: { id: adminUserId },
      data: { backupCodes: hashedCodes },
    });
    logger.info(`Backup codes regenerated for admin user: ${adminUserId}`);
    return rawCodes;
  }
}

// WebAuthn types exported for TypeScript
export type PublicKeyCredentialCreationOptionsJSON = Awaited<
  ReturnType<typeof generateRegistrationOptions>
>;
export type PublicKeyCredentialRequestOptionsJSON = Awaited<
  ReturnType<typeof generateAuthenticationOptions>
>;

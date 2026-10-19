import Redis from 'ioredis';
import {
  CAPTCHA_ALPHABET,
  CAPTCHA_LENGTH,
  generateCaptchaCode,
  normalizeCaptchaInput,
  renderCaptchaImage,
} from '../src/utils/captchaImage';
import { CAPTCHA_CHECK_LUA } from '../src/services/VerificationService';

describe('captcha image utils', () => {
  it('uses an alphabet without ambiguous characters', () => {
    for (const c of ['0', 'O', '1', 'I', 'L', 'l', 'o', 'i']) expect(CAPTCHA_ALPHABET).not.toContain(c);
  });

  it('generates codes of the expected length from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCaptchaCode();
      expect(code).toHaveLength(CAPTCHA_LENGTH);
      for (const c of code) expect(CAPTCHA_ALPHABET).toContain(c);
    }
  });

  it('normalizes user input case-insensitively', () => {
    expect(normalizeCaptchaInput('  ab3k 7q ')).toBe('AB3K7Q');
    expect(normalizeCaptchaInput('ab-3k-7q')).toBe('AB3K7Q');
  });

  it('renders a PNG', () => {
    const png = renderCaptchaImage(generateCaptchaCode());
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.length).toBeGreaterThan(1000);
  });
});

// Requiere un Redis desechable: REDIS_TEST_URL=redis://127.0.0.1:6399 npx jest tests/verificationCaptcha.test.ts
const redisUrl = process.env.REDIS_TEST_URL;
(redisUrl ? describe : describe.skip)('captcha check script (Redis)', () => {
  let redis: Redis;
  const keys = ['t:code', 't:attempts', 't:cooldown'];
  const check = async (hash: string, max = 3, cooldown = 60) =>
    (await redis.eval(CAPTCHA_CHECK_LUA, 3, ...keys, hash, String(max), String(cooldown), '1800')) as [number, number];

  beforeAll(() => { redis = new Redis(redisUrl!); });
  afterAll(async () => { await redis.quit(); });
  beforeEach(async () => { await redis.del(...keys); });

  it('accepts the right code only once', async () => {
    await redis.set('t:code', 'h1', 'EX', 300);
    expect(await check('h1')).toEqual([1, 0]);
    expect(await check('h1')).toEqual([-1, 0]);
  });

  it('counts failures and locks after the maximum', async () => {
    await redis.set('t:code', 'h1', 'EX', 300);
    expect(await check('bad')).toEqual([0, 2]);
    expect(await check('bad')).toEqual([0, 1]);
    expect(await check('bad')).toEqual([-3, 60]);
    // Bloqueado: ni siquiera el código correcto (ya borrado) pasa
    await redis.set('t:code', 'h1', 'EX', 300);
    const [status] = await check('h1');
    expect(status).toBe(-2);
  });

  it('keeps failures across new codes', async () => {
    await redis.set('t:code', 'h1', 'EX', 300);
    expect(await check('bad')).toEqual([0, 2]);
    await redis.set('t:code', 'h2', 'EX', 300);
    expect(await check('bad')).toEqual([0, 1]);
  });
});

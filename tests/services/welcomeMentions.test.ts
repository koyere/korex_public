jest.mock('../../src/utils/i18n', () => ({ i18n: { t: (k: string) => k } }));
jest.mock('../../src/services/WelcomeImageService', () => ({ WelcomeImageService: { getInstance: () => ({ generateImage: async () => null }) } }));
import { WelcomeService } from '../../src/services/WelcomeService';

// Regression C·API-04 (audit 2026-11-21): welcome and goodbye without allowedMentions.
describe('welcome mentions', () => {
  const channel = { isTextBased: () => true };
  const member: any = {
    id: '111111111111111111',
    user: { id: '111111111111111111', username: 'ana', tag: 'ana', displayAvatarURL: () => 'x' },
    displayName: '@everyone',
    guild: { id: 'g', name: 'S', memberCount: 3, channels: { cache: new Map([['c', channel]]) } },
    toString: () => '<@111111111111111111>',
  };
  const service = WelcomeService.getInstance({} as any);

  it.each(['welcome', 'goodbye'] as const)('%s: can only mention the member themselves', async (kind) => {
    const config: any = { welcomeChannelId: 'c', goodbyeChannelId: 'c', welcomeMessage: '@everyone <@&222222222222222222> {user}', goodbyeMessage: '@here {user}' };
    const built = await service.buildMessage(member, kind, config);
    expect(built?.options.allowedMentions).toEqual({ parse: [], users: [member.id] });
  });
});

import { awaitOwnModal } from '../../src/utils/awaitOwnModal';
import { ComponentManager } from '../../src/client/managers/ComponentManager';

jest.mock('../../src/utils/i18n', () => ({ i18n: { t: (k: string) => k } }));

// Regression G·BOT-04 and H·BOT2-02 (audit 2026-11-21)
describe('awaitOwnModal', () => {
  it('uses a unique customId and only accepts its own modal from the same user', async () => {
    const manager = new ComponentManager({ logger: { debug() {}, error() {}, warn() {} } } as any);
    const client: any = { components: manager };
    let filter: ((i: any) => boolean) | undefined;
    let setId = '';
    const modal: any = { setCustomId: (id: string) => { setId = id; return modal; } };
    const interaction: any = {
      id: '999', user: { id: 'u1' },
      showModal: async () => undefined,
      awaitModalSubmit: async (opts: any) => { filter = opts.filter; return { ok: true }; },
    };
    await awaitOwnModal(client, interaction, modal, 'massban_users', 1000);
    expect(setId).toBe('massban_users:999');
    expect(filter!({ customId: 'massban_users:999', user: { id: 'u1' } })).toBe(true);
    expect(filter!({ customId: 'massban_users:999', user: { id: 'otro' } })).toBe(false);
    expect(filter!({ customId: 'verify:captcha_modal', user: { id: 'u1' } })).toBe(false);
    expect(filter!({ customId: 'massban_users:123', user: { id: 'u1' } })).toBe(false);
  });

  it('the dispatcher does not answer a modal a collector awaits, but does answer an expired one', async () => {
    const manager = new ComponentManager({ logger: { debug() {}, error() {}, warn() {} } } as any);
    const reply = jest.fn(async () => undefined);
    const modalInteraction = (customId: string): any => ({ customId, guildId: 'g', isModalSubmit: () => true, reply });
    manager.expectModal('autoroles_join_setup_modal:1');
    await manager.handleModal(modalInteraction('autoroles_join_setup_modal:1'));
    expect(reply).not.toHaveBeenCalled();
    manager.releaseModal('autoroles_join_setup_modal:1');
    await manager.handleModal(modalInteraction('autoroles_join_setup_modal:1'));
    expect(reply).toHaveBeenCalledTimes(1);
  });
});

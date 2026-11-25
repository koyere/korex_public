import PremiumCommand from '../../src/commands/admin/premium';

// D·PAY-16: /premium no longer advertises fictitious plans; it links to the panel
describe('/premium', () => {
  const cmd: any = new PremiumCommand({} as any);

  it('shows no fictitious prices', async () => {
    const text: string = await cmd.catalogText('g');
    expect(text).not.toMatch(/4\.99|9\.99/);
  });

  it('the button is a link to the server add-ons page', () => {
    const row = cmd.panelRow('123').toJSON();
    expect(row.components[0].style).toBe(5);
    expect(row.components[0].url).toMatch(/\/dashboard\/123\/addons$/);
  });
});

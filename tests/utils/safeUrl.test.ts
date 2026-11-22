import dns from 'dns';
import http from 'http';
import { AddressInfo } from 'net';
import { isPrivateIP, isPrivateLiteralHost, isPublicHttpUrl, fetchPublicResource, publicLookup, openPublicStream } from '../../src/utils/safeUrl';

// Regression J·GEN-01 / J·GEN-02 (audit 2026-11-21)
describe('safeUrl', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1',
    '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:10.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::', '::127.0.0.1',
  ])('%s is private', (ip) => expect(isPrivateIP(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('%s is public', (ip) => expect(isPrivateIP(ip)).toBe(false));

  it('rejects literals in any notation URL normalises', async () => {
    for (const u of ['http://[::ffff:127.0.0.1]:3000/', 'http://[::ffff:7f00:1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://017700000001/', 'http://[::1]/', 'http://localhost/', 'http://x.internal/', 'http://user:pw@example.com/', 'ftp://example.com/']) {
      expect(await isPublicHttpUrl(u)).toBe(false);
    }
    expect(isPrivateLiteralHost('[::ffff:7f00:1]')).toBe(true);
  });

  it('rejects a domain whose DNS points to an internal IP (rebinding)', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);
    expect(await isPublicHttpUrl('http://evil.example/')).toBe(false);
    await expect(fetchPublicResource('http://evil.example/')).rejects.toThrow();
  });

  it('rejects when any of the resolved IPs is internal', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '::ffff:7f00:1', family: 6 }] as any);
    expect(await isPublicHttpUrl('http://mixed.example/')).toBe(false);
  });

  it('publicLookup returns the validated IP and fails with ESSRF if internal', (done) => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as any).mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }] as any);
    publicLookup('ok.example', {}, (err, addr) => {
      expect(err).toBeNull();
      expect(addr).toBe('8.8.8.8');
      publicLookup('bad.example', {}, (err2) => {
        expect(err2?.code).toBe('ESSRF');
        done();
      });
    });
  });

  it('never reaches a local server, directly or through a redirect', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => { hits++; res.end('secreto'); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(fetchPublicResource(`http://[::ffff:127.0.0.1]:${port}/`)).rejects.toThrow();
      await expect(fetchPublicResource(`http://127.0.0.1:${port}/`)).rejects.toThrow();
      await expect(openPublicStream(`http://[::ffff:7f00:1]:${port}/a.mp3`)).rejects.toThrow();
      await expect(openPublicStream(`http://localhost:${port}/a.mp3`)).rejects.toThrow();
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });
});

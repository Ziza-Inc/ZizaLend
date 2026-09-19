import { describe, it, expect, jest } from '@jest/globals';
import {
  UnsafeWebhookUrlError,
  assertSafeWebhookUrl,
  isAddressLiteral,
  isBlockedAddress,
  isBlockedHostname,
  type UnsafeWebhookUrlReason,
} from '../webhookUrlGuard.js';

/** Resolver that answers with a fixed set of addresses, so no test touches real DNS. */
const resolvingTo =
  (...addresses: string[]) =>
  async (): Promise<string[]> =>
    addresses;

/** Rejection helper: asserts both that it throws and why. */
async function expectRefusal(
  url: string,
  reason: UnsafeWebhookUrlReason,
  resolver?: () => Promise<string[]>,
) {
  await expect(
    assertSafeWebhookUrl(url, resolver ? { resolveHost: resolver } : {}),
  ).rejects.toMatchObject({ name: 'UnsafeWebhookUrlError', reason });
}

describe('isBlockedAddress', () => {
  it.each([
    ['0.0.0.0', 'the unspecified address'],
    ['0.1.2.3', '0.0.0.0/8'],
    ['10.0.0.1', 'RFC 1918'],
    ['10.255.255.254', 'RFC 1918'],
    ['127.0.0.1', 'loopback'],
    ['127.9.9.9', 'loopback'],
    ['169.254.169.254', 'the cloud metadata endpoint'],
    ['169.254.0.1', 'link-local'],
    ['172.16.0.1', 'RFC 1918 low end'],
    ['172.31.255.254', 'RFC 1918 high end'],
    ['192.168.1.1', 'RFC 1918'],
    ['100.64.0.1', 'CGNAT'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['192.0.2.1', 'TEST-NET-1'],
    ['192.88.99.1', '6to4 relay anycast'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.1', 'TEST-NET-2'],
    ['203.0.113.1', 'TEST-NET-3'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['::', 'the unspecified address'],
    ['::1', 'IPv6 loopback'],
    ['fe80::1', 'link-local'],
    ['fe80::a00:27ff:fe4e:66a1', 'link-local'],
    ['fc00::1', 'unique local'],
    ['fd12:3456:789a::1', 'unique local'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:10.0.0.1', 'IPv4-mapped RFC 1918'],
    ['::ffff:169.254.169.254', 'IPv4-mapped link-local'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['93.184.216.34', 'the example.com range'],
    ['8.8.8.8', 'a public resolver'],
    ['172.15.0.1', 'just below the RFC 1918 block'],
    ['172.32.0.1', 'just above the RFC 1918 block'],
    ['100.63.255.255', 'just below CGNAT'],
    ['100.128.0.0', 'just above CGNAT'],
    ['223.255.255.255', 'the last unicast address'],
    ['2606:2800:220:1:248:1893:25c8:1946', 'a public IPv6 address'],
  ])('allows %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it('fails closed on a string that is not an address at all', () => {
    // Not "public": the caller must resolve a name, and a malformed literal must never be read
    // as one that is safe to connect to.
    expect(isBlockedAddress('not-an-address')).toBe(true);
    expect(isBlockedAddress('999.1.1.1')).toBe(true);
    expect(isBlockedAddress('1.2.3')).toBe(true);
  });
});

describe('isBlockedHostname', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'api.localhost',
    'db',
    'redis',
    'anything.internal',
    'metadata.google.internal',
    'printer.local',
    'service.home.arpa',
    'host.corp',
  ])('blocks %s', (hostname) => {
    expect(isBlockedHostname(hostname)).toBe(true);
  });

  it.each(['example.com', 'hooks.stripe.com', 'a.b.c.example.co.uk'])('allows %s', (hostname) => {
    expect(isBlockedHostname(hostname)).toBe(false);
  });

  it('ignores a trailing root dot', () => {
    expect(isBlockedHostname('example.com.')).toBe(false);
    expect(isBlockedHostname('db.')).toBe(true);
  });
});

describe('isAddressLiteral', () => {
  it('recognises literals in the forms WHATWG URL can produce', () => {
    expect(isAddressLiteral('127.0.0.1')).toBe(true);
    expect(isAddressLiteral('[::1]')).toBe(true);
    expect(isAddressLiteral('::ffff:7f00:1')).toBe(true);
    expect(isAddressLiteral('example.com')).toBe(false);
  });
});

describe('assertSafeWebhookUrl', () => {
  it('accepts an https URL whose host resolves publicly', async () => {
    const url = await assertSafeWebhookUrl('https://hooks.example.com/ziza', {
      resolveHost: resolvingTo('93.184.216.34'),
    });

    expect(url.toString()).toBe('https://hooks.example.com/ziza');
  });

  it.each([
    ['http://hooks.example.com/ziza', 'plaintext delivery'],
    ['ftp://hooks.example.com/ziza', 'not a webhook transport'],
    ['file:///etc/passwd', 'a local file'],
    ['gopher://hooks.example.com/', 'a legacy protocol'],
  ])('refuses %s (%s)', async (rawUrl) => {
    await expectRefusal(rawUrl, 'insecure_scheme', resolvingTo('93.184.216.34'));
  });

  it('refuses a string that is not a URL', async () => {
    await expectRefusal('hooks.example.com/ziza', 'invalid_url');
  });

  it.each([
    'https://localhost/ziza',
    'https://db/ziza',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://anything.internal/ziza',
  ])('refuses %s without resolving it', async (rawUrl) => {
    const resolveHost = jest.fn(resolvingTo('93.184.216.34'));
    await expectRefusal(rawUrl, 'blocked_hostname', resolveHost);
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it.each([
    ['https://127.0.0.1/ziza', 'loopback'],
    ['https://169.254.169.254/latest/meta-data/', 'the metadata endpoint'],
    ['https://10.0.0.5/ziza', 'RFC 1918'],
    ['https://192.168.0.10/ziza', 'RFC 1918'],
    ['https://[::1]/ziza', 'IPv6 loopback'],
    ['https://[fd00::1]/ziza', 'unique local'],
  ])('refuses the address literal in %s (%s)', async (rawUrl) => {
    const resolveHost = jest.fn(resolvingTo('93.184.216.34'));
    await expectRefusal(rawUrl, 'blocked_address', resolveHost);
    // An address needs no resolving, and resolving one would only invite a name-based bypass.
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it.each([
    ['https://2130706433/ziza', 'the integer spelling of 127.0.0.1'],
    ['https://0x7f000001/ziza', 'the hex spelling of 127.0.0.1'],
    ['https://127.1/ziza', 'the shortened spelling of 127.0.0.1'],
    ['https://0x7f.0.0.1/ziza', 'a mixed-radix spelling'],
  ])('refuses %s (%s), which WHATWG URL normalises to 127.0.0.1', async (rawUrl) => {
    await expectRefusal(rawUrl, 'blocked_address', resolvingTo('93.184.216.34'));
  });

  it('refuses a public name that resolves to a private address anyway', async () => {
    // The whole point: `rebind.example` is an ordinary hostname until it is resolved.
    await expectRefusal('https://rebind.example/ziza', 'blocked_address', resolvingTo('127.0.0.1'));
  });

  it('refuses a name that answers with both a public and a private address', async () => {
    await expectRefusal(
      'https://rebind.example/ziza',
      'blocked_address',
      resolvingTo('93.184.216.34', '10.1.2.3'),
    );
  });

  it('refuses a name that does not resolve', async () => {
    await expectRefusal('https://nothing.example/ziza', 'unresolvable_host', async () => {
      throw new Error('getaddrinfo ENOTFOUND nothing.example');
    });
  });

  it('refuses a name that resolves to nothing', async () => {
    await expectRefusal('https://empty.example/ziza', 'unresolvable_host', resolvingTo());
  });

  it('reports the refusal with a message that names the address', async () => {
    await expect(
      assertSafeWebhookUrl('https://rebind.example/ziza', {
        resolveHost: resolvingTo('127.0.0.1'),
      }),
    ).rejects.toThrow(/127\.0\.0\.1/);
  });

  it('carries the reason on the error so a caller can act on it', async () => {
    await expect(assertSafeWebhookUrl('http://example.com')).rejects.toBeInstanceOf(
      UnsafeWebhookUrlError,
    );
  });
});

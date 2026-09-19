import { lookup } from 'node:dns/promises';

/**
 * Whether an outbound webhook may be aimed at a given URL.
 *
 * A subscriber chooses the URL the server makes a request to, which makes the server a proxy
 * into whatever network it can reach: the cloud metadata endpoint on 169.254.169.254, an
 * internal admin port on 127.0.0.1, a service on the private subnet. The check therefore has to
 * happen where the connection is made, on every hop of a redirect chain, and not only when the
 * subscription is created — a public hostname that resolved publicly at subscription time can
 * resolve privately, or redirect privately, at delivery time.
 *
 * The hostname check alone is not enough, which is why the resolver is consulted rather than
 * matched against a list of suspicious names: `evil.example` is an ordinary-looking hostname
 * until it resolves to 127.0.0.1.
 */

export type UnsafeWebhookUrlReason =
  /** Not parseable as a URL at all. */
  | 'invalid_url'
  /** A scheme other than `https:` — `http:`, `file:`, `gopher:`, and so on. */
  | 'insecure_scheme'
  /** A hostname that can never be a public endpoint: `localhost`, `.internal`, a bare label. */
  | 'blocked_hostname'
  /** An address literal, or a name that resolved to one, inside a private, loopback,
   *  link-local, multicast, or otherwise non-public range. */
  | 'blocked_address'
  /** The name did not resolve, or resolved to nothing, so the destination is unknowable. */
  | 'unresolvable_host';

export class UnsafeWebhookUrlError extends Error {
  public readonly reason: UnsafeWebhookUrlReason;

  constructor(message: string, reason: UnsafeWebhookUrlReason) {
    super(message);
    this.name = 'UnsafeWebhookUrlError';
    this.reason = reason;
  }
}

/** Resolve a hostname to every address it answers with. Injected so tests need no real DNS. */
export type HostResolver = (hostname: string) => Promise<string[]>;

/**
 * Resolver used when a caller does not pass one.
 *
 * Overridable so that a test can state the addresses a hostname answers with instead of depending
 * on real DNS: the point of the check is what it does with the answers, and a suite that needs a
 * network to prove it is a suite that fails on a runner without one. Production leaves it alone,
 * and `null` restores the system resolver.
 */
let configuredResolver: HostResolver | null = null;

export function setHostResolver(resolver: HostResolver | null): void {
  configuredResolver = resolver;
}

const defaultResolver: HostResolver = async (hostname) => {
  // `all` matters: a name with one public record and one private record must be refused on the
  // private one, and a resolver that returned a single address would hide it. `verbatim` keeps
  // the resolver from reordering the answer by family, which is irrelevant to the decision but
  // makes the check deterministic.
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/** Strip the brackets WHATWG URL keeps around an IPv6 literal. */
function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '');
}

/** Parse a dotted-quad IPv4 literal into its octets, or null when it is not one. */
function parseIpv4(address: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return null;

  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((octet) => octet > 255)) return null;
  return octets as [number, number, number, number];
}

/**
 * Expand an IPv6 literal into its eight 16-bit groups, or null when it is not one.
 *
 * Handles `::` compression, a trailing IPv4 form (`::ffff:127.0.0.1`), and a scope id
 * (`fe80::1%eth0`), because a scope id is how a link-local address is usually written and
 * `fe80::1%eth0` must not read as a different address than `fe80::1`.
 */
function parseIpv6(address: string): number[] | null {
  const withoutScope = address.split('%')[0]!.toLowerCase();
  if (!withoutScope.includes(':')) return null;

  let working = withoutScope;

  // A trailing dotted-quad is the IPv4-mapped/compatible form; fold it into two groups.
  const lastColon = working.lastIndexOf(':');
  const tail = working.slice(lastColon + 1);
  if (tail.includes('.')) {
    const embeddedIpv4 = parseIpv4(tail);
    if (!embeddedIpv4) return null;
    const high = ((embeddedIpv4[0] << 8) | embeddedIpv4[1]).toString(16);
    const low = ((embeddedIpv4[2] << 8) | embeddedIpv4[3]).toString(16);
    working = `${working.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const sections = working.split('::');
  if (sections.length > 2) return null;

  const parseGroups = (section: string): number[] | null => {
    if (section === '') return [];
    const parts = section.split(':');
    const groups: number[] = [];
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(parseInt(part, 16));
    }
    return groups;
  };

  const head = parseGroups(sections[0]!);
  if (head === null) return null;

  if (sections.length === 1) {
    return head.length === 8 ? head : null;
  }

  const tailGroups = parseGroups(sections[1]!);
  if (tailGroups === null) return null;

  const missing = 8 - head.length - tailGroups.length;
  if (missing < 1) return null;

  return [...head, ...new Array<number>(missing).fill(0), ...tailGroups];
}

/**
 * Whether an address literal is outside the public internet.
 *
 * Deliberately fails closed: anything that is not recognisably a public unicast address —
 * including a string that looks like an address but does not parse — is treated as blocked.
 */
export function isBlockedAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) {
    const [a, b, c] = ipv4;

    if (a === 0) return true; // 0.0.0.0/8 — "this network"
    if (a === 10) return true; // RFC 1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
    if (a === 192 && b === 168) return true; // RFC 1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC 6598
    if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
    if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
    if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking, RFC 2544
    if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // multicast and reserved, including the broadcast address

    return false;
  }

  const ipv6 = parseIpv6(address);
  if (ipv6) {
    const [first, second] = ipv6 as [number, number, ...number[]];

    if (ipv6.every((group) => group === 0)) return true; // ::
    if (ipv6.slice(0, 7).every((group) => group === 0) && ipv6[7] === 1) return true; // ::1
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast

    // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible forms carry an IPv4
    // reachability decision inside them, so the embedded address decides.
    const isIpv4Mapped =
      ipv6.slice(0, 5).every((group) => group === 0) &&
      (ipv6[5] === 0xffff || (ipv6[5] === 0 && ipv6[6] !== 0));
    if (isIpv4Mapped) {
      const embedded = `${ipv6[6]! >> 8}.${ipv6[6]! & 0xff}.${ipv6[7]! >> 8}.${ipv6[7]! & 0xff}`;
      return isBlockedAddress(embedded);
    }
    // ::ffff:0:a.b.c.d (IPv4-translated) lands in the same place.
    if (ipv6[5] === 0xffff && second === 0) return true;

    return false;
  }

  // Not an address literal at all: the caller must resolve it instead. Reported as blocked so
  // a malformed literal can never fall through to "public".
  return true;
}

/**
 * Whether a hostname can be refused without resolving it.
 *
 * Names that cannot be public by construction are cheap to reject, and rejecting them first
 * keeps the resolver out of the path for the most obvious attempts.
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = stripBrackets(hostname).toLowerCase().replace(/\.$/, '');

  if (host === '') return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  // Reserved for exactly this kind of question, plus the names internal deployments use.
  for (const suffix of ['.local', '.internal', '.home.arpa', '.lan', '.intranet', '.corp']) {
    if (host.endsWith(suffix)) return true;
  }

  if (host === 'metadata.google.internal' || host === 'metadata.goog') return true;

  // A single label is a name only this network can resolve. `internal`, `db`, `redis` — an
  // attacker cannot own one, and an operator publishing a webhook at one is a misconfiguration.
  if (!host.includes('.')) return true;

  return false;
}

/** True when the hostname is an address literal rather than a name to resolve. */
export function isAddressLiteral(hostname: string): boolean {
  const host = stripBrackets(hostname);
  return parseIpv4(host) !== null || parseIpv6(host) !== null || host.includes(':');
}

/**
 * Parse and vet a webhook URL, resolving the host so a public name that points somewhere
 * private is refused.
 *
 * Throws {@link UnsafeWebhookUrlError} with a `reason` the caller can log or map to a response.
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  options: { resolveHost?: HostResolver } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookUrlError('Webhook URL is not a valid URL', 'invalid_url');
  }

  // HTTPS only. `http:` is a plaintext delivery of a signed payload, and the other schemes a
  // `fetch` would follow are not webhook transports at all.
  if (url.protocol !== 'https:') {
    throw new UnsafeWebhookUrlError(
      `Webhook URL must use https, received ${url.protocol.replace(':', '')}`,
      'insecure_scheme',
    );
  }

  const hostname = stripBrackets(url.hostname).toLowerCase();

  if (hostname === '') {
    throw new UnsafeWebhookUrlError(
      'Webhook URL must not target a private or internal host (empty host)',
      'blocked_hostname',
    );
  }

  // Literals are decided first: an IPv6 address contains no dot, so the "bare label" rule below
  // would classify `fd00::1` as an internal hostname and report the wrong reason for refusing
  // it. The address is the more specific answer.
  if (isAddressLiteral(hostname)) {
    // WHATWG URL normalises the alternative spellings of an IPv4 literal — `2130706433`,
    // `0x7f.0.0.1`, `127.1` — to a dotted quad, so they arrive here as `127.0.0.1`.
    if (isBlockedAddress(hostname)) {
      throw new UnsafeWebhookUrlError(
        `Webhook URL must not target a private, loopback, or link-local address (${hostname})`,
        'blocked_address',
      );
    }
    return url;
  }

  if (isBlockedHostname(hostname)) {
    throw new UnsafeWebhookUrlError(
      `Webhook URL must not target a private or internal host (${hostname})`,
      'blocked_hostname',
    );
  }

  const resolveHost = options.resolveHost ?? configuredResolver ?? defaultResolver;
  let addresses: string[];
  try {
    addresses = await resolveHost(hostname);
  } catch (error) {
    throw new UnsafeWebhookUrlError(
      `Could not resolve webhook host ${hostname}: ${error instanceof Error ? error.message : String(error)}`,
      'unresolvable_host',
    );
  }

  if (addresses.length === 0) {
    throw new UnsafeWebhookUrlError(
      `Webhook host ${hostname} did not resolve to any address`,
      'unresolvable_host',
    );
  }

  // Every answer has to be public. A name that returns one public and one private address is a
  // rebinding vector, and whichever record the client picks is not something this check can
  // control — so the only safe reading of "one private answer" is refusal.
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new UnsafeWebhookUrlError(
        `Webhook host ${hostname} resolves to a private, loopback, or link-local address (${address})`,
        'blocked_address',
      );
    }
  }

  return url;
}

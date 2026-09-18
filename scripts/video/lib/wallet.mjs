/**
 * A read-only stand-in for the Freighter browser extension, for video capture only.
 *
 * The deployed frontend gates every screen behind a wallet, so a screenshot of the
 * real application otherwise shows nothing but the connect prompt. This is not a
 * bundle patch and not a mock build: the extension's own API (`@stellar/freighter-api`)
 * talks to the extension over `postMessage`, so injecting a responder into the page is
 * enough to let the *deployed* application — the same build every user gets — believe a
 * wallet is connected and read genuine state from the Testnet contracts.
 *
 * It deliberately cannot sign. `signTransaction` and `signAuthEntry` are absent, so the
 * application can read the chain and render real figures but cannot be driven through a
 * transaction. That boundary is the point: a demo that could fabricate a signed
 * transaction would be able to fabricate a state the chain is not in.
 *
 * Nothing here ships to users, and nothing here is reachable from the application
 * bundle. It exists only inside the capture step.
 */

/** The extension's wire protocol, reproduced from the API's own constants. */
const REQUEST = "FREIGHTER_EXTERNAL_MSG_REQUEST";
const RESPONSE = "FREIGHTER_EXTERNAL_MSG_RESPONSE";

const TESTNET = {
  network: "TESTNET",
  networkName: "Testnet",
  networkUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
};

/**
 * Build the init script Playwright evaluates before any application code runs.
 *
 * @param {string} publicKey a funded Testnet account, so the balance calls behind the
 *   dashboard resolve against a real account rather than 404-ing into empty state.
 */
export function mockFreighterInitScript(publicKey) {
  return `(() => {
    const PUBLIC_KEY = ${JSON.stringify(publicKey)};
    const REQUEST = ${JSON.stringify(REQUEST)};
    const RESPONSE = ${JSON.stringify(RESPONSE)};
    const NETWORK = ${JSON.stringify(TESTNET)};

    // \`isConnected()\` short-circuits on this global without posting a message at all.
    window.freighter = { isConnected: true, isAllowed: true, publicKey: PUBLIC_KEY, version: "video-capture" };
    window.__zizalendMockWallet = { publicKey: PUBLIC_KEY, readOnly: true, requests: [] };

    const payloadFor = (type) => {
      switch (type) {
        case "REQUEST_CONNECTION_STATUS": return { isConnected: true };
        case "REQUEST_PUBLIC_KEY":       return { publicKey: PUBLIC_KEY };
        case "REQUEST_ACCESS":           return { publicKey: PUBLIC_KEY };
        case "REQUEST_ALLOWED_STATUS":   return { isAllowed: true };
        case "SET_ALLOWED_STATUS":       return { isAllowed: true };
        case "REQUEST_NETWORK_DETAILS":  return { networkDetails: NETWORK };
        case "REQUEST_NETWORK":          return { network: NETWORK.network, networkPassphrase: NETWORK.networkPassphrase };
        case "REQUEST_USER_INFO":        return { publicKey: PUBLIC_KEY };
        default:                         return { error: { code: -1, message: "capture wallet is read-only" } };
      }
    };

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.source !== REQUEST) return;
      window.__zizalendMockWallet.requests.push(data.type);
      // The API matches the reply on \`messagedId\` — its spelling, not ours.
      window.postMessage(
        { source: RESPONSE, messagedId: data.messageId, apiError: null, ...payloadFor(data.type) },
        window.location.origin,
      );
    }, false);
  })();`;
}

/**
 * Fund a fresh Testnet account so the capture has a wallet that exists on the network.
 *
 * A new keypair per run rather than a committed address: the point is only that the
 * account is real, and a fresh one cannot drift into a state where the video's
 * screenshots stop matching what it shows.
 */
export async function createFundedTestnetAccount() {
  const { Keypair } = await import("@stellar/stellar-sdk");
  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();

  const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok) {
    throw new Error(`friendbot refused ${publicKey}: ${response.status} ${response.statusText}`);
  }
  return publicKey;
}

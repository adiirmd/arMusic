/* Proof of origin tokens for the media requests.
 *
 * Without one, the upstream serves roughly the first megabyte of a track and
 * answers 403 to everything after it, which is a song that stops after half a
 * minute. With a token bound to the track id, every range is served.
 *
 * The token comes from running the upstream's own attestation script inside a
 * jsdom window. That window is created with runScripts: 'outside-only', so the
 * script lives in the window's own realm and never touches this process's
 * globals. Two realm mismatches follow from that and are bridged by hand below:
 * the minter callback is a function from the window's realm (so instanceof
 * Function fails in bgutils), and the bytes it returns are the window's
 * Uint8Array.
 *
 * Server side only. Nothing produced here is ever sent to the browser. */

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

let state = null; // { minter, createdAt, refreshAt }
let pending = null;

async function createMinter() {
  const [{ JSDOM }, bg, utils, webpo] = await Promise.all([
    import('jsdom'),
    import('bgutils-js/botguard'),
    import('bgutils-js/utils'),
    import('bgutils-js/webpo'),
  ]);
  const dom = new JSDOM('<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>', {
    url: 'https://www.youtube.com/',
    referrer: 'https://www.youtube.com/',
    userAgent: utils.USER_AGENT,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const W = dom.window;

  const challenge = await bg.getChallenge({ fetchFunction: fetch, requestKey: REQUEST_KEY });
  const interpreter = challenge.interpreterJavascript
    && challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!interpreter) throw new Error('attestation interpreter missing');
  W.eval(interpreter);

  const client = await bg.BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: W,
  });
  const signal = [];
  const snapshot = await client.snapshot({ webPoSignalOutput: signal });

  const r = await fetch(utils.buildURL('GenerateIT', true), {
    method: 'POST',
    headers: utils.getHeaders(),
    body: JSON.stringify([REQUEST_KEY, snapshot]),
  });
  if (!r.ok) throw new Error(`integrity token ${r.status}`);
  const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = await r.json();

  const getMinter = signal[0];
  if (typeof getMinter !== 'function') throw new Error('attestation produced no minter');
  signal[0] = async (it) => {
    const cb = await getMinter(new W.Uint8Array(it));
    if (typeof cb !== 'function') throw new Error('attestation minter callback missing');
    return async (binding) => {
      const out = await cb(new W.Uint8Array(binding));
      return out ? new Uint8Array(out) : out;
    };
  };

  const minter = await webpo.WebPoMinter.create(
    { integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken },
    signal
  );
  const ttl = Math.max(600, Number(estimatedTtlSecs) || 3600);
  const margin = Math.max(300, Number(mintRefreshThreshold) || 0);
  const now = Date.now();
  return { minter, createdAt: now, refreshAt: now + (ttl - margin) * 1000 };
}

async function getMinter() {
  if (state && Date.now() < state.refreshAt) return state.minter;
  if (!pending) {
    pending = createMinter()
      .then((s) => { state = s; return s.minter; })
      .finally(() => { pending = null; });
  }
  return pending;
}

/* A token bound to one track id. Cheap once the minter exists. */
async function mintFor(trackId) {
  const m = await getMinter();
  return m.mintAsWebsafeString(trackId);
}

function resetMinter() {
  state = null;
}

module.exports = { mintFor, resetMinter, getMinter };

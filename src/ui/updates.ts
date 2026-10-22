import { CHANGELOG, VERSION } from '../changelog';

const SEEN_KEY = 'metroforge:seen-version';

/** Whether the player has already been told about this version's changes. */
export function seenLatest(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === VERSION;
  } catch {
    return false;
  }
}

export function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, VERSION);
  } catch {
    // private mode: the notice just shows again next time
  }
}

/** The latest release's notes as one ticker line. */
export function latestTicker(): string {
  const r = CHANGELOG[0];
  return `🆕 v${r.version} ${r.title}：${r.notes.join('　·　')}`;
}

/**
 * Asks the site which version is deployed now (`version.json`, written at build time), so a
 * player with the game left open hears about a new release. Quiet when there is no such file.
 */
export function watchForNewVersion(onNew: (version: string, title: string) => void, every = 5 * 60_000): void {
  let told = false;
  const check = async () => {
    if (told || document.visibilityState === 'hidden') return;
    try {
      const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const v = (await res.json()) as { version?: string; title?: string };
      if (v.version && v.version !== VERSION) {
        told = true;
        onNew(v.version, v.title ?? '');
      }
    } catch {
      // offline or not served from the site
    }
  };
  setInterval(check, every);
  addEventListener('visibilitychange', () => void check());
}

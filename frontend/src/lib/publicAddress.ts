/**
 * Opened directly at pifix-web.onrender.com, the app moves itself to its
 * public PiNet address (VITE_APP_URL, handyfix1515.pinet.com) — the address
 * other Pi apps show in Pi Browser's bar. PiNet serves the very same app in a
 * frame, so inside that frame this does nothing and there is no loop.
 *
 * Left alone:
 *   - anything not on *.onrender.com (local development, previews);
 *   - /admin, so the password login keeps working from a desktop browser;
 *   - `?direct=1`, an escape hatch remembered for the rest of the session.
 *
 * The query string is not carried: PiNet drops it on the way into the frame.
 * The one parameter that matters, `?ref=`, is turned into the `/r/<name>` path
 * that survives (see captureReferrer).
 */
function decide(): boolean {
  const target = String(import.meta.env.VITE_APP_URL ?? '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.pinet\.com$/i.test(target)) return false;
  if (!window.location.hostname.endsWith('.onrender.com')) return false;

  let framed = true;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true; // a cross-origin parent: we are inside PiNet
  }
  if (framed) return false;

  const params = new URLSearchParams(window.location.search);
  try {
    if (params.get('direct') === '1') {
      sessionStorage.setItem('pifix_direct', '1');
      return false;
    }
    if (sessionStorage.getItem('pifix_direct') === '1') return false;
  } catch {
    // storage blocked: fall through and move
  }
  if (window.location.pathname.startsWith('/admin')) return false;

  const ref = params.get('ref');
  const path = ref && !window.location.pathname.startsWith('/r/')
    ? `/r/${encodeURIComponent(ref)}`
    : window.location.pathname;
  window.location.replace(`${target}${path}`);
  return true;
}

export const movingToPublicAddress = typeof window !== 'undefined' && decide();

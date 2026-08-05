/**
 * DEV-ONLY stand-in for the Pi SDK, so the UI can be worked on in a normal
 * browser instead of only inside Pi Browser.
 *
 * It is loaded from main.tsx behind `import.meta.env.DEV`, which Vite replaces
 * with the literal `false` in a production build — so this module is dropped
 * from `npm run build` output entirely and can never run in production.
 *
 * It fakes only what the SDK *is*, never what the server *verifies*:
 * `authenticate` returns a token the backend will (correctly) reject, and
 * payments are not simulated. Signed-out browsing — the job board, master
 * profiles, maps, i18n, layout — is what this unlocks.
 *
 * Enable with VITE_PI_MOCK=true in frontend/.env.
 */
export function installPiMock(): void {
  if (!import.meta.env.DEV) return;
  if (typeof window === 'undefined' || window.Pi) return;

  // eslint-disable-next-line no-console
  console.warn('[PiFix] Pi SDK mock active — dev only. Sign-in and payments will not work.');

  window.Pi = {
    init: () => undefined,
    authenticate: () =>
      Promise.reject(
        new Error('Pi SDK mock: real authentication needs Pi Browser (the server verifies the token).'),
      ),
    createPayment: (_data, callbacks) => {
      callbacks.onError(new Error('Pi SDK mock: payments only work in Pi Browser.'));
    },
    openShareDialog: (title, message) => {
      // eslint-disable-next-line no-console
      console.info('[PiFix] share:', title, message);
    },
  };
}

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Emits the Developer Portal's domain-ownership file.
 *
 * Checklist step "Validate Domain Ownership" fetches
 * `https://<host>/validation-key.txt` and compares it byte for byte with the
 * key shown in the portal. Nothing downstream works until that passes: no
 * PiNet subdomain, and therefore no real address for pioneers to arrive at.
 *
 * Kept out of `public/` deliberately. The key is per-app and changes when the
 * app is re-registered, so committing it would mean a code change to fix a
 * portal setting — and a stale committed key fails the check silently, with
 * the portal only saying the content did not match. As an env var it is set
 * in the dashboard next to the other Pi settings.
 */
function piDomainValidationKey(): Plugin {
  return {
    name: 'pi-domain-validation-key',
    apply: 'build',
    generateBundle() {
      const key = process.env.VITE_PI_VALIDATION_KEY?.trim();
      if (!key) {
        this.warn(
          'VITE_PI_VALIDATION_KEY is not set — /validation-key.txt will 404 and ' +
            'the portal cannot validate domain ownership.',
        );
        return;
      }
      // No trailing newline: the portal compares the body exactly.
      this.emitFile({ type: 'asset', fileName: 'validation-key.txt', source: key });
    },
  };
}

export default defineConfig({
  plugins: [react(), piDomainValidationKey()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2019', // Pi Browser wraps older Android WebViews
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector', 'i18next-http-backend'],
          // Leaflet is loaded lazily by the map component; keeping it in its own
          // chunk means the first paint on 3G never waits for it.
          leaflet: ['leaflet'],
        },
      },
    },
  },
});

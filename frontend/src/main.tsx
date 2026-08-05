import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './i18n';
import './styles/global.css';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { BootScreen } from './components/BootScreen';

// Dev-only: lets the UI render in a normal browser. `import.meta.env.DEV` is
// inlined as `false` by the production build, so this is tree-shaken away.
if (import.meta.env.DEV && import.meta.env.VITE_PI_MOCK === 'true') {
  const { installPiMock } = await import('./lib/piSdkMock');
  installPiMock();
}

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <Suspense fallback={<BootScreen />}>
      <BrowserRouter>
        <SettingsProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </SettingsProvider>
      </BrowserRouter>
    </Suspense>
  </StrictMode>,
);

// Static-asset caching only. Pi Browser's service worker support is flaky, so a
// failed registration must never break the app.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* caching is a bonus, not a requirement */
    });
  });
}

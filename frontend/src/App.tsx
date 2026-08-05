import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { OfflineBanner } from './components/OfflineBanner';
import { BootScreen } from './components/BootScreen';
import { OpenInPiBrowser } from './components/OpenInPiBrowser';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAuth } from './hooks/useAuth';
import { usePlatformSettings } from './hooks/usePlatformSettings';
import { directionFor } from './i18n';

import Home from './pages/Home';
import OrdersList from './pages/OrdersList';

// Routes below the fold are code-split: the first paint on 3G only pays for
// the shell, the home screen and the order list.
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const CreateOrder = lazy(() => import('./pages/CreateOrder'));
const MastersList = lazy(() => import('./pages/MastersList'));
const MasterProfile = lazy(() => import('./pages/MasterProfile'));
const MasterDashboard = lazy(() => import('./pages/MasterDashboard'));
const MasterProfileEdit = lazy(() => import('./pages/MasterProfileEdit'));
const Profile = lazy(() => import('./pages/Profile'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminOrders = lazy(() => import('./pages/admin/AdminOrders'));
const AdminVerifications = lazy(() => import('./pages/admin/AdminVerifications'));
const AdminWithdrawals = lazy(() => import('./pages/admin/AdminWithdrawals'));
const AdminReviews = lazy(() => import('./pages/admin/AdminReviews'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));

function ScrollToTop(): null {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Screens that need a signed-in pioneer fall back to the sign-in prompt. */
function RequireAuth({ children }: { children: JSX.Element }): JSX.Element {
  const { status } = useAuth();
  const { t } = useTranslation();

  if (status === 'booting' || status === 'signing_in') return <BootScreen />;
  if (status === 'no_pi') return <OpenInPiBrowser />;
  if (status !== 'signed_in') {
    return (
      <div className="page">
        <div className="card center stack">
          <h2>{t('auth.signInRequired')}</h2>
          <p className="muted">{t('auth.signInRequiredHint')}</p>
          <SignInButton />
        </div>
      </div>
    );
  }
  return children;
}

function SignInButton(): JSX.Element {
  const { signIn, status, error } = useAuth();
  const { t } = useTranslation();
  return (
    <>
      <button className="btn" onClick={() => void signIn()} disabled={status === 'signing_in'}>
        {status === 'signing_in' ? t('common.loading') : t('auth.signIn')}
      </button>
      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}

export default function App(): JSX.Element {
  const { i18n } = useTranslation();
  const { status } = useAuth();
  const { settings } = usePlatformSettings();
  const location = useLocation();

  const isAdminArea = location.pathname.startsWith('/admin');

  useEffect(() => {
    const language = i18n.resolvedLanguage ?? 'en';
    document.documentElement.setAttribute('lang', language);
    document.documentElement.setAttribute('dir', directionFor(language));
  }, [i18n.resolvedLanguage]);

  // The admin panel is a separate surface: it must stay reachable from a normal
  // desktop browser, so it never gets gated behind the Pi SDK check.
  if (!isAdminArea && status === 'no_pi') {
    return (
      <>
        <OfflineBanner />
        <OpenInPiBrowser />
      </>
    );
  }

  if (!isAdminArea && status === 'booting') {
    return <BootScreen />;
  }

  return (
    <ErrorBoundary>
      <ScrollToTop />
      <OfflineBanner />
      {!isAdminArea && <Header />}
      {settings?.maintenanceMode && !isAdminArea ? <MaintenanceNotice /> : null}

      <Suspense fallback={<BootScreen inline />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/orders" element={<OrdersList />} />
          <Route path="/orders/new" element={<RequireAuth><CreateOrder /></RequireAuth>} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/masters" element={<MastersList />} />
          <Route path="/masters/:username" element={<MasterProfile />} />
          <Route path="/dashboard" element={<RequireAuth><MasterDashboard /></RequireAuth>} />
          <Route path="/dashboard/profile" element={<RequireAuth><MasterProfileEdit /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/privacy" element={<PrivacyPolicy />} />

          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="verifications" element={<AdminVerifications />} />
            <Route path="withdrawals" element={<AdminWithdrawals />} />
            <Route path="reviews" element={<AdminReviews />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>

      {!isAdminArea && <BottomNav />}
    </ErrorBoundary>
  );
}

function MaintenanceNotice(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="page" style={{ paddingBottom: 0, flex: '0 0 auto' }}>
      <div className="alert alert--warn">{t('common.maintenance')}</div>
    </div>
  );
}

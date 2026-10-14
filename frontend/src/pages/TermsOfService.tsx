import { useTranslation } from 'react-i18next';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { AppLink as Link } from '../components/AppLink';

/**
 * Public terms of service. Its address goes into the Pi Developer Portal
 * (Privacy / TOS) and the Ecosystem Listing, so it must render signed out and
 * outside Pi Browser, like the privacy policy.
 */
export default function TermsOfService(): JSX.Element {
  const { settings } = usePlatformSettings();
  const { t } = useTranslation();

  const sections = [
    'about',
    'account',
    'payments',
    'fees',
    'refunds',
    'disputes',
    'conduct',
    'verification',
    'liability',
    'changes',
    'contact',
  ] as const;

  return (
    <main className="page stack">
      <h1>{t('terms.title')}</h1>
      <p className="muted">{t('terms.updated')}</p>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{t('terms.intro')}</p>

      {sections.map((section) => {
        // Same rule as the privacy policy: a configured support channel is
        // named outright, otherwise the Developer Portal listing is the way in.
        const hasChannel = section === 'contact' && Boolean(settings?.supportContact);
        return (
          <section key={section} className="card stack" style={{ gap: 6 }}>
            <h2 style={{ fontSize: 16 }}>{t(`terms.${section}Title`)}</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
              {hasChannel ? t('terms.contactWithChannel') : t(`terms.${section}Body`)}
            </p>
            {hasChannel ? (
              <p style={{ margin: 0, fontWeight: 600, wordBreak: 'break-all' }}>
                {settings!.supportContact}
              </p>
            ) : null}
          </section>
        );
      })}

      <Link to="/privacy" className="btn btn--secondary">
        {t('common.privacy')}
      </Link>
    </main>
  );
}

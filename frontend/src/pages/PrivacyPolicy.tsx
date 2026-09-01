import { useTranslation } from 'react-i18next';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { Link } from 'react-router-dom';

export default function PrivacyPolicy(): JSX.Element {
  const { settings } = usePlatformSettings();
  const { t } = useTranslation();

  const sections = [
    'collect',
    'use',
    'payments',
    'photos',
    'location',
    'retention',
    'rights',
    'cookies',
    'contact',
  ] as const;

  return (
    <main className="page stack">
      <h1>{t('privacy.title')}</h1>
      <p className="muted">{t('privacy.updated')}</p>

      {sections.map((section) => {
        // The contact section is the one place the policy has to name a way to
        // reach a human. With a channel configured it points there; without
        // one it keeps the Developer Portal fallback rather than going blank.
        const hasChannel = section === 'contact' && Boolean(settings?.supportContact);
        return (
          <section key={section} className="card stack" style={{ gap: 6 }}>
            <h2 style={{ fontSize: 16 }}>{t(`privacy.${section}Title`)}</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
              {hasChannel ? t('privacy.contactWithChannel') : t(`privacy.${section}Body`)}
            </p>
            {hasChannel ? (
              <p style={{ margin: 0, fontWeight: 600, wordBreak: 'break-all' }}>
                {settings!.supportContact}
              </p>
            ) : null}
          </section>
        );
      })}

      <Link to="/profile" className="btn btn--secondary">
        {t('privacy.manageData')}
      </Link>
    </main>
  );
}

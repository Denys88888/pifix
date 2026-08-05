import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function PrivacyPolicy(): JSX.Element {
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

      {sections.map((section) => (
        <section key={section} className="card stack" style={{ gap: 6 }}>
          <h2 style={{ fontSize: 16 }}>{t(`privacy.${section}Title`)}</h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
            {t(`privacy.${section}Body`)}
          </p>
        </section>
      ))}

      <Link to="/profile" className="btn btn--secondary">
        {t('privacy.manageData')}
      </Link>
    </main>
  );
}

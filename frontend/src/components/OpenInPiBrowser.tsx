import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';
import styles from '../styles/OpenInPiBrowser.module.css';

const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined) ?? window.location.origin;

/**
 * Fallback screen when `window.Pi` is missing — desktop Chrome, a regular
 * mobile browser, or a blocked SDK script. Nothing in the app works without the
 * SDK, so this is a dead end by design, with the link to copy.
 */
export function OpenInPiBrowser(): JSX.Element {
  const { t } = useTranslation();

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(APP_URL);
    } catch {
      window.prompt(t('piBrowser.copyPrompt'), APP_URL);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.lang}>
        <LanguageSwitcher compact />
      </div>

      <div className={styles.card}>
        <div className={styles.icon} aria-hidden="true">
          π
        </div>
        <h1>{t('piBrowser.title')}</h1>
        <p className="muted">{t('piBrowser.body')}</p>

        <ol className={styles.steps}>
          <li>{t('piBrowser.step1')}</li>
          <li>{t('piBrowser.step2')}</li>
          <li>{t('piBrowser.step3')}</li>
        </ol>

        <div className={styles.url}>{APP_URL}</div>

        <button className="btn" onClick={() => void copyLink()}>
          {t('piBrowser.copy')}
        </button>
        <button className="btn btn--secondary" onClick={() => window.location.reload()}>
          {t('piBrowser.retry')}
        </button>

        <p className={styles.footnote}>{t('piBrowser.footnote')}</p>
      </div>
    </div>
  );
}

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../i18n';
import { authApi } from '../api/endpoints';
import { getAuthToken } from '../api/client';
import styles from '../styles/LanguageSwitcher.module.css';

export function LanguageSwitcher({ compact = false }: { compact?: boolean }): JSX.Element {
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage ?? 'en';

  const change = useCallback(
    async (code: string) => {
      await i18n.changeLanguage(code);
      // Persist the choice server-side too, but only when signed in.
      if (getAuthToken()) {
        void authApi.setLanguage(code).catch(() => undefined);
      }
    },
    [i18n],
  );

  return (
    <label className={compact ? styles.compact : styles.full}>
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={current}
        onChange={(event) => void change(event.target.value)}
        aria-label={t('common.language')}
      >
        {LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {compact ? language.code.toUpperCase() : language.label}
          </option>
        ))}
      </select>
    </label>
  );
}

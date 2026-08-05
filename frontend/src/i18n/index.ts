import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';

export interface LanguageOption {
  code: string;
  label: string;
  dir: 'ltr' | 'rtl';
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ru', label: 'Русский', dir: 'ltr' },
  { code: 'uk', label: 'Українська', dir: 'ltr' },
  { code: 'pl', label: 'Polski', dir: 'ltr' },
  { code: 'es', label: 'Español', dir: 'ltr' },
  { code: 'pt', label: 'Português', dir: 'ltr' },
  { code: 'id', label: 'Bahasa Indonesia', dir: 'ltr' },
  { code: 'vi', label: 'Tiếng Việt', dir: 'ltr' },
  { code: 'hi', label: 'हिन्दी', dir: 'ltr' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
];

export const SUPPORTED_CODES = LANGUAGES.map((language) => language.code);

export function directionFor(code: string): 'ltr' | 'rtl' {
  return LANGUAGES.find((language) => language.code === code)?.dir ?? 'ltr';
}

/**
 * Bundles are served as static JSON from /locales/{lng}/translation.json so a
 * new language does not require a rebuild, and only the active language is
 * downloaded — matters a lot on 3G.
 */
void i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_CODES,
    nonExplicitSupportedLngs: true, // ru-RU → ru
    load: 'languageOnly',
    ns: ['translation'],
    defaultNS: 'translation',
    backend: { loadPath: '/locales/{{lng}}/translation.json' },
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: 'pifix_lang',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false }, // React already escapes
    react: { useSuspense: true },
    returnEmptyString: false,
  });

i18n.on('languageChanged', (language) => {
  const dir = directionFor(language);
  document.documentElement.setAttribute('lang', language);
  document.documentElement.setAttribute('dir', dir);
});

export default i18n;

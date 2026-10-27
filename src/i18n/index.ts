// src/i18n/index.ts
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';

export const SUPPORTED_LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'pt-BR', label: 'Português (BR)' },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]['code'];

void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            en: { translation: en },
            'pt-BR': { translation: ptBR },
        },
        fallbackLng: 'en',
        supportedLngs: ['en', 'pt-BR'],
        interpolation: {
            escapeValue: false,
        },
        detection: {
            order: ['localStorage', 'navigator', 'htmlTag'],
            lookupLocalStorage: 'spotyfree-language',
            caches: ['localStorage'],
        },
    });

export default i18n;

/** Change language and persist preference */
export function setLanguage(lang: SupportedLanguage) {
    void i18n.changeLanguage(lang);
    localStorage.setItem('spotyfree-language', lang);
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang } }));
    }
}

interface WindowWithI18n extends Window {
    i18n?: typeof i18n;
    setLanguage?: typeof setLanguage;
}

if (typeof window !== 'undefined') {
    const win = window as WindowWithI18n;
    win.i18n = i18n;
    win.setLanguage = setLanguage;
}

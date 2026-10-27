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

const savedLanguage =
    (typeof window !== 'undefined' && localStorage.getItem('spotyfree-language')) || 'pt-BR';

void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            en: { translation: en },
            'pt-BR': { translation: ptBR },
            pt: { translation: ptBR },
        },
        lng: savedLanguage === 'en' ? 'en' : 'pt-BR',
        fallbackLng: 'pt-BR',
        supportedLngs: ['pt-BR', 'pt', 'en'],
        interpolation: {
            escapeValue: false,
        },
        detection: {
            order: ['localStorage'],
            lookupLocalStorage: 'spotyfree-language',
            caches: ['localStorage'],
        },
    });

if (typeof document !== 'undefined') {
    document.documentElement.lang = savedLanguage.startsWith('en') ? 'en' : 'pt-BR';
}

export default i18n;

/** Change language and persist preference */
export function setLanguage(lang: SupportedLanguage) {
    void i18n.changeLanguage(lang);
    localStorage.setItem('spotyfree-language', lang);
    if (typeof document !== 'undefined') {
        document.documentElement.lang = lang;
    }
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

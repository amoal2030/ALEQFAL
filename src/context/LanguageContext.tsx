import React, { createContext, useContext, useEffect, useState } from 'react';
import { SupportedLanguage } from '../types';
import { translations } from '../i18n/translations';

type TranslationsShape = typeof translations.ar;

interface LanguageContextType {
  language: SupportedLanguage;
  direction: 'rtl' | 'ltr';
  setLanguage: (lang: SupportedLanguage) => void;
  t: (key: keyof TranslationsShape) => any;
  /** Inline trilingual helper that preserves exact Arabic copy while rendering natural English/Urdu */
  tr: (ar: string, en: string, ur: string) => string;
  translationsObj: TranslationsShape;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'aleqfal_lang';

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<SupportedLanguage>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as SupportedLanguage;
      if (saved === 'ar' || saved === 'en' || saved === 'ur') {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'ar';
  });

  const direction: 'rtl' | 'ltr' = language === 'en' ? 'ltr' : 'rtl';

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // ignore
    }
  }, [language, direction]);

  const setLanguage = (lang: SupportedLanguage) => {
    setLanguageState(lang);
  };

  const currentDict = translations[language] || translations.ar;

  const t = (key: keyof TranslationsShape): any => {
    return currentDict[key] ?? translations.ar[key] ?? key;
  };

  const tr = (ar: string, en: string, ur: string): string => {
    if (language === 'en') return en;
    if (language === 'ur') return ur;
    return ar;
  };

  return (
    <LanguageContext.Provider
      value={{
        language,
        direction,
        setLanguage,
        t,
        tr,
        translationsObj: currentDict,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

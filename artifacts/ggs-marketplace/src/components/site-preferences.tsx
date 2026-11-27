import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { ChevronDown, Globe, Monitor, Moon, Sun } from 'lucide-react';

export function SitePreferences({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const id = useId();
  const ThemeIcon = mounted && theme === 'dark' ? Moon : mounted && theme === 'light' ? Sun : Monitor;
  useEffect(() => setMounted(true), []);
  const locales = [
    { code: 'en', label: t('languageNames.en'), beta: false },
    { code: 'es', label: t('languageNames.es'), beta: true },
    { code: 'fr', label: t('languageNames.fr'), beta: true },
    { code: 'zh-CN', label: t('languageNames.zhCN'), beta: true },
  ];
  return <div className={`site-preferences flex flex-nowrap items-center gap-2 ${compact ? 'site-preferences-compact' : ''}`} data-testid="group-site-preferences">
    <label className="preference-control">
    <ThemeIcon size={15} aria-hidden="true" />
    <span className="sr-only">{t('theme')}</span>
    <select id={`${id}-theme`} className="theme-control" value={mounted ? theme : 'system'} onChange={(event) => setTheme(event.target.value)} aria-label={t('theme')} data-testid="select-theme">
      <option value="light">{t('themeLight')}</option><option value="dark">{t('themeDark')}</option><option value="system">{t('themeSystem')}</option>
    </select>
    </label>
    <label className="preference-control language-preference">
    <Globe size={15} aria-hidden="true" />
    <span aria-hidden="true">{(i18n.resolvedLanguage || 'en') === 'zh-CN' ? 'ZH' : (i18n.resolvedLanguage || 'en').toUpperCase()}</span>
    <ChevronDown size={12} aria-hidden="true" />
    <select id={`${id}-language`} className="locale-select-overlay" value={i18n.resolvedLanguage || 'en'} onChange={(event) => void i18n.changeLanguage(event.target.value)} aria-label={t('language')} data-testid="select-language">
      {locales.map(({ code, label, beta }) => <option key={code} value={code}>{label}{beta ? ` · ${t('beta')}` : ''}</option>)}
    </select>
    </label>
  </div>;
}

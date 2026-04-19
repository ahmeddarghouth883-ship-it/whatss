import { useTranslation } from 'react-i18next'
import { useTheme } from '../contexts/ThemeContext'

export default function AppHeaderBar() {
  const { t, i18n } = useTranslation()
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="hidden lg:flex items-center gap-3 px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm flex-shrink-0 justify-end">
      <label className="sr-only" htmlFor="wf-lang">{t('common.language')}</label>
      <select
        id="wf-lang"
        value={(i18n.language || 'en').split('-')[0]}
        onChange={e => i18n.changeLanguage(e.target.value)}
        className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
      >
        <option value="en">English</option>
        <option value="fr">Français</option>
        <option value="ar">العربية</option>
      </select>
      <button
        type="button"
        onClick={toggleTheme}
        className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
        title={t('common.theme')}
      >
        {theme === 'dark' ? t('common.themeLight') : t('common.themeDark')}
      </button>
    </div>
  )
}

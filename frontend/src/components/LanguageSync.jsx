import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export default function LanguageSync() {
  const { i18n } = useTranslation()

  useEffect(() => {
    function apply() {
      const lng = i18n.resolvedLanguage || i18n.language || 'en'
      const base = lng.split('-')[0]
      document.documentElement.setAttribute('dir', base === 'ar' ? 'rtl' : 'ltr')
      document.documentElement.setAttribute('lang', lng)
      try {
        localStorage.setItem('wf_lang', base)
      } catch (_) {}
    }
    apply()
    i18n.on('languageChanged', apply)
    return () => i18n.off('languageChanged', apply)
  }, [i18n])

  return null
}

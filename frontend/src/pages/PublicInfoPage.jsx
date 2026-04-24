import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../contexts/ThemeContext'
import { legalPagesCopy } from './legalPagesCopy'
import { landingCopy } from './landingCopy'

function readStoredLang() {
  try {
    const s = localStorage.getItem('language') || localStorage.getItem('whispflow-landing-lang')
    if (s === 'en' || s === 'fr' || s === 'ar' || s === 'it') return s
  } catch {}
  return null
}

function resolveLang(i18n) {
  const stored = readStoredLang()
  if (stored) return stored
  const base = (i18n.language || 'en').split('-')[0]
  return ['en', 'fr', 'ar', 'it'].includes(base) ? base : 'en'
}

export default function PublicInfoPage({ page }) {
  const { i18n } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const [lang, setLang] = useState(() => readStoredLang() ?? 'en')

  useEffect(() => {
    setLang(resolveLang(i18n))
  }, [i18n.language])

  const copy = legalPagesCopy[lang]?.[page] || legalPagesCopy.en[page]
  const tFoot = landingCopy[lang]?.footer || landingCopy.en.footer
  const isRtl = lang === 'ar'

  function persistLang(next) {
    setLang(next)
    try {
      localStorage.setItem('language', next)
      localStorage.setItem('whispflow-landing-lang', next)
    } catch {}
    if (next === 'en' || next === 'fr' || next === 'ar') {
      i18n.changeLanguage(next)
    }
    document.documentElement.setAttribute('lang', next)
    document.documentElement.setAttribute('dir', next === 'ar' ? 'rtl' : 'ltr')
  }

  if (!copy) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
        <p className="text-gray-600 dark:text-gray-400">Page not found.</p>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100"
      dir={isRtl ? 'rtl' : 'ltr'}
      lang={lang}
    >
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="text-green-600 hover:text-green-700 dark:text-green-500 font-medium text-sm">
            ← WhispFlow
          </Link>
          <div className="flex items-center gap-2">
            <select
              value={lang}
              onChange={(e) => persistLang(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
              aria-label="Language"
            >
              <option value="en">EN</option>
              <option value="fr">FR</option>
              <option value="it">IT</option>
              <option value="ar">عربي</option>
            </select>
            <button
              type="button"
              onClick={() => toggleTheme()}
              className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-10 sm:py-14">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 mb-2">
          {copy.title}
        </h1>
        {copy.updated && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-10">{copy.updated}</p>
        )}

        {page === 'contact' ? (
          <>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed mb-8">{copy.intro}</p>
            <dl className="space-y-6">
              {copy.rows.map((row) => (
                <div key={row.label}>
                  <dt className="text-xs font-mono uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                    {row.label}
                  </dt>
                  <dd className="text-base">
                    {row.href ? (
                      <a
                        href={row.href}
                        className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 font-medium underline-offset-2 hover:underline"
                      >
                        {row.value}
                      </a>
                    ) : (
                      row.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <article className="space-y-10">
            {copy.sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                  {section.title}
                </h2>
                <div className="space-y-3 text-gray-600 dark:text-gray-300 leading-relaxed">
                  {section.paragraphs.map((p, idx) => (
                    <p key={idx}>{p}</p>
                  ))}
                </div>
              </section>
            ))}
          </article>
        )}
      </main>

      <footer className="border-t border-gray-200 dark:border-gray-800 py-8 mt-auto">
        <div className="max-w-3xl mx-auto px-4 flex flex-wrap gap-6 justify-center text-sm text-gray-500 dark:text-gray-400">
          <Link to="/privacy" className="hover:text-green-600 dark:hover:text-green-400">
            {tFoot.privacy}
          </Link>
          <Link to="/terms" className="hover:text-green-600 dark:hover:text-green-400">
            {tFoot.terms}
          </Link>
          <Link to="/contact" className="hover:text-green-600 dark:hover:text-green-400">
            {tFoot.contact}
          </Link>
        </div>
      </footer>
    </div>
  )
}

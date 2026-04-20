import { useEffect, useRef, useState } from 'react'

const GOOGLE_SCRIPT_ID = 'google-identity-services'
const GOOGLE_CALLBACK_KEY = '__wfGoogleCredentialCallback'
const GOOGLE_INIT_CLIENT_KEY = '__wfGoogleInitClientId'
const GOOGLE_INIT_PROMISE_KEY = '__wfGoogleInitPromise'
const GOOGLE_INITIALIZED_KEY = '__wfGoogleInitialized'

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve()

    const existing = document.getElementById(GOOGLE_SCRIPT_ID)
    if (existing) {
      const existingSrc = existing.getAttribute('src') || ''
      if (/accounts\.google\.com\/gsi\/client/.test(existingSrc) && existing.dataset.loaded === 'true') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Google script failed to load')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = GOOGLE_SCRIPT_ID
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      script.dataset.loaded = 'true'
      resolve()
    }
    script.onerror = () => reject(new Error('Google script failed to load'))
    document.head.appendChild(script)
  })
}

export default function GoogleSignInButton({
  onCredential,
  disabled = false,
  theme = 'light',
  showDivider = true,
}) {
  const buttonRef = useRef(null)
  const callbackRef = useRef(onCredential)
  const [ready, setReady] = useState(false)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  useEffect(() => {
    callbackRef.current = onCredential
  }, [onCredential])

  useEffect(() => {
    let mounted = true

    async function initGoogle() {
      if (!clientId || !buttonRef.current) return

      try {
        await loadGoogleScript()
        if (!mounted || !window.google?.accounts?.id) return

        // Keep the latest callback without re-initializing Google on every render.
        window[GOOGLE_CALLBACK_KEY] = (credential) => {
          const cb = callbackRef.current
          if (typeof cb === 'function') cb(credential)
        }

        const alreadyInitialized = window[GOOGLE_INITIALIZED_KEY] === true
        if (!alreadyInitialized) {
          if (!window[GOOGLE_INIT_PROMISE_KEY]) {
            window[GOOGLE_INIT_PROMISE_KEY] = (async () => {
              // Keep account picker explicit instead of silently reusing a remembered session.
              window.google.accounts.id.disableAutoSelect()

              window.google.accounts.id.initialize({
                client_id: clientId,
                auto_select: false,
                itp_support: true,
                use_fedcm_for_prompt: true,
                use_fedcm_for_button: true,
                callback: (response) => {
                  if (!response?.credential) return
                  const cb = window[GOOGLE_CALLBACK_KEY]
                  if (typeof cb !== 'function') return
                  cb(response.credential)
                }
              })

              window[GOOGLE_INIT_CLIENT_KEY] = clientId
              window[GOOGLE_INITIALIZED_KEY] = true
            })().finally(() => {
              window[GOOGLE_INIT_PROMISE_KEY] = null
            })
          }

          await window[GOOGLE_INIT_PROMISE_KEY]
        } else if (window[GOOGLE_INIT_CLIENT_KEY] !== clientId) {
          // GIS only uses the last initialized instance; keep the first setup stable.
          console.warn('Google Identity Services was already initialized with a different client ID.')
        }

        if (!mounted || !buttonRef.current) {
          return
        }

        buttonRef.current.innerHTML = ''
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: theme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          width: Math.min(buttonRef.current.offsetWidth || 320, 360)
        })

        setReady(true)
      } catch {
        setReady(false)
      }
    }

    initGoogle()
    return () => {
      mounted = false
    }
  }, [clientId, theme])

  if (!clientId) return null

  return (
    <div className="space-y-2">
      {showDivider && (
        <div className="relative flex items-center justify-center">
          <div className="absolute left-0 right-0 h-px bg-gray-200 dark:bg-gray-700" />
          <span className="relative px-3 text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900">
            or
          </span>
        </div>
      )}
      <div className={disabled ? 'opacity-60 pointer-events-none' : ''}>
        <div ref={buttonRef} className="w-full flex justify-center" />
      </div>
      {!ready && (
        <p className="text-[11px] text-center text-gray-500 dark:text-gray-400">
          Loading Google sign in...
        </p>
      )}
    </div>
  )
}

/**
 * Maps axios/fetch failures to a user-visible string.
 * Network errors (no response) usually mean the API is down or unreachable.
 */
export function getRequestErrorMessage(err, t, fallbackKey) {
  const serverMsg = err.response?.data?.error
  if (typeof serverMsg === 'string' && serverMsg.trim()) return serverMsg

  const code = err.code
  const msg = err.message || ''
  if (!err.response && (code === 'ERR_NETWORK' || code === 'ECONNABORTED' || msg === 'Network Error')) {
    return t('errors.apiUnreachable')
  }
  if (!err.response) {
    return t('errors.apiUnreachable')
  }
  return t(fallbackKey)
}

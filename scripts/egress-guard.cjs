/**
 * ELLEVEE IA — STAGING EGRESS FIREWALL
 * Intercepta e bloqueia in-process qualquer chamada HTTP/HTTPS de saída
 * que não pertença estritamente à allowlist de Staging (127.0.0.1 / dkjrpdhymtkgbknocijy).
 */
const http = require('http')
const https = require('https')
const { EventEmitter } = require('events')

const ALLOWED_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  'dkjrpdhymtkgbknocijy.supabase.co',
])

function isAllowedHost(host) {
  if (!host) return false
  const cleanHost = String(host).toLowerCase().split(':')[0]
  if (ALLOWED_HOSTS.has(cleanHost)) return true
  if (cleanHost.endsWith('.dkjrpdhymtkgbknocijy.supabase.co')) return true
  return false
}

function wrapRequest(originalFn, protocol) {
  return function (urlOrOptions, options, cb) {
    let host = ''
    if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
      try {
        const parsed = new URL(urlOrOptions)
        host = parsed.hostname
      } catch {
        host = String(urlOrOptions)
      }
    } else if (urlOrOptions && typeof urlOrOptions === 'object') {
      host = urlOrOptions.hostname || urlOrOptions.host || ''
    }

    if (!isAllowedHost(host)) {
      const err = new Error(`[EGRESS_BLOCKED] Conexão externa bloqueada para: '${host}'. Host não autorizado no runtime de homologação.`)
      err.code = 'EGRESS_BLOCKED'

      const mockReq = new EventEmitter()
      mockReq.end = () => mockReq
      mockReq.write = () => true
      mockReq.abort = () => {}
      mockReq.destroy = () => {}
      mockReq.setHeader = () => {}
      mockReq.getHeader = () => undefined

      process.nextTick(() => {
        mockReq.emit('error', err)
      })
      return mockReq
    }

    return originalFn.apply(this, arguments)
  }
}

http.request = wrapRequest(http.request, 'http')
http.get = wrapRequest(http.get, 'http')
https.request = wrapRequest(https.request, 'https')
https.get = wrapRequest(https.get, 'https')

if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async function (input, init) {
    let host = ''
    try {
      if (typeof input === 'string' || input instanceof URL) {
        host = new URL(input).hostname
      } else if (input && typeof input.url === 'string') {
        host = new URL(input.url).hostname
      }
    } catch {
      host = String(input)
    }

    if (!isAllowedHost(host)) {
      const err = new Error(`[EGRESS_BLOCKED] Fetch bloqueado para host externo: '${host}'. Proibido no runtime de homologação.`)
      err.code = 'EGRESS_BLOCKED'
      throw err
    }

    return originalFetch.apply(this, arguments)
  }
}

module.exports = { isAllowedHost, ALLOWED_HOSTS }

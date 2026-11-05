import 'server-only'

import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import { createAdminClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { requireActiveCompany, TenantAccessError } from '@/lib/services/platform/tenant-access'

/**
 * Handler mockável para interceptação de requisições em testes automatizados.
 */
type MockHttpHandler = (url: string, options: any) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
  json?: () => Promise<any>
}>
let mockHttpHandler: MockHttpHandler | null = null

export function setMockHttpHandler(handler: MockHttpHandler | null) {
  mockHttpHandler = handler
}

/**
 * Validação rigorosa de octetos para IPv4 contra faixas privadas,
 * loopback, link-local, multicast, CGNAT e reservadas (RFC 1918, RFC 1122, RFC 3927, RFC 6598, RFC 5771).
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4) return true
  for (const p of parts) {
    if (isNaN(p) || p < 0 || p > 255) return true
  }
  const [b0, b1, b2] = parts

  if (b0 === 0) return true // 0.0.0.0/8 (Current network / unspecified RFC 1122)
  if (b0 === 10) return true // 10.0.0.0/8 (Private RFC 1918)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true // 100.64.0.0/10 (Shared Address Space / CGNAT RFC 6598)
  if (b0 === 127) return true // 127.0.0.0/8 (Loopback RFC 1122)
  if (b0 === 169 && b1 === 254) return true // 169.254.0.0/16 (Link-local RFC 3927 / Cloud Metadata)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true // 172.16.0.0/12 (Private RFC 1918)
  if (b0 === 192 && b1 === 0 && b2 === 0) return true // 192.0.0.0/24 (IETF Protocol Assignments)
  if (b0 === 192 && b1 === 0 && b2 === 2) return true // 192.0.2.0/24 (TEST-NET-1)
  if (b0 === 192 && b1 === 168) return true // 192.168.0.0/16 (Private RFC 1918)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true // 198.18.0.0/15 (Benchmarking)
  if (b0 === 198 && b1 === 51 && b2 === 100) return true // 198.51.100.0/24 (TEST-NET-2)
  if (b0 === 203 && b1 === 0 && b2 === 113) return true // 203.0.113.0/24 (TEST-NET-3)
  if (b0 >= 224) return true // 224.0.0.0/4 (Multicast e Reservado Classe E / Broadcast RFC 5771/1112)
  return false
}

/**
 * Desempacota representações IPv4 encapsuladas ou mapeadas em endereços IPv6.
 * Cobre formatos decimais com pontos e notações hexadecimais de 16 bits para:
 * - IPv4-mapped IPv6 (::ffff:d.d.d.d e ::ffff:hhhh:hhhh) (RFC 4291)
 * - IPv4-translated (::ffff:0:d.d.d.d e ::ffff:0:hhhh:hhhh) (RFC 2765)
 * - NAT64 Well-Known Prefix (64:ff9b::d.d.d.d e 64:ff9b::hhhh:hhhh) (RFC 6052)
 * - 6to4 (2002:WWXX:YYZZ::) (RFC 3056)
 */
export function unpackIpv4FromIpv6(ipStr: string): string | null {
  if (!ipStr || typeof ipStr !== 'string') return null
  let s = ipStr.toLowerCase().trim()
  if (s.startsWith('[') && s.endsWith(']')) {
    s = s.slice(1, -1)
  }

  // 1. Dotted decimal: ::ffff:d.d.d.d, ::ffff:0:d.d.d.d ou 64:ff9b::d.d.d.d
  const dottedMatch = /(?:^::ffff:|^::ffff:0:|^64:ff9b::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(s)
  if (dottedMatch) {
    return dottedMatch[1]
  }

  // 2. Hexadecimal de 16 bits: ::ffff:h:h ou ::ffff:0:h:h
  const hexMatch = /(?:^::ffff:|^::ffff:0:|^0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(s)
  if (hexMatch) {
    const w1 = parseInt(hexMatch[1], 16)
    const w2 = parseInt(hexMatch[2], 16)
    if (!isNaN(w1) && !isNaN(w2) && w1 >= 0 && w1 <= 0xffff && w2 >= 0 && w2 <= 0xffff) {
      return `${(w1 >> 8) & 0xff}.${w1 & 0xff}.${(w2 >> 8) & 0xff}.${w2 & 0xff}`
    }
  }

  // 3. NAT64 hex: 64:ff9b::[0-9a-f]{1,4}:[0-9a-f]{1,4}
  const nat64HexMatch = /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(s)
  if (nat64HexMatch) {
    const w1 = parseInt(nat64HexMatch[1], 16)
    const w2 = parseInt(nat64HexMatch[2], 16)
    if (!isNaN(w1) && !isNaN(w2) && w1 >= 0 && w1 <= 0xffff && w2 >= 0 && w2 <= 0xffff) {
      return `${(w1 >> 8) & 0xff}.${w1 & 0xff}.${(w2 >> 8) & 0xff}.${w2 & 0xff}`
    }
  }

  // 4. 6to4: 2002:w1:w2:...
  const m6to4 = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})/i.exec(s)
  if (m6to4) {
    const w1 = parseInt(m6to4[1], 16)
    const w2 = parseInt(m6to4[2], 16)
    if (!isNaN(w1) && !isNaN(w2) && w1 >= 0 && w1 <= 0xffff && w2 >= 0 && w2 <= 0xffff) {
      return `${(w1 >> 8) & 0xff}.${w1 & 0xff}.${(w2 >> 8) & 0xff}.${w2 & 0xff}`
    }
  }

  return null
}

/**
 * Avalia se um endereço IP (IPv4 ou IPv6) pertence a faixas privadas,
 * loopback, link-local, multicast, CGNAT, não roteáveis, reservadas ou prefixos de transição inseguros.
 */
export function isPrivateIp(ipStr: string): boolean {
  if (!ipStr || typeof ipStr !== 'string') return true

  let ip = ipStr.trim()
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1)
  }

  // Desempacotamento de endereços IPv4 encapsulados ou mapeados em IPv6
  const embeddedIpv4 = unpackIpv4FromIpv6(ip)
  if (embeddedIpv4) {
    // Se o IPv4 embutido for privado, rejeita incondicionalmente
    if (isPrivateIpv4(embeddedIpv4)) {
      return true
    }
  }

  // Validação estrita para IPv4 nativo
  if (net.isIPv4(ip)) {
    return isPrivateIpv4(ip)
  }

  // Validação estrita para IPv6 nativo
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase()
    if (l === '::1' || l === '0:0:0:0:0:0:0:1') return true // Loopback (RFC 4291)
    if (l === '::' || l === '0:0:0:0:0:0:0:0') return true // Unspecified (RFC 4291)
    if (l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb')) return true // Link-local (fe80::/10, RFC 4291)
    if (l.startsWith('fec') || l.startsWith('fed') || l.startsWith('fee') || l.startsWith('fef')) return true // Site-local depreciado (fec0::/10, RFC 3879)
    if (l.startsWith('fc') || l.startsWith('fd')) return true // Unique Local Address / ULA (fc00::/7, RFC 4193)
    if (l.startsWith('ff')) return true // Multicast (ff00::/8, RFC 4291)
    if (l.startsWith('100::')) return true // Discard prefix (100::/64, RFC 6666)
    if (l.startsWith('2001:db8:')) return true // Documentação (2001:db8::/32, RFC 3849)
    if (l.startsWith('2001:2:')) return true // Benchmarking (2001:2::/48, RFC 5180)

    // Prefixos de transição e tunelamento histórico depreciados (RFC 7526):
    // 6to4 (2002::/16) e Teredo (2001:0000::/32 ou 2001::/32)
    if (l.startsWith('2002:')) return true // 6to4 bloqueado por política de segurança (RFC 7526)
    if (l.startsWith('2001:0:') || l.startsWith('2001:0000:') || l === '2001::' || l.startsWith('2001::')) {
      // Bloqueia Teredo (2001:0::/32, RFC 4380)
      return true
    }

    // NAT64 Well-Known Prefix (64:ff9b::/96)
    if (l.startsWith('64:ff9b::')) {
      // Se não desempacotou um IPv4 público válido, bloqueia por padrão defensivo
      if (!embeddedIpv4 || isPrivateIpv4(embeddedIpv4)) return true
    }

    // Demais faixas IPv6 públicas globais (ex: 2606:4700:..., 2001:4860:..., 2a00:...) permanecem permitidas
    return false
  }

  // Caso não seja um IPv4 ou IPv6 reconhecido, trata como inseguro por fail-closed
  return true
}

/**
 * Validação léxica preliminar de segurança da URL (protocolos, caracteres e literais de IP).
 */
export function isSafeUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    // Apenas HTTP e HTTPS são estritamente permitidos
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

    const hostname = url.hostname.toLowerCase()
    const cleanHostname = hostname.replace(/^\[|\]$/g, '')

    // Bloqueia nomes locais óbvios
    if (
      cleanHostname === 'localhost' ||
      cleanHostname.endsWith('.localhost') ||
      cleanHostname.endsWith('.local') ||
      cleanHostname.endsWith('.internal') ||
      cleanHostname === 'localtest.me'
    ) {
      return false
    }

    // Bloqueia notações numéricas alternativas de IPv4 (decimal puro, octal ou hex)
    if (/^\d+$/.test(cleanHostname)) return false // Ex: http://2130706433/
    if (/^0x[0-9a-f]+$/i.test(cleanHostname)) return false // Ex: http://0x7f000001/
    if (/^0[0-7]+(\.[0-9a-f]+)*$/i.test(cleanHostname)) return false // Ex: http://0177.0.0.1/

    // Se o hostname for diretamente um IP literal (v4 ou v6), valida imediatamente contra faixas privadas
    if (net.isIP(cleanHostname) !== 0) {
      if (isPrivateIp(cleanHostname)) return false
    }

    return true
  } catch {
    return false
  }
}

function returnLookupAddress(callback: any, options: any, address: string, family: number) {
  if (options && options.all) {
    return callback(null, [{ address, family }])
  }
  return callback(null, address, family)
}

/**
 * Custom DNS Lookup para http.request/https.request:
 * 1. Resolve todos os registros A e AAAA do domínio.
 * 2. Inspeciona cada IP retornado.
 * 3. Se QUALQUER endereço resolver para faixa privada/restrita, aborta a requisição imediatamente.
 * 4. Pega o primeiro IP validado e o entrega ao socket de conexão.
 * 5. Previne DNS Rebinding ao forçar a conexão exatamente no IP aprovado, sem perder SNI/TLS validation.
 */
export function safeLookup(
  hostname: string,
  options: any,
  callback: any
) {
  // Se hostname já for um IP literal
  if (net.isIP(hostname) !== 0) {
    if (isPrivateIp(hostname)) {
      return callback(new Error(`SSRF_BLOCKED: Endereço IP literal ${hostname} pertence a uma faixa privada ou restrita.`))
    }
    return returnLookupAddress(callback, options, hostname, net.isIPv6(hostname) ? 6 : 4)
  }

  dns.promises.lookup(hostname, { all: true }).then((addresses) => {
    if (!addresses || addresses.length === 0) {
      return callback(new Error('Nenhum endereço IP retornado na resolução DNS.'))
    }

    for (const addr of addresses) {
      if (isPrivateIp(addr.address)) {
        return callback(new Error(`SSRF_BLOCKED: O endereço resolvido ${addr.address} pertence a uma faixa privada ou restrita.`))
      }
    }

    // Retorna o primeiro endereço seguro para conexão física do socket
    const target = addresses[0]
    returnLookupAddress(callback, options, target.address, target.family)
  }).catch((err) => {
    callback(err)
  })
}

/**
 * Cliente HTTP seguro com blindagem SSRF completa:
 * - Validação sintática e léxica da URL.
 * - Resolução DNS com safeLookup e IP pinning contra DNS Rebinding.
 * - Bloqueio estrito de redirecionamentos HTTP (redirect: 'error' / 3xx abort).
 * - Timeout máximo configurado (padrão 8.000 ms).
 * - Preservação do hostname original para SNI e validação do certificado TLS.
 */
export async function safeHttpRequest(
  urlStr: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
    timeoutMs?: number
    lookup?: (hostname: string, options: any, callback: any) => void
  } = {}
): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json?: () => Promise<any> }> {
  if (!isSafeUrl(urlStr)) {
    throw new Error('URL bloqueada por políticas de segurança (SSRF). Use uma URL externa pública válida.')
  }

  if (mockHttpHandler) {
    return await mockHttpHandler(urlStr, options)
  }

  const url = new URL(urlStr)
  const isHttps = url.protocol === 'https:'
  const client = isHttps ? https : http
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80
  const timeoutMs = options.timeoutMs || 8000

  return new Promise((resolve, reject) => {
    let isSettled = false

    const req = (client as any).request({
      protocol: url.protocol,
      hostname: url.hostname,
      port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      lookup: options.lookup || safeLookup, // Pinning de IP seguro (suporta injeção de resolver em testes)
      timeout: timeoutMs
    }, (res: http.IncomingMessage) => {
      // Bloqueio mandatório de redirecionamentos (redirect: 'error')
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
        req.destroy()
        if (!isSettled) {
          isSettled = true
          return reject(new Error('Redirecionamentos HTTP são bloqueados por políticas de segurança (SSRF).'))
        }
      }

      let responseData = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        responseData += chunk
      })
      res.on('end', () => {
        if (!isSettled) {
          isSettled = true
          resolve({
            ok: (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300),
            status: res.statusCode || 500,
            text: async () => responseData,
            json: async () => JSON.parse(responseData)
          })
        }
      })
    })

    req.on('timeout', () => {
      req.destroy()
      if (!isSettled) {
        isSettled = true
        reject(new Error(`Timeout de conexão (${timeoutMs}ms) excedido ao conectar ao n8n.`))
      }
    })

    req.on('error', (err: any) => {
      if (!isSettled) {
        isSettled = true
        if (err.message && err.message.includes('SSRF_BLOCKED')) {
          reject(new Error('URL bloqueada por políticas de segurança (SSRF). Use uma URL externa pública válida.'))
        } else {
          reject(err)
        }
      }
    })

    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

function isNativeFetch(fn: any): boolean {
  if (typeof fn !== 'function') return false
  const str = Function.prototype.toString.call(fn)
  return str.includes('[native code]') || str.includes('undici')
}

/**
 * Wrapper de compatibilidade com timeout.
 */
export async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 8000) {
  if (mockHttpHandler) {
    return await mockHttpHandler(url, options)
  }

  // Intercepta e delega caso a suíte de testes tenha injetado mock em globalThis.fetch
  if (typeof globalThis.fetch === 'function' && !isNativeFetch(globalThis.fetch)) {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await globalThis.fetch(url, { ...options, signal: controller.signal })
      clearTimeout(id)
      return res
    } catch (err) {
      clearTimeout(id)
      throw err
    }
  }

  const method = (options.method || 'GET').toUpperCase()
  const headers = (options.headers || {}) as Record<string, string>
  const body = options.body ? String(options.body) : undefined

  return await safeHttpRequest(url, {
    method,
    headers,
    body,
    timeoutMs
  })
}

/**
 * Executa o teste de conectividade HTTP com o webhook n8n informado.
 * Função puramente interna protegida por 'server-only'.
 */
export async function testN8nConnectionInternal(
  url: string, 
  secret: string
): Promise<{ success: boolean; message: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (secret) headers['x-ellevee-api-key'] = secret

    const response = await safeHttpRequest(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event_id: `test-${Date.now()}`,
        event_type: 'connection.test',
        timestamp: new Date().toISOString()
      }),
      timeoutMs: 8000
    })

    if (response.ok) {
      return { success: true, message: 'Conexão estabelecida com sucesso!' }
    } else if (response.status === 404) {
      return { 
        success: false, 
        message: 'O n8n retornou HTTP 404 (Não Encontrado). Verifique se o Workflow está ATIVO (toggle "Active" ligado no topo do n8n) ou se a URL está correta.' 
      }
    } else {
      return { success: false, message: `O n8n retornou erro: HTTP ${response.status}` }
    }
  } catch (error: any) {
    return { success: false, message: `Falha ao alcançar o n8n: ${error.message}` }
  }
}

/**
 * Módulo interno: executa a validação completa de autorização, RBAC e ciclo de vida
 * antes de invocar o teste HTTP. Aceita opções internas para testes unitários.
 */
export async function testN8nConnectionActionInternal(
  url: string, 
  secret: string, 
  options?: { supabaseClient?: any; adminClient?: any }
): Promise<{ success: boolean; message: string; error?: string; code?: string }> {
  let supabase: any
  try {
    supabase = options?.supabaseClient || createClient()
  } catch {
    supabase = options?.supabaseClient || null
  }

  if (!supabase) {
    return { 
      success: false, 
      message: 'Falha ao inicializar contexto de autenticação.',
      error: 'Falha ao inicializar contexto de autenticação.' 
    }
  }

  // 1. Autenticação de sessão
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return { 
      success: false, 
      message: 'Usuário não autenticado.',
      error: 'Usuário não autenticado.' 
    }
  }

  // 2. Resolução de perfil e empresa autenticada
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', user.id)
    .single()

  if (profErr || !profile?.company_id) {
    return { 
      success: false, 
      message: 'Perfil de empresa não localizado.',
      error: 'Perfil de empresa não localizado.' 
    }
  }

  // 3. RBAC administrativo
  if (!['admin', 'owner'].includes(profile.role)) {
    return { 
      success: false, 
      message: 'Não autorizado: apenas administradores podem testar integrações.',
      error: 'Não autorizado: apenas administradores podem testar integrações.' 
    }
  }

  // 4. Validação do ciclo de vida do tenant (Fail-closed)
  try {
    await requireActiveCompany(profile.company_id, { adminClient: options?.adminClient })
  } catch (err: any) {
    return {
      success: false,
      code: err.code || 'TENANT_NOT_ACTIVE',
      message: err.message,
      error: err.message
    }
  }

  // 5. Invocação da implementação interna protegida
  return await testN8nConnectionInternal(url, secret)
}

/**
 * Tipos estritos para o retorno do Gateway n8n/WhatsApp
 */
export interface OutboundGatewayResponse {
  provider_message_id?: string | null
  providerMessageId?: string | null
  message_id?: string | null
  [key: string]: any
}

export type SendOutboundSuccess = {
  success: true
  provider_message_id: string | null
  cached?: boolean
}

export type SendOutboundFailure = {
  success: false
  reason: string
  code?: string
  statusCode?: number
  error?: string
}

export type SendOutboundResult = SendOutboundSuccess | SendOutboundFailure

export interface SendOutboundOptions {
  adminClient?: any
  outboxId?: string
  messageId?: string
  leaseSeconds?: number
}

/**
 * Avalia se o erro de conexão/transporte é de natureza ambígua
 * (onde não é possível determinar com certeza se o pacote atingiu ou não o destino).
 */
export function isAmbiguousNetworkError(err: any): boolean {
  if (!err) return false
  if (err.name === 'AbortError') return true
  const msg = String(err.message || err).toLowerCase()
  return (
    msg.includes('timeout') ||
    msg.includes('abort') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('econnrefused') ||
    msg.includes('network error')
  )
}

/**
 * Módulo interno: despacha mensagens outbound pelo n8n / WhatsApp.
 * Movido estritamente para fora de qualquer módulo com 'use server' para
 * não ser exposto como Server Action pública no Next.js App Router.
 */
export async function sendOutboundMessage(
  companyId: string, 
  messagePayload: any,
  options?: SendOutboundOptions
): Promise<SendOutboundResult> {
  const supabase = options?.adminClient || createAdminClient()

  // 0. Validação de ciclo de vida do tenant (Fail-closed incondicional)
  try {
    await requireActiveCompany(companyId, { adminClient: supabase })
  } catch (err: any) {
    if (err instanceof TenantAccessError) {
      console.warn(`[N8N Outbound Blocked] Envio bloqueado para empresa '${companyId}': ${err.code} - ${err.message}`)
      return {
        success: false,
        code: err.code,
        statusCode: err.statusCode,
        reason: 'tenant_blocked',
        error: err.message
      }
    }
    return {
      success: false,
      reason: 'tenant_access_error',
      error: err.message || 'Falha ao verificar autorização da empresa'
    }
  }
  
  // 1. Busca a integração n8n ativa da empresa
  const { data: integration } = await supabase.from('integrations')
    .select('*')
    .eq('company_id', companyId)
    .eq('type', 'n8n')
    .eq('status', 'active')
    .single()

  if (!integration || !integration.config?.webhook_url) {
    return { success: false, reason: 'no_integration' }
  }

  const url = integration.config.webhook_url
  const secret = integration.credentials?.webhook_secret
  const eventId = messagePayload?.event_id || messagePayload?.idempotency_key

  if (!isSafeUrl(url)) {
    await logIntegrationEvent(supabase, companyId, integration.id, 'outbound', 'message.send', eventId, 'failed', 'Unsafe URL detected (SSRF Protection)')
    return { success: false, reason: 'unsafe_url' }
  }

  // 2. Aquisição de Lock de Idempotência no Gateway (Tabela gateway_outbound_locks)
  let claimToken: string | null = null

  if (typeof (supabase as any)?.rpc === 'function' && eventId) {
    const { data: lockData, error: lockErr } = await (supabase as any).rpc('acquire_gateway_outbound_lock', {
      p_company_id: companyId,
      p_event_id: eventId,
      p_outbox_id: options?.outboxId || null,
      p_message_id: options?.messageId || null,
      p_lease_seconds: options?.leaseSeconds || 60
    })

    if (lockErr) {
      console.error(`[N8N Outbound Lock Error] Erro ao adquirir lock de gateway: ${lockErr.message}`)
      return {
        success: false,
        reason: 'lock_rpc_error',
        error: lockErr.message
      }
    }

    const lock = Array.isArray(lockData) ? lockData[0] : lockData

    if (lock) {
      if (!lock.was_acquired) {
        // Short-circuit: já enviado com sucesso anteriormente
        if (lock.status === 'completed' || lock.error_reason === 'already_completed') {
          console.log(`[N8N Outbound Idempotent] Lock de gateway já completado para event_id ${eventId}. Short-circuit ativado.`)
          return {
            success: true,
            provider_message_id: lock.provider_message_id || null,
            cached: true
          }
        }

        // Concorrência ativa com lease: aborta para evitar duplicidade no WhatsApp
        if (lock.error_reason === 'concurrency_active_lease') {
          console.warn(`[N8N Outbound Concurrency] Envio concorrente em andamento com lease ativo para event_id ${eventId}`)
          return {
            success: false,
            reason: 'concurrency_active_lease',
            error: 'Envio concorrente em processamento no gateway'
          }
        }

        return {
          success: false,
          reason: lock.error_reason || 'lock_denied',
          error: lock.error_reason || 'Bloqueio de gateway negado'
        }
      }

      claimToken = lock.claim_token
    }
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    
    if (secret) {
      headers['x-ellevee-api-key'] = secret
    }

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(messagePayload)
    }, 8000)

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      const status = response.status
      const isAmbiguousStatus = status === 502 || status === 504

      // Se for 502/504, tratamos como erro ambíguo de rede intermediária (abandona o lock)
      if (isAmbiguousStatus) {
        throw new Error(`HTTP ${status}: ${errorText.substring(0, 100)}`)
      }

      // Falha determinística confirmada pelo backend (4xx ou 500 nítido)
      if (claimToken && typeof (supabase as any)?.rpc === 'function' && eventId) {
        try {
          await (supabase as any).rpc('complete_gateway_outbound_lock', {
            p_company_id: companyId,
            p_event_id: eventId,
            p_claim_token: claimToken,
            p_status: 'failed',
            p_provider_message_id: null,
            p_last_error: `HTTP ${status}: ${errorText.substring(0, 200)}`
          })
        } catch (lockErr: any) {
          console.warn(`[N8N Outbound Lock Warning] Falha ao marcar lock como failed: ${lockErr?.message}`)
        }
      }

      await logIntegrationEvent(supabase, companyId, integration.id, 'outbound', 'message.send', eventId, 'failed', `HTTP ${status}: ${errorText.substring(0, 100)}`)

      return {
        success: false,
        reason: 'fetch_error',
        statusCode: status,
        error: `HTTP ${status}: ${errorText.substring(0, 100)}`
      }
    }

    // 3. Extração segura e tolerante a falhas do provider_message_id do gateway
    let providerMessageId: string | null = null

    try {
      let rawText: string | null = null
      let parsedJson: any = null

      if (typeof response.text === 'function') {
        try {
          rawText = await response.text()
        } catch {
          // Erro de leitura de stream
        }
      }

      if (rawText && typeof rawText === 'string' && rawText.trim().length > 0) {
        try {
          parsedJson = JSON.parse(rawText)
        } catch {
          console.warn('[N8N Outbound Warning] Resposta HTTP 200 recebida, mas o corpo não é um JSON válido. Rastreabilidade degradada.')
        }
      } else if (!rawText && typeof (response as any).json === 'function') {
        try {
          parsedJson = await (response as any).json()
        } catch {
          console.warn('[N8N Outbound Warning] Resposta HTTP 200 recebida, mas falhou ao executar .json(). Rastreabilidade degradada.')
        }
      }

      if (parsedJson && typeof parsedJson === 'object') {
        // Suporta tanto objeto direto { provider_message_id } quanto array n8n [{ provider_message_id }]
        const item = Array.isArray(parsedJson) ? parsedJson[0] : parsedJson
        const candidateId = item?.provider_message_id ?? item?.providerMessageId ?? item?.message_id
        if (typeof candidateId === 'string' && candidateId.trim().length > 0) {
          providerMessageId = candidateId.trim()
        } else {
          console.warn('[N8N Outbound Warning] Resposta HTTP 200 recebida com JSON válido, mas sem provider_message_id.')
        }
      }
    } catch (parseEx: any) {
      // Prioridade máxima: se response.ok === true, a mensagem FOI enviada.
      // Erro de parse NUNCA pode cancelar ou invalidar o sucesso do envio.
      console.warn(`[N8N Outbound Warning] Exceção ignorada no parse do retorno do gateway: ${parseEx?.message || parseEx}`)
    }

    // Sucesso - Conclui o lock de gateway como completed
    if (claimToken && typeof (supabase as any)?.rpc === 'function' && eventId) {
      try {
        await (supabase as any).rpc('complete_gateway_outbound_lock', {
          p_company_id: companyId,
          p_event_id: eventId,
          p_claim_token: claimToken,
          p_status: 'completed',
          p_provider_message_id: providerMessageId || null,
          p_last_error: null
        })
      } catch (lockErr: any) {
        console.warn(`[N8N Outbound Lock Warning] Falha ao marcar lock como completed: ${lockErr?.message}`)
      }
    }

    // Registra auditoria e heartbeats
    await logIntegrationEvent(supabase, companyId, integration.id, 'outbound', 'message.send', eventId, 'success')
    
    await supabase.from('integrations').update({
      last_connected_at: new Date().toISOString(),
      last_event_at: new Date().toISOString()
    }).eq('id', integration.id)

    return {
      success: true,
      provider_message_id: providerMessageId
    }

  } catch (error: any) {
    console.error(`[N8N Outbound Error] ${error.message}`)
    await logIntegrationEvent(supabase, companyId, integration.id, 'outbound', 'message.send', eventId, 'failed', error.message)

    const isAmbiguous = isAmbiguousNetworkError(error)

    if (!isAmbiguous && claimToken && typeof (supabase as any)?.rpc === 'function' && eventId) {
      // Falha determinística que gerou exceção
      try {
        await (supabase as any).rpc('complete_gateway_outbound_lock', {
          p_company_id: companyId,
          p_event_id: eventId,
          p_claim_token: claimToken,
          p_status: 'failed',
          p_provider_message_id: null,
          p_last_error: error.message
        })
      } catch (lockErr: any) {
        console.warn(`[N8N Outbound Lock Warning] Falha ao marcar lock como failed no catch: ${lockErr?.message}`)
      }
    } else if (isAmbiguous) {
      console.warn(`[N8N Outbound Ambiguous Network Failure] Lock mantido como in_flight com lease ativo para event_id ${eventId}: ${error.message}`)
      // ABANDONA O LOCK: NÃO chama complete_gateway_outbound_lock!
    }

    return { success: false, reason: 'fetch_error', error: error.message }
  }
}

async function logIntegrationEvent(supabase: any, companyId: string, integrationId: string, direction: string, eventType: string, eventId: string, status: string, errorMessage?: string) {
  await supabase.from('integration_events').insert({
    company_id: companyId,
    integration_id: integrationId,
    direction,
    event_type: eventType,
    event_id: eventId,
    status,
    error_message: errorMessage || null
  })
}

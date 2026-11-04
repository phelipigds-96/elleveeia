import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  createAuthenticatedClient,
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

// Importações dos módulos sob teste
import * as n8nServicePublic from '@/lib/services/n8n-service'
import * as integrationsPublic from '@/lib/services/integrations'
import {
  isPrivateIp,
  isSafeUrl,
  safeLookup,
  safeHttpRequest,
  testN8nConnectionInternal,
  testN8nConnectionActionInternal,
  sendOutboundMessage,
  setMockHttpHandler
} from '@/lib/services/n8n-internal'
import {
  getInboundWebhookInfoInternal,
  rotateInboundWebhookTokenInternal,
  getN8nIntegrationInternal,
  saveN8nIntegrationInternal,
  disconnectN8nInternal
} from '@/lib/services/integrations-internal'

test.describe('ETAPA 8.4.3N.2 — Correções Cirúrgicas de Segurança: Server Actions, Rotação Atômica e SSRF', () => {
  const TENANT_ACTIVE_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_SUSPENDED_ID = '22222222-2222-2222-2222-222222222222'
  const USER_ADMIN_ID = 'user-admin-surgical'
  const USER_ATTENDANT_ID = 'user-attendant-surgical'

  test.beforeEach(() => {
    resetInMemoryDb()

    inMemoryDb.companies.set(TENANT_ACTIVE_ID, {
      id: TENANT_ACTIVE_ID,
      name: 'Empresa Alpha Ativa',
      slug: 'empresa-alpha',
      status: 'active',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_SUSPENDED_ID, {
      id: TENANT_SUSPENDED_ID,
      name: 'Empresa Beta Suspensa',
      slug: 'empresa-beta',
      status: 'suspended',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    inMemoryDb.profiles.set(USER_ADMIN_ID, {
      id: USER_ADMIN_ID,
      company_id: TENANT_ACTIVE_ID,
      role: 'admin',
      full_name: 'Admin Cirúrgico'
    })

    inMemoryDb.profiles.set(USER_ATTENDANT_ID, {
      id: USER_ATTENDANT_ID,
      company_id: TENANT_ACTIVE_ID,
      role: 'attendant',
      full_name: 'Atendente Cirúrgico'
    })
  })

  // =========================================================================
  // PARTE 1: SERVER ACTIONS E SEPARAÇÃO INTERNA
  // =========================================================================
  test.describe('1. Server Actions e Separação de Módulos Internos', () => {
    test('1.1. sendOutboundMessage NÃO está exportada no módulo público n8n-service', () => {
      assert.equal(
        (n8nServicePublic as any).sendOutboundMessage,
        undefined,
        'sendOutboundMessage não pode ser exportada em módulo com use server'
      )
    })

    test('1.2. sendOutboundMessage reside exclusivamente no módulo n8n-internal (server-only)', () => {
      assert.equal(
        typeof sendOutboundMessage,
        'function',
        'sendOutboundMessage deve estar disponível internamente no backend'
      )
    })

    test('1.3. Assinaturas das Server Actions públicas não aceitam parâmetros de options/clientes', () => {
      // testN8nConnection: aceita estritamente (url, secret)
      assert.equal(n8nServicePublic.testN8nConnection.length, 2)

      // saveN8nIntegration: aceita estritamente (url, secret)
      assert.equal(integrationsPublic.saveN8nIntegration.length, 2)

      // disconnectN8n: sem parâmetros
      assert.equal(integrationsPublic.disconnectN8n.length, 0)

      // rotateInboundWebhookToken: sem parâmetros
      assert.equal(integrationsPublic.rotateInboundWebhookToken.length, 0)

      // getInboundWebhookInfo: sem parâmetros
      assert.equal(integrationsPublic.getInboundWebhookInfo.length, 0)

      // getN8nIntegration: sem parâmetros
      assert.equal(integrationsPublic.getN8nIntegration.length, 0)
    })

    test('1.4. Identidade real prevalece mesmo se cliente tentar passar argumentos extras', async () => {
      setMockHttpHandler(async () => {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true, message: 'ok' })
        }
      })
      try {
        // Injeta chamada na implementação interna com parâmetros forjados
        const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ID })
        const maliciousPayload: any = {
          supabaseClient: adminClient,
          companyId: '99999999-9999-9999-9999-999999999999',
          userId: 'spoofed-user-id',
          role: 'superadmin'
        }

        const res = await saveN8nIntegrationInternal('https://webhook.site/abc', 'sec', maliciousPayload)
        // A gravação ocorre estritamente para TENANT_ACTIVE_ID da sessão
        assert.equal(res.success, true)
        assert.equal(inMemoryDb.integrations.has('integ-spoofed'), false)
        const saved = Array.from(inMemoryDb.integrations.values()).find(i => i.company_id === TENANT_ACTIVE_ID)
        assert.ok(saved)
        assert.equal(saved.company_id, TENANT_ACTIVE_ID)
      } finally {
        setMockHttpHandler(null)
      }
    })
  })

  // =========================================================================
  // PARTE 2: ROTAÇÃO ATÔMICA DO TOKEN
  // =========================================================================
  test.describe('2. Rotação Atômica do Token de Webhook', () => {
    test('2.1. Rotação bem-sucedida atualiza in-place o registro existente', async () => {
      const initialKey = 'ell_original11111111111111111'
      inMemoryDb.api_keys.set('key-auto-1', {
        id: 'key-auto-1',
        company_id: TENANT_ACTIVE_ID,
        key: initialKey,
        description: 'Chave Automatica Webhook',
        created_at: new Date(Date.now() - 50000).toISOString()
      })

      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ID })
      const res = await rotateInboundWebhookTokenInternal({ supabaseClient: adminClient })

      assert.equal(res.success, true)
      assert.ok(res.token)
      assert.notEqual(res.token, initialKey)

      // Verifica que o ID original foi preservado com novo token atualizado in-place
      const updated = inMemoryDb.api_keys.get('key-auto-1')
      assert.ok(updated)
      assert.equal(updated.key, res.token)
      assert.equal(updated.description, 'Chave Automatica Webhook')
    })

    test('2.2. Falha na atualização PRESERVA o token anterior intacto (Sem perda)', async () => {
      const initialKey = 'ell_original11111111111111111'
      inMemoryDb.api_keys.set('key-auto-1', {
        id: 'key-auto-1',
        company_id: TENANT_ACTIVE_ID,
        key: initialKey,
        description: 'Chave Automatica Webhook'
      })

      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ID })
      const realAdmin = createAdminClient()

      // Simula falha de escrita no UPDATE
      const failingUpdateClient = {
        ...realAdmin,
        from: (table: string) => {
          if (table === 'api_keys') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      order: async () => ({
                        data: [{ id: 'key-auto-1', key: initialKey }],
                        error: null
                      }),
                      then: (resolve: any) => resolve({
                        data: [{ id: 'key-auto-1', key: initialKey }],
                        error: null
                      })
                    })
                  })
                })
              }),
              update: () => ({
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      single: async () => ({
                        data: null,
                        error: { message: 'DB Connection Timeout on UPDATE' }
                      })
                    })
                  })
                })
              })
            }
          }
          return realAdmin.from(table)
        }
      }

      const res = await rotateInboundWebhookTokenInternal({
        supabaseClient: adminClient,
        adminClient: failingUpdateClient
      })

      assert.equal(res.success, false)
      assert.match(res.error || '', /Falha ao atualizar token de webhook/i)

      // O token original continua rigorosamente salvo no banco!
      const preserved = inMemoryDb.api_keys.get('key-auto-1')
      assert.ok(preserved)
      assert.equal(preserved.key, initialKey, 'O token antigo JAMAIS deve ser deletado se o update falhar')
    })

    test('2.3. Rotação cria chave com segurança caso não exista chave prévia', async () => {
      assert.equal(inMemoryDb.api_keys.size, 0)
      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ID })
      const res = await rotateInboundWebhookTokenInternal({ supabaseClient: adminClient })

      assert.equal(res.success, true)
      assert.ok(res.token)
      assert.equal(inMemoryDb.api_keys.size, 1)
      const created = Array.from(inMemoryDb.api_keys.values())[0]
      assert.equal(created.key, res.token)
    })

    test('2.4. Rotações simultâneas não corrompem o estado nem geram chaves órfãs', async () => {
      inMemoryDb.api_keys.set('key-auto-1', {
        id: 'key-auto-1',
        company_id: TENANT_ACTIVE_ID,
        key: 'ell_initialtoken1111111111111',
        description: 'Chave Automatica Webhook'
      })

      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ID })

      // Executa duas rotações paralelas
      const [res1, res2] = await Promise.all([
        rotateInboundWebhookTokenInternal({ supabaseClient: adminClient }),
        rotateInboundWebhookTokenInternal({ supabaseClient: adminClient })
      ])

      assert.equal(res1.success, true)
      assert.equal(res2.success, true)

      // Apenas 1 chave automática ativa permanece
      const autoKeys = Array.from(inMemoryDb.api_keys.values()).filter(k => k.company_id === TENANT_ACTIVE_ID && k.description === 'Chave Automatica Webhook')
      assert.equal(autoKeys.length, 1)
    })

    test('2.5. Chaves externas de outras integrações são estritamente preservadas', async () => {
      inMemoryDb.api_keys.set('key-crm-manual', {
        id: 'key-crm-manual',
        company_id: TENANT_ACTIVE_ID,
        key: 'ell_crmmanualtoken9999999999',
        description: 'Chave CRM Externa'
      })

      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ID })
      await rotateInboundWebhookTokenInternal({ supabaseClient: adminClient })

      // Chave externa permanece intacta
      const crmKey = inMemoryDb.api_keys.get('key-crm-manual')
      assert.ok(crmKey)
      assert.equal(crmKey.key, 'ell_crmmanualtoken9999999999')
    })

    test('2.6. Ordenação determinística: created_at idêntico seleciona consistentemente via desempate por id', async () => {
      const fixedTimestamp = '2026-11-03T12:00:00.000Z'
      // Duas chaves com o mesmo timestamp exato
      inMemoryDb.api_keys.set('key-auto-aaa', {
        id: 'key-auto-aaa',
        company_id: TENANT_ACTIVE_ID,
        key: 'ell_token_aaa_1111111111111111',
        description: 'Chave Automatica Webhook',
        created_at: fixedTimestamp
      })
      inMemoryDb.api_keys.set('key-auto-zzz', {
        id: 'key-auto-zzz',
        company_id: TENANT_ACTIVE_ID,
        key: 'ell_token_zzz_2222222222222222',
        description: 'Chave Automatica Webhook',
        created_at: fixedTimestamp
      })

      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ID })
      // Ambas as consultas devem selecionar deterministicamente a chave com maior id ('key-auto-zzz')
      const info = await getInboundWebhookInfoInternal({ supabaseClient: adminClient })
      assert.ok(info)
      assert.equal(info.token, 'ell_token_zzz_2222222222222222')
    })

    test('2.7. Conflito de concorrência em inicialização (23505) recupera a chave vencedora com sucesso', async () => {
      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ID })
      const realAdmin = createAdminClient()

      // Simula colisão de índice único parcial (outra requisição inseriu primeiro a chave automática)
      const winningToken = 'ell_winner_concurrency_123456'
      let insertAttempted = false

      const collisionClient = {
        ...realAdmin,
        from: (table: string) => {
          if (table === 'api_keys') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      order: () => ({
                        limit: () => ({
                          maybeSingle: async () => {
                            if (insertAttempted) {
                              return { data: { key: winningToken }, error: null }
                            }
                            return { data: null, error: null }
                          }
                        }),
                        then: (resolve: any) => {
                          if (insertAttempted) {
                            resolve({ data: [{ id: 'key-auto-winner', key: winningToken }], error: null })
                          } else {
                            resolve({ data: [], error: null })
                          }
                        }
                      })
                    })
                  })
                })
              }),
              insert: () => ({
                select: () => ({
                  single: async () => {
                    insertAttempted = true
                    return {
                      data: null,
                      error: {
                        code: '23505',
                        message: 'duplicate key value violates unique constraint "idx_api_keys_company_auto_webhook"'
                      }
                    }
                  }
                })
              })
            }
          }
          return realAdmin.from(table)
        }
      }

      const res = await rotateInboundWebhookTokenInternal({
        supabaseClient: adminClient,
        adminClient: collisionClient
      })

      assert.equal(res.success, true)
      assert.equal(res.token, winningToken)
    })
  })

  // =========================================================================
  // PARTE 3: PROTEÇÃO SSRF COMPLETA DO TESTE N8N
  // =========================================================================
  test.describe('3. Proteção SSRF e DNS Rebinding', () => {
    test('3.1. isPrivateIp rejeita todas as faixas IPv4 privadas e reservadas', () => {
      // Loopback
      assert.equal(isPrivateIp('127.0.0.1'), true)
      assert.equal(isPrivateIp('127.255.255.255'), true)

      // Rede 10.0.0.0/8
      assert.equal(isPrivateIp('10.0.0.1'), true)
      assert.equal(isPrivateIp('10.255.255.255'), true)

      // Rede 172.16.0.0/12
      assert.equal(isPrivateIp('172.16.0.1'), true)
      assert.equal(isPrivateIp('172.31.255.255'), true)

      // Rede 192.168.0.0/16
      assert.equal(isPrivateIp('192.168.0.1'), true)
      assert.equal(isPrivateIp('192.168.1.254'), true)

      // CGNAT 100.64.0.0/10
      assert.equal(isPrivateIp('100.64.0.1'), true)
      assert.equal(isPrivateIp('100.127.255.255'), true)

      // Cloud Metadata / Link-local 169.254.0.0/16
      assert.equal(isPrivateIp('169.254.169.254'), true)
      assert.equal(isPrivateIp('169.254.1.1'), true)

      // Unspecified 0.0.0.0/8
      assert.equal(isPrivateIp('0.0.0.0'), true)

      // Multicast e Reservado 224.0.0.0/4
      assert.equal(isPrivateIp('224.0.0.1'), true)
      assert.equal(isPrivateIp('240.0.0.1'), true)
      assert.equal(isPrivateIp('255.255.255.255'), true)

      // IPs Públicos NÃO devem ser bloqueados
      assert.equal(isPrivateIp('8.8.8.8'), false)
      assert.equal(isPrivateIp('1.1.1.1'), false)
      assert.equal(isPrivateIp('104.26.10.1'), false)
    })

    test('3.2. isPrivateIp rejeita todas as faixas IPv6, IPv4-mapped (decimal e hex) e prefixos de transição', () => {
      // Loopback nativo
      assert.equal(isPrivateIp('::1'), true)
      assert.equal(isPrivateIp('[::1]'), true)
      assert.equal(isPrivateIp('0:0:0:0:0:0:0:1'), true)

      // Unspecified
      assert.equal(isPrivateIp('::'), true)

      // Link-local fe80::/10
      assert.equal(isPrivateIp('fe80::1'), true)

      // Unique Local fc00::/7
      assert.equal(isPrivateIp('fc00::1'), true)
      assert.equal(isPrivateIp('fd12:3456:789a::1'), true)

      // Site-local depreciado (fec0::/10, RFC 3879)
      assert.equal(isPrivateIp('fec0::1'), true)

      // Multicast ff00::/8
      assert.equal(isPrivateIp('ff02::1'), true)

      // Discard prefix (100::/64, RFC 6666)
      assert.equal(isPrivateIp('100::1'), true)

      // Documentação e Benchmarking
      assert.equal(isPrivateIp('2001:db8::1'), true)
      assert.equal(isPrivateIp('2001:2::1'), true)

      // Prefixos de transição depreciados (RFC 7526)
      assert.equal(isPrivateIp('2002:7f00:1::'), true) // 6to4 com 127.0.0.1
      assert.equal(isPrivateIp('2002:a00:1::'), true) // 6to4 com 10.0.0.1
      assert.equal(isPrivateIp('2001:0000:1234::'), true) // Teredo

      // IPv4-mapped IPv6 em formato decimal com pontos
      assert.equal(isPrivateIp('::ffff:127.0.0.1'), true)
      assert.equal(isPrivateIp('::ffff:10.0.0.1'), true)
      assert.equal(isPrivateIp('::ffff:169.254.169.254'), true)
      assert.equal(isPrivateIp('::ffff:192.168.1.1'), true)
      assert.equal(isPrivateIp('::ffff:8.8.8.8'), false) // Público permitido

      // IPv4-mapped IPv6 em formato hexadecimal puro (RFC 4291)
      assert.equal(isPrivateIp('::ffff:7f00:1'), true) // 127.0.0.1 em hex
      assert.equal(isPrivateIp('::ffff:7f00:0001'), true)
      assert.equal(isPrivateIp('::ffff:a00:1'), true) // 10.0.0.1 em hex
      assert.equal(isPrivateIp('::ffff:0a00:0001'), true)
      assert.equal(isPrivateIp('::ffff:c0a8:0101'), true) // 192.168.1.1 em hex
      assert.equal(isPrivateIp('::ffff:808:808'), false) // 8.8.8.8 em hex público permitido

      // NAT64 Well-Known Prefix (64:ff9b::/96)
      assert.equal(isPrivateIp('64:ff9b::127.0.0.1'), true)
      assert.equal(isPrivateIp('64:ff9b::7f00:1'), true)
      assert.equal(isPrivateIp('64:ff9b::10.0.0.1'), true)
      assert.equal(isPrivateIp('64:ff9b::a00:1'), true)

      // IPv6 Públicos Globais continuam permitidos
      assert.equal(isPrivateIp('2606:4700:4700::1111'), false) // Cloudflare DNS
      assert.equal(isPrivateIp('2001:4860:4860::8888'), false) // Google DNS
    })

    test('3.3. isSafeUrl rejeita esquemas inválidos e notações alternativas de IP', () => {
      // Protocolos proibidos
      assert.equal(isSafeUrl('ftp://example.com'), false)
      assert.equal(isSafeUrl('file:///etc/passwd'), false)
      assert.equal(isSafeUrl('javascript:alert(1)'), false)
      assert.equal(isSafeUrl('gopher://example.com'), false)

      // Nomes locais
      assert.equal(isSafeUrl('http://localhost:5678'), false)
      assert.equal(isSafeUrl('http://meu-host.local'), false)
      assert.equal(isSafeUrl('http://servico.internal'), false)
      assert.equal(isSafeUrl('http://localtest.me'), false)

      // Notações numéricas alternativas
      assert.equal(isSafeUrl('http://2130706433/'), false) // Decimal puro de 127.0.0.1
      assert.equal(isSafeUrl('http://0x7f000001/'), false) // Hex puro
      assert.equal(isSafeUrl('http://0177.0.0.1/'), false) // Octal

      // URLs públicas legítimas
      assert.equal(isSafeUrl('https://n8n.minhaempresa.com.br/webhook/abc'), true)
      assert.equal(isSafeUrl('https://api.ellevee.ai/webhook'), true)
    })

    test('3.4. safeLookup bloqueia domínios cujo DNS resolve para IP privado', async () => {
      await new Promise<void>((resolve, reject) => {
        // safeLookup com localhost deve ser rejeitado com erro SSRF_BLOCKED
        safeLookup('localhost', {}, (err, address) => {
          if (err && err.message.includes('SSRF_BLOCKED')) {
            resolve()
          } else {
            reject(new Error('safeLookup deveria ter bloqueado a resolução de localhost'))
          }
        })
      })
    })

    test('3.5. safeHttpRequest bloqueia redirecionamentos HTTP físicos (301, 302, 303, 307, 308) com interrupção do socket', async () => {
      const redirectStatusCodes = [301, 302, 303, 307, 308]

      for (const status of redirectStatusCodes) {
        let requestCount = 0

        const redirectServer = http.createServer((req, res) => {
          requestCount++
          res.writeHead(status, {
            'Location': 'http://169.254.169.254/latest/meta-data'
          })
          res.end('Redirecting...')
        })

        await new Promise<void>((resolveServer) => {
          redirectServer.listen(0, '127.0.0.1', () => {
            resolveServer()
          })
        })

        const port = (redirectServer.address() as any).port

        // Injeção de resolver controlado para testes locais:
        // O hostname aponta sintaticamente para um domínio público válido (passa em isSafeUrl),
        // enquanto o lookup direciona o socket TCP físico para o servidor local na porta atribuída.
        const testLookup = (_hostname: string, opts: any, cb: any) => {
          if (opts && opts.all) {
            cb(null, [{ address: '127.0.0.1', family: 4 }])
          } else {
            cb(null, '127.0.0.1', 4)
          }
        }

        try {
          await assert.rejects(
            async () => {
              await safeHttpRequest(`http://webhook-redirect.example.com:${port}/endpoint`, {
                lookup: testLookup
              })
            },
            (err: any) => {
              // 1. O erro gerado deve ser estritamente o de bloqueio de redirecionamento 3xx
              assert.match(err.message, /Redirecionamentos HTTP são bloqueados por políticas de segurança \(SSRF\)/i)
              return true
            }
          )

          // 2. Comprova que a requisição física ALCANÇOU o servidor de teste
          assert.equal(requestCount, 1, `A requisição HTTP com status ${status} deveria ter alcançado o servidor exatamente uma vez`)
        } finally {
          redirectServer.close()
        }
      }
    })

    test('3.6. testN8nConnectionInternal bloqueia URLs SSRF sem realizar requisição externa', async () => {
      const maliciousUrls = [
        'http://127.0.0.1:5678/webhook',
        'http://169.254.169.254/latest/meta-data',
        'http://localhost:8080',
        'http://[::1]:3000',
        'http://0177.0.0.1/',
        'http://2130706433/'
      ]

      for (const url of maliciousUrls) {
        const res = await testN8nConnectionInternal(url, 'secret')
        assert.equal(res.success, false)
        assert.match(res.message, /SSRF/i, `Deveria bloquear por SSRF: ${url}`)
      }
    })
  })
})

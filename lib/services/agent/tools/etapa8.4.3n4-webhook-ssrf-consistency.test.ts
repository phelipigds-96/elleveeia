import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  createAuthenticatedClient,
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

import {
  isPrivateIp,
  isSafeUrl,
  unpackIpv4FromIpv6,
  isPrivateIpv4,
  safeLookup,
  safeHttpRequest
} from '@/lib/services/n8n-internal'

import {
  getInboundWebhookInfoInternal,
  rotateInboundWebhookTokenInternal
} from '@/lib/services/integrations-internal'

test.describe('ETAPA 8.4.3N.4 — Correções Finais de Consistência do Webhook e Cobertura SSRF', () => {
  const TENANT_ACTIVE_ID = '11111111-1111-1111-1111-111111111111'
  const USER_ADMIN_ID = 'user-admin-surgical-n4'

  test.beforeEach(() => {
    resetInMemoryDb()

    inMemoryDb.companies.set(TENANT_ACTIVE_ID, {
      id: TENANT_ACTIVE_ID,
      name: 'Empresa Ativa Alpha N4',
      slug: 'empresa-alpha-n4',
      status: 'active',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    inMemoryDb.profiles.set(USER_ADMIN_ID, {
      id: USER_ADMIN_ID,
      company_id: TENANT_ACTIVE_ID,
      role: 'admin',
      full_name: 'Admin Cirúrgico N4'
    })
  })

  // =========================================================================
  // PARTE 1: UNICIDADE E MIGRATION DO TOKEN DE WEBHOOK
  // =========================================================================
  test.describe('1. Unicidade Estrutural e Mecânica de Rotação', () => {
    test('1.1. Arquivo de migration local existe com DDL de deduplicação, índice parcial e RPC', () => {
      const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/2026110301_api_keys_webhook_uniqueness.sql')
      assert.ok(fs.existsSync(migrationPath), 'Migration 2026110301_api_keys_webhook_uniqueness.sql deve existir')

      const sqlContent = fs.readFileSync(migrationPath, 'utf8')

      // 1. Deve conter a estratégia de expurgo seguro de duplicatas preservando a mais recente
      assert.match(sqlContent, /ROW_NUMBER\(\)\s+OVER/i, 'Deve conter window function para identificar duplicatas')
      assert.match(sqlContent, /ORDER BY created_at DESC,\s*id DESC/i, 'Deve usar ordenação determinística para desempate')
      assert.match(sqlContent, /WHERE description = 'Chave Automatica Webhook'/i, 'Deve filtrar estritamente chaves automáticas')

      // 2. Deve conter a criação do índice único parcial
      assert.match(sqlContent, /CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_company_auto_webhook/i)
      assert.match(sqlContent, /ON public\.api_keys\s*\(company_id\)/i)
      assert.match(sqlContent, /WHERE description = 'Chave Automatica Webhook'/i)

      // 3. Deve conter a RPC transacional com FOR UPDATE e ON CONFLICT
      assert.match(sqlContent, /CREATE OR REPLACE FUNCTION public\.rotate_company_webhook_key/i)
      assert.match(sqlContent, /FOR UPDATE/i)
      assert.match(sqlContent, /ON CONFLICT\s*\(company_id\)\s*WHERE description = 'Chave Automatica Webhook'/i)
    })

    test('1.2. Chaves externas permanecem estritamente preservadas durante rotação', async () => {
      inMemoryDb.api_keys.set('ext-key-1', {
        id: 'ext-key-1',
        company_id: TENANT_ACTIVE_ID,
        key: 'ell_external_crm_token_999999',
        description: 'Chave Externa CRM Salesforce'
      })

      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ID })
      const res = await rotateInboundWebhookTokenInternal({ supabaseClient: adminClient })

      assert.equal(res.success, true)
      const extKey = inMemoryDb.api_keys.get('ext-key-1')
      assert.ok(extKey)
      assert.equal(extKey.key, 'ell_external_crm_token_999999')
    })

    test('1.3. Conflito de concorrência em inicialização (código 23505) não corrompe e retorna chave vencedora', async () => {
      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ID })
      const realAdmin = createAdminClient()
      const winningToken = 'ell_winning_concurrency_key_999'
      let insertAttempted = false

      const collidingAdmin = {
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
                            if (insertAttempted) return { data: { key: winningToken }, error: null }
                            return { data: null, error: null }
                          }
                        }),
                        then: (resolve: any) => {
                          if (insertAttempted) {
                            resolve({ data: [{ id: 'winner-id', key: winningToken }], error: null })
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
        adminClient: collidingAdmin
      })

      assert.equal(res.success, true)
      assert.equal(res.token, winningToken)
    })
  })

  // =========================================================================
  // PARTE 2: CLASSIFICAÇÃO COMPLETA DE ENDEREÇOS IPv6
  // =========================================================================
  test.describe('2. Classificação de IPv6, IPv4-Mapped e Prefixos de Transição', () => {
    test('2.1. Desempacotamento de IPv4-mapped em notação decimal e hexadecimal', () => {
      // Decimal
      assert.equal(unpackIpv4FromIpv6('::ffff:127.0.0.1'), '127.0.0.1')
      assert.equal(unpackIpv4FromIpv6('::ffff:10.0.0.1'), '10.0.0.1')
      assert.equal(unpackIpv4FromIpv6('::ffff:8.8.8.8'), '8.8.8.8')

      // Hexadecimal (RFC 4291)
      assert.equal(unpackIpv4FromIpv6('::ffff:7f00:1'), '127.0.0.1')
      assert.equal(unpackIpv4FromIpv6('::ffff:7f00:0001'), '127.0.0.1')
      assert.equal(unpackIpv4FromIpv6('::ffff:a00:1'), '10.0.0.1')
      assert.equal(unpackIpv4FromIpv6('::ffff:0a00:0001'), '10.0.0.1')
      assert.equal(unpackIpv4FromIpv6('::ffff:c0a8:0101'), '192.168.1.1')
      assert.equal(unpackIpv4FromIpv6('::ffff:808:808'), '8.8.8.8')

      // NAT64
      assert.equal(unpackIpv4FromIpv6('64:ff9b::127.0.0.1'), '127.0.0.1')
      assert.equal(unpackIpv4FromIpv6('64:ff9b::7f00:1'), '127.0.0.1')
    })

    test('2.2. isPrivateIp rejeita adequadamente endereços IPv4-mapped privados (decimal e hex)', () => {
      // Loopback
      assert.equal(isPrivateIp('::ffff:127.0.0.1'), true)
      assert.equal(isPrivateIp('::ffff:7f00:1'), true)
      assert.equal(isPrivateIp('::ffff:7f00:0001'), true)

      // Rede 10.0.0.0/8
      assert.equal(isPrivateIp('::ffff:10.0.0.1'), true)
      assert.equal(isPrivateIp('::ffff:a00:1'), true)

      // Rede 192.168.0.0/16
      assert.equal(isPrivateIp('::ffff:192.168.1.1'), true)
      assert.equal(isPrivateIp('::ffff:c0a8:0101'), true)

      // Link-local / Cloud Metadata 169.254.169.254
      assert.equal(isPrivateIp('::ffff:169.254.169.254'), true)
      assert.equal(isPrivateIp('::ffff:a9fe:a9fe'), true)

      // IPv4-mapped público NÃO deve ser bloqueado
      assert.equal(isPrivateIp('::ffff:8.8.8.8'), false)
      assert.equal(isPrivateIp('::ffff:808:808'), false)
    })

    test('2.3. isPrivateIp rejeita NAT64, 6to4, Teredo e prefixos não-roteáveis', () => {
      // NAT64 com IP privado
      assert.equal(isPrivateIp('64:ff9b::127.0.0.1'), true)
      assert.equal(isPrivateIp('64:ff9b::7f00:1'), true)
      assert.equal(isPrivateIp('64:ff9b::10.0.0.1'), true)
      assert.equal(isPrivateIp('64:ff9b::a00:1'), true)

      // 6to4 (2002::/16)
      assert.equal(isPrivateIp('2002:7f00:1::'), true)
      assert.equal(isPrivateIp('2002:a00:1::'), true)

      // Teredo (2001:0::/32)
      assert.equal(isPrivateIp('2001:0000:1234::'), true)
      assert.equal(isPrivateIp('2001:0:1234::'), true)

      // Site-local depreciado (fec0::/10)
      assert.equal(isPrivateIp('fec0::1'), true)

      // Discard (100::/64)
      assert.equal(isPrivateIp('100::1'), true)

      // Documentação e Benchmarking
      assert.equal(isPrivateIp('2001:db8::1'), true)
      assert.equal(isPrivateIp('2001:2::1'), true)

      // IPv6 públicos legítimos continuam rigorosamente permitidos
      assert.equal(isPrivateIp('2606:4700:4700::1111'), false)
      assert.equal(isPrivateIp('2001:4860:4860::8888'), false)
    })
  })

  // =========================================================================
  // PARTE 3: REDIRECIONAMENTOS HTTP FÍSICOS (301, 302, 303, 307, 308)
  // =========================================================================
  test.describe('3. Bloqueio Físico de Redirecionamentos HTTP', () => {
    const redirectCodes = [301, 302, 303, 307, 308]

    for (const code of redirectCodes) {
      test(`3.${redirectCodes.indexOf(code) + 1}. HTTP ${code} é interceptado, socket é destruído e não há 2ª requisição`, async () => {
        let requestCount = 0

        const redirectServer = http.createServer((req, res) => {
          requestCount++
          res.writeHead(code, {
            'Location': 'http://169.254.169.254/latest/meta-data'
          })
          res.end(`Redirecting status ${code}`)
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
              assert.match(err.message, /Redirecionamentos HTTP são bloqueados por políticas de segurança \(SSRF\)/i)
              return true
            }
          )

          // Comprova que o servidor físico recebeu a requisição exatamente uma vez e não houve segundo request
          assert.equal(requestCount, 1, `Status ${code} deveria ter recebido exatamente 1 requisição física`)
        } finally {
          redirectServer.close()
        }
      })
    }
  })

  // =========================================================================
  // PARTE 4: ORDENAÇÃO DETERMINÍSTICA
  // =========================================================================
  test.describe('4. Ordenação Determinística com Empate de Timestamps', () => {
    test('4.1. getInboundWebhookInfoInternal seleciona consistentemente por id em caso de created_at idêntico', async () => {
      const fixedDate = '2026-11-03T15:00:00.000Z'
      inMemoryDb.api_keys.set('key-aaa', {
        id: 'key-aaa',
        company_id: TENANT_ACTIVE_ID,
        key: 'ell_token_aaa_111111111111',
        description: 'Chave Automatica Webhook',
        created_at: fixedDate
      })
      inMemoryDb.api_keys.set('key-zzz', {
        id: 'key-zzz',
        company_id: TENANT_ACTIVE_ID,
        key: 'ell_token_zzz_222222222222',
        description: 'Chave Automatica Webhook',
        created_at: fixedDate
      })

      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ID })
      const info = await getInboundWebhookInfoInternal({ supabaseClient: adminClient })
      assert.ok(info)
      // O critério secundário de ordenação (.order('id', { ascending: false })) garante a chave 'key-zzz'
      assert.equal(info.token, 'ell_token_zzz_222222222222')
    })

    test('4.2. rotateInboundWebhookTokenInternal utiliza o mesmo critério determinístico', async () => {
      const fixedDate = '2026-11-03T15:00:00.000Z'
      inMemoryDb.api_keys.set('key-aaa', {
        id: 'key-aaa',
        company_id: TENANT_ACTIVE_ID,
        key: 'ell_token_aaa_111111111111',
        description: 'Chave Automatica Webhook',
        created_at: fixedDate
      })
      inMemoryDb.api_keys.set('key-zzz', {
        id: 'key-zzz',
        company_id: TENANT_ACTIVE_ID,
        key: 'ell_token_zzz_222222222222',
        description: 'Chave Automatica Webhook',
        created_at: fixedDate
      })

      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ID })
      const res = await rotateInboundWebhookTokenInternal({ supabaseClient: adminClient })
      assert.equal(res.success, true)

      // Atualizou in-place a chave 'key-zzz' (que era a maior na ordenação determinística)
      const updatedZzz = inMemoryDb.api_keys.get('key-zzz')
      assert.ok(updatedZzz)
      assert.equal(updatedZzz.key, res.token)

      // A chave 'key-aaa' foi expurgada no prune de duplicatas
      assert.equal(inMemoryDb.api_keys.has('key-aaa'), false)
    })
  })
})

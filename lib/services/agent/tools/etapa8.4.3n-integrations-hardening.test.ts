import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  createAuthenticatedClient,
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

import { testN8nConnection } from '@/lib/services/n8n-service'
import {
  testN8nConnectionInternal,
  testN8nConnectionActionInternal,
  isSafeUrl,
  setMockHttpHandler
} from '@/lib/services/n8n-internal'
import {
  saveN8nIntegration,
  disconnectN8n,
  rotateInboundWebhookToken,
  getInboundWebhookInfo,
  getN8nIntegration
} from '@/lib/services/integrations'
import {
  saveN8nIntegrationInternal,
  disconnectN8nInternal,
  rotateInboundWebhookTokenInternal,
  getInboundWebhookInfoInternal,
  getN8nIntegrationInternal
} from '@/lib/services/integrations-internal'

test.describe('ETAPA 8.4.3N — Blindagem de Segurança das Ações de Integrações e n8n', () => {
  // IDs de tenants (empresas)
  const TENANT_ACTIVE_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_SUSPENDED_ID = '22222222-2222-2222-2222-222222222222'
  const TENANT_CANCELLED_ID = '33333333-3333-3333-3333-333333333333'
  const TENANT_PROVISIONING_ID = '44444444-4444-4444-4444-444444444444'
  const TENANT_OTHER_ACTIVE_ID = '55555555-5555-5555-5555-555555555555'

  // IDs de usuários
  const USER_ADMIN_ACTIVE_ID = 'user-admin-active'
  const USER_ATTENDANT_ACTIVE_ID = 'user-attendant-active'
  const USER_ADMIN_SUSPENDED_ID = 'user-admin-suspended'
  const USER_ADMIN_CANCELLED_ID = 'user-admin-cancelled'
  const USER_ADMIN_PROVISIONING_ID = 'user-admin-provisioning'
  const USER_ADMIN_OTHER_ID = 'user-admin-other'

  let fetchCalls: Array<{ url: string; options: any }> = []

  test.beforeEach(() => {
    resetInMemoryDb()
    fetchCalls = []

    setMockHttpHandler(async (url: string, options: any) => {
      fetchCalls.push({ url, options })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, message: 'ok' })
      }
    })

    // 1. Cadastrar Empresas no banco em memória
    inMemoryDb.companies.set(TENANT_ACTIVE_ID, {
      id: TENANT_ACTIVE_ID,
      name: 'Empresa Ativa Alpha',
      slug: 'empresa-ativa-alpha',
      status: 'active',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_SUSPENDED_ID, {
      id: TENANT_SUSPENDED_ID,
      name: 'Empresa Suspensa Beta',
      slug: 'empresa-suspensa-beta',
      status: 'suspended',
      suspension_reason: 'Inadimplência financeira',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_CANCELLED_ID, {
      id: TENANT_CANCELLED_ID,
      name: 'Empresa Cancelada Gamma',
      slug: 'empresa-cancelada-gamma',
      status: 'cancelled',
      plan_tier: 'free',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_PROVISIONING_ID, {
      id: TENANT_PROVISIONING_ID,
      name: 'Empresa Provisioning Delta',
      slug: 'empresa-provisioning-delta',
      status: 'provisioning',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_OTHER_ACTIVE_ID, {
      id: TENANT_OTHER_ACTIVE_ID,
      name: 'Empresa Ativa Epsilon',
      slug: 'empresa-ativa-epsilon',
      status: 'active',
      plan_tier: 'enterprise',
      created_at: new Date().toISOString()
    })

    // 2. Cadastrar Perfis de Usuários
    inMemoryDb.profiles.set(USER_ADMIN_ACTIVE_ID, {
      id: USER_ADMIN_ACTIVE_ID,
      company_id: TENANT_ACTIVE_ID,
      role: 'admin',
      full_name: 'Admin Alpha'
    })

    inMemoryDb.profiles.set(USER_ATTENDANT_ACTIVE_ID, {
      id: USER_ATTENDANT_ACTIVE_ID,
      company_id: TENANT_ACTIVE_ID,
      role: 'attendant',
      full_name: 'Atendente Alpha'
    })

    inMemoryDb.profiles.set(USER_ADMIN_SUSPENDED_ID, {
      id: USER_ADMIN_SUSPENDED_ID,
      company_id: TENANT_SUSPENDED_ID,
      role: 'admin',
      full_name: 'Admin Beta (Suspensa)'
    })

    inMemoryDb.profiles.set(USER_ADMIN_CANCELLED_ID, {
      id: USER_ADMIN_CANCELLED_ID,
      company_id: TENANT_CANCELLED_ID,
      role: 'admin',
      full_name: 'Admin Gamma (Cancelada)'
    })

    inMemoryDb.profiles.set(USER_ADMIN_PROVISIONING_ID, {
      id: USER_ADMIN_PROVISIONING_ID,
      company_id: TENANT_PROVISIONING_ID,
      role: 'admin',
      full_name: 'Admin Delta (Provisioning)'
    })

    inMemoryDb.profiles.set(USER_ADMIN_OTHER_ID, {
      id: USER_ADMIN_OTHER_ID,
      company_id: TENANT_OTHER_ACTIVE_ID,
      role: 'admin',
      full_name: 'Admin Epsilon'
    })
  })

  test.afterEach(() => {
    setMockHttpHandler(null)
  })

  // =========================================================================
  // 1. Usuário não autenticado não consegue testar conexão n8n
  // =========================================================================
  test('1. Usuário não autenticado não consegue testar conexão n8n', async () => {
    const unauthClient = createAuthenticatedClient(null)
    const result = await testN8nConnectionActionInternal(
      'https://n8n.workflow-externo.com/webhook/test',
      'secret-test-123',
      { supabaseClient: unauthClient }
    )

    assert.equal(result.success, false)
    assert.match(result.message, /Usuário não autenticado/i)
    assert.equal(fetchCalls.length, 0, 'Nenhuma requisição externa deve ocorrer para usuário não autenticado')
  })

  // =========================================================================
  // 2. Atendente não consegue testar conexão
  // =========================================================================
  test('2. Atendente não consegue testar conexão', async () => {
    const attendantClient = createAuthenticatedClient({ userId: USER_ATTENDANT_ACTIVE_ID })
    const result = await testN8nConnectionActionInternal(
      'https://n8n.workflow-externo.com/webhook/test',
      'secret-test-123',
      { supabaseClient: attendantClient }
    )

    assert.equal(result.success, false)
    assert.match(result.message, /apenas administradores/i)
    assert.equal(fetchCalls.length, 0, 'Nenhuma requisição externa deve ocorrer para perfil atendente')
  })

  // =========================================================================
  // 3. Administrador de empresa ativa consegue testar conexão segura
  // =========================================================================
  test('3. Administrador de empresa ativa consegue testar conexão segura', async () => {
    const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ACTIVE_ID })
    const result = await testN8nConnectionActionInternal(
      'https://n8n.workflow-externo.com/webhook/test',
      'secret-test-123',
      { supabaseClient: adminClient }
    )

    assert.equal(result.success, true)
    assert.match(result.message, /estabelecida com sucesso/i)
    assert.equal(fetchCalls.length, 1, 'Requisição HTTP deve ser executada após todas as validações')
    assert.equal(fetchCalls[0].url, 'https://n8n.workflow-externo.com/webhook/test')
  })

  // =========================================================================
  // 4. Empresa suspensa não consegue testar conexão
  // =========================================================================
  test('4. Empresa suspensa não consegue testar conexão', async () => {
    const suspendedClient = createAuthenticatedClient({ userId: USER_ADMIN_SUSPENDED_ID })
    const result = await testN8nConnectionActionInternal(
      'https://n8n.workflow-externo.com/webhook/test',
      'secret-test-123',
      { supabaseClient: suspendedClient }
    )

    assert.equal(result.success, false)
    assert.equal(result.code, 'TENANT_SUSPENDED')
    assert.match(result.message, /suspenso/i)
    assert.equal(fetchCalls.length, 0, 'Nenhuma requisição externa deve ocorrer para empresa suspensa')
  })

  // =========================================================================
  // 5. Empresa cancelada não consegue testar conexão
  // =========================================================================
  test('5. Empresa cancelada não consegue testar conexão', async () => {
    const cancelledClient = createAuthenticatedClient({ userId: USER_ADMIN_CANCELLED_ID })
    const result = await testN8nConnectionActionInternal(
      'https://n8n.workflow-externo.com/webhook/test',
      'secret-test-123',
      { supabaseClient: cancelledClient }
    )

    assert.equal(result.success, false)
    assert.equal(result.code, 'TENANT_CANCELLED')
    assert.match(result.message, /cancelad/i)
    assert.equal(fetchCalls.length, 0, 'Nenhuma requisição externa deve ocorrer para empresa cancelada')
  })

  // =========================================================================
  // 6. Falha na consulta de tenant impede a chamada HTTP (Fail-closed)
  // =========================================================================
  test('6. Falha na consulta de tenant impede a chamada HTTP', async () => {
    const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ACTIVE_ID })
    
    // Simula cliente com falha fatal de banco na consulta de empresas
    const failingAdminClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: 'Supabase connection timeout / DB Unavailable' }
            })
          })
        })
      })
    }

    const result = await testN8nConnectionActionInternal(
      'https://n8n.workflow-externo.com/webhook/test',
      'secret-test-123',
      { supabaseClient: adminClient, adminClient: failingAdminClient }
    )

    assert.equal(result.success, false)
    assert.equal(result.code, 'TENANT_STATUS_UNAVAILABLE')
    assert.equal(fetchCalls.length, 0, 'Falha de consulta de tenant deve operar em fail-closed sem disparar HTTP')
  })

  // =========================================================================
  // 7. Atendente não consegue salvar integração
  // =========================================================================
  test('7. Atendente não consegue salvar integração', async () => {
    const attendantClient = createAuthenticatedClient({ userId: USER_ATTENDANT_ACTIVE_ID })
    const result = await saveN8nIntegrationInternal(
      'https://n8n.workflow-externo.com/webhook/test',
      'secret-test-123',
      { supabaseClient: attendantClient }
    )

    assert.equal(result.success, false)
    assert.match(result.error || '', /apenas administradores/i)
    assert.equal(fetchCalls.length, 0, 'Não deve testar HTTP para atendente')
    assert.equal(inMemoryDb.integrations.size, 0, 'Nenhuma integração deve ser persistida')
  })

  // =========================================================================
  // 8. Empresa suspensa não consegue salvar integração
  // =========================================================================
  test('8. Empresa suspensa não consegue salvar integração', async () => {
    const suspendedClient = createAuthenticatedClient({ userId: USER_ADMIN_SUSPENDED_ID })
    const result = await saveN8nIntegrationInternal(
      'https://n8n.workflow-externo.com/webhook/test',
      'secret-test-123',
      { supabaseClient: suspendedClient }
    )

    assert.equal(result.success, false)
    assert.equal(result.code, 'TENANT_SUSPENDED')
    assert.match(result.error || '', /suspenso/i)
    assert.equal(fetchCalls.length, 0, 'Não deve disparar HTTP para tenant suspenso')
    assert.equal(inMemoryDb.integrations.size, 0, 'Nenhuma integração deve ser gravada')
  })

  // =========================================================================
  // 9. Administrador ativo consegue salvar integração
  // =========================================================================
  test('9. Administrador ativo consegue salvar integração', async () => {
    const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ACTIVE_ID })
    const result = await saveN8nIntegrationInternal(
      'https://n8n.workflow-externo.com/webhook/test',
      'secret-test-123',
      { supabaseClient: adminClient }
    )

    assert.equal(result.success, true)
    assert.equal(fetchCalls.length, 1, 'Teste HTTP deve ser executado antes de salvar')

    // Verifica persistência na tabela integrations
    const saved = Array.from(inMemoryDb.integrations.values()).find(i => i.company_id === TENANT_ACTIVE_ID)
    assert.ok(saved, 'Integração deve estar salva no banco')
    assert.equal(saved.type, 'n8n')
    assert.equal(saved.status, 'active')
    assert.equal(saved.config?.webhook_url, 'https://n8n.workflow-externo.com/webhook/test')
    assert.equal(saved.credentials?.webhook_secret, 'secret-test-123')
  })

  // =========================================================================
  // 10. Atendente não consegue desconectar integração
  // =========================================================================
  test('10. Atendente não consegue desconectar integração', async () => {
    // Cadastra integração pré-existente
    inMemoryDb.integrations.set('integ-alpha-1', {
      id: 'integ-alpha-1',
      company_id: TENANT_ACTIVE_ID,
      type: 'n8n',
      status: 'active',
      name: 'n8n Workflow',
      config: { webhook_url: 'https://n8n.workflow-externo.com/webhook/test' }
    })

    const attendantClient = createAuthenticatedClient({ userId: USER_ATTENDANT_ACTIVE_ID })
    const result = await disconnectN8nInternal({ supabaseClient: attendantClient })

    assert.equal(result.success, false)
    assert.match(result.error || '', /apenas administradores/i)
    assert.ok(inMemoryDb.integrations.has('integ-alpha-1'), 'Integração ativa deve permanecer intacta')
  })

  // =========================================================================
  // 11. Usuário de outra empresa não consegue alterar integração
  // =========================================================================
  test('11. Usuário de outra empresa não consegue alterar integração', async () => {
    // Cadastra integração para a Empresa Alpha
    inMemoryDb.integrations.set('integ-alpha-1', {
      id: 'integ-alpha-1',
      company_id: TENANT_ACTIVE_ID,
      type: 'n8n',
      status: 'active',
      name: 'n8n Alpha',
      config: { webhook_url: 'https://alpha.com/webhook' },
      credentials: { webhook_secret: 'alpha-secret' }
    })

    // Usuário admin da Empresa Epsilon tenta desconectar
    const otherAdminClient = createAuthenticatedClient({ userId: USER_ADMIN_OTHER_ID })
    const result = await disconnectN8nInternal({ supabaseClient: otherAdminClient })

    // Operação não apaga integração da Empresa Alpha
    assert.equal(result.success, true)
    const alphaIntegration = inMemoryDb.integrations.get('integ-alpha-1')
    assert.ok(alphaIntegration, 'Integração da Empresa Alpha não deve ser alterada ou excluída')
    assert.equal(alphaIntegration.company_id, TENANT_ACTIVE_ID)
  })

  // =========================================================================
  // 12. Atendente não consegue rotacionar token
  // =========================================================================
  test('12. Atendente não consegue rotacionar token', async () => {
    const attendantClient = createAuthenticatedClient({ userId: USER_ATTENDANT_ACTIVE_ID })
    const result = await rotateInboundWebhookTokenInternal({ supabaseClient: attendantClient })

    assert.equal(result.success, false)
    assert.match(result.error || '', /apenas administradores/i)
    assert.equal(inMemoryDb.api_keys.size, 0, 'Nenhuma chave deve ser criada ou alterada')
  })

  // =========================================================================
  // 13. Empresa suspensa não consegue rotacionar token
  // =========================================================================
  test('13. Empresa suspensa não consegue rotacionar token', async () => {
    const suspendedClient = createAuthenticatedClient({ userId: USER_ADMIN_SUSPENDED_ID })
    const result = await rotateInboundWebhookTokenInternal({ supabaseClient: suspendedClient })

    assert.equal(result.success, false)
    assert.equal(result.code, 'TENANT_SUSPENDED')
    assert.match(result.error || '', /suspenso/i)
    assert.equal(inMemoryDb.api_keys.size, 0, 'Nenhum token deve ser alterado para empresa suspensa')
  })

  // =========================================================================
  // 14. Administrador ativo consegue rotacionar token (Atomicamente in-place)
  // =========================================================================
  test('14. Administrador ativo consegue rotacionar token', async () => {
    // Cadastra token automático antigo
    inMemoryDb.api_keys.set('key-old-alpha', {
      id: 'key-old-alpha',
      company_id: TENANT_ACTIVE_ID,
      key: 'ell_oldtoken111111111111111111111',
      description: 'Chave Automatica Webhook',
      created_at: new Date(Date.now() - 100000).toISOString()
    })

    // Cadastra também uma chave manual que NÃO deve ser excluída
    inMemoryDb.api_keys.set('key-manual-crm', {
      id: 'key-manual-crm',
      company_id: TENANT_ACTIVE_ID,
      key: 'ell_manualcrmkey99999999999999',
      description: 'Chave CRM Externa',
      created_at: new Date().toISOString()
    })

    const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ACTIVE_ID })
    const result = await rotateInboundWebhookTokenInternal({ supabaseClient: adminClient })

    assert.equal(result.success, true)
    assert.ok(result.token)
    assert.match(result.token, /^ell_[a-f0-9]{24}$/, 'Novo token deve seguir formato ell_ + 24 hex')

    // A chave manual foi preservada
    assert.equal(inMemoryDb.api_keys.has('key-manual-crm'), true, 'Chave manual externa deve ser preservada')

    // O registro foi atualizado in-place com o novo token
    const currentKeys = Array.from(inMemoryDb.api_keys.values()).filter(k => k.company_id === TENANT_ACTIVE_ID && k.description === 'Chave Automatica Webhook')
    assert.equal(currentKeys.length, 1)
    assert.equal(currentKeys[0].key, result.token)
  })

  // =========================================================================
  // 15. Atendente não consegue obter informações protegidas do webhook
  // =========================================================================
  test('15. Atendente não consegue obter informações protegidas do webhook', async () => {
    // Cadastra token automático para a empresa ativa
    inMemoryDb.api_keys.set('key-alpha-1', {
      id: 'key-alpha-1',
      company_id: TENANT_ACTIVE_ID,
      key: 'ell_secrettoken111111111111111',
      description: 'Chave Automatica Webhook'
    })

    const attendantClient = createAuthenticatedClient({ userId: USER_ATTENDANT_ACTIVE_ID })
    const result = await getInboundWebhookInfoInternal({ supabaseClient: attendantClient })

    assert.equal(result, null, 'Atendente não deve receber informações de webhook')
  })

  // =========================================================================
  // 16. Empresa suspensa não consegue gerar token automaticamente
  // =========================================================================
  test('16. Empresa suspensa não consegue gerar token automaticamente', async () => {
    // Banco sem chaves para a empresa suspensa
    const suspendedClient = createAuthenticatedClient({ userId: USER_ADMIN_SUSPENDED_ID })
    const result = await getInboundWebhookInfoInternal({ supabaseClient: suspendedClient })

    assert.equal(result, null, 'Empresa suspensa deve receber null')
    
    // Garante que nenhuma chave foi auto-gerada
    const keysForSuspended = Array.from(inMemoryDb.api_keys.values()).filter(k => k.company_id === TENANT_SUSPENDED_ID)
    assert.equal(keysForSuspended.length, 0, 'Nenhum token deve ser auto-gerado para empresa suspensa')
  })

  // =========================================================================
  // 17. Falha de banco durante rotação não retorna falso sucesso
  // =========================================================================
  test('17. Falha de banco durante rotação não retorna falso sucesso', async () => {
    const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ACTIVE_ID })
    const realAdmin = createAdminClient()

    // Simula cliente administrativo onde o insert de chave em api_keys falha
    const failingInsertAdminClient = {
      ...realAdmin,
      from: (table: string) => {
        if (table === 'api_keys') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => {
                  const orderChain = {
                    order: () => orderChain,
                    then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
                    catch: (reject: any) => Promise.resolve({ data: [], error: null }).catch(reject)
                  }
                  return orderChain
                }
              })
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { message: 'Database write error (disk full / constraint)' }
                })
              })
            })
          }
        }
        return realAdmin.from(table)
      }
    }

    const result = await rotateInboundWebhookTokenInternal({
      supabaseClient: adminClient,
      adminClient: failingInsertAdminClient
    })

    assert.equal(result.success, false)
    assert.match(result.error || '', /Falha ao registrar novo token/i)
  })

  // =========================================================================
  // 18. Tentativas de manipulação de identidade e company_id são ignoradas
  // =========================================================================
  test('18. Tentativas de manipulação de identidade e company_id enviados pelo cliente são ignoradas ou rejeitadas', async () => {
    const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ACTIVE_ID })

    // Tentativa de spoofing passando payload com company_id da Empresa Epsilon
    const maliciousOptions: any = {
      supabaseClient: adminClient,
      companyId: TENANT_OTHER_ACTIVE_ID,
      company_id: TENANT_OTHER_ACTIVE_ID,
      userId: 'spoofed-user'
    }

    // Salva integração: deve salvar estritamente para TENANT_ACTIVE_ID (resolvido na sessão)
    const saveResult = await saveN8nIntegrationInternal(
      'https://n8n.workflow-externo.com/webhook/test',
      'secret-test-123',
      maliciousOptions
    )
    assert.equal(saveResult.success, true)

    // A Empresa Epsilon NÃO deve ter sido modificada
    const epsilonIntegration = Array.from(inMemoryDb.integrations.values()).find(i => i.company_id === TENANT_OTHER_ACTIVE_ID)
    assert.equal(epsilonIntegration, undefined, 'Empresa de terceiro não pode receber dados forjados pelo cliente')

    // A integração foi salva estritamente para a empresa autenticada
    const alphaIntegration = Array.from(inMemoryDb.integrations.values()).find(i => i.company_id === TENANT_ACTIVE_ID)
    assert.ok(alphaIntegration, 'Integração deve pertencer estritamente à empresa da sessão')
    assert.equal(alphaIntegration.company_id, TENANT_ACTIVE_ID)

    // Verifica que a Server Action pública não aceita options
    assert.equal(saveN8nIntegration.length, 2, 'saveN8nIntegration deve aceitar estritamente (url, secret)')
    assert.equal(disconnectN8n.length, 0, 'disconnectN8n não deve aceitar argumentos')
    assert.equal(rotateInboundWebhookToken.length, 0, 'rotateInboundWebhookToken não deve aceitar argumentos')
    assert.equal(getInboundWebhookInfo.length, 0, 'getInboundWebhookInfo não deve aceitar argumentos')
    assert.equal(getN8nIntegration.length, 0, 'getN8nIntegration não deve aceitar argumentos')
    assert.equal(testN8nConnection.length, 2, 'testN8nConnection deve aceitar estritamente (url, secret)')
  })

  // =========================================================================
  // 19. Regressão das proteções SSRF de testN8nConnection
  // =========================================================================
  test('19. Regressão das proteções SSRF de testN8nConnection', async () => {
    // Desabilita mock handler para testar a validação real de SSRF
    setMockHttpHandler(null)
    const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ACTIVE_ID })

    const forbiddenUrls = [
      'http://localhost:5678/webhook',
      'http://127.0.0.1:8080/test',
      'http://10.0.0.1/admin',
      'http://192.168.1.1/secret',
      'http://172.16.0.1/internal',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/status',
      'http://2130706433/test', // Decimal puro
      'http://0x7f000001/test', // Hexadecimal puro
      'http://0177.0.0.1/test', // Notação octal
      'ftp://evil.com/payload',
      'file:///etc/passwd',
      'javascript:alert(1)'
    ]

    for (const badUrl of forbiddenUrls) {
      const result = await testN8nConnectionActionInternal(badUrl, 'secret', { supabaseClient: adminClient })
      assert.equal(result.success, false, `URL proibida deve ser bloqueada: ${badUrl}`)
      assert.match(result.message, /SSRF/i, `Mensagem deve indicar bloqueio SSRF para: ${badUrl}`)
    }

    assert.equal(fetchCalls.length, 0, 'Nenhuma requisição externa deve ser disparada para URLs bloqueadas por SSRF')
  })

  // =========================================================================
  // 20. Nenhum segredo aparece em logs, mensagens de erro ou auditoria
  // =========================================================================
  test('20. Nenhum segredo aparece em logs, mensagens de erro ou auditoria', async () => {
    const rawSecret = 'ell_supersecret1234567890'
    const consoleLogs: string[] = []

    const originalLog = console.log
    const originalError = console.error
    const originalWarn = console.warn

    console.log = (...args: any[]) => consoleLogs.push(args.join(' '))
    console.error = (...args: any[]) => consoleLogs.push(args.join(' '))
    console.warn = (...args: any[]) => consoleLogs.push(args.join(' '))

    try {
      // 1. Cadastra integração com segredo
      inMemoryDb.integrations.set('integ-secret-1', {
        id: 'integ-secret-1',
        company_id: TENANT_ACTIVE_ID,
        type: 'n8n',
        status: 'active',
        config: { webhook_url: 'https://n8n.workflow-externo.com/webhook/test' },
        credentials: { webhook_secret: rawSecret }
      })

      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_ACTIVE_ID })

      // 2. Chama getN8nIntegration e verifica mascaramento
      const integrationData = await getN8nIntegrationInternal({ supabaseClient: adminClient })
      assert.ok(integrationData)
      assert.equal(
        integrationData.credentials?.webhook_secret,
        '••••••••••••••••',
        'Segredo deve ser estritamente mascarado ao retornar para o cliente'
      )

      // 3. Executa rotação de token e verifica se o token gerado aparece nos logs
      const rotateResult = await rotateInboundWebhookTokenInternal({ supabaseClient: adminClient })
      assert.ok(rotateResult.token)

      for (const logLine of consoleLogs) {
        assert.equal(
          logLine.includes(rotateResult.token),
          false,
          `O token rotacionado '${rotateResult.token}' não deve aparecer nos logs do console`
        )
        assert.equal(
          logLine.includes(rawSecret),
          false,
          `O segredo '${rawSecret}' não deve aparecer nos logs do console`
        )
      }
    } finally {
      console.log = originalLog
      console.error = originalError
      console.warn = originalWarn
    }
  })
})

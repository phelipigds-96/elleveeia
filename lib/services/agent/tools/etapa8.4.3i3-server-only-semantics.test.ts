// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import * as convModule from '@/lib/services/conversations'
import { sendMessage } from '@/lib/services/conversations'
import { sendManualMessageInternal } from '@/lib/services/conversations-internal'
import { inMemoryDb, resetInMemoryDb, createAdminClient, createAuthenticatedClient, createClient } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

describe('ETAPA 8.4.3I.3 — Blindagem Final do Módulo Interno e Precisão Semântica do Envio', () => {
  const ACTIVE_COMPANY_ID = '11111111-1111-1111-1111-111111111111'
  const OTHER_COMPANY_ID = '22222222-2222-2222-2222-222222222222'

  const CONV_ACTIVE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CONV_OTHER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

  const USER_ACTIVE_ID = 'user-act-1111'
  const USER_OTHER_ID = 'user-oth-2222'

  let fetchCallCount = 0
  let fetchHistory: any[] = []
  let originalFetch: any

  beforeEach(() => {
    resetInMemoryDb()
    fetchCallCount = 0
    fetchHistory = []
    originalFetch = globalThis.fetch

    globalThis.fetch = async (url: any, options: any) => {
      fetchCallCount++
      fetchHistory.push({ url, options })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Dispatched successfully', id: 'gw-msg-456' })
      } as any
    }

    // 1. Cadastrar Empresas
    inMemoryDb.companies.set(ACTIVE_COMPANY_ID, {
      id: ACTIVE_COMPANY_ID,
      name: 'Empresa Alpha Ativa',
      slug: 'empresa-alpha-ativa',
      status: 'active',
      plan_tier: 'pro',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(OTHER_COMPANY_ID, {
      id: OTHER_COMPANY_ID,
      name: 'Empresa Beta Ativa',
      slug: 'empresa-beta-ativa',
      status: 'active',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    // 2. Perfis de Atendentes
    inMemoryDb.profiles.set(USER_ACTIVE_ID, {
      id: USER_ACTIVE_ID,
      company_id: ACTIVE_COMPANY_ID,
      role: 'agent',
      email: 'operador@alpha.com'
    })

    inMemoryDb.profiles.set(USER_OTHER_ID, {
      id: USER_OTHER_ID,
      company_id: OTHER_COMPANY_ID,
      role: 'agent',
      email: 'operador@beta.com'
    })

    // 3. Integração n8n
    inMemoryDb.integrations.set('int-active-1', {
      id: 'int-active-1',
      company_id: ACTIVE_COMPANY_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.ellevee.ai/outbound' },
      credentials: { webhook_secret: 'sec-outbound-alpha' }
    })

    // 4. Clientes e Conversas
    inMemoryDb.customers.set('cust-act-1', {
      id: 'cust-act-1',
      company_id: ACTIVE_COMPANY_ID,
      name: 'Cliente Alpha 1',
      phone: '5511999990001'
    })

    inMemoryDb.conversations.set(CONV_ACTIVE_ID, {
      id: CONV_ACTIVE_ID,
      company_id: ACTIVE_COMPANY_ID,
      customer_id: 'cust-act-1',
      channel: 'whatsapp',
      status: 'human',
      last_message_at: '2026-10-01T10:00:00Z',
      customers: { phone: '5511999990001', name: 'Cliente Alpha 1' }
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ============================================================================
  // TESTE 1: PROTEÇÃO EXPLÍCITA server-only NO MÓDULO INTERNO
  // ============================================================================
  test('1. O módulo interno contém a proteção server-only no topo', () => {
    const filePath = path.join('C:/Users/Phelipi/Projects/elleveeia/lib/services/conversations-internal.ts')
    const content = fs.readFileSync(filePath, 'utf-8')

    // Confirma que 'server-only' é importado logo no início
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
    assert.equal(
      lines[0],
      "import 'server-only'",
      "A primeira linha executável de lib/services/conversations-internal.ts DEVE ser import 'server-only'"
    )

    // Confirma que NÃO possui a diretiva 'use server'
    assert.equal(
      /^\s*['"]use server['"]/m.test(content),
      false,
      "lib/services/conversations-internal.ts JAMAIS deve conter a diretiva 'use server'"
    )
    assert.equal(
      content.includes("'use server'"),
      false,
      "lib/services/conversations-internal.ts não deve conter a string 'use server'"
    )
  })

  // ============================================================================
  // TESTE 2: ISOLAMENTO TOTAL DOS EXPORTS DO ARQUIVO DE SERVER ACTIONS
  // ============================================================================
  test('2. O módulo interno não é exportado pelo arquivo de Server Actions', () => {
    // lib/services/conversations.ts é o módulo com 'use server'
    assert.equal(
      (convModule as any).sendManualMessageInternal,
      undefined,
      'sendManualMessageInternal NÃO pode ser exportada por conversations.ts'
    )
    assert.equal(
      (convModule as any).SendMessageInternalContext,
      undefined,
      'SendMessageInternalContext NÃO pode ser exportado como valor por conversations.ts'
    )

    // Garante que conversations-internal não é importado por nenhum componente client
    const appDir = 'C:/Users/Phelipi/Projects/elleveeia/app'
    const files = fs.readdirSync(appDir, { recursive: true }) as string[]
    for (const relFile of files) {
      if (typeof relFile === 'string' && (relFile.endsWith('.tsx') || relFile.endsWith('.ts'))) {
        const fullPath = path.join(appDir, relFile)
        const fileContent = fs.readFileSync(fullPath, 'utf-8')
        assert.equal(
          fileContent.includes('conversations-internal'),
          false,
          `Violação de camada: componente em app/ (${relFile}) não pode importar conversartions-internal!`
        )
      }
    }
  })

  // ============================================================================
  // TESTE 3: EXECUÇÃO CORRETA PELO BACKEND
  // ============================================================================
  test('3. A função interna continua sendo chamada corretamente pelo backend', async () => {
    const userClient = createAuthenticatedClient({ id: USER_ACTIVE_ID })

    const result = await sendMessage(
      CONV_ACTIVE_ID,
      'Mensagem legítima despachada pelo backend',
      { supabaseClient: userClient }
    )

    assert.equal(result.success, true)
    assert.equal(result.gatewayDispatched, true)
    assert.equal(result.persistedStatus, 'sent')
    assert.equal(result.message.content, 'Mensagem legítima despachada pelo backend')
    assert.equal(result.message.company_id, ACTIVE_COMPANY_ID)
    assert.equal(result.message.sender_id, USER_ACTIVE_ID)
    assert.equal(fetchCallCount, 1)
  })

  // ============================================================================
  // TESTE 4: CONSUMIDORES MIGRADOS PARA gatewayDispatched (COM externalDeliveryConfirmed DEPRECATED)
  // ============================================================================
  test('4. Consumidores utilizam gatewayDispatched e externalDeliveryConfirmed está documentado como deprecated', async () => {
    const userClient = createAuthenticatedClient({ id: USER_ACTIVE_ID })

    // Validação em caso de sucesso
    const successResult = await sendMessage(
      CONV_ACTIVE_ID,
      'Mensagem para auditoria de contrato',
      { supabaseClient: userClient }
    )
    assert.equal(successResult.gatewayDispatched, true)
    // externalDeliveryConfirmed existe apenas como fallback/alias retrocompatível
    assert.equal(successResult.externalDeliveryConfirmed, true)

    // Validação em caso de falha (conteúdo vazio)
    const failResult = await sendMessage(
      CONV_ACTIVE_ID,
      '   ',
      { supabaseClient: userClient }
    )
    assert.equal(failResult.success, false)
    assert.equal(failResult.gatewayDispatched, false)
    assert.equal(failResult.externalDeliveryConfirmed, false)

    // Verifica que nenhum arquivo em app/ depende de externalDeliveryConfirmed
    const appDir = 'C:/Users/Phelipi/Projects/elleveeia/app'
    const files = fs.readdirSync(appDir, { recursive: true }) as string[]
    for (const relFile of files) {
      if (typeof relFile === 'string' && (relFile.endsWith('.tsx') || relFile.endsWith('.ts'))) {
        const fullPath = path.join(appDir, relFile)
        const fileContent = fs.readFileSync(fullPath, 'utf-8')
        assert.equal(
          fileContent.includes('externalDeliveryConfirmed'),
          false,
          `Dependência obsoleta: componente em app/ (${relFile}) não deve referenciar externalDeliveryConfirmed!`
        )
      }
    }
  })

  // ============================================================================
  // TESTE 5: PRECISÃO DO STATUS NA INTERFACE (DESPACHO ACEITO vs ENTREGA FÍSICA)
  // ============================================================================
  test('5. A interface não apresenta aceite do gateway como entrega no aparelho', () => {
    const clientComponentPath = path.join('C:/Users/Phelipi/Projects/elleveeia/app/(dashboard)/conversations/components/painel-client.tsx')
    const content = fs.readFileSync(clientComponentPath, 'utf-8')

    // Verifica que o status 'sent' é renderizado como "Despacho aceito"
    assert.ok(
      content.includes('Despacho aceito'),
      "A interface deve rotular mensagens 'sent' como 'Despacho aceito' ou equivalente, indicando aceite pelo gateway."
    )

    // Garante que o status 'sent' NÃO é rotulado falsamente como 'Entregue no aparelho' ou 'Lido'
    assert.equal(
      content.includes('Entregue no aparelho'),
      false,
      "A interface JAMAIS deve sugerir entrega física no aparelho sem confirmação DLR assíncrona."
    )
    assert.equal(
      content.includes('Entregue ao cliente'),
      false,
      "A interface não pode alegar entrega ao cliente apenas com o aceite do gateway."
    )
  })

  // ============================================================================
  // TESTE 6: PRESERVAÇÃO DO STATUS PENDING EM CASO DE INCONSISTÊNCIA LOCAL
  // ============================================================================
  test('6. Inconsistência entre aceite externo e persistência local continua preservando pending', async () => {
    const adminClient = createAdminClient()

    const originalMessagesMap = inMemoryDb.messages
    const messagesProxy = new Proxy(originalMessagesMap, {
      get(target, prop, receiver) {
        if (prop === 'set') {
          return function(key: any, value: any) {
            if (value?.metadata?.delivery_status === 'sent') {
              throw new Error('Falha simulada ao persistir delivery_status: sent no banco')
            }
            return target.set(key, value)
          }
        }
        const val = Reflect.get(target, prop, target)
        return typeof val === 'function' ? val.bind(target) : val
      }
    })

    inMemoryDb.messages = messagesProxy

    try {
      const result = await sendManualMessageInternal(
        CONV_ACTIVE_ID,
        'Mensagem com falha de confirmação local',
        {
          userId: USER_ACTIVE_ID,
          companyId: ACTIVE_COMPANY_ID,
          supabaseClient: adminClient,
          adminClient: adminClient
        }
      )

      assert.equal(result.success, true)
      assert.equal(result.gatewayDispatched, true)
      assert.equal(result.persistedStatus, 'pending')
      assert.equal(result.inconsistency, true)
      assert.equal(result.message.metadata.delivery_status, 'pending')
      assert.ok(result.warning)
    } finally {
      inMemoryDb.messages = originalMessagesMap
    }
  })

  // ============================================================================
  // TESTE 7: DERIVAÇÃO EXCLUSIVA DE IDENTIDADE NO SERVIDOR E NO BANCO
  // ============================================================================
  test('7. Server Action pública continua derivando usuário e empresa exclusivamente da sessão e do banco', async () => {
    const userClient = createAuthenticatedClient({ id: USER_ACTIVE_ID })

    const result = await sendMessage(
      CONV_ACTIVE_ID,
      'Tentativa de spoofing',
      {
        companyId: OTHER_COMPANY_ID,
        userId: 'spoofed-hacker-id',
        adminClient: { malicious: true },
        supabaseClient: userClient
      }
    )

    assert.equal(result.success, true)
    // O remetente e a empresa foram estritamente validados no servidor
    assert.equal(result.message.company_id, ACTIVE_COMPANY_ID)
    assert.notEqual(result.message.company_id, OTHER_COMPANY_ID)
    assert.equal(result.message.sender_id, USER_ACTIVE_ID)
    assert.notEqual(result.message.sender_id, 'spoofed-hacker-id')
  })
})

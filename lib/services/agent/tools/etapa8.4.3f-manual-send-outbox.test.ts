// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  sendManualMessageInternal
} from '@/lib/services/conversations-internal'
import {
  sendMessage
} from '@/lib/services/conversations'
import {
  setMockHttpHandler
} from '@/lib/services/n8n-internal'
import {
  inMemoryDb,
  resetInMemoryDb
} from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'
import { createAdminClient } from '@/lib/supabase/service'

describe('ETAPA Q.2.8F — Integração do Envio Manual de Mensagens à Outbox Transacional', () => {
  const COMPANY_ID = '11111111-1111-1111-1111-111111111111'
  const OTHER_COMPANY_ID = '22222222-2222-2222-2222-222222222222'
  const CONVERSATION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const USER_ID = '99999999-9999-9999-9999-999999999999'
  const OTHER_USER_ID = '88888888-9999-9999-9999-999999999999'
  const CUSTOMER_ID = '77777777-7777-7777-7777-777777777777'

  beforeEach(() => {
    resetInMemoryDb()
    setMockHttpHandler(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, provider_message_id: 'wamid.default.mock' }),
      json: async () => ({ success: true, provider_message_id: 'wamid.default.mock' })
    }))

    // 1. Configurar Empresa Ativa
    inMemoryDb.companies.set(COMPANY_ID, {
      id: COMPANY_ID,
      name: 'Empresa Manual Outbox Test',
      slug: 'empresa-manual-outbox-test',
      status: 'active',
      plan_tier: 'pro',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(OTHER_COMPANY_ID, {
      id: OTHER_COMPANY_ID,
      name: 'Outra Empresa',
      slug: 'outra-empresa',
      status: 'active',
      plan_tier: 'free',
      created_at: new Date().toISOString()
    })

    // 2. Configurar Perfil do Operador Humano
    inMemoryDb.profiles.set(USER_ID, {
      id: USER_ID,
      company_id: COMPANY_ID,
      full_name: 'Operador Humano da Silva',
      role: 'agent',
      created_at: new Date().toISOString()
    })

    inMemoryDb.profiles.set(OTHER_USER_ID, {
      id: OTHER_USER_ID,
      company_id: OTHER_COMPANY_ID, // pertence a outro tenant
      full_name: 'Operador de Outra Empresa',
      role: 'agent',
      created_at: new Date().toISOString()
    })

    // 3. Configurar Cliente
    inMemoryDb.customers.set(CUSTOMER_ID, {
      id: CUSTOMER_ID,
      company_id: COMPANY_ID,
      name: 'Cliente WhatsApp Destinatário',
      phone: '5511999991234',
      created_at: new Date().toISOString()
    })

    // 4. Configurar Conversa
    inMemoryDb.conversations.set(CONVERSATION_ID, {
      id: CONVERSATION_ID,
      company_id: COMPANY_ID,
      customer_id: CUSTOMER_ID,
      channel: 'whatsapp',
      status: 'open',
      customers: {
        phone: '5511999991234'
      },
      created_at: new Date().toISOString(),
      last_message_at: new Date().toISOString()
    })

    // 5. Configurar Integração n8n ativa
    inMemoryDb.integrations.set('int-manual-001', {
      id: 'int-manual-001',
      company_id: COMPANY_ID,
      type: 'n8n',
      status: 'active',
      config: {
        webhook_url: 'https://n8n.externo-confiavel.com/webhook/msg'
      },
      credentials: {
        webhook_secret: 'sec-manual-test-001'
      }
    })
  })

  afterEach(() => {
    setMockHttpHandler(null)
  })

  test('1. Caminho Feliz: Cria registros simultâneos em messages e message_outbox, despacha no gateway e atualiza metadados com sucesso', async () => {
    const adminClient = createAdminClient()
    const clientMessageId = 'client-msg-happy-001'
    let networkCalls = 0

    setMockHttpHandler(async (url, opts) => {
      networkCalls++
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, provider_message_id: 'wamid.manual.happy.999' }),
        json: async () => ({ success: true, provider_message_id: 'wamid.manual.happy.999' })
      }
    })

    const result = await sendManualMessageInternal(
      CONVERSATION_ID,
      'Olá cliente, sua compra foi aprovada com sucesso!',
      {
        companyId: COMPANY_ID,
        userId: USER_ID,
        clientMessageId,
        adminClient
      }
    )

    // Asserções do Retorno
    assert.equal(result.success, true)
    assert.equal(result.gatewayDispatched, true)
    assert.equal(result.persistedStatus, 'sent')
    assert.ok(result.message)
    assert.equal(networkCalls, 1)

    const messageId = result.message.id

    // 1.1 Verificação da tabela messages
    const storedMsg = inMemoryDb.messages.get(messageId)
    assert.ok(storedMsg, 'Mensagem deve existir na tabela messages')
    assert.equal(storedMsg.company_id, COMPANY_ID)
    assert.equal(storedMsg.conversation_id, CONVERSATION_ID)
    assert.equal(storedMsg.sender_type, 'human')
    assert.equal(storedMsg.sender_id, USER_ID)
    assert.equal(storedMsg.content, 'Olá cliente, sua compra foi aprovada com sucesso!')
    assert.equal(storedMsg.metadata.delivery_status, 'sent')
    assert.equal(storedMsg.metadata.provider_message_id, 'wamid.manual.happy.999')

    // 1.2 Verificação da tabela message_outbox vinculada
    const outboxEntries = Array.from(inMemoryDb.message_outbox.values()).filter(
      (o: any) => o.message_id === messageId
    )
    assert.equal(outboxEntries.length, 1, 'Deve existir exatamente 1 outbox vinculada à mensagem')
    const storedOutbox = outboxEntries[0]
    assert.equal(storedOutbox.company_id, COMPANY_ID)
    assert.equal(storedOutbox.conversation_id, CONVERSATION_ID)
    assert.equal(storedOutbox.status, 'sent')
    assert.equal(storedOutbox.idempotency_key, `manual-${CONVERSATION_ID}-${clientMessageId}`)
    assert.equal(storedOutbox.recipient, '5511999991234')
  })

  test('2. Identidade Humana: A RPC valida e persiste corretamente o sender_id e rejeita operadores de outro tenant', async () => {
    const adminClient = createAdminClient()

    // 2.1 Envio com operador válido
    const resValid = await sendManualMessageInternal(
      CONVERSATION_ID,
      'Mensagem do operador legítimo',
      {
        companyId: COMPANY_ID,
        userId: USER_ID,
        adminClient
      }
    )
    assert.equal(resValid.success, true)
    assert.equal(resValid.message.sender_type, 'human')
    assert.equal(resValid.message.sender_id, USER_ID)

    const storedMsg = inMemoryDb.messages.get(resValid.message.id)
    assert.equal(storedMsg.sender_id, USER_ID)

    // 2.2 Tentativa com operador de outro tenant (spoofing / invasão)
    const initialMsgCount = inMemoryDb.messages.size
    const resInvalid = await sendManualMessageInternal(
      CONVERSATION_ID,
      'Tentativa de operador de outro tenant',
      {
        companyId: COMPANY_ID,
        userId: OTHER_USER_ID, // Pertence a OTHER_COMPANY_ID!
        adminClient
      }
    )

    assert.equal(resInvalid.success, false)
    assert.equal(resInvalid.code, 'DB_INSERT_FAILED')
    assert.equal(inMemoryDb.messages.size, initialMsgCount, 'Nenhuma mensagem deve ser gravada para operador de outro tenant')
  })

  test('3. Defesa contra Timeout (Resiliência): AbortError no Gateway mantém mensagem na Outbox como processing para reconciliação do Worker', async () => {
    const adminClient = createAdminClient()
    const clientMessageId = 'client-msg-timeout-001'

    // Mock simulando timeout de rede (AbortError)
    setMockHttpHandler(async () => {
      const abortErr = new Error('The operation was aborted due to timeout (8000ms)')
      abortErr.name = 'AbortError'
      throw abortErr
    })

    const result = await sendManualMessageInternal(
      CONVERSATION_ID,
      'Mensagem com timeout de rede simulado',
      {
        companyId: COMPANY_ID,
        userId: USER_ID,
        clientMessageId,
        adminClient
      }
    )

    // A Server Action não deve crashar nem lançar erro não tratado
    assert.equal(result.success, false)
    assert.equal(result.gatewayDispatched, false)
    assert.equal(result.code, 'OUTBOUND_DISPATCH_FAILED')
    assert.ok(result.message)

    const messageId = result.message.id

    // 3.1 Mensagem em messages permanece em pending (não regride para failed definitiva)
    const storedMsg = inMemoryDb.messages.get(messageId)
    assert.ok(storedMsg)
    assert.equal(storedMsg.metadata.delivery_status, 'pending')

    // 3.2 Registro na message_outbox permanece em processing com lease ativo para o Worker patrulhar
    const outboxEntries = Array.from(inMemoryDb.message_outbox.values()).filter(
      (o: any) => o.message_id === messageId
    )
    assert.equal(outboxEntries.length, 1)
    const storedOutbox = outboxEntries[0]
    assert.equal(storedOutbox.status, 'processing', 'Mensagem ambígua deve ficar em processing na outbox')
    assert.ok(new Date(storedOutbox.locked_until).getTime() > Date.now(), 'Lease deve estar ativo no futuro')
  })

  test('4. Defesa de Duplo Clique: Duas chamadas simultâneas com a MESMA chave disparam apenas 1 requisição HTTP e retornam a mesma mensagem', async () => {
    const adminClient = createAdminClient()
    const duplicateKey = 'double-click-client-token-999'
    let networkCalls = 0

    setMockHttpHandler(async (url, opts) => {
      networkCalls++
      // Delay artificial para simular latência de rede durante o primeiro envio
      await new Promise(r => setTimeout(r, 20))
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, provider_message_id: 'wamid.doubleclick.123' }),
        json: async () => ({ success: true, provider_message_id: 'wamid.doubleclick.123' })
      }
    })

    // Disparar duas chamadas simultâneas com exatamente a mesma chave
    const [res1, res2] = await Promise.all([
      sendManualMessageInternal(CONVERSATION_ID, 'Mensagem com duplo clique', {
        companyId: COMPANY_ID,
        userId: USER_ID,
        clientMessageId: duplicateKey,
        adminClient
      }),
      sendManualMessageInternal(CONVERSATION_ID, 'Mensagem com duplo clique', {
        companyId: COMPANY_ID,
        userId: USER_ID,
        clientMessageId: duplicateKey,
        adminClient
      })
    ])

    // Ambas as chamadas reportam sucesso
    assert.equal(res1.success, true)
    assert.equal(res2.success, true)

    // Ambas retornam o MESMO message.id
    assert.equal(res1.message.id, res2.message.id, 'Ambos os retornos devem apontar para a mesma mensagem')

    // Apenas 1 requisição HTTP foi feita ao gateway
    assert.equal(networkCalls, 1, 'Deve realizar exatamente 1 chamada HTTP externa ao gateway')

    // Apenas 1 registro na tabela messages
    const msgsWithContent = Array.from(inMemoryDb.messages.values()).filter(
      (m: any) => m.content === 'Mensagem com duplo clique'
    )
    assert.equal(msgsWithContent.length, 1, 'Deve existir apenas 1 registro na tabela messages')

    // Apenas 1 registro na outbox
    const outboxesWithKey = Array.from(inMemoryDb.message_outbox.values()).filter(
      (o: any) => o.idempotency_key === `manual-${CONVERSATION_ID}-${duplicateKey}`
    )
    assert.equal(outboxesWithKey.length, 1, 'Deve existir apenas 1 registro na message_outbox')
  })
})

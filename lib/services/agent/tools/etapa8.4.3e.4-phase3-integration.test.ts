// @ts-nocheck
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { updateMessageMetadataSafe } from '@/lib/services/message-engine'

// Configuração do Cliente Supabase Conectado ao PostgreSQL REAL (Docker local porta 54321 / 54322)
const REAL_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const REAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const supabase = createClient(REAL_SUPABASE_URL, REAL_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
})

const shouldSkip = !process.env.USE_REAL_SUPABASE

describe('ETAPA E.4 — Fase 3: Teste de Integração Real no PostgreSQL Local', { skip: shouldSkip ? 'Ambiente sem container PostgreSQL real ativo (USE_REAL_SUPABASE desativado)' : false }, () => {
  const COMPANY_ID = crypto.randomUUID()
  const CONVERSATION_ID = crypto.randomUUID()
  const MSG_CONCURRENT_ID = crypto.randomUUID()
  const MSG_SAFE_FN_ID = crypto.randomUUID()
  const OUTBOX_TEST_ID = crypto.randomUUID()

  before(async () => {
    // 1. Cadastra Empresa Real de Teste
    const { error: compErr } = await supabase
      .from('companies')
      .insert({
        id: COMPANY_ID,
        name: 'Empresa Teste Integracao Real E.4',
        slug: `real-e4-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        status: 'active',
        plan_tier: 'pro'
      })
    if (compErr) {
      throw new Error(`Falha no setup da empresa de teste: ${compErr.message}`)
    }

    // 2. Cadastra Conversa Real de Teste
    const { error: convErr } = await supabase
      .from('conversations')
      .insert({
        id: CONVERSATION_ID,
        company_id: COMPANY_ID,
        status: 'open',
        channel: 'whatsapp'
      })
    if (convErr) {
      throw new Error(`Falha no setup da conversa de teste: ${convErr.message}`)
    }

    // 3. Cadastra Mensagem 1 para Teste Direto de Concorrência da RPC
    const { error: msgErr1 } = await supabase
      .from('messages')
      .insert({
        id: MSG_CONCURRENT_ID,
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        sender_type: 'agent',
        content: 'Mensagem real para teste concorrente de RPC',
        message_type: 'text',
        metadata: {
          agent_id: 'agent-phase3-001',
          trigger_event_id: 'evt-real-p3-001'
        }
      })
    if (msgErr1) {
      throw new Error(`Falha no setup da mensagem 1: ${msgErr1.message}`)
    }

    // 4. Cadastra Mensagem 2 para Teste via updateMessageMetadataSafe
    const { error: msgErr2 } = await supabase
      .from('messages')
      .insert({
        id: MSG_SAFE_FN_ID,
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        sender_type: 'agent',
        content: 'Mensagem real para teste via updateMessageMetadataSafe',
        message_type: 'text',
        metadata: {
          agent_id: 'agent-phase3-002',
          trigger_event_id: 'evt-real-p3-002'
        }
      })
    if (msgErr2) {
      throw new Error(`Falha no setup da mensagem 2: ${msgErr2.message}`)
    }

    // 5. Cadastra Outbox para Teste de 7 Parâmetros em complete_outbox_message
    const { error: outboxErr } = await supabase
      .from('message_outbox')
      .insert({
        id: OUTBOX_TEST_ID,
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        idempotency_key: `outbox-real-p3-${Date.now()}`,
        channel: 'whatsapp',
        recipient: '5511999990000',
        payload: { content: 'Payload de teste real outbox' },
        status: 'processing',
        claim_token: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        claim_version: 1,
        attempts: 1
      })
    if (outboxErr) {
      throw new Error(`Falha no setup da outbox de teste: ${outboxErr.message}`)
    }
  })

  after(async () => {
    // Cleanup completo no banco real ao final dos testes
    try {
      await supabase.from('message_outbox').delete().eq('company_id', COMPANY_ID)
      await supabase.from('messages').delete().eq('company_id', COMPANY_ID)
      await supabase.from('conversations').delete().eq('company_id', COMPANY_ID)
      await supabase.from('companies').delete().eq('id', COMPANY_ID)
    } catch (cleanupErr) {
      console.warn('[Phase3 Integration Cleanup] Aviso ao limpar banco de teste:', cleanupErr)
    }
  })

  test('1. Concorrência Real no Banco: duas chamadas simultâneas à RPC merge_message_metadata_monotonic convergem sem Lost Update', async () => {
    const EXPECTED_PROVIDER_ID = 'wamid.HBgLMjA5NTg3NTU4MzAVAgARGBIyMzk5OTU0RUIxOUQ3OThBAA=='

    // Operação A: Simula o callback assíncrono entregando { delivery_status: 'delivered' }
    const opA = supabase.rpc('merge_message_metadata_monotonic', {
      p_company_id: COMPANY_ID,
      p_message_id: MSG_CONCURRENT_ID,
      p_metadata_patch: {
        delivery_status: 'delivered',
        delivery_updated_at: new Date().toISOString()
      }
    })

    // Operação B: Simula o retorno síncrono HTTP 200 entregando { delivery_status: 'sent', provider_message_id }
    const opB = supabase.rpc('merge_message_metadata_monotonic', {
      p_company_id: COMPANY_ID,
      p_message_id: MSG_CONCURRENT_ID,
      p_metadata_patch: {
        delivery_status: 'sent',
        delivery_updated_at: new Date().toISOString()
      },
      p_provider_message_id: EXPECTED_PROVIDER_ID
    })

    // Dispara ambas as operações de forma concorrente contra o PostgreSQL Real
    const [resA, resB] = await Promise.all([opA, opB])

    assert.equal(resA.error, null, `Operação A falhou com erro: ${resA.error?.message}`)
    assert.equal(resB.error, null, `Operação B falhou com erro: ${resB.error?.message}`)

    const rowA = Array.isArray(resA.data) ? resA.data[0] : resA.data
    const rowB = Array.isArray(resB.data) ? resB.data[0] : resB.data

    assert.equal(rowA.was_updated, true, 'Operação A deve retornar was_updated: true')
    assert.equal(rowB.was_updated, true, 'Operação B deve retornar was_updated: true')

    // Consulta o estado definitivo persistido na tabela messages do PostgreSQL REAL
    const { data: dbMsg, error: selectErr } = await supabase
      .from('messages')
      .select('id, metadata, external_id')
      .eq('id', MSG_CONCURRENT_ID)
      .eq('company_id', COMPANY_ID)
      .single()

    assert.equal(selectErr, null)
    assert.ok(dbMsg, 'Registro da mensagem deve existir no banco')

    // 1. O status final é 'delivered' (a regra monotônica no SQL não permitiu regressão para 'sent')
    assert.equal(
      dbMsg.metadata.delivery_status,
      'delivered',
      'delivery_status deve ser delivered no banco real'
    )

    // 2. O provider_message_id foi incorporado com sucesso (nenhum Lost Update ocorreu)
    assert.equal(
      dbMsg.metadata.provider_message_id,
      EXPECTED_PROVIDER_ID,
      'provider_message_id deve estar presente no metadata'
    )

    // 3. external_id foi populado com provider_message_id
    assert.equal(
      dbMsg.external_id,
      EXPECTED_PROVIDER_ID,
      'external_id deve ter sido atualizado com provider_message_id'
    )

    // 4. Metadados preexistentes íntegros
    assert.equal(dbMsg.metadata.agent_id, 'agent-phase3-001')
    assert.equal(dbMsg.metadata.trigger_event_id, 'evt-real-p3-001')
  })

  test('2. Refatoração TypeScript: updateMessageMetadataSafe utiliza a RPC real do banco e previne Lost Update', async () => {
    const SAFE_PROVIDER_ID = 'wamid.REAL_TS_SAFE_CALL_9999999'

    // Operação 1: Atualização de status para 'delivered'
    const op1 = updateMessageMetadataSafe(supabase, COMPANY_ID, MSG_SAFE_FN_ID, {
      delivery_status: 'delivered',
      delivery_updated_at: new Date().toISOString()
    })

    // Operação 2: Atualização de retorno síncrono com 'sent' e provider_message_id
    const op2 = updateMessageMetadataSafe(supabase, COMPANY_ID, MSG_SAFE_FN_ID, {
      delivery_status: 'sent',
      provider_message_id: SAFE_PROVIDER_ID
    })

    const [res1, res2] = await Promise.all([op1, op2])

    assert.equal(res1.success, true, `res1 falhou: ${res1.error}`)
    assert.equal(res2.success, true, `res2 falhou: ${res2.error}`)

    const { data: dbMsg } = await supabase
      .from('messages')
      .select('id, metadata, external_id')
      .eq('id', MSG_SAFE_FN_ID)
      .eq('company_id', COMPANY_ID)
      .single()

    assert.ok(dbMsg)
    assert.equal(dbMsg.metadata.delivery_status, 'delivered')
    assert.equal(dbMsg.metadata.provider_message_id, SAFE_PROVIDER_ID)
    assert.equal(dbMsg.external_id, SAFE_PROVIDER_ID)
    assert.equal(dbMsg.metadata.agent_id, 'agent-phase3-002')
  })

  test('3. RPC complete_outbox_message: 7º parâmetro (p_provider_message_id) persiste na tabela message_outbox do banco real', async () => {
    const OUTBOX_PROVIDER_ID = 'wamid.REAL_OUTBOX_COL_7777777'

    const { data: completeData, error: completeErr } = await supabase.rpc('complete_outbox_message', {
      p_company_id: COMPANY_ID,
      p_outbox_id: OUTBOX_TEST_ID,
      p_claim_token: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      p_claim_version: 1,
      p_status: 'sent',
      p_last_error: null,
      p_provider_message_id: OUTBOX_PROVIDER_ID
    })

    assert.equal(completeErr, null, `Erro na RPC complete_outbox_message: ${completeErr?.message}`)
    const row = Array.isArray(completeData) ? completeData[0] : completeData
    assert.equal(row.was_completed, true)
    assert.equal(row.current_status, 'sent')

    // Consulta direta na tabela message_outbox do banco real
    const { data: outboxDb, error: outboxSelectErr } = await supabase
      .from('message_outbox')
      .select('id, status, provider_message_id, sent_at')
      .eq('id', OUTBOX_TEST_ID)
      .eq('company_id', COMPANY_ID)
      .single()

    assert.equal(outboxSelectErr, null)
    assert.ok(outboxDb)
    assert.equal(outboxDb.status, 'sent')
    assert.equal(
      outboxDb.provider_message_id,
      OUTBOX_PROVIDER_ID,
      'A nova coluna provider_message_id na message_outbox deve ter sido gravada pela RPC'
    )
    assert.ok(outboxDb.sent_at, 'sent_at deve ter sido preenchido')
  })
})

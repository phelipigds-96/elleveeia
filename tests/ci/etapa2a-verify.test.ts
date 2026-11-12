// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.GEMINI_API_KEY = 'test-gemini-key'

const { setMockSupabaseClient } = await import(
  './mocks/supabase-mock.mjs'
)
const { setMockGeminiGenerateContent } = await import(
  './mocks/genai-mock.mjs'
)

const { OpenAIProvider } = await import('@/lib/services/llm/providers/openai')
const { GeminiProvider } = await import('@/lib/services/llm/providers/gemini')
const { LLMTimeoutError } = await import('@/lib/services/llm/timeout')
const { runAgentEngine } = await import('@/lib/services/agent/engine')
const { buildAgentContext } = await import('@/lib/services/agent/context-builder')
const { resolveToolScope } = await import('@/lib/services/agent/tool-scoping')
const { POST: webhookPOST } = await import('@/app/api/webhooks/messages/route')
const { dispatchOutboxRecordHardened } = await import('@/lib/services/conversations-internal')
const { setMockHttpHandler } = await import('@/lib/services/n8n-internal')

const originalFetch = globalThis.fetch

function createQueryChain(resolver) {
  const state = {
    filters: [],
    nots: [],
    orderBy: null,
    limitCount: null,
    singleMode: null,
    op: 'select',
    payload: null
  }
  const chain = {
    select(_cols) {
      if (state.op === 'insert' || state.op === 'update') return chain
      state.op = 'select'
      return chain
    },
    insert(payload) {
      state.op = 'insert'
      state.payload = payload
      return chain
    },
    update(payload) {
      state.op = 'update'
      state.payload = payload
      return chain
    },
    eq(col, val) {
      state.filters.push({ col, val })
      return chain
    },
    in(col, vals) {
      state.filters.push({ col, vals })
      return chain
    },
    neq(col, val) {
      state.filters.push({ col, val, op: 'neq' })
      return chain
    },
    is(col, val) {
      state.filters.push({ col, val, op: 'is' })
      return chain
    },
    or(expr) {
      state.filters.push({ expr, op: 'or' })
      return chain
    },
    not(col, op, val) {
      state.nots.push({ col, op, val })
      return chain
    },
    order(col, opts) {
      state.orderBy = { col, opts }
      return chain
    },
    limit(n) {
      state.limitCount = n
      return chain
    },
    maybeSingle() {
      state.singleMode = 'maybeSingle'
      return resolver(state)
    },
    single() {
      state.singleMode = 'single'
      return resolver(state)
    },
    then(resolve, reject) {
      return Promise.resolve(resolver(state)).then(resolve, reject)
    }
  }
  return chain
}

describe('ETAPA 2A — Verificação Completa (Timeouts, Memória, Scoping, Mídia Idempotente, Outbox Hardened)', () => {
  beforeEach(() => {
    setMockHttpHandler(null)
    setMockGeminiGenerateContent(null)
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    setMockHttpHandler(null)
    setMockGeminiGenerateContent(null)
    globalThis.fetch = originalFetch
  })

  test('1. OpenAIProvider passa AbortSignal para fetch e aborta limpo com LLMTimeoutError', async () => {
    let receivedSignal = null
    globalThis.fetch = (_url, init) => {
      receivedSignal = init?.signal
      return new Promise((_resolve, reject) => {
        receivedSignal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }

    const provider = new OpenAIProvider()
    const t0 = Date.now()
    await assert.rejects(
      () =>
        provider.generateResponse({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'oi' }],
          timeoutMs: 40
        }),
      (err) => {
        assert.ok(err instanceof LLMTimeoutError)
        assert.equal(err.code, 'LLM_TIMEOUT')
        return true
      }
    )
    const elapsed = Date.now() - t0
    assert.ok(receivedSignal instanceof AbortSignal, 'fetch deve receber AbortSignal')
    assert.equal(receivedSignal.aborted, true, 'AbortSignal deve estar abortado após timeout')
    assert.ok(elapsed < 1000, `Timeout demorou demais: ${elapsed}ms`)
  })

  test('2. GeminiProvider passa config.abortSignal e aborta limpo com LLMTimeoutError', async () => {
    let receivedConfigSignal = null
    setMockGeminiGenerateContent((args) => {
      receivedConfigSignal = args?.config?.abortSignal
      return new Promise((_resolve, reject) => {
        receivedConfigSignal?.addEventListener('abort', () => {
          const err = new Error('Request aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })

    const provider = new GeminiProvider()
    await assert.rejects(
      () =>
        provider.generateResponse({
          model: 'gemini-2.5-flash',
          messages: [{ role: 'user', content: 'oi' }],
          timeoutMs: 40
        }),
      (err) => err instanceof LLMTimeoutError && err.code === 'LLM_TIMEOUT'
    )
    assert.ok(receivedConfigSignal instanceof AbortSignal, 'Gemini config.abortSignal deve ser AbortSignal')
    assert.equal(receivedConfigSignal.aborted, true, 'config.abortSignal deve estar abortado')
  })

  test('3. Engine passa timeoutMs limitado ao orçamento de 40s e grava status timeout em agent_runs', async () => {
    const COMPANY_ID = '11111111-1111-1111-1111-111111111111'
    const AGENT_ID = '22222222-2222-2222-2222-222222222222'
    const CONV_ID = '33333333-3333-3333-3333-333333333333'
    const CUST_ID = '44444444-4444-4444-4444-444444444444'

    const insertedRuns = []
    let capturedTimeoutMs = null

    const mockSupabase = {
      from(table) {
        return createQueryChain((state) => {
          if (table === 'conversations') {
            return {
              data: {
                id: CONV_ID,
                company_id: COMPANY_ID,
                customer_id: CUST_ID,
                customers: { id: CUST_ID, name: 'Maria', name_confirmed: true, phone: '5511999999999' }
              },
              error: null
            }
          }
          if (table === 'companies') {
            return { data: { id: COMPANY_ID, status: 'active', name: 'Empresa Teste' }, error: null }
          }
          if (table === 'agents') {
            return {
              data: { id: AGENT_ID, company_id: COMPANY_ID, name: 'Bot', is_active: true, provider: 'openai', model: 'gpt-4o-mini' },
              error: null
            }
          }
          if (table === 'messages') {
            return { data: state.singleMode ? null : [], error: null, count: 0 }
          }
          if (table === 'products') {
            return { data: [], error: null, count: 0 }
          }
          if (table === 'agent_runs' && state.op === 'insert') {
            insertedRuns.push(state.payload)
            return { data: { id: 'run-1', ...state.payload }, error: null }
          }
          return { data: state.singleMode ? null : [], error: null }
        })
      }
    }

    setMockSupabaseClient(mockSupabase)

    const timeoutProvider = {
      async generateResponse(req) {
        capturedTimeoutMs = req.timeoutMs
        throw new LLMTimeoutError('openai', req.timeoutMs || 20000)
      }
    }

    const res = await runAgentEngine({
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      conversationId: CONV_ID,
      userMessage: 'ola',
      skipCustomerMessageInsert: true,
      adminClient: mockSupabase,
      llmProvider: timeoutProvider
    })

    assert.equal(res.success, false)
    assert.equal(res.code, 'LLM_TIMEOUT')
    assert.ok(typeof capturedTimeoutMs === 'number' && capturedTimeoutMs > 0 && capturedTimeoutMs <= 20000)
    assert.equal(insertedRuns.length, 1)
    assert.equal(insertedRuns[0].status, 'timeout')
  })

  test('4. Context Builder recupera working_memory mesmo além do corte das 20 mensagens recentes', async () => {
    const COMPANY_ID = '11111111-1111-1111-1111-111111111111'
    const AGENT_ID = '22222222-2222-2222-2222-222222222222'
    const CONV_ID = '33333333-3333-3333-3333-333333333333'
    const CUST_ID = '44444444-4444-4444-4444-444444444444'

    const recent20 = Array.from({ length: 20 }, (_, i) => ({
      id: `m-${i}`,
      sender_type: i % 2 === 0 ? 'customer' : 'agent',
      content: `Mensagem recente ${i}`,
      metadata: {}
    }))

    const durableMemory = {
      activeCart: [
        { productId: 'prod-1', name: 'Chocolate Blend 1kg', quantity: 3, unitPrice: 40, subtotal: 120, isPriceConfirmed: true }
      ]
    }

    let durableFallbackCalled = false

    const mockSupabase = {
      from(table) {
        return createQueryChain((state) => {
          if (table === 'agents') {
            return { data: { id: AGENT_ID, company_id: COMPANY_ID, name: 'Bot', is_active: true, provider: 'openai', model: 'gpt-4o-mini' }, error: null }
          }
          if (table === 'conversations') {
            return {
              data: { id: CONV_ID, company_id: COMPANY_ID, customer_id: CUST_ID, customers: { id: CUST_ID, name: 'Joao', phone: '5511888888888' } },
              error: null
            }
          }
          if (table === 'products') {
            return { data: [], error: null, count: 1 }
          }
          if (table === 'messages') {
            const hasWmNot = state.nots.some((n) => String(n.col).includes('working_memory'))
            if (hasWmNot) {
              durableFallbackCalled = true
              return {
                data: [{ metadata: { working_memory: durableMemory }, created_at: '2026-11-10T00:00:00Z' }],
                error: null
              }
            }
            return { data: recent20, error: null }
          }
          return { data: null, error: null }
        })
      }
    }

    setMockSupabaseClient(mockSupabase)

    const ctx = await buildAgentContext({
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      conversationId: CONV_ID
    })
    assert.equal(durableFallbackCalled, true, 'Deve consultar working_memory durável quando as últimas 20 mensagens não possuem working_memory')
    assert.deepEqual(ctx.workingMemory, durableMemory)
  })

  test('5. Tool Scoping preserva ferramentas comerciais em confirmações curtas com carrinho/produto, mas bloqueia sem estado', async () => {
    const allTools = [
      { name: 'consultar_produto_comercial', description: 'Busca e preço', schema: {}, metadata: { category: 'commercial' }, execute: async () => {} },
      { name: 'buscar_produto', description: 'Busca', schema: {}, metadata: { category: 'catalog' }, execute: async () => {} },
      { name: 'consultar_preco', description: 'Preço', schema: {}, metadata: { category: 'pricing' }, execute: async () => {} },
      { name: 'calcular_preco_produto', description: 'Calcula', schema: {}, metadata: { category: 'pricing' }, execute: async () => {} },
      { name: 'gerar_orcamento', description: 'Gera orçamento', schema: {}, metadata: { category: 'quotes' }, execute: async () => {} },
      { name: 'consultar_orcamento', description: 'Consulta orçamento', schema: {}, metadata: { category: 'quotes' }, execute: async () => {} },
      { name: 'get_current_datetime', description: 'Data', schema: {}, metadata: { category: 'datetime' }, execute: async () => {} }
    ]

    const cartMemory = {
      activeCart: [{ productId: 'p1', name: 'Barra 1kg', quantity: 2, unitPrice: 30, subtotal: 60, isPriceConfirmed: true }]
    }

    for (const phrase of ['sim', 'ok', 'pode gerar', 'fechou', 'gera', 'manda', 'isso', 'certo', 'perfeito', 'beleza']) {
      const names = resolveToolScope(phrase, [], allTools, cartMemory).map((t) => t.name)
      assert.ok(names.includes('gerar_orcamento'), `"${phrase}" com activeCart deve manter gerar_orcamento (obtido: ${names.join(',')})`)
      assert.ok(names.includes('consultar_produto_comercial'), `"${phrase}" com activeCart deve manter consultar_produto_comercial`)
    }

    const productMemory = { activeProduct: { id: 'p2', name: 'Cobertura Top 1kg' } }
    const namesFromProduct = resolveToolScope('sim', [], allTools, productMemory).map((t) => t.name)
    assert.ok(namesFromProduct.includes('calcular_preco_produto'), '"sim" com activeProduct deve manter calcular_preco_produto')
    assert.ok(namesFromProduct.includes('gerar_orcamento'), '"sim" com activeProduct deve manter gerar_orcamento')

    for (const emptyPhrase of ['oi', 'bom dia', 'tudo bem', 'sim', 'ok', 'nao', 'pode gerar']) {
      const names = resolveToolScope(emptyPhrase, [], allTools, {}).map((t) => t.name)
      assert.equal(names.length, 0, `"${emptyPhrase}" SEM estado comercial deve retornar 0 tools (obtido: ${names.join(',')})`)
    }

    const closingNames = resolveToolScope('obrigado, tchau', [], allTools, cartMemory).map((t) => t.name)
    assert.equal(closingNames.length, 0, 'Encerramento explícito deve retornar 0 tools mesmo com carrinho ativo')
  })

  test('6. Webhook POST diferencia erro de banco (503) de credencial inválida (401) e pula mídia em evento duplicado', async () => {
    // 6A: Erro de infraestrutura no lookup de api_keys => HTTP 503
    setMockSupabaseClient({
      from(table) {
        return createQueryChain(() => {
          if (table === 'api_keys') return { data: null, error: { message: 'connection refused' } }
          return { data: null, error: null }
        })
      }
    })

    const resDbErr = await webhookPOST(
      new Request('https://app.elleveeia.com.br/api/webhooks/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ellevee-webhook-secret': 'sec-123' },
        body: JSON.stringify({})
      })
    )
    assert.equal(resDbErr.status, 503)

    // 6B: Secret inválido (sem erro de banco) => HTTP 401
    setMockSupabaseClient({
      from() {
        return createQueryChain(() => ({ data: null, error: null }))
      }
    })
    const res401 = await webhookPOST(
      new Request('https://app.elleveeia.com.br/api/webhooks/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ellevee-webhook-secret': 'wrong' },
        body: JSON.stringify({})
      })
    )
    assert.equal(res401.status, 401)

    // 6C: Mídia em evento novo vs duplicado (Whisper/Storage NÃO podem rodar no duplicado)
    const COMPANY_ID = '11111111-1111-1111-1111-111111111111'
    const CONV_ID = '33333333-3333-3333-3333-333333333333'
    const MSG_ID = '55555555-5555-5555-5555-555555555555'
    const CUST_ID = '44444444-4444-4444-4444-444444444444'

    const seenEventIds = new Set()
    let storageUploadCalls = 0
    let whisperCalls = 0
    const updatedMessagePayloads = []

    globalThis.fetch = async (url) => {
      if (String(url).includes('audio/transcriptions')) {
        whisperCalls++
        return new Response(JSON.stringify({ text: 'Quero 5kg de chocolate' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response('{}', { status: 200 })
    }

    setMockSupabaseClient({
      storage: {
        from() {
          return {
            async upload() {
              storageUploadCalls++
              return { error: null }
            },
            getPublicUrl(p) {
              return { data: { publicUrl: `https://cdn.example.com/${p}` } }
            }
          }
        }
      },
      async rpc(fn, args) {
        if (fn === 'insert_message_idempotent') {
          return { data: [{ message_id: MSG_ID, was_inserted: true }], error: null }
        }
        if (fn === 'merge_message_metadata_monotonic') {
          updatedMessagePayloads.push({ type: 'rpc_merge', args })
          return { data: [{ was_updated: true, final_metadata: args.p_metadata_patch, current_status: 'pending' }], error: null }
        }
        return { data: null, error: null }
      },
      from(table) {
        return createQueryChain((state) => {
          if (table === 'api_keys') return { data: { company_id: COMPANY_ID }, error: null }
          if (table === 'companies') return { data: { id: COMPANY_ID, status: 'active' }, error: null }
          if (table === 'webhook_events' && state.op === 'insert') {
            if (seenEventIds.has(state.payload.event_id)) {
              return { data: null, error: { code: '23505', message: 'duplicate key' } }
            }
            seenEventIds.add(state.payload.event_id)
            // Garante que base64 não foi persistido no evento
            assert.equal(state.payload.payload?.metadata?.base64, undefined)
            assert.equal(state.payload.payload?.message?.base64, undefined)
            return { data: { id: 'we-1', ...state.payload }, error: null }
          }
          if (table === 'webhook_events' && state.op === 'update') {
            return { data: {}, error: null }
          }
          if (table === 'customers') {
            if (state.op === 'insert' || state.op === 'update') {
              return { data: { id: CUST_ID, company_id: COMPANY_ID, phone: '5511999990000' }, error: null }
            }
            return { data: { id: CUST_ID, company_id: COMPANY_ID, phone: '5511999990000', name: 'Ana', name_confirmed: true }, error: null }
          }
          if (table === 'conversations') {
            if (state.op === 'insert' || state.op === 'update') {
              return { data: { id: CONV_ID, company_id: COMPANY_ID, customer_id: CUST_ID, ai_enabled: false, status: 'open' }, error: null }
            }
            return { data: { id: CONV_ID, company_id: COMPANY_ID, customer_id: CUST_ID, ai_enabled: false, status: 'open' }, error: null }
          }
          if (table === 'messages') {
            if (state.op === 'insert') return { data: { id: MSG_ID }, error: null }
            if (state.op === 'update') {
              updatedMessagePayloads.push({ type: 'table_update', payload: state.payload })
              return { data: { id: MSG_ID }, error: null }
            }
            return { data: { id: MSG_ID, metadata: {} }, error: null }
          }
          return { data: null, error: null }
        })
      }
    })

    const audioPayload = {
      event_id: 'evt-audio-dedup-1',
      event_type: 'message.received',
      channel: 'whatsapp',
      customer: { name: 'Ana', phone: '5511999990000' },
      message: {
        sender_type: 'customer',
        message_type: 'audio',
        base64: Buffer.from('fake-ogg-bytes').toString('base64')
      }
    }

    const req1 = new Request('https://app.elleveeia.com.br/api/webhooks/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ellevee-webhook-secret': 'sec-valid' },
      body: JSON.stringify(audioPayload)
    })
    const res1 = await webhookPOST(req1)
    assert.equal(res1.status, 200)
    const body1 = await res1.json()
    assert.equal(body1.duplicate, false)
    assert.equal(storageUploadCalls, 1, 'Storage upload deve rodar 1x no evento inédito')
    assert.equal(whisperCalls, 1, 'Whisper deve rodar 1x no evento inédito')
    assert.ok(
      updatedMessagePayloads.some((u) => u.type === 'table_update' && u.payload.content === 'Quero 5kg de chocolate'),
      'Transcrição deve atualizar content da mensagem persistida'
    )

    // Replay duplicado do mesmo event_id
    const req2 = new Request('https://app.elleveeia.com.br/api/webhooks/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ellevee-webhook-secret': 'sec-valid' },
      body: JSON.stringify(audioPayload)
    })
    const res2 = await webhookPOST(req2)
    assert.equal(res2.status, 200)
    const body2 = await res2.json()
    assert.equal(body2.duplicate, true)
    assert.equal(storageUploadCalls, 1, 'Replay duplicado NÃO deve chamar Storage upload')
    assert.equal(whisperCalls, 1, 'Replay duplicado NÃO deve chamar Whisper novamente')
  })

  test('7. actions.ts não referencia dispatchOutboxMessage e dispatchOutboxRecordHardened aplica SSRF guard + gateway lock', async () => {
    const actionsSource = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/conversations/actions.ts'), 'utf8')
    assert.equal(actionsSource.includes('dispatchOutboxMessage'), false, 'actions.ts não pode mais importar/chamar dispatchOutboxMessage legado')
    assert.equal(actionsSource.includes('dispatchOutboxRecordHardened'), true, 'actions.ts deve usar dispatchOutboxRecordHardened')

    const COMPANY_ID = '11111111-1111-1111-1111-111111111111'
    const OUTBOX_ID = '66666666-6666-6666-6666-666666666666'
    const MSG_ID = '55555555-5555-5555-5555-555555555555'

    const rpcCalls = []
    let fetchAttempted = false
    globalThis.fetch = async () => {
      fetchAttempted = true
      return new Response('{}', { status: 200 })
    }

    const mockClient = {
      async rpc(fn, args) {
        rpcCalls.push({ fn, args })
        if (fn === 'claim_outbox_message') {
          return { data: [{ claim_token: 'ct-1', claim_version: 2 }], error: null }
        }
        return { data: null, error: null }
      },
      from(table) {
        return createQueryChain(() => {
          if (table === 'companies') return { data: { id: COMPANY_ID, status: 'active' }, error: null }
          if (table === 'integrations') {
            return {
              data: { id: 'int-1', type: 'n8n', status: 'active', config: { webhook_url: 'http://127.0.0.1:8080/internal-ssrf' } },
              error: null
            }
          }
          return { data: null, error: null }
        })
      }
    }

    const res = await dispatchOutboxRecordHardened({
      adminClient: mockClient,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID,
      messageId: MSG_ID,
      outboundPayload: { event_id: 'evt-ssrf-test', message: { content: 'oi' } }
    })

    assert.equal(res.outcome, 'failed')
    assert.equal(fetchAttempted, false, 'URL privada (SSRF) deve ser bloqueada antes de fetch')
    assert.ok(rpcCalls.some((c) => c.fn === 'claim_outbox_message' && c.args.p_lease_seconds === 120))
    assert.ok(rpcCalls.some((c) => c.fn === 'complete_outbox_message' && c.args.p_status === 'failed'))

    // Fallback Evolution API com gateway lock + conclusão atomizada
    const evoRpcCalls = []
    let evoFetchUrl = null
    globalThis.fetch = async (url) => {
      evoFetchUrl = String(url)
      return new Response(JSON.stringify({ key: { id: 'evo-msg-777' } }), { status: 200 })
    }

    const evoClient = {
      async rpc(fn, args) {
        evoRpcCalls.push({ fn, args })
        if (fn === 'claim_outbox_message') return { data: [{ claim_token: 'ct-evo', claim_version: 1 }], error: null }
        if (fn === 'acquire_gateway_outbound_lock') return { data: [{ was_acquired: true, claim_token: 'gw-tok-1' }], error: null }
        return { data: null, error: null }
      },
      from(table) {
        return createQueryChain((state) => {
          if (table === 'companies') return { data: { id: COMPANY_ID, status: 'active' }, error: null }
          if (table === 'integrations') {
            const typeFilter = state.filters.find((f) => f.col === 'type')
            if (typeFilter?.val === 'n8n') return { data: null, error: null }
            return {
              data: {
                id: 'int-evo',
                type: 'whatsapp_evolution',
                status: 'active',
                config: { api_url: 'https://evo.example.com', instance_name: 'inst1' },
                credentials: { api_key: 'evo-secret' }
              },
              error: null
            }
          }
          return { data: null, error: null }
        })
      }
    }

    const evoRes = await dispatchOutboxRecordHardened({
      adminClient: evoClient,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID,
      messageId: MSG_ID,
      outboundPayload: { event_id: 'evt-evo-1', recipient: '5511999998888', message: { content: 'olá' } }
    })

    assert.equal(evoRes.outcome, 'sent')
    assert.equal(evoRes.providerMessageId, 'evo-msg-777')
    assert.equal(evoFetchUrl, 'https://evo.example.com/message/sendText/inst1')
    assert.ok(evoRpcCalls.some((c) => c.fn === 'acquire_gateway_outbound_lock'))
    assert.ok(evoRpcCalls.some((c) => c.fn === 'complete_gateway_outbound_lock' && c.args.p_status === 'completed'))
    assert.ok(evoRpcCalls.some((c) => c.fn === 'complete_outbox_message' && c.args.p_status === 'sent'))

    // Falha ambígua de rede (AbortError) NÃO pode concluir outbox como failed nem liberar lock prematuramente
    const ambigRpcCalls = []
    setMockHttpHandler(async () => {
      const abortErr = new Error('The operation was aborted')
      abortErr.name = 'AbortError'
      throw abortErr
    })

    const ambigClient = {
      async rpc(fn, args) {
        ambigRpcCalls.push({ fn, args })
        if (fn === 'claim_outbox_message') return { data: [{ claim_token: 'ct-amb', claim_version: 1 }], error: null }
        if (fn === 'acquire_gateway_outbound_lock') return { data: [{ was_acquired: true, claim_token: 'gw-amb-1' }], error: null }
        return { data: null, error: null }
      },
      from(table) {
        return createQueryChain((state) => {
          if (table === 'companies') return { data: { id: COMPANY_ID, status: 'active' }, error: null }
          if (table === 'integrations') {
            const typeFilter = state.filters.find((f) => f.col === 'type')
            if (typeFilter?.val === 'n8n') {
              return {
                data: { id: 'int-n8n', type: 'n8n', status: 'active', config: { webhook_url: 'https://n8n.example.com/hook' } },
                error: null
              }
            }
            return { data: null, error: null }
          }
          return { data: null, error: null }
        })
      }
    }

    const ambigRes = await dispatchOutboxRecordHardened({
      adminClient: ambigClient,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID,
      messageId: MSG_ID,
      outboundPayload: { event_id: 'evt-amb-1', message: { content: 'oi' } }
    })

    assert.equal(ambigRes.outcome, 'ambiguous')
    assert.equal(
      ambigRpcCalls.some((c) => c.fn === 'complete_outbox_message'),
      false,
      'Falha ambígua NÃO deve concluir outbox — deve permanecer em processing para reconciliação'
    )
  })
})

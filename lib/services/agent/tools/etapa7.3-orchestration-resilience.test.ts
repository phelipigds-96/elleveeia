import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  buildSafeIterationLimitResponse,
  sanitizeLogMetadata
} from '../engine.ts'
import { resolveToolScope, hasClearProductIntent } from '../tool-scoping.ts'
import {
  type WorkingMemory,
  addItemToCart,
  updateCartItemQuantity,
  updateCartItemPrice,
  getCartItems,
  calculateCartTotal,
  applyWorkingMemoryUpdate
} from '../working-memory.ts'
import type { ToolDefinition } from '../tools.ts'

const localExpect = (actual: any) => ({
  toBe: (expected: any) => assert.strictEqual(actual, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
  toBeUndefined: () => assert.strictEqual(actual, undefined),
  toBeDefined: () => assert.notStrictEqual(actual, undefined),
  toBeTruthy: () => assert.ok(actual),
  toBeFalsy: () => assert.ok(!actual),
  toContain: (substring: string) => assert.ok(typeof actual === 'string' && actual.includes(substring), `Esperava que "${actual}" contivesse "${substring}"`),
  toNotContain: (substring: string) => assert.ok(typeof actual === 'string' && !actual.includes(substring), `Esperava que "${actual}" NÃO contivesse "${substring}"`)
})

const expect = typeof (globalThis as any).expect === 'function' ? (globalThis as any).expect : localExpect

const mockTools: ToolDefinition[] = [
  { name: 'consultar_produto_comercial', description: 'Busca produto e calcula preço', schema: {} as any, metadata: { category: 'commercial' }, execute: async () => {} },
  { name: 'buscar_produto', description: 'Busca simples', schema: {} as any, metadata: { category: 'catalog' }, execute: async () => {} },
  { name: 'consultar_preco', description: 'Preço unitário base', schema: {} as any, metadata: { category: 'pricing' }, execute: async () => {} },
  { name: 'calcular_preco_produto', description: 'Cálculo por quantidade', schema: {} as any, metadata: { category: 'pricing' }, execute: async () => {} },
  { name: 'gerar_orcamento', description: 'Gera orçamento formal', schema: {} as any, metadata: { category: 'quotes' }, execute: async () => {} },
  { name: 'consultar_orcamento', description: 'Consulta orçamento formal', schema: {} as any, metadata: { category: 'quotes' }, execute: async () => {} },
  { name: 'get_current_datetime', description: 'Data e hora atual', schema: {} as any, metadata: { category: 'datetime' }, execute: async () => {} }
]

describe('ETAPA 7.3 — Orquestração, Propagação de Memória e Resiliência', () => {

  it('1. Memória anterior é propagada ao Tool Scoping', () => {
    const previousMemory: WorkingMemory = {
      activeProduct: { id: 'prod-10', name: 'Chocolate Harald 1kg' },
      activeCart: [
        { productId: 'prod-10', name: 'Chocolate Harald 1kg', quantity: 2, unitPrice: 35, subtotal: 70, isPriceConfirmed: true }
      ]
    }

    // Mesmo com mensagem curta de edição, o scoping com a memória prévia ativa as ferramentas de carrinho e orçamento
    const scoped = resolveToolScope('Tira esse item', [], mockTools, previousMemory)
    const names = scoped.map(t => t.name)

    expect(names.includes('gerar_orcamento')).toBe(true)
    expect(names.includes('consultar_produto_comercial')).toBe(true)
  })

  it('2. Mensagem curta de edição utiliza o carrinho existente', () => {
    const memoryWithCart: WorkingMemory = {
      activeCart: [
        { productId: 'item-a', name: 'Item A', quantity: 1, unitPrice: 20, subtotal: 20, isPriceConfirmed: true },
        { productId: 'item-b', name: 'Item B', quantity: 2, unitPrice: 15, subtotal: 30, isPriceConfirmed: true }
      ]
    }

    const scoped = resolveToolScope('remove o item a', [], mockTools, memoryWithCart)
    const names = scoped.map(t => t.name)

    expect(names.includes('gerar_orcamento')).toBe(true)
    expect(names.includes('consultar_produto_comercial')).toBe(true)
  })

  it('3. Inclusão de segundo produto preserva o primeiro no carrinho', () => {
    let memory: WorkingMemory = {
      activeProduct: { id: 'prod-1', name: 'Item 1' },
      activeCart: [
        { productId: 'prod-1', name: 'Item 1', quantity: 2, unitPrice: 30.00, subtotal: 60.00, isPriceConfirmed: true }
      ]
    }

    // O LLM executa ferramenta comercial para o segundo produto com quantity_pricing
    const toolResultsTurn2 = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'quantity_pricing',
          product: { id: 'prod-2', name: 'Item 2' },
          quantity: 4,
          price: { unit_price: 25.00, subtotal: 100.00 }
        }
      }
    ]

    memory = applyWorkingMemoryUpdate(memory, toolResultsTurn2)

    const items = getCartItems(memory)
    expect(items.length).toBe(2)
    expect(items[0].productId).toBe('prod-1')
    expect(items[0].subtotal).toBe(60.00)
    expect(items[1].productId).toBe('prod-2')
    expect(items[1].subtotal).toBe(100.00)

    const calc = calculateCartTotal(memory)
    expect(calc.total).toBe(160.00) // 60 + 100
    expect(calc.allPricesConfirmed).toBe(true)
  })

  it('4. Alteração de quantidade exige nova precificação antes de confirmar subtotal', () => {
    let memory: WorkingMemory = {
      activeCart: [
        { productId: 'prod-1', name: 'Item 1', quantity: 2, unitPrice: 30.00, subtotal: 60.00, isPriceConfirmed: true }
      ]
    }

    // Cliente mudou a quantidade para 10 unidades
    memory = updateCartItemQuantity(memory, 'prod-1', 10)

    // Preço fica marcado como pendente (não confirmado) e subtotal é invalidado
    expect(memory.activeCart?.[0].isPriceConfirmed).toBe(false)
    expect(memory.activeCart?.[0].subtotal).toBeUndefined()
    expect(calculateCartTotal(memory).allPricesConfirmed).toBe(false)

    // Ferramenta calcular_preco_produto roda e valida a faixa de atacado de 10 unidades
    const priceResult = [
      {
        success: true,
        toolName: 'calcular_preco_produto',
        data: {
          product_id: 'prod-1',
          quantity: 10,
          unit_price: 26.50,
          subtotal: 265.00,
          price_type: 'wholesale'
        }
      }
    ]

    memory = applyWorkingMemoryUpdate(memory, priceResult)

    expect(memory.activeCart?.[0].isPriceConfirmed).toBe(true)
    expect(memory.activeCart?.[0].unitPrice).toBe(26.50)
    expect(memory.activeCart?.[0].subtotal).toBe(265.00)
    expect(calculateCartTotal(memory).allPricesConfirmed).toBe(true)
    expect(calculateCartTotal(memory).total).toBe(265.00)
  })

  it('5. Falha de ferramenta não confirma operação nem corrompe memória', () => {
    const memoryBefore: WorkingMemory = {
      activeProduct: { id: 'prod-1', name: 'Item 1' },
      activeCart: [
        { productId: 'prod-1', name: 'Item 1', quantity: 1, unitPrice: 30.00, subtotal: 30.00, isPriceConfirmed: true }
      ]
    }

    // Ferramenta falha (ex: produto sem preço cadastrado ou erro de timeout)
    const failedResults = [
      {
        success: false,
        toolName: 'consultar_produto_comercial',
        error: { code: 'NO_ACTIVE_PRICE', message: 'Produto não possui preço configurado.' }
      }
    ]

    const memoryAfter = applyWorkingMemoryUpdate(memoryBefore, failedResults)

    // O carrinho e o produto anterior permanecem intactos sem confirmações alucinadas
    expect(memoryAfter.activeCart?.length).toBe(1)
    expect(memoryAfter.activeCart?.[0].productId).toBe('prod-1')
    expect(memoryAfter.activeQuote).toBeUndefined()
  })

  it('6. Erro de orçamento não confirma número ou total e produz resposta segura', () => {
    const memoryBefore: WorkingMemory = {
      activeCart: [
        { productId: 'prod-1', name: 'Item 1', quantity: 2, unitPrice: 20.00, subtotal: 40.00, isPriceConfirmed: true }
      ]
    }

    const failedQuoteResult = [
      {
        success: false,
        toolName: 'gerar_orcamento',
        error: { code: 'DATABASE_TIMEOUT', message: 'Conexão temporariamente indisponível' }
      }
    ]

    const memoryAfter = applyWorkingMemoryUpdate(memoryBefore, failedQuoteResult)
    expect(memoryAfter.activeQuote).toBeUndefined()

    // O helper de resposta segura explica o erro sem inventar ID de orçamento
    const safeResponse = buildSafeIterationLimitResponse(failedQuoteResult)
    expect(safeResponse).toContain('Não foi possível concluir a operação solicitada: Conexão temporariamente indisponível')
    expect(safeResponse).toNotContain('ID:')
  })

  it('7. LLM sem chamada de ferramenta aciona fallback quando aplicável', () => {
    const message = 'Vocês têm Cobertura Sicao 1kg?'
    expect(hasClearProductIntent(message)).toBe(true)

    // Em mensagem puramente institucional, NÃO dispara fallback
    const institutionalMsg = 'Vocês têm nota fiscal com CNPJ?'
    expect(hasClearProductIntent(institutionalMsg)).toBe(false)
  })

  it('8. Limite do loop encerra com resposta segura e objetiva', () => {
    // Cenário 1: Loop encerra com erro
    const resultsWithError = [
      { success: false, toolName: 'consultar_preco', error: { message: 'Produto desativado no catálogo' } }
    ]
    const respError = buildSafeIterationLimitResponse(resultsWithError)
    expect(respError).toContain('Não foi possível concluir a operação solicitada: Produto desativado no catálogo')

    // Cenário 2: Loop encerra sem chamadas ou erro
    const respEmpty = buildSafeIterationLimitResponse([])
    expect(respEmpty).toContain('Consultei nosso sistema para atender sua solicitação, mas não consegui concluir a resposta automaticamente')
    expect(respEmpty).toContain('Gostaria de falar com nossa equipe de atendimento?')

    // Cenário 3: Orçamento concluído mas LLM não emitiu texto final
    const resultsWithQuote = [
      { success: true, toolName: 'gerar_orcamento', data: { id: 'ORC-SAFE-99', total: 180.50 } }
    ]
    const respQuote = buildSafeIterationLimitResponse(resultsWithQuote)
    expect(respQuote).toContain('Seu orçamento foi gerado com sucesso (ID: ORC-SAFE-99) no valor total de R$ 180.50')
  })

  it('9. Memória legada continua funcionando sem erros no Engine', () => {
    const legacyMemory: WorkingMemory = {
      activeProduct: { id: 'legado-1', name: 'Barra Chocolate' },
      activePrice: { unitPrice: 20.00 },
      activeQuantity: 1,
      activeQuote: { id: 'ORC-LEGACY', total: 20.00, status: 'draft' }
    }

    const updated = applyWorkingMemoryUpdate(legacyMemory, [])
    expect(updated.activeProduct?.id).toBe('legado-1')
    expect(updated.activeQuote?.id).toBe('ORC-LEGACY')
  })

  it('10. activeQuote é preservado durante inclusões e consultas de itens', () => {
    let memory: WorkingMemory = {
      activeQuote: { id: 'ORC-PRESERVED-1', total: 150.00, status: 'draft' },
      activeCart: [
        { productId: 'p1', name: 'Item 1', quantity: 3, unitPrice: 50.00, subtotal: 150.00, isPriceConfirmed: true }
      ]
    }

    // Consulta de outro produto não remove o orçamento existente
    const searchResults = [
      {
        success: true,
        toolName: 'buscar_produto',
        data: {
          strategy: 'specific_product',
          product: { id: 'p2', name: 'Item 2' }
        }
      }
    ]

    memory = applyWorkingMemoryUpdate(memory, searchResults)

    expect(memory.activeQuote?.id).toBe('ORC-PRESERVED-1')
    expect(memory.activeQuote?.total).toBe(150.00)
    expect(memory.activeQuote?.status).toBe('draft')
  })

  it('11. Resultados reais das ferramentas atualizam a memória, ignorando afirmações arbitrárias', () => {
    const memoryBefore: WorkingMemory = {}

    // Simulação: se nenhuma ferramenta retornou sucesso, a memória não ganha produtos fictícios
    const emptyResults: any[] = []
    const memoryAfter = applyWorkingMemoryUpdate(memoryBefore, emptyResults)

    expect(memoryAfter.activeProduct).toBeUndefined()
    expect(memoryAfter.activePrice).toBeUndefined()
    expect(memoryAfter.activeCart).toBeUndefined()
    expect(memoryAfter.activeQuote).toBeUndefined()
  })

  it('12. Logs não expõem credenciais nem conteúdo sensível', () => {
    const rawTelemetryMetadata = {
      companyId: 'company-uuid-123',
      token: 'sk-secret-token-1234567890',
      api_key: 'AIzaSySecretApiKey',
      authorization: 'Bearer secret_auth_header',
      cart: {
        item_count: 2,
        has_items: true
      },
      orchestration: {
        iterations: 2,
        executed_tools: [{ tool: 'consultar_produto_comercial', success: true }]
      },
      nested_config: {
        password: 'db_secret_password',
        status: 'ok'
      }
    }

    const sanitized = sanitizeLogMetadata(rawTelemetryMetadata)

    // Dados de telemetria operacionais legítimos permanecem intactos
    expect(sanitized.companyId).toBe('company-uuid-123')
    expect(sanitized.cart.item_count).toBe(2)
    expect(sanitized.orchestration.iterations).toBe(2)
    expect(sanitized.nested_config.status).toBe('ok')

    // Campos com chaves sensíveis são ofuscados para [REDACTED]
    expect(sanitized.token).toBe('[REDACTED]')
    expect(sanitized.api_key).toBe('[REDACTED]')
    expect(sanitized.authorization).toBe('[REDACTED]')
    expect(sanitized.nested_config.password).toBe('[REDACTED]')
  })

})

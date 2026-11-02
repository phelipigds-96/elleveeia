import { describe, it } from 'node:test'
import assert from 'node:assert'
import { formatWorkingMemoryPrompt } from '../context-builder.ts'
import { resolveToolScope, hasClearProductIntent } from '../tool-scoping.ts'
import type { ToolDefinition } from '../tools.ts'
import type { WorkingMemory } from '../working-memory.ts'

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

// Conjunto mock padrão das 7 ferramentas oficiais
const mockTools: ToolDefinition[] = [
  { name: 'consultar_produto_comercial', description: 'Busca produto e calcula preço', schema: {} as any, metadata: { category: 'commercial' }, execute: async () => {} },
  { name: 'buscar_produto', description: 'Busca simples', schema: {} as any, metadata: { category: 'catalog' }, execute: async () => {} },
  { name: 'consultar_preco', description: 'Preço unitário base', schema: {} as any, metadata: { category: 'pricing' }, execute: async () => {} },
  { name: 'calcular_preco_produto', description: 'Cálculo por quantidade', schema: {} as any, metadata: { category: 'pricing' }, execute: async () => {} },
  { name: 'gerar_orcamento', description: 'Gera orçamento formal', schema: {} as any, metadata: { category: 'quotes' }, execute: async () => {} },
  { name: 'consultar_orcamento', description: 'Consulta orçamento formal', schema: {} as any, metadata: { category: 'quotes' }, execute: async () => {} },
  { name: 'get_current_datetime', description: 'Data e hora atual', schema: {} as any, metadata: { category: 'datetime' }, execute: async () => {} }
]

describe('ETAPA 7.2 — Refinamento do Prompt Operacional e Tool Scoping', () => {

  // --- SEÇÃO 1: CONTEXT BUILDER & EXPOSIÇÃO DO CARRINHO ---

  it('1. Contexto apresenta dois ou mais produtos do carrinho com nomes, quantidades e subtotais', () => {
    const memory: WorkingMemory = {
      activeCart: [
        {
          productId: 'prod-top-blend',
          name: 'Cobertura Harald Top Blend 1kg',
          quantity: 2,
          unitPrice: 38.50,
          subtotal: 77.00,
          priceType: 'retail',
          isPriceConfirmed: true
        },
        {
          productId: 'prod-melken-granulado',
          name: 'Granulado Melken Preto 500g',
          quantity: 5,
          unitPrice: 18.00,
          subtotal: 90.00,
          priceType: 'wholesale',
          isPriceConfirmed: true
        }
      ]
    }

    const promptText = formatWorkingMemoryPrompt(memory)

    expect(promptText).toContain('Carrinho de Negociação (2 itens distintos):')
    expect(promptText).toContain('Cobertura Harald Top Blend 1kg')
    expect(promptText).toContain('Qtd: 2')
    expect(promptText).toContain('Preço Unit: R$ 38.50 (retail)')
    expect(promptText).toContain('Subtotal: R$ 77.00')
    expect(promptText).toContain('Granulado Melken Preto 500g')
    expect(promptText).toContain('Qtd: 5')
    expect(promptText).toContain('Preço Unit: R$ 18.00 (wholesale)')
    expect(promptText).toContain('Subtotal: R$ 90.00')
    expect(promptText).toContain('Total Parcial Confirmado: R$ 167.00')
  })

  it('2. Produto com preço pendente não aparece como confirmado no contexto', () => {
    const memory: WorkingMemory = {
      activeCart: [
        {
          productId: 'prod-1',
          name: 'Cobertura Branca 1kg',
          quantity: 10,
          isPriceConfirmed: false // Preço pendente
        }
      ]
    }

    const promptText = formatWorkingMemoryPrompt(memory)

    expect(promptText).toContain('Precificação: Pendente')
    expect(promptText).toNotContain('Preço Unit: R$')
    expect(promptText).toNotContain('Subtotal: R$')
    expect(promptText).toContain('Atenção: Os seguintes produtos precisam de recálculo/confirmação de preço antes de gerar orçamento: Cobertura Branca 1kg')
  })

  it('3. Total parcial exclui produtos sem preço confirmado', () => {
    const memory: WorkingMemory = {
      activeCart: [
        {
          productId: 'prod-confirmado',
          name: 'Produto Confirmado',
          quantity: 2,
          unitPrice: 50.00,
          subtotal: 100.00,
          isPriceConfirmed: true
        },
        {
          productId: 'prod-pendente',
          name: 'Produto Pendente',
          quantity: 15,
          unitPrice: 10.00, // Preço antigo/stale que NÃO deve ser somado
          subtotal: 150.00,
          isPriceConfirmed: false
        }
      ]
    }

    const promptText = formatWorkingMemoryPrompt(memory)

    // O total parcial confirmado deve ser estritamente R$ 100.00 (excluindo os 150.00 do pendente)
    expect(promptText).toContain('Total Parcial Confirmado: R$ 100.00')
    expect(promptText).toNotContain('Total Parcial Confirmado: R$ 250.00')
  })

  it('4. Memória antiga sem activeCart continua funcionando perfeitamente', () => {
    const legacyMemory: WorkingMemory = {
      activeProduct: { id: 'p-legado', name: 'Barra Garoto 1kg' },
      activePrice: { unitPrice: 32.00, priceType: 'retail' },
      activeQuantity: 1,
      activeQuote: { id: 'ORC-OLD-1', total: 32.00, status: 'draft' }
    }

    const promptText = formatWorkingMemoryPrompt(legacyMemory)

    expect(promptText).toContain('Produto em Foco: Barra Garoto 1kg')
    expect(promptText).toContain('Preco: R$ 32.00 (retail) | Qtd: 1')
    expect(promptText).toContain('Orcamento Formal: ID ORC-OLD-1 (draft) | Total: R$ 32.00')
    expect(promptText).toNotContain('Carrinho de Negociação')
  })

  it('5. activeProduct não substitui nem apaga o carrinho na renderização', () => {
    const memory: WorkingMemory = {
      activeProduct: { id: 'prod-foco', name: 'Forma Acetato BWB' },
      activePrice: { unitPrice: 5.50 },
      activeQuantity: 1,
      activeCart: [
        {
          productId: 'prod-carrinho-1',
          name: 'Cobertura Sicao 1kg',
          quantity: 3,
          unitPrice: 30.00,
          subtotal: 90.00,
          isPriceConfirmed: true
        }
      ]
    }

    const promptText = formatWorkingMemoryPrompt(memory)

    expect(promptText).toContain('Produto em Foco: Forma Acetato BWB')
    expect(promptText).toContain('Cobertura Sicao 1kg')
    expect(promptText).toContain('Total Parcial Confirmado: R$ 90.00')
  })

  // --- SEÇÃO 2: TOOL SCOPING & INTENÇÕES DE EDIÇÃO ---

  it('6. Expressões de remoção ("tira o granulado", "não quero mais a cobertura") ativam o escopo comercial adequado', () => {
    const memoryWithCart: WorkingMemory = {
      activeCart: [
        { productId: 'p1', name: 'Granulado', quantity: 2, unitPrice: 10, subtotal: 20, isPriceConfirmed: true }
      ]
    }

    const tools1 = resolveToolScope('Tira o granulado, deixa só a cobertura.', [], mockTools, memoryWithCart)
    const toolNames1 = tools1.map(t => t.name)

    expect(toolNames1.includes('consultar_produto_comercial')).toBe(true)
    expect(toolNames1.includes('gerar_orcamento')).toBe(true)

    const tools2 = resolveToolScope('Não quero mais a barra de blend.', [], mockTools, memoryWithCart)
    const toolNames2 = tools2.map(t => t.name)

    expect(toolNames2.includes('consultar_produto_comercial')).toBe(true)
    expect(toolNames2.includes('gerar_orcamento')).toBe(true)
  })

  it('7. Expressões de alteração de quantidade ("muda pra 20", "coloca 15 unidades") ativam consulta e recálculo de preço', () => {
    const memory: WorkingMemory = {
      activeProduct: { id: 'p1', name: 'Top Gotas 1kg' }
    }

    const tools1 = resolveToolScope('Muda para 20 unidades.', [], mockTools, memory)
    const names1 = tools1.map(t => t.name)

    expect(names1.includes('calcular_preco_produto')).toBe(true)
    expect(names1.includes('consultar_preco')).toBe(true)
    expect(names1.includes('consultar_produto_comercial')).toBe(true)

    const tools2 = resolveToolScope('Coloca 15 unidades.', [], mockTools, memory)
    const names2 = tools2.map(t => t.name)

    expect(names2.includes('calcular_preco_produto')).toBe(true)
    expect(names2.includes('consultar_produto_comercial')).toBe(true)
  })

  it('8. Expressões de inclusão ("adiciona também 2kg de blend", "coloca mais 5 unidades") preservam ferramentas comerciais necessárias', () => {
    const memoryWithQuote: WorkingMemory = {
      activeQuote: { id: 'ORC-1', total: 50, status: 'draft' }
    }

    const tools = resolveToolScope('Adiciona também 2kg de cobertura blend.', [], mockTools, memoryWithQuote)
    const names = tools.map(t => t.name)

    expect(names.includes('consultar_produto_comercial')).toBe(true)
    expect(names.includes('calcular_preco_produto')).toBe(true)
    expect(names.includes('gerar_orcamento')).toBe(true)
  })

  it('9. "Tira esse" considera o contexto quando existe carrinho ou orçamento ativo', () => {
    const memoryWithCart: WorkingMemory = {
      activeCart: [
        { productId: 'p1', name: 'Item 1', quantity: 1, unitPrice: 20, subtotal: 20, isPriceConfirmed: true }
      ]
    }

    // Com carrinho ativo, mensagem contextual curta "Tira esse" ativa ferramentas de remoção e orçamento
    const toolsWithContext = resolveToolScope('Tira esse', [], mockTools, memoryWithCart)
    const namesWithContext = toolsWithContext.map(t => t.name)

    expect(namesWithContext.includes('gerar_orcamento')).toBe(true)
    expect(namesWithContext.includes('consultar_produto_comercial')).toBe(true)

    // Sem carrinho nem orçamento, "Tira esse" isolado não inventa fluxo de orçamento
    const emptyMemory: WorkingMemory = {}
    const toolsWithoutContext = resolveToolScope('Tira esse', [], mockTools, emptyMemory)
    const namesWithoutContext = toolsWithoutContext.map(t => t.name)

    expect(namesWithoutContext.includes('gerar_orcamento')).toBe(false)
  })

  it('10. Conversas institucionais não recebem ferramentas comerciais sem necessidade', () => {
    const toolsAddress = resolveToolScope('Qual é o endereço de vocês?', [], mockTools)
    expect(toolsAddress.length).toBe(0)

    const toolsPix = resolveToolScope('Vocês aceitam Pix?', [], mockTools)
    expect(toolsPix.length).toBe(0)

    const toolsNF = resolveToolScope('Vocês emitem nota fiscal com CNPJ?', [], mockTools)
    expect(toolsNF.length).toBe(0)

    const toolsDelivery = resolveToolScope('Qual é a política de entrega e o frete?', [], mockTools)
    expect(toolsDelivery.length).toBe(0)
  })

  it('11. Edição de orçamento ("altera meu orçamento", "atualiza o orçamento") mantém disponível a ferramenta de atualização', () => {
    const memoryWithQuote: WorkingMemory = {
      activeQuote: { id: 'ORC-999', total: 200, status: 'draft' }
    }

    const tools = resolveToolScope('Altera meu orçamento, por favor.', [], mockTools, memoryWithQuote)
    const names = tools.map(t => t.name)

    expect(names.includes('gerar_orcamento')).toBe(true)
    expect(names.includes('consultar_orcamento')).toBe(true)
  })

  it('12. Uma simples menção a "mudar" em conversa sem intenção comercial não ativa indevidamente o fluxo de orçamento', () => {
    // "O tempo vai mudar hoje?"
    const tools1 = resolveToolScope('O tempo vai mudar hoje?', [], mockTools)
    expect(tools1.some(t => t.name === 'gerar_orcamento')).toBe(false)

    // "Vou mudar de endereço, vocês entregam no centro?" (institucional com 'mudar')
    const tools2 = resolveToolScope('Vou mudar de endereço, vocês entregam no centro?', [], mockTools)
    expect(tools2.length).toBe(0)

    // "Você tira uma dúvida minha sobre horário?"
    const tools3 = resolveToolScope('Você tira uma dúvida minha sobre horário?', [], mockTools)
    expect(tools3.some(t => t.name === 'gerar_orcamento')).toBe(false)
  })

})

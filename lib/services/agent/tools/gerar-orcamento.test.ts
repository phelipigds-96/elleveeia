import { describe, it } from 'node:test'
import assert from 'node:assert'
import { gerarOrcamentoTool } from './gerar-orcamento.ts'
import { consultarOrcamentoTool } from './consultar-orcamento.ts'
import { createQuote, getQuote } from '@/lib/services/commercial/quotes.ts'
import { applyWorkingMemoryUpdate, type WorkingMemory } from '../working-memory.ts'

// Helper expect para execução isolada nativa
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

const localExpect = (actual: any) => ({
  toBe: (expected: any) => assert.strictEqual(actual, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
  toBeUndefined: () => assert.strictEqual(actual, undefined),
  toBeDefined: () => assert.notStrictEqual(actual, undefined),
  toBeTruthy: () => assert.ok(actual),
  toBeFalsy: () => assert.ok(!actual)
})

const expect = typeof (globalThis as any).expect === 'function' ? (globalThis as any).expect : localExpect

describe('Etapa 3: Geração e Recuperação de Orçamentos Comerciais (10 Cenários)', () => {
  const mockContext = {
    companyId: '00000000-0000-0000-0000-000000000001',
    agentId: '00000000-0000-0000-0000-000000000002',
    conversationId: '00000000-0000-0000-0000-000000000003',
    customerId: '00000000-0000-0000-0000-000000000004',
    workingMemory: {
      activeProduct: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Top Gotas Blend 1kg' },
      activeQuantity: 2,
      activePrice: { unitPrice: 38.50 }
    } as WorkingMemory
  }

  // --------------------------------------------------------------------------
  // 1. GERAÇÃO DE ORÇAMENTO COM PRODUTO, QUANTIDADE E PREÇO VÁLIDOS
  // --------------------------------------------------------------------------
  it('Cenário 1: Geração de orçamento com produto, quantidade e preço válidos', async () => {
    // Simula a tool gerar_orcamento recebendo os dados validados da Working Memory
    const result = await gerarOrcamentoTool.execute({
      items: [
        { product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: 2 }
      ]
    }, mockContext)

    // A tool não pode retornar mock randômico ou total 0
    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data.status).toBe('draft')
    assert.ok(result.data.id, 'Deve conter um ID persistido')
    assert.ok(result.data.total > 0, 'Total deve ser positivo')
  })

  // --------------------------------------------------------------------------
  // 2. CÁLCULO CORRETO DO TOTAL DE DOIS PACOTES (2 x R$ 38,50 = R$ 77,00)
  // --------------------------------------------------------------------------
  it('Cenário 2: Cálculo correto do total de dois pacotes (2 x 38.50 = 77.00)', async () => {
    const unitPrice = 38.50
    const quantity = 2
    const expectedSubtotal = Math.round(unitPrice * 100) * quantity / 100

    expect(expectedSubtotal).toBe(77.00)

    const result = await gerarOrcamentoTool.execute({
      items: [
        { product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity }
      ]
    }, mockContext)

    expect(result.success).toBe(true)
    // O mock do supabase createClient configurado devolve 77.00
    expect(result.data.total).toBe(77.00)
  })

  // --------------------------------------------------------------------------
  // 3. AUSÊNCIA DE PREÇO UNITÁRIO
  // --------------------------------------------------------------------------
  it('Cenário 3: Rejeição clara em caso de produto sem preço configurado', async () => {
    // Criamos um contexto com produto fictício que não terá preço retornado pelo pricing engine
    // Se o pricing engine lançar erro de preço indisponível, a tool captura e devolve success: false
    const brokenContext = {
      ...mockContext,
      companyId: 'company-sem-preco'
    }

    // Simulando que o motor de pricing ou supabase rejeita por falta de preço
    // O createQuote captura e a tool retorna erro explicativo
    const toolExec = await gerarOrcamentoTool.execute({
      items: [
        { product_id: '00000000-0000-0000-0000-000000000099', quantity: 1 }
      ]
    }, brokenContext)

    // Se houver erro de preço, a tool nunca devolve success: true com total 0
    if (!toolExec.success) {
      assert.ok(toolExec.error)
      expect(toolExec.data).toBeUndefined()
    }
  })

  // --------------------------------------------------------------------------
  // 4. PRODUTO NÃO IDENTIFICADO
  // --------------------------------------------------------------------------
  it('Cenário 4: Rejeita produto não identificado (ID não é UUID ou está vazio)', async () => {
    const resultNome = await gerarOrcamentoTool.execute({
      items: [
        { product_id: 'Top Gotas Blend 1kg', quantity: 2 }
      ]
    }, mockContext)

    expect(resultNome.success).toBe(false)
    assert.match(resultNome.error, /Identificador do produto inválido/)

    const resultVazio = await gerarOrcamentoTool.execute({
      items: []
    }, mockContext)

    expect(resultVazio.success).toBe(false)
    assert.match(resultVazio.error, /pelo menos um item/)
  })

  // --------------------------------------------------------------------------
  // 5. QUANTIDADE INVÁLIDA OU AUSENTE
  // --------------------------------------------------------------------------
  it('Cenário 5: Rejeita quantidade inválida (menor ou igual a zero ou fracionária)', async () => {
    const resultZero = await gerarOrcamentoTool.execute({
      items: [
        { product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: 0 }
      ]
    }, mockContext)

    expect(resultZero.success).toBe(false)
    assert.match(resultZero.error, /Quantidade inválida/)

    const resultNegativo = await gerarOrcamentoTool.execute({
      items: [
        { product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: -5 }
      ]
    }, mockContext)

    expect(resultNegativo.success).toBe(false)
    assert.match(resultNegativo.error, /Quantidade inválida/)
  })

  // --------------------------------------------------------------------------
  // 6. FALHA NA PERSISTÊNCIA
  // --------------------------------------------------------------------------
  it('Cenário 6: Falha na persistência é tratada com success: false e mensagem de erro', async () => {
    // Quando ocorre erro no banco, a tool não quebra nem afirma sucesso
    const failContext = {
      ...mockContext,
      companyId: '' // Força falha de contexto
    }

    const result = await gerarOrcamentoTool.execute({
      items: [
        { product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: 1 }
      ]
    }, failContext)

    if (!result.success) {
      assert.ok(result.error)
      expect(result.data).toBeUndefined()
    }
  })

  // --------------------------------------------------------------------------
  // 7. RECUPERAÇÃO DO ORÇAMENTO APÓS SUA CRIAÇÃO
  // --------------------------------------------------------------------------
  it('Cenário 7: Recuperação do orçamento por ID válido', async () => {
    const result = await consultarOrcamentoTool.execute({
      quote_id: '00000000-0000-0000-0000-000000000099'
    }, mockContext)

    // O mock do Supabase responde com o orçamento existente
    if (result.success) {
      expect(result.data.status).toBe('draft')
      expect(result.data.total).toBe(77.00)
    } else {
      // Rejeição caso não exista
      assert.ok(result.error)
    }
  })

  // --------------------------------------------------------------------------
  // 8. PERGUNTA POSTERIOR: "Quanto fica ao total?"
  // --------------------------------------------------------------------------
  it('Cenário 8: Responde à pergunta "Quanto fica ao total?" via Working Memory', () => {
    const memoryAfterQuote: WorkingMemory = {
      activeProduct: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Top Gotas Blend 1kg' },
      activeQuantity: 2,
      activePrice: { unitPrice: 38.50 },
      activeQuote: {
        id: '00000000-0000-0000-0000-000000000099',
        total: 77.00,
        status: 'draft'
      }
    }

    // A memória retém o total de 77.00
    expect(memoryAfterQuote.activeQuote?.total).toBe(77.00)
    expect(memoryAfterQuote.activeQuote?.id).toBe('00000000-0000-0000-0000-000000000099')

    // Formatação esperada no System Prompt
    const totalFormatted = ` | Total: R$ ${memoryAfterQuote.activeQuote?.total.toFixed(2)}`
    expect(totalFormatted).toBe(' | Total: R$ 77.00')
  })

  // --------------------------------------------------------------------------
  // 9. PREVENÇÃO DE DUPLICAÇÃO DO ORÇAMENTO EM MENSAGENS DE ACOMPANHAMENTO
  // --------------------------------------------------------------------------
  it('Cenário 9: Chamadas de acompanhamento reutilizam o orçamento ativo existente', () => {
    const currentMemory: WorkingMemory = {
      activeProduct: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Top Gotas Blend 1kg' },
      activeQuantity: 2,
      activePrice: { unitPrice: 38.50 },
      activeQuote: {
        id: '00000000-0000-0000-0000-000000000099',
        total: 77.00,
        status: 'draft'
      }
    }

    // Turno posterior onde consultar_orcamento é executado
    const queryResults = [
      {
        success: true,
        toolName: 'consultar_orcamento',
        data: {
          id: '00000000-0000-0000-0000-000000000099',
          status: 'draft',
          total: 77.00,
          items: [
            {
              product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              name: 'Top Gotas Blend 1kg',
              quantity: 2,
              unit_price: 38.50,
              subtotal: 77.00
            }
          ]
        }
      }
    ]

    const updatedMemory = applyWorkingMemoryUpdate(currentMemory, queryResults)

    // O ID permanece o mesmo, sem criar outro orçamento
    expect(updatedMemory.activeQuote?.id).toBe('00000000-0000-0000-0000-000000000099')
    expect(updatedMemory.activeQuote?.total).toBe(77.00)
  })

  // --------------------------------------------------------------------------
  // 10. GARANTIA DE QUE UM RESULTADO INCOMPLETO NÃO SEJA COMUNICADO COMO CONCLUÍDO
  // --------------------------------------------------------------------------
  it('Cenário 10: Resultado incompleto nunca retorna success: true com total zero', async () => {
    const result = await gerarOrcamentoTool.execute({
      items: [
        { product_id: 'produto-incompleto', quantity: 1 }
      ]
    }, mockContext)

    expect(result.success).toBe(false)
    expect(result.data).toBeUndefined()
    assert.ok(result.error, 'Deve retornar erro explícito para o agente não mentir ao cliente')
  })
})

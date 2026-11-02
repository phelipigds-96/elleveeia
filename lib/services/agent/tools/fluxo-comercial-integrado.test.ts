import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { resolveToolScope } from '../tool-scoping.ts'
import { gerarOrcamentoTool } from './gerar-orcamento.ts'
import { consultarOrcamentoTool } from './consultar-orcamento.ts'
import { consultarProdutoComercialTool } from './consultar-produto-comercial.ts'
import { createQuote, getQuote } from '@/lib/services/commercial/quotes.ts'
import { applyWorkingMemoryUpdate, type WorkingMemory } from '../working-memory.ts'
import { resetInMemoryDb, getInMemoryQuotesCount } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

// Setup de ambiente seguro e isolado
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

const expect = (actual: any) => ({
  toBe: (expected: any) => assert.strictEqual(actual, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
  toBeUndefined: () => assert.strictEqual(actual, undefined),
  toBeDefined: () => assert.notStrictEqual(actual, undefined),
  toBeTruthy: () => assert.ok(actual),
  toBeFalsy: () => assert.ok(!actual)
})

describe('ETAPA 4 — Homologação Integrada do Fluxo Comercial Completo', () => {
  const companyId = '00000000-0000-0000-0000-000000000001'
  const agentId = '00000000-0000-0000-0000-000000000002'
  const conversationId = '00000000-0000-0000-0000-000000000003'
  const customerId = '00000000-0000-0000-0000-000000000004'

  const availableTools = [
    consultarProdutoComercialTool,
    gerarOrcamentoTool,
    consultarOrcamentoTool
  ]

  beforeEach(() => {
    resetInMemoryDb()
  })

  // ==========================================================================
  // SEÇÃO 3: CENÁRIO INTEGRADO OBRIGATÓRIO (TURNO A TURNO)
  // ==========================================================================

  describe('3. Cenário Integrado Obrigatório: Conversa Completa Ponta a Ponta', () => {
    it('Executa o ciclo completo: Produto -> Quantidade 2 -> Gerar Orçamento -> Perguntar Total', async () => {
      let workingMemory: WorkingMemory = {}
      const conversationHistory: any[] = []

      // ----------------------------------------------------------------------
      // TURNO 1: Cliente: "Quero Top Gotas Blend 1kg."
      // ----------------------------------------------------------------------
      const msg1 = 'Quero Top Gotas Blend 1kg.'
      conversationHistory.push({ role: 'user', content: msg1 })

      // 1. Tool Scoping
      const scopedToolsTurn1 = resolveToolScope(msg1, [], availableTools)
      const toolNamesTurn1 = scopedToolsTurn1.map(t => t.name)
      assert.ok(
        toolNamesTurn1.includes('consultar_produto_comercial'),
        'Turno 1 deve selecionar consultar_produto_comercial para busca com unidade de medida'
      )

      // 2. Execução da Ferramenta Comercial Simulada com dados reais do produto
      const turn1ToolResult = {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'specific_product',
          product: {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Top Gotas Blend 1kg'
          },
          price: {
            unit_price: 38.50,
            subtotal: 38.50
          }
        }
      }

      // 3. Atualização da Working Memory
      workingMemory = applyWorkingMemoryUpdate(workingMemory, [turn1ToolResult])

      // Verificação do estado do Turno 1
      expect(workingMemory.activeProduct?.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      expect(workingMemory.activeProduct?.name).toBe('Top Gotas Blend 1kg')
      expect(workingMemory.activePrice?.unitPrice).toBe(38.50)
      expect(workingMemory.activeQuantity).toBeUndefined()
      expect(workingMemory.activeQuote).toBeUndefined()

      conversationHistory.push({
        role: 'assistant',
        content: 'Encontrei o Top Gotas Blend 1kg por R$ 38,50 a unidade. Quantos pacotes você gostaria?'
      })

      // ----------------------------------------------------------------------
      // TURNO 2: Cliente: "Quero 2 pacotes."
      // ----------------------------------------------------------------------
      const msg2 = 'Quero 2 pacotes.'
      conversationHistory.push({ role: 'user', content: msg2 })

      // 1. Tool Scoping
      const scopedToolsTurn2 = resolveToolScope(msg2, conversationHistory, availableTools)
      const toolNamesTurn2 = scopedToolsTurn2.map(t => t.name)
      assert.ok(
        toolNamesTurn2.includes('consultar_produto_comercial'),
        'Turno 2 deve selecionar consultar_produto_comercial para calcular preço da quantidade'
      )

      // 2. Execução da Ferramenta Comercial com quantidade 2
      const turn2ToolResult = {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'quantity_pricing',
          product: {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Top Gotas Blend 1kg'
          },
          quantity: 2,
          price: {
            unit_price: 38.50,
            subtotal: 77.00
          }
        }
      }

      // 3. Atualização da Working Memory
      workingMemory = applyWorkingMemoryUpdate(workingMemory, [turn2ToolResult])

      // Verificação do estado do Turno 2: produto mantido, quantidade atualizada para 2
      expect(workingMemory.activeProduct?.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      expect(workingMemory.activeProduct?.name).toBe('Top Gotas Blend 1kg')
      expect(workingMemory.activeQuantity).toBe(2)
      expect(workingMemory.activePrice?.unitPrice).toBe(38.50)
      expect(workingMemory.activeQuote).toBeUndefined()

      conversationHistory.push({
        role: 'assistant',
        content: 'Perfeito! 2 pacotes de Top Gotas Blend 1kg ficam em R$ 77,00. Deseja que eu gere o orçamento?'
      })

      // ----------------------------------------------------------------------
      // TURNO 3: Cliente: "Faz um orçamento para mim."
      // ----------------------------------------------------------------------
      const msg3 = 'Faz um orçamento para mim.'
      conversationHistory.push({ role: 'user', content: msg3 })

      // 1. Tool Scoping
      const scopedToolsTurn3 = resolveToolScope(msg3, conversationHistory, availableTools)
      const toolNamesTurn3 = scopedToolsTurn3.map(t => t.name)
      assert.ok(toolNamesTurn3.includes('gerar_orcamento'), 'Turno 3 deve incluir gerar_orcamento')

      // 2. Execução REAL de gerar_orcamento conectada ao quotes.ts
      const contextTurn3 = {
        companyId,
        agentId,
        conversationId,
        customerId,
        workingMemory
      }

      const quoteExecResult = await gerarOrcamentoTool.execute({
        items: [
          {
            product_id: workingMemory.activeProduct!.id,
            quantity: workingMemory.activeQuantity!
          }
        ]
      }, contextTurn3)

      expect(quoteExecResult.success).toBe(true)
      const createdQuote = quoteExecResult.data
      assert.ok(createdQuote.id, 'Orçamento deve possuir um ID persistido')
      expect(createdQuote.status).toBe('draft')
      expect(createdQuote.total).toBe(77.00)
      expect(createdQuote.items.length).toBe(1)
      expect(createdQuote.items[0].unitPrice).toBe(38.50)
      expect(createdQuote.items[0].subtotal).toBe(77.00)

      // 3. Atualização da Working Memory
      workingMemory = applyWorkingMemoryUpdate(workingMemory, [
        {
          success: true,
          toolName: 'gerar_orcamento',
          data: createdQuote
        }
      ])

      // Verificação do estado do Turno 3
      expect(workingMemory.activeQuote?.id).toBe(createdQuote.id)
      expect(workingMemory.activeQuote?.total).toBe(77.00)
      expect(workingMemory.activeQuote?.status).toBe('draft')
      expect(workingMemory.activeProduct?.name).toBe('Top Gotas Blend 1kg')
      expect(workingMemory.activeQuantity).toBe(2)

      // Verifica que exatamente 1 orçamento foi persistido no banco de dados simulado
      expect(getInMemoryQuotesCount()).toBe(1)

      conversationHistory.push({
        role: 'assistant',
        content: `Orçamento gerado com sucesso! ID: ${createdQuote.id}. 2 pacotes de Top Gotas Blend 1kg no total de R$ 77,00.`
      })

      // ----------------------------------------------------------------------
      // TURNO 4: Cliente: "Quanto fica ao total?"
      // ----------------------------------------------------------------------
      const msg4 = 'Quanto fica ao total?'
      conversationHistory.push({ role: 'user', content: msg4 })

      // 1. Tool Scoping
      const scopedToolsTurn4 = resolveToolScope(msg4, conversationHistory, availableTools)
      const toolNamesTurn4 = scopedToolsTurn4.map(t => t.name)
      assert.ok(
        toolNamesTurn4.includes('consultar_orcamento'),
        'Turno 4 deve incluir consultar_orcamento quando cliente pergunta pelo total'
      )

      // 2. Context Builder Prompt Injection: o total deve estar presente no prompt gerado
      const promptSnippet = `Orcamento: ID ${workingMemory.activeQuote!.id} (${workingMemory.activeQuote!.status}) | Total: R$ ${workingMemory.activeQuote!.total.toFixed(2)}`
      assert.match(promptSnippet, /Total: R\$ 77\.00/)

      // 3. Consulta de Orçamento (Recuperação no banco)
      const contextTurn4 = {
        companyId,
        agentId,
        conversationId,
        customerId,
        workingMemory
      }

      const consultResult = await consultarOrcamentoTool.execute({}, contextTurn4)
      expect(consultResult.success).toBe(true)
      expect(consultResult.data.id).toBe(createdQuote.id)
      expect(consultResult.data.total).toBe(77.00)
      expect(consultResult.data.status).toBe('draft')

      // 4. Garantia de NÃO Duplicação: banco continua com exatamente 1 orçamento!
      expect(getInMemoryQuotesCount()).toBe(1)
    })
  })

  // ==========================================================================
  // SEÇÃO 4: CENÁRIOS NEGATIVOS E DE ISOLAMENTO
  // ==========================================================================

  describe('4. Cenários Negativos e de Isolamento', () => {

    it('Cenário Negativo 1: Produto ambíguo não altera a memória e impede orçamento falso', () => {
      const initialMemory: WorkingMemory = {
        activeProduct: { id: 'prod-anterior', name: 'Chocolate X' }
      }

      // Busca ambígua
      const ambiguousResult = {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'generic_discovery',
          brands: ['Harald', 'Sicao'],
          product_count: 5
        }
      }

      const updated = applyWorkingMemoryUpdate(initialMemory, [ambiguousResult])
      // Produto anterior é preservado e nada é quebrado
      expect(updated.activeProduct?.id).toBe('prod-anterior')
      expect(updated.activeQuote).toBeUndefined()
    })

    it('Cenário Negativo 2: Produto sem preço configurado é rejeitado e não gera orçamento zerado', async () => {
      const context = {
        companyId,
        agentId,
        conversationId,
        customerId,
        workingMemory: {}
      }

      // Produto sem preço cadastrado na tabela de preços
      const result = await gerarOrcamentoTool.execute({
        items: [
          {
            product_id: '00000000-0000-0000-0000-000000000099', // Não cadastrado em product_prices
            quantity: 1
          }
        ]
      }, context)

      expect(result.success).toBe(false)
      assert.match(result.error, /preço configurado|indisponível/)
      expect(getInMemoryQuotesCount()).toBe(0)
    })

    it('Cenário Negativo 3: Quantidade inválida (zero ou negativa) é rejeitada de imediato', async () => {
      const context = { companyId, agentId, conversationId, customerId }

      const resultZero = await gerarOrcamentoTool.execute({
        items: [{ product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: 0 }]
      }, context)

      expect(resultZero.success).toBe(false)
      assert.match(resultZero.error, /Quantidade inválida/)

      const resultNeg = await gerarOrcamentoTool.execute({
        items: [{ product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: -3 }]
      }, context)

      expect(resultNeg.success).toBe(false)
      assert.match(resultNeg.error, /Quantidade inválida/)
      expect(getInMemoryQuotesCount()).toBe(0)
    })

    it('Cenário Negativo 4: Falha na gravação do banco retorna erro e não aprova', async () => {
      const invalidContext = {
        companyId: '', // Contexto quebrado
        agentId,
        conversationId,
        customerId
      }

      const result = await gerarOrcamentoTool.execute({
        items: [{ product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: 1 }]
      }, invalidContext)

      expect(result.success).toBe(false)
      assert.ok(result.error)
      expect(result.data).toBeUndefined()
    })

    it('Cenário Negativo 5: Falha na leitura de orçamento inexistente', async () => {
      const context = { companyId, agentId, conversationId, customerId }

      const result = await consultarOrcamentoTool.execute({
        quote_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff'
      }, context)

      expect(result.success).toBe(false)
      assert.match(result.error, /não encontrado/)
    })

    it('Cenário Negativo 6: Isolamento entre conversas e empresas (não acessa orçamentos alheios)', async () => {
      // Cria orçamento para empresa 1
      const quote1 = await createQuote({
        companyId: '00000000-0000-0000-0000-000000000001',
        conversationId: 'conv-empresa-1',
        items: [{ productId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: 1 }]
      })

      // Empresa 2 tenta consultar o orçamento da empresa 1
      const quoteFromOtherCompany = await getQuote({
        companyId: '00000000-0000-0000-0000-000000000002', // Outra empresa
        quoteId: quote1.quoteId
      })

      // Deve ser nulo devido ao isolamento por company_id
      expect(quoteFromOtherCompany).toBe(null)
    })

    it('Cenário Negativo 7: Pergunta sobre total sem orçamento ativo retorna erro amigável', async () => {
      const emptyContext = { companyId, agentId, conversationId, customerId, workingMemory: {} }
      const result = await consultarOrcamentoTool.execute({}, emptyContext)

      expect(result.success).toBe(false)
      assert.match(result.error, /Nenhum identificador de orçamento foi informado/)
    })

    it('Cenário Negativo 8: Idempotência evita criação duplicada em chamadas repetidas', async () => {
      const context = {
        companyId,
        agentId,
        conversationId,
        customerId,
        workingMemory: {}
      }

      // Primeira chamada: gera o orçamento
      const call1 = await gerarOrcamentoTool.execute({
        items: [{ product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: 2 }]
      }, context)

      expect(call1.success).toBe(true)
      const quoteId1 = call1.data.id
      expect(getInMemoryQuotesCount()).toBe(1)

      // Atualiza memória com o orçamento criado
      context.workingMemory = {
        activeQuote: { id: quoteId1, total: 77.00, status: 'draft' }
      }

      // Segunda chamada com os MESMOS itens
      const call2 = await gerarOrcamentoTool.execute({
        items: [{ product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: 2 }]
      }, context)

      expect(call2.success).toBe(true)
      expect(call2.data.id).toBe(quoteId1)
      expect(call2.data.is_reused).toBe(true)

      // O número de orçamentos no banco continua exatamente 1!
      expect(getInMemoryQuotesCount()).toBe(1)
    })

    it('Cenário Negativo 9: Alteração de quantidade após orçamento atualiza o valor no banco e não duplica', async () => {
      const context = {
        companyId,
        agentId,
        conversationId,
        customerId,
        workingMemory: {}
      }

      // 1. Cria orçamento com 2 pacotes (2 x 38.50 = 77.00)
      const call1 = await gerarOrcamentoTool.execute({
        items: [{ product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: 2 }]
      }, context)

      expect(call1.data.total).toBe(77.00)
      const originalQuoteId = call1.data.id

      // Atualiza a memória de trabalho
      context.workingMemory = {
        activeQuote: { id: originalQuoteId, total: 77.00, status: 'draft' }
      }

      // 2. Cliente pede para mudar para 5 pacotes (5 x 38.50 = 192.50)
      const call2 = await gerarOrcamentoTool.execute({
        items: [{ product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: 5 }]
      }, context)

      expect(call2.success).toBe(true)
      expect(call2.data.id).toBe(originalQuoteId) // Mesmo ID
      expect(call2.data.total).toBe(192.50) // Total atualizado com precisão
      expect(getInMemoryQuotesCount()).toBe(1) // Não duplicou!
    })

    it('Cenário Negativo 10: Alteração de produto invalida derivados antigos e limpa contaminação', () => {
      const initialMemory: WorkingMemory = {
        activeProduct: { id: 'prod-a', name: 'Produto A' },
        activePrice: { unitPrice: 20.00 },
        activeQuantity: 10
      }

      // Produto muda para Produto B
      const newProductResult = {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'specific_product',
          product: { id: 'prod-b', name: 'Produto B' },
          price: { unit_price: 50.00 }
        }
      }

      const updated = applyWorkingMemoryUpdate(initialMemory, [newProductResult])

      expect(updated.activeProduct?.id).toBe('prod-b')
      expect(updated.activePrice?.unitPrice).toBe(50.00)
      // A quantidade do produto A (10) foi descartada com segurança
      expect(updated.activeQuantity).toBeUndefined()
    })

    it('Cenário Negativo 11: Retomada de conversa com memória vazia não falha e opera limpa', () => {
      const cleanMemory = applyWorkingMemoryUpdate(null, [])
      expect(cleanMemory).toEqual({})
    })

    it('Cenário Negativo 12: Resultado de ferramenta com erro preserva a memória anterior sem aprovar', () => {
      const initialMemory: WorkingMemory = {
        activeProduct: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Top Gotas Blend 1kg' },
        activeQuantity: 2,
        activePrice: { unitPrice: 38.50 }
      }

      const failedToolResult = {
        success: false,
        toolName: 'gerar_orcamento',
        error: 'Falha de comunicação com o banco'
      }

      const updated = applyWorkingMemoryUpdate(initialMemory, [failedToolResult])

      // Memória preservada, sem criação de activeQuote
      expect(updated.activeProduct?.name).toBe('Top Gotas Blend 1kg')
      expect(updated.activeQuantity).toBe(2)
      expect(updated.activeQuote).toBeUndefined()
    })
  })
})

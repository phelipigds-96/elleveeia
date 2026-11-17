import test from 'node:test'
import assert from 'node:assert/strict'
import { parseQuery, calculateMatchScore } from '@/lib/services/catalog/search-logic'
import { 
  extractWeightInKg, 
  resolveReferenceQuery, 
  applyCommercialStrategy 
} from '@/lib/services/agent/commercial-strategy'
import { 
  hasClearProductIntent, 
  resolveToolScope, 
  isUndecidedHelpIntent 
} from '@/lib/services/agent/tool-scoping'

test('AC-02 Cenário 1: "200 doces" NÃO é interpretado como peso de 200g', () => {
  const query = 'vou fazer 200 doces para festa quanto custa leite condensado tirol'
  const parsed = parseQuery(query)

  // Deve extrair a contagem da receita sem poluir o peso unitário
  assert.equal(parsed.targetCount, 200)
  assert.equal(parsed.targetCountUnit, 'doces')

  // O peso de 200g NÃO deve ter sido atribuído aos tokens específicos do produto
  const weightVariants = parsed.tokenGroups.flatMap(g => g.variants)
  assert.ok(
    !weightVariants.includes('200g'),
    `Esperado que '200g' não estivesse nos tokens do produto, mas encontrado: ${weightVariants.join(', ')}`
  )
})

test('AC-02 Cenário 2: "Outra marca" recupera contexto anterior e exclui marca anterior', () => {
  const workingMemory = {
    activeProduct: {
      id: 'prod-leite-moca-1',
      name: 'LEITE CONDENSADO MOCA 395G NESTLE'
    },
    discoveredProducts: [
      { id: 'prod-leite-moca-1', name: 'LEITE CONDENSADO MOCA 395G NESTLE' }
    ]
  }

  const res = resolveReferenceQuery('quero a mesma coisa de outra marca', workingMemory)

  assert.equal(res.isAnaphoric, true)
  assert.equal(res.isAmbiguous, false)
  assert.equal(res.isDifferentBrandRequest, true)
  assert.equal(res.excludeBrand?.toLowerCase(), 'moca')
  assert.ok(res.resolvedQuery.includes('leite condensado'))
})

test('AC-02 Cenário 3: Referência ordinal "aquele primeiro" identifica opção 1 do buffer recente', () => {
  const workingMemory = {
    discoveredProducts: [
      { id: 'uuid-italac-1', name: 'LEITE CONDENSADO SEMIDESNATADO ITALAC 395G', unitPrice: 5.69 },
      { id: 'uuid-tirol-2', name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G', unitPrice: 5.49 },
      { id: 'uuid-triangulo-3', name: 'LEITE CONDENSADO SEMIDESNATADO TRIANGULO 395G', unitPrice: 5.29 }
    ]
  }

  const res1 = resolveReferenceQuery('quanto custa aquele primeiro?', workingMemory)
  assert.equal(res1.isAnaphoric, true)
  assert.equal(res1.isAmbiguous, false)
  assert.equal(res1.targetOrdinalIndex, 0)
  assert.equal(res1.resolvedProduct?.id, 'uuid-italac-1')
  assert.equal(res1.resolvedProduct?.name, 'LEITE CONDENSADO SEMIDESNATADO ITALAC 395G')

  const res2 = resolveReferenceQuery('me vê o segundo', workingMemory)
  assert.equal(res2.isAnaphoric, true)
  assert.equal(res2.targetOrdinalIndex, 1)
  assert.equal(res2.resolvedProduct?.id, 'uuid-tirol-2')

  const resLast = resolveReferenceQuery('qual o preço do último?', workingMemory)
  assert.equal(resLast.isAnaphoric, true)
  assert.equal(resLast.targetOrdinalIndex, 2)
  assert.equal(resLast.resolvedProduct?.id, 'uuid-triangulo-3')
})

test('AC-02 Cenário 4: Referência múltipla "dois desse e três do outro" desambigua com clareza', () => {
  // Caso A: Exatamente 2 produtos em tela -> Associação unívoca
  const wmTwo = {
    discoveredProducts: [
      { id: 'uuid-sicao-1', name: 'COBERTURA FRACIONADA AO LEITE SICAO MAIS 1KG' },
      { id: 'uuid-sicao-2', name: 'COBERTURA FRACIONADA BRANCA SICAO MAIS 1KG' }
    ]
  }
  const resTwo = resolveReferenceQuery('quero dois desse e três do outro', wmTwo)
  assert.equal(resTwo.isAnaphoric, true)
  assert.equal(resTwo.isAmbiguous, false)
  assert.equal(resTwo.candidateOptions?.length, 2)
  assert.equal(resTwo.candidateOptions[0].quantity, 2)
  assert.equal(resTwo.candidateOptions[1].quantity, 3)

  // Caso B: Mais de 2 produtos em tela -> Gera desambiguação consultiva amigável
  const wmThree = {
    discoveredProducts: [
      { id: 'uuid-1', name: 'CHOCOLATE AO LEITE 1KG' },
      { id: 'uuid-2', name: 'CHOCOLATE MEIO AMARGO 1KG' },
      { id: 'uuid-3', name: 'CHOCOLATE BRANCO 1KG' }
    ]
  }
  const resThree = resolveReferenceQuery('quero dois desse e três do outro', wmThree)
  assert.equal(resThree.isAnaphoric, true)
  assert.equal(resThree.isAmbiguous, true)
  assert.ok(resThree.ambiguityMessage?.includes('Apresentamos 3 opções'))
})

test('AC-02 Cenário 5: "Chocolate para casquinha de ovo" pontua cobertura fracionada e orienta aplicação', () => {
  const query = 'chocolate para casquinha de ovo de pascoa'
  const parsed = parseQuery(query)

  assert.equal(parsed.applicationNeed, 'casquinha')

  // Testa o cálculo de match score para cobertura fracionada
  const scoreResult = calculateMatchScore(
    'COBERTURA FRACIONADA EM BARRA AO LEITE SICAO MAIS 1.01KG',
    'Sicao',
    'Coberturas',
    parsed
  )

  assert.ok(scoreResult.score > 20, `Score esperado > 20, obtido: ${scoreResult.score}`)
  assert.ok(scoreResult.confidence >= 0.8, `Confidence esperada >= 0.8, obtido: ${scoreResult.confidence}`)

  // Testa payload da estratégia com guidance de casquinha
  const mockSearch = {
    status: 'ambiguous' as const,
    confidence: 0.85,
    matches: [
      {
        id: 'sicao-1',
        name: 'COBERTURA FRACIONADA AO LEITE SICAO MAIS 1.01KG',
        sku: '123',
        barcode: null,
        brand: 'Sicao',
        category: 'Coberturas',
        unit: 'UN',
        active: true
      }
    ]
  }

  const payload = applyCommercialStrategy(query, mockSearch, 1, undefined, undefined, undefined, parsed)
  assert.equal(payload.application_guidance, 'casquinha_de_ovo')
  assert.ok(payload.consultative_hint.includes('ORIENTAÇÃO TÉCNICA (CASQUINHA / MOLDAGEM)'))
})

test('AC-02 Cenário 6: Dúvidas conceituais/técnicas mantêm ferramentas de catálogo e escopo operacional', () => {
  const techQuery = 'Qual a diferença entre chocolate nobre e cobertura fracionada?'
  const mockTools: any[] = [
    { name: 'consultar_produto_comercial', metadata: { category: 'commercial' } },
    { name: 'buscar_produto', metadata: { category: 'commercial' } },
    { name: 'salvar_nome_cliente', metadata: { category: 'customer' } }
  ]

  // Mesmo no primeiro turno (histórico vazio), a ferramenta de consulta de catálogo deve ser mantida
  const scoped = resolveToolScope(techQuery, [], mockTools)
  const scopedNames = scoped.map(t => t.name)

  assert.ok(
    scopedNames.includes('consultar_produto_comercial'),
    `Esperado consultar_produto_comercial no escopo para dúvida técnica, mas obtido: ${scopedNames.join(', ')}`
  )
})

test('AC-02 Cenário 7: "Qual compensa mais" calcula determinística e corretamente R$/kg de custo-benefício', () => {
  const query = 'qual compensa mais a barra de 1kg ou de 2kg de chocolate sicao?'
  const parsed = parseQuery(query)

  assert.equal(parsed.isCostBenefitQuery, true)

  const mockMatches = [
    { id: 'sicao-1kg', name: 'BARRA CHOCOLATE AO LEITE SICAO 1.01KG', brand: 'Sicao', sku: '1', barcode: null, category: null, unit: 'UN', active: true },
    { id: 'sicao-2kg', name: 'BARRA CHOCOLATE AO LEITE SICAO 2.05KG', brand: 'Sicao', sku: '2', barcode: null, category: null, unit: 'UN', active: true }
  ]
  const mockSearch = {
    status: 'ambiguous' as const,
    confidence: 0.9,
    matches: mockMatches
  }
  const candidatePrices = new Map([
    ['sicao-1kg', { unit_price: 44.90, subtotal: 44.90 }], // 44.90 / 1.01 = ~44.45/kg
    ['sicao-2kg', { unit_price: 79.90, subtotal: 79.90 }]  // 79.90 / 2.05 = ~38.97/kg (Mais econômico!)
  ])

  const payload = applyCommercialStrategy(query, mockSearch, 1, undefined, candidatePrices, undefined, parsed)

  assert.ok(payload.cost_benefit_analysis, 'Esperado cost_benefit_analysis presente')
  assert.equal(payload.best_cost_benefit?.id, 'sicao-2kg')
  assert.equal(payload.best_cost_benefit?.formatted_price_per_kg, 'R$ 38,98/kg')
  assert.ok(payload.consultative_hint.includes('ANÁLISE DE CUSTO-BENEFÍCIO (R$/KG)'))
})

test('AC-02 Cenário 8: "O mais barato" identifica a opção com menor preço unitário', () => {
  const query = 'qual o leite condensado mais barato?'
  const parsed = parseQuery(query)

  assert.equal(parsed.isCheapestQuery, true)

  const mockMatches = [
    { id: 'moca', name: 'LEITE CONDENSADO MOCA 395G', brand: 'Nestle', sku: '1', barcode: null, category: null, unit: 'UN', active: true },
    { id: 'tirol', name: 'LEITE CONDENSADO TIROL 395G', brand: 'Tirol', sku: '2', barcode: null, category: null, unit: 'UN', active: true },
    { id: 'italac', name: 'LEITE CONDENSADO ITALAC 395G', brand: 'Italac', sku: '3', barcode: null, category: null, unit: 'UN', active: true }
  ]
  const mockSearch = {
    status: 'ambiguous' as const,
    confidence: 0.9,
    matches: mockMatches
  }
  const candidatePrices = new Map([
    ['moca', { unit_price: 8.99, subtotal: 8.99 }],
    ['tirol', { unit_price: 5.29, subtotal: 5.29 }],
    ['italac', { unit_price: 5.69, subtotal: 5.69 }]
  ])

  const payload = applyCommercialStrategy(query, mockSearch, 1, undefined, candidatePrices, undefined, parsed)

  assert.ok(payload.cheapest_option, 'Esperado cheapest_option no payload')
  assert.equal(payload.cheapest_option.id, 'tirol')
  assert.equal(payload.cheapest_option.price.unit_price, 5.29)
  assert.ok(payload.consultative_hint.includes('OPÇÃO MAIS ECONÔMICA'))
})

test('AC-02 Cenário 9: "Não sei qual comprar" preserva a resposta conversacional e não força busca cega', () => {
  const undecidedMessage = 'não sei qual produto comprar, pode me ajudar?'

  assert.equal(isUndecidedHelpIntent(undecidedMessage), true)

  // hasClearProductIntent deve retornar false para evitar que o engine force busca por "não sei qual comprar"
  const clearIntent = hasClearProductIntent(undecidedMessage)
  assert.equal(
    clearIntent, 
    false, 
    'hasClearProductIntent deve retornar false para pedido aberto de ajuda'
  )
})

test('AC-02 Cenário 10: Busca direta por produto específico continua com exatidão e sem regressão', () => {
  const directQuery = 'leite condensado semidesnatado tirol 395g'
  const parsed = parseQuery(directQuery)

  assert.ok(parsed.significantTokens.includes('tirol'))
  assert.equal(parsed.weight, 395)
  assert.equal(hasClearProductIntent(directQuery), true)

  const matchScore = calculateMatchScore(
    'LEITE CONDENSADO SEMIDESNATADO TIROL 395G',
    'Tirol',
    'Laticínios',
    parsed
  )
  assert.ok(matchScore.score >= 50, `Score esperado alto para match exato, obtido: ${matchScore.score}`)
  assert.equal(matchScore.confidence, 1.0)
})

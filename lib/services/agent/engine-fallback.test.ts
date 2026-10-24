import { ToolDefinition } from './tools'
import { resolveToolScope, hasClearProductIntent } from './tool-scoping'

interface FallbackParams {
  userMessage?: string
  scopedTools: Array<{ name: string }>
  llmResponse: { content: string | null; tool_calls?: any[] }
  iteration?: number
}

/**
 * Função pura que simula a decisão de Fallback do Agent Engine no round 1
 * exatamente como implementado em engine.ts:
 */
export function evaluateEngineRound1Fallback(params: FallbackParams) {
  const { userMessage, scopedTools, llmResponse, iteration = 1 } = params
  const response = { ...llmResponse, tool_calls: llmResponse.tool_calls ? [...llmResponse.tool_calls] : [] }

  if (
    iteration === 1 && 
    (!response.tool_calls || response.tool_calls.length === 0) &&
    hasClearProductIntent(userMessage)
  ) {
    const catalogTool = scopedTools.find(t => t.name === 'consultar_produto_comercial' || t.name === 'buscar_produto')
    if (catalogTool) {
      response.tool_calls = [{
        callId: 'fallback_catalog_1',
        toolName: catalogTool.name,
        arguments: catalogTool.name === 'consultar_produto_comercial' 
          ? { product_query: userMessage || '' } 
          : { query: userMessage || '' }
      }]
      response.content = null // Anula texto alucinado apenas quando a intenção de produto era explícita
    }
  }

  return response
}

describe('Agent Engine - Deterministic Fallback & Scoping Guardrails', () => {
  const mockTools = [
    { name: 'get_current_datetime', description: '', schema: {} as any, metadata: { category: 'datetime' }, execute: async () => {} },
    { name: 'buscar_produto', description: '', schema: {} as any, metadata: { category: 'catalog' }, execute: async () => {} },
    { name: 'consultar_preco', description: '', schema: {} as any, metadata: { category: 'pricing' }, execute: async () => {} },
    { name: 'calcular_preco_produto', description: '', schema: {} as any, metadata: { category: 'pricing' }, execute: async () => {} },
    { name: 'consultar_produto_comercial', description: '', schema: {} as any, metadata: { category: 'commercial' }, execute: async () => {} },
    { name: 'gerar_orcamento', description: '', schema: {} as any, metadata: { category: 'quotes' }, execute: async () => {} },
  ]

  it('Cenário 1: "Obrigado, era isso." não apaga texto e não dispara fallback', () => {
    const msg = 'Obrigado, era isso.'
    const scoped = resolveToolScope(msg, [], mockTools)
    expect(scoped).toHaveLength(0)

    const result = evaluateEngineRound1Fallback({
      userMessage: msg,
      scopedTools: scoped,
      llmResponse: { content: 'Por nada! Até logo.', tool_calls: [] }
    })

    expect(result.content).toBe('Por nada! Até logo.')
    expect(result.tool_calls).toHaveLength(0)
  })

  it('Cenário 1b: "Vocês aceitam Pix?" preserva resposta institucional e não busca produto', () => {
    const msg = 'Vocês aceitam Pix?'
    const scoped = resolveToolScope(msg, [], mockTools)
    expect(scoped).toHaveLength(0)

    const result = evaluateEngineRound1Fallback({
      userMessage: msg,
      scopedTools: scoped,
      llmResponse: { content: 'Sim, aceitamos Pix e cartão.', tool_calls: [] }
    })

    expect(result.content).toBe('Sim, aceitamos Pix e cartão.')
    expect(result.tool_calls).toHaveLength(0)
  })

  it('Cenário 2: "Vocês aceitam Pix e quanto custa o produto?" escopa comercial e ativa intenção clara', () => {
    const msg = 'Vocês aceitam Pix e quanto custa o produto?'
    const scoped = resolveToolScope(msg, [], mockTools)
    expect(scoped.map(t => t.name)).toEqual(['consultar_produto_comercial'])
    expect(hasClearProductIntent(msg)).toBe(true)

    const result = evaluateEngineRound1Fallback({
      userMessage: msg,
      scopedTools: scoped,
      llmResponse: { 
        content: null, 
        tool_calls: [{ callId: 'call_pix_1', toolName: 'consultar_produto_comercial', arguments: { product_query: msg } }] 
      }
    })

    expect(result.tool_calls).toHaveLength(1)
    expect(result.tool_calls![0].toolName).toBe('consultar_produto_comercial')
  })

  it('Cenário 3: "Quanto custa o chocolate Sicao com entrega?" não deixa entrega suprimir preço', () => {
    const msg = 'Quanto custa o chocolate Sicao com entrega?'
    const scoped = resolveToolScope(msg, [], mockTools)
    expect(scoped.map(t => t.name)).toEqual(['consultar_produto_comercial'])
    expect(hasClearProductIntent(msg)).toBe(true)
  })

  it('Cenário 4: "Qual é o endereço e o horário de funcionamento?" não busca produto e preserva texto', () => {
    const msg = 'Qual é o endereço e o horário de funcionamento?'
    const scoped = resolveToolScope(msg, [], mockTools)
    expect(scoped.map(t => t.name)).toEqual(['get_current_datetime'])
    expect(scoped.map(t => t.name)).not.toContain('buscar_produto')
    expect(scoped.map(t => t.name)).not.toContain('consultar_produto_comercial')
    expect(hasClearProductIntent(msg)).toBe(false)

    const result = evaluateEngineRound1Fallback({
      userMessage: msg,
      scopedTools: scoped,
      llmResponse: { content: 'Nosso endereço é Rua X e funcionamos das 8h às 18h.', tool_calls: [] }
    })

    expect(result.content).toBe('Nosso endereço é Rua X e funcionamos das 8h às 18h.')
    expect(result.tool_calls).toHaveLength(0)
  })

  it('Cenário 6: "Qual o preço do chocolate Sicao de 1 kg?" reconhece unidade com espaço', () => {
    const msg = 'Qual o preço do chocolate Sicao de 1 kg?'
    const scoped = resolveToolScope(msg, [], mockTools)
    expect(scoped.map(t => t.name)).toEqual(['consultar_produto_comercial'])
    expect(hasClearProductIntent(msg)).toBe(true)
  })

  it('Cenário 7: "Quanto custa 500 g de chocolate Sicao?" reconhece unidade com espaço', () => {
    const msg = 'Quanto custa 500 g de chocolate Sicao?'
    const scoped = resolveToolScope(msg, [], mockTools)
    expect(scoped.map(t => t.name)).toEqual(['consultar_produto_comercial'])
    expect(hasClearProductIntent(msg)).toBe(true)
  })

  it('Cenário 8: "Quanto fica 10 unidades da cobertura Genuine?" reconhece unidades por extenso', () => {
    const msg = 'Quanto fica 10 unidades da cobertura Genuine?'
    const scoped = resolveToolScope(msg, [], mockTools)
    expect(scoped.map(t => t.name)).toEqual(['consultar_produto_comercial'])
    expect(hasClearProductIntent(msg)).toBe(true)
  })

  it('Cenário 9: "Vocês trabalham com chocolate Sicao?" escopa buscar_produto e preserva tool call legítima', () => {
    const msg = 'Vocês trabalham com chocolate Sicao?'
    const scoped = resolveToolScope(msg, [], mockTools)
    expect(scoped.map(t => t.name)).toEqual(['buscar_produto'])
    expect(hasClearProductIntent(msg)).toBe(true)

    const result = evaluateEngineRound1Fallback({
      userMessage: msg,
      scopedTools: scoped,
      llmResponse: { 
        content: null, 
        tool_calls: [{ callId: 'call_1', toolName: 'buscar_produto', arguments: { query: 'chocolate Sicao' } }] 
      }
    })

    expect(result.tool_calls).toHaveLength(1)
    expect(result.tool_calls![0].toolName).toBe('buscar_produto')
    expect(result.tool_calls![0].arguments.query).toBe('chocolate Sicao')
  })

  it('Cenário 10: "Tem filmes infantis?" não apaga texto do assistente baseado em instruções', () => {
    const msg = 'Tem filmes infantis?'
    const scoped = resolveToolScope(msg, [], mockTools)
    expect(scoped.map(t => t.name)).toEqual(['buscar_produto'])
    expect(hasClearProductIntent(msg)).toBe(false)

    // Se o modelo respondeu via instruções de negócio sem chamar a tool física:
    const result = evaluateEngineRound1Fallback({
      userMessage: msg,
      scopedTools: scoped,
      llmResponse: { content: 'Sim, temos uma seleção de filmes infantis em nosso catálogo de streaming.', tool_calls: [] }
    })

    // CRUCIAL: O texto é preservado e NÃO é anulado para null!
    expect(result.content).toBe('Sim, temos uma seleção de filmes infantis em nosso catálogo de streaming.')
    expect(result.tool_calls).toHaveLength(0)
  })

  it('Prazo no Engine: "Quanto demora?" preserva resposta textual e não injeta busca de produto', () => {
    const msg = 'Quanto demora?'
    const scoped = resolveToolScope(msg, [], mockTools)
    expect(scoped).toHaveLength(0)
    expect(hasClearProductIntent(msg)).toBe(false)

    const result = evaluateEngineRound1Fallback({
      userMessage: msg,
      scopedTools: scoped,
      llmResponse: { content: 'Nosso prazo de entrega para sua região é de 1 a 2 dias úteis.', tool_calls: [] }
    })

    expect(result.content).toBe('Nosso prazo de entrega para sua região é de 1 a 2 dias úteis.')
    expect(result.tool_calls).toHaveLength(0)
  })

  it('Prazo no Engine: "Quanto falta para entregar?" preserva resposta textual e não injeta busca de produto', () => {
    const msg = 'Quanto falta para entregar?'
    const scoped = resolveToolScope(msg, [], mockTools)
    expect(scoped).toHaveLength(0)
    expect(hasClearProductIntent(msg)).toBe(false)

    const result = evaluateEngineRound1Fallback({
      userMessage: msg,
      scopedTools: scoped,
      llmResponse: { content: 'Seu pedido já saiu para entrega e deve chegar até as 17h.', tool_calls: [] }
    })

    expect(result.content).toBe('Seu pedido já saiu para entrega e deve chegar até as 17h.')
    expect(result.tool_calls).toHaveLength(0)
  })
})
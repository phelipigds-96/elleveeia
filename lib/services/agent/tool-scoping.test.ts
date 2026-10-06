import { resolveToolScope } from './tool-scoping'
import { ToolDefinition } from './tools'

describe('ToolScopeResolver', () => {
  const mockTools: ToolDefinition[] = [
    { name: 'get_current_datetime', description: '', schema: {} as any, metadata: { category: 'datetime' }, execute: async () => {} },
    { name: 'buscar_produto', description: '', schema: {} as any, metadata: { category: 'catalog' }, execute: async () => {} },
    { name: 'consultar_preco', description: '', schema: {} as any, metadata: { category: 'pricing' }, execute: async () => {} },
    { name: 'calcular_preco_produto', description: '', schema: {} as any, metadata: { category: 'pricing' }, execute: async () => {} },
    { name: 'consultar_produto_comercial', description: '', schema: {} as any, metadata: { category: 'commercial' }, execute: async () => {} },
    { name: 'gerar_orcamento', description: '', schema: {} as any, metadata: { category: 'quotes' }, execute: async () => {} },
  ]

  const getToolNames = (tools: ToolDefinition[]) => tools.map(t => t.name).sort()

  it('Caso 1: Olá -> []', () => {
    const result = resolveToolScope('Olá', [], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Caso 1b: Saudao completa -> []', () => {
    const result = resolveToolScope('Oi, tudo bem?', [], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Caso 2: Que horas sǜo? -> [datetime]', () => {
    const result = resolveToolScope('Que horas sǜo?', [], mockTools)
    expect(getToolNames(result)).toEqual(['get_current_datetime'])
  })

  it('Caso 3: Tem chocolate Sicao? -> fallback comercial', () => {
    const result = resolveToolScope('Tem chocolate Sicao?', [], mockTools)
    expect(getToolNames(result)).toEqual(
      ['buscar_produto', 'calcular_preco_produto', 'consultar_preco', 'consultar_produto_comercial'].sort()
    )
  })

  it('Caso 4: Quanto custa chocolate Sicao ao leite? -> fallback comercial', () => {
    const result = resolveToolScope('Quanto custa chocolate Sicao ao leite?', [], mockTools)
    expect(getToolNames(result)).toEqual(
      ['buscar_produto', 'calcular_preco_produto', 'consultar_preco', 'consultar_produto_comercial'].sort()
    )
  })

  it('Caso 5: Unidade de peso (1kg) ativa o comercial automaticamente', () => {
    const result = resolveToolScope('Me vǦ a de 1kg', [], mockTools)
    expect(getToolNames(result)).toEqual(
      ['buscar_produto', 'calcular_preco_produto', 'consultar_preco', 'consultar_produto_comercial'].sort()
    )
  })

  it('Caso 6: Fluxo de oramento -> [quotes + comercial]', () => {
    const result = resolveToolScope('Gostaria de fechar um oramento', [], mockTools)
    expect(getToolNames(result)).toEqual(
      ['buscar_produto', 'calcular_preco_produto', 'consultar_preco', 'consultar_produto_comercial', 'gerar_orcamento'].sort()
    )
  })

  it('Caso 7: Palavra solta "sim" com historico -> [comercial]', () => {
    // "sim" no meio da conversa pode ser resposta a "vocǦ quer a de 1kg?". Tem que enviar as tools comerciais.
    const result = resolveToolScope('sim', [{ role: 'assistant', content: 'quer 1kg?' }], mockTools)
    expect(getToolNames(result)).toEqual(
      ['buscar_produto', 'calcular_preco_produto', 'consultar_preco', 'consultar_produto_comercial'].sort()
    )
  })

  it('Caso 8: Sem mensagem -> Retorna tudo por seguranǜa', () => {
    const result = resolveToolScope(undefined, [], mockTools)
    expect(result).toHaveLength(6)
  })
})

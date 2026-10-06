import { resolveToolScope } from './tool-scoping'
import { ToolDefinition } from './tools'

describe('ToolScopeResolver (Refinado)', () => {
  const mockTools: ToolDefinition[] = [
    { name: 'get_current_datetime', description: '', schema: {} as any, metadata: { category: 'datetime' }, execute: async () => {} },
    { name: 'buscar_produto', description: '', schema: {} as any, metadata: { category: 'catalog' }, execute: async () => {} },
    { name: 'consultar_preco', description: '', schema: {} as any, metadata: { category: 'pricing' }, execute: async () => {} },
    { name: 'calcular_preco_produto', description: '', schema: {} as any, metadata: { category: 'pricing' }, execute: async () => {} },
    { name: 'consultar_produto_comercial', description: '', schema: {} as any, metadata: { category: 'commercial' }, execute: async () => {} },
    { name: 'gerar_orcamento', description: '', schema: {} as any, metadata: { category: 'quotes' }, execute: async () => {} },
  ]

  const getToolNames = (tools: ToolDefinition[]) => tools.map(t => t.name).sort()

  it('Teste 1: Ol -> []', () => {
    const result = resolveToolScope('Olá', [], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Teste 2: Obrigado -> [] (Ignorando histrico)', () => {
    const result = resolveToolScope('Obrigado', [{ role: 'assistant', content: 'Fica R$ 29,90' }], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Teste 3: Que horas sǜo? -> [get_current_datetime]', () => {
    const result = resolveToolScope('Que horas sǜo?', [], mockTools)
    expect(getToolNames(result)).toEqual(['get_current_datetime'])
  })

  it('Teste 4: VocǦs tǦm chocolate Sicao? -> [buscar_produto]', () => {
    const result = resolveToolScope('VocǦs tǦm chocolate Sicao?', [], mockTools)
    expect(getToolNames(result)).toEqual(['buscar_produto'])
  })

  it('Teste 5: Tem cobertura Genuine? -> [buscar_produto]', () => {
    const result = resolveToolScope('Tem cobertura Genuine?', [], mockTools)
    expect(getToolNames(result)).toEqual(['buscar_produto'])
  })

  it('Teste 6: Quanto custa chocolate Sicao ao leite? -> [consultar_produto_comercial]', () => {
    const result = resolveToolScope('Quanto custa chocolate Sicao ao leite?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Teste 7: Quanto tǭ a cobertura Genuine meio amargo de 1kg? -> [consultar_produto_comercial]', () => {
    const result = resolveToolScope('Quanto tǭ a cobertura Genuine meio amargo de 1kg?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Teste 8: Quanto fica 20 unidades da cobertura Genuine? -> [consultar_produto_comercial]', () => {
    const result = resolveToolScope('Quanto fica 20 unidades da cobertura Genuine?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Teste 9: Histrico + E o preo? -> [consultar_produto_comercial]', () => {
    const result = resolveToolScope('E o preco?', [{ role: 'assistant', content: 'Temos Sicao' }], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Teste 10: Histrico + Obrigado -> []', () => {
    const result = resolveToolScope('Obrigado', [{ role: 'assistant', content: 'Temos Sicao' }], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Teste 11: Histrico + Ok -> []', () => {
    const result = resolveToolScope('Ok', [{ role: 'assistant', content: 'Temos Sicao' }], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Teste 12: Quero fazer um oramento -> [gerar_orcamento]', () => {
    const result = resolveToolScope('Quero fazer um oramento', [], mockTools)
    expect(getToolNames(result)).toEqual(['gerar_orcamento'])
  })
  
  it('Teste Extra: A de 1kg (respondendo ao assistente) -> [consultar_produto_comercial]', () => {
    const result = resolveToolScope('A de 1kg', [{ role: 'assistant', content: 'Qual tamanho?' }], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })
})

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

  // -------------------------------------------------------------------------
  // SAUDACOES — sem ferramentas
  // -------------------------------------------------------------------------
  it('Teste 1: Olá → []', () => {
    const result = resolveToolScope('Olá', [], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Teste 2: Obrigado → [] (ignorando histórico)', () => {
    const result = resolveToolScope('Obrigado', [{ role: 'assistant', content: 'Fica R$ 29,90' }], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Teste: Ok → []', () => {
    const result = resolveToolScope('Ok', [{ role: 'assistant', content: 'Temos Sicao' }], mockTools)
    expect(result).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // CAUSA RAIZ: timeKeywords — 8 casos obrigatórios
  // -------------------------------------------------------------------------
  it('Teste 3a [CAUSA RAIZ]: "Que horas são?" → [get_current_datetime]', () => {
    const result = resolveToolScope('Que horas são?', [], mockTools)
    expect(getToolNames(result)).toEqual(['get_current_datetime'])
    expect(result.map(t => t.name)).not.toContain('consultar_produto_comercial')
  })

  it('Teste 3b: "Que hora é?" → [get_current_datetime]', () => {
    const result = resolveToolScope('Que hora é?', [], mockTools)
    expect(getToolNames(result)).toEqual(['get_current_datetime'])
  })

  it('Teste 3c: "Que horas são agora?" → [get_current_datetime]', () => {
    const result = resolveToolScope('Que horas são agora?', [], mockTools)
    expect(getToolNames(result)).toEqual(['get_current_datetime'])
  })

  it('Teste 3d: "Que horário é?" → [get_current_datetime]', () => {
    const result = resolveToolScope('Que horário é?', [], mockTools)
    expect(getToolNames(result)).toEqual(['get_current_datetime'])
  })

  it('Teste 3e: "Qual a hora atual?" → [get_current_datetime]', () => {
    const result = resolveToolScope('Qual a hora atual?', [], mockTools)
    expect(getToolNames(result)).toEqual(['get_current_datetime'])
  })

  it('Teste 3f: "Que horas são atualmente?" → [get_current_datetime]', () => {
    const result = resolveToolScope('Que horas são atualmente?', [], mockTools)
    expect(getToolNames(result)).toEqual(['get_current_datetime'])
  })

  it('Teste 3g: "Qual a data de hoje?" → [get_current_datetime]', () => {
    const result = resolveToolScope('Qual a data de hoje?', [], mockTools)
    expect(getToolNames(result)).toEqual(['get_current_datetime'])
  })

  it('Teste 3h: "Que dia é hoje?" → [get_current_datetime]', () => {
    const result = resolveToolScope('Que dia é hoje?', [], mockTools)
    expect(getToolNames(result)).toEqual(['get_current_datetime'])
  })

  // -------------------------------------------------------------------------
  // BUSCA DE PRODUTO
  // -------------------------------------------------------------------------
  it('Teste 4: "Vocês têm chocolate Sicao?" → [buscar_produto]', () => {
    const result = resolveToolScope('Vocês têm chocolate Sicao?', [], mockTools)
    expect(getToolNames(result)).toEqual(['buscar_produto'])
  })

  it('Teste 5: "Tem cobertura Genuine?" → [buscar_produto]', () => {
    const result = resolveToolScope('Tem cobertura Genuine?', [], mockTools)
    expect(getToolNames(result)).toEqual(['buscar_produto'])
  })

  // -------------------------------------------------------------------------
  // FERRAMENTAS COMERCIAIS
  // -------------------------------------------------------------------------
  it('Teste 6: "Quanto custa chocolate Sicao ao leite?" → [consultar_produto_comercial]', () => {
    const result = resolveToolScope('Quanto custa chocolate Sicao ao leite?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Teste 7: "Quanto tá a cobertura Genuine meio amargo de 1kg?" → [consultar_produto_comercial]', () => {
    const result = resolveToolScope('Quanto tá a cobertura Genuine meio amargo de 1kg?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Teste 8: "Quanto fica 20 unidades da cobertura Genuine?" → [consultar_produto_comercial]', () => {
    const result = resolveToolScope('Quanto fica 20 unidades da cobertura Genuine?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Teste 9: Histórico + "E o preço?" → [consultar_produto_comercial]', () => {
    const result = resolveToolScope('E o preco?', [{ role: 'assistant', content: 'Temos Sicao' }], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Teste: A de 1kg (respondendo ao assistente) → [consultar_produto_comercial]', () => {
    const result = resolveToolScope('A de 1kg', [{ role: 'assistant', content: 'Qual tamanho?' }], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  // -------------------------------------------------------------------------
  // ORÇAMENTO
  // -------------------------------------------------------------------------
  it('Teste 12: "Quero fazer um orçamento" → [gerar_orcamento]', () => {
    const result = resolveToolScope('Quero fazer um orcamento', [], mockTools)
    expect(getToolNames(result)).toEqual(['gerar_orcamento'])
  })

  // -------------------------------------------------------------------------
  // OS 10 CENÁRIOS OBRIGATÓRIOS DA AUDITORIA (INTENÇÕES MISTAS & UNIDADES)
  // -------------------------------------------------------------------------
  it('Cenário 1: "Vocês aceitam Pix?" → [] (institucional, sem catálogo ou preço)', () => {
    const result = resolveToolScope('Vocês aceitam Pix?', [], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Cenário 2: "Vocês aceitam Pix e quanto custa o produto?" → [consultar_produto_comercial] (mista: preço não suprimido)', () => {
    const result = resolveToolScope('Vocês aceitam Pix e quanto custa o produto?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Cenário 3: "Quanto custa o chocolate Sicao com entrega?" → [consultar_produto_comercial] (mista: entrega não suprime preço)', () => {
    const result = resolveToolScope('Quanto custa o chocolate Sicao com entrega?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Cenário 4: "Qual é o endereço e o horário de funcionamento?" → [get_current_datetime] (sem busca de produto)', () => {
    const result = resolveToolScope('Qual é o endereço e o horário de funcionamento?', [], mockTools)
    expect(getToolNames(result)).toEqual(['get_current_datetime'])
  })

  it('Cenário 5: "Obrigado, era isso." → [] (encerramento cordial, sem ferramentas)', () => {
    const result = resolveToolScope('Obrigado, era isso.', [{ role: 'assistant', content: 'Fica R$ 29,90' }], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Cenário 6: "Qual o preço do chocolate Sicao de 1 kg?" → [consultar_produto_comercial] (unidade com espaço "1 kg")', () => {
    const result = resolveToolScope('Qual o preço do chocolate Sicao de 1 kg?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Cenário 7: "Quanto custa 500 g de chocolate Sicao?" → [consultar_produto_comercial] (unidade com espaço "500 g")', () => {
    const result = resolveToolScope('Quanto custa 500 g de chocolate Sicao?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Cenário 8: "Quanto fica 10 unidades da cobertura Genuine?" → [consultar_produto_comercial] (unidade "10 unidades")', () => {
    const result = resolveToolScope('Quanto fica 10 unidades da cobertura Genuine?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Cenário 9: "Vocês trabalham com chocolate Sicao?" → [buscar_produto] (busca legítima de marca/produto)', () => {
    const result = resolveToolScope('Vocês trabalham com chocolate Sicao?', [], mockTools)
    expect(getToolNames(result)).toEqual(['buscar_produto'])
  })

  it('Cenário 10: "Tem filmes infantis?" → [buscar_produto] (sem forçar física ou premissas indevidas)', () => {
    const result = resolveToolScope('Tem filmes infantis?', [], mockTools)
    expect(getToolNames(result)).toEqual(['buscar_produto'])
  })

  // -------------------------------------------------------------------------
  // INTENÇÃO DE PRAZO / DURAÇÃO VS INTENÇÃO COMERCIAL
  // -------------------------------------------------------------------------
  it('Prazo 1: "Quanto demora?" → [] (sem ferramentas comerciais)', () => {
    const result = resolveToolScope('Quanto demora?', [], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Prazo 1b: "Quanto demora?" com histórico → [] (não aciona fallback comercial)', () => {
    const result = resolveToolScope('Quanto demora?', [{ role: 'assistant', content: 'Temos chocolate Sicao' }], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Prazo 2: "Quanto falta para entregar?" → [] (sem ferramentas comerciais)', () => {
    const result = resolveToolScope('Quanto falta para entregar?', [], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Prazo 2b: "Quanto falta para entregar?" com histórico → [] (não aciona fallback comercial)', () => {
    const result = resolveToolScope('Quanto falta para entregar?', [{ role: 'assistant', content: 'Pedido recebido' }], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Prazo 3: "Quanto tempo demora a entrega?" → [] (duração explícita de entrega)', () => {
    const result = resolveToolScope('Quanto tempo demora a entrega?', [], mockTools)
    expect(result).toHaveLength(0)
  })

  it('Prazo 4: "Quanto custa o chocolate Sicao?" → [consultar_produto_comercial] (preço de produto preservado)', () => {
    const result = resolveToolScope('Quanto custa o chocolate Sicao?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Prazo 5: "Quanto custa a entrega do chocolate Sicao?" → [consultar_produto_comercial] (mista: entrega não suprime preço do produto)', () => {
    const result = resolveToolScope('Quanto custa a entrega do chocolate Sicao?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Prazo 6: "Vocês aceitam Pix e quanto custa o produto?" → [consultar_produto_comercial] (mista preservada)', () => {
    const result = resolveToolScope('Vocês aceitam Pix e quanto custa o produto?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })

  it('Prazo 7: "Quanto fica 10 unidades da cobertura Genuine?" → [consultar_produto_comercial] (quantidade/preço preservada)', () => {
    const result = resolveToolScope('Quanto fica 10 unidades da cobertura Genuine?', [], mockTools)
    expect(getToolNames(result)).toEqual(['consultar_produto_comercial'])
  })
})

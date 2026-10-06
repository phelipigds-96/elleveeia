import { ToolDefinition } from './tools'

/**
 * Resolve quais ferramentas devem ser enviadas ao LLM com base na mensagem atual
 * e no contexto da conversa, reduzindo cirurgicamente o consumo de tokens.
 */
export function resolveToolScope(
  userMessage: string | undefined,
  history: any[],
  availableTools: ToolDefinition[]
): ToolDefinition[] {
  if (!userMessage) return availableTools

  const msg = userMessage
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()

  const words = msg.split(/\s+/)

  // 1. Identificar se é apenas Greeting/Confirmação (NÃO precisa de tools, mesmo com histórico)
  const GREETINGS = new Set([
    'ola', 'oi', 'tudo', 'bem', 'bom', 'dia', 'boa', 'tarde', 'noite',
    'opa', 'eae', 'obrigado', 'obrigada', 'valeu', 'tchau', 'ate', 'logo',
    'beleza', 'ok', 'certo', 'entendi', 'sim', 'nao', 'aham', 'isso', 'perfeito'
  ])
  
  const isOnlyGreeting = words.length > 0 && words.every(w => GREETINGS.has(w))

  if (isOnlyGreeting) {
    return [] // Retorna imediatamente sem acionar fallbacks
  }

  const selectedTools = new Set<ToolDefinition>()

  // 2. Extrair Intenções Específicas
  let hasTimeIntent = false
  let hasQuoteIntent = false
  let hasCatalogSearchIntent = false
  let hasProductPriceIntent = false
  let hasQuantityPriceIntent = false

  const timeKeywords = ['hora', 'dia', 'hoje', 'data', 'agora', 'funcionamento']
  const quoteKeywords = ['orcamento', 'cotacao', 'pedido', 'fechar', 'finalizar', 'resumo']
  const catalogSearchKeywords = [
    'tem', 'buscar', 'procura', 'catalogo', 'produto', 'marca', 'qual', 'quais',
    'opcao', 'opcoes', 'sabor', 'sabores', 'vende', 'vendem', 'temos', 'queria', 'quero', 'gostaria', 'trabalham'
  ]
  const productPriceKeywords = ['quanto', 'preco', 'valor', 'custa', 'fica', 'sair', 'cair']
  const quantityPriceKeywords = ['unidades', 'caixas', 'fardos', 'pacotes']

  for (const w of words) {
    if (timeKeywords.includes(w)) hasTimeIntent = true
    if (quoteKeywords.includes(w)) hasQuoteIntent = true
    if (catalogSearchKeywords.includes(w)) hasCatalogSearchIntent = true
    if (productPriceKeywords.includes(w)) hasProductPriceIntent = true
    if (quantityPriceKeywords.includes(w)) hasQuantityPriceIntent = true
  }

  // Unidade de medida aciona intenção de catálogo (ex: "a de 1kg")
  if (/\b\d+(?:kg|g|ml|l|un|und)\b/.test(msg)) {
    hasCatalogSearchIntent = true
  }

  // 3. Mapeamento de Intenção para Capability
  for (const tool of availableTools) {
    const name = tool.name
    const category = tool.metadata?.category || 'general'

    if (category === 'datetime' && hasTimeIntent) {
      selectedTools.add(tool)
    }
    
    if (category === 'quotes' && hasQuoteIntent) {
      selectedTools.add(tool)
    }

    // Ferramenta Composta (Prioridade 1 para vendas)
    if (name === 'consultar_produto_comercial') {
      if (hasProductPriceIntent || hasQuantityPriceIntent) {
        selectedTools.add(tool)
      } else if (hasCatalogSearchIntent && history.length > 0) {
        // Se há histórico (ex: respondendo a desambiguação), priorizamos a composta para já trazer o preço
        selectedTools.add(tool)
      }
    }

    // Ferramenta de Busca Simples
    if (name === 'buscar_produto') {
      if (hasCatalogSearchIntent && !hasProductPriceIntent && !hasQuantityPriceIntent) {
        selectedTools.add(tool)
      }
    }
  }

  // 4. Fallback Seguro (Mensagem desconhecida/sem keyword, mas não é saudação)
  // Ex: "Chocolate sicao" ou "A amarga"
  if (selectedTools.size === 0 && !isOnlyGreeting) {
    const fallbackTool = availableTools.find(t => t.name === 'consultar_produto_comercial')
    if (fallbackTool) selectedTools.add(fallbackTool)
  }

  // 5. Otimização de Conflitos: Se a Composta for carregada, as auxiliares perdem necessidade no fluxo inicial
  const hasComercial = Array.from(selectedTools).some(t => t.name === 'consultar_produto_comercial')
  if (hasComercial) {
    return Array.from(selectedTools).filter(t => 
      t.name !== 'buscar_produto' && 
      t.name !== 'consultar_preco' && 
      t.name !== 'calcular_preco_produto'
    )
  }

  return Array.from(selectedTools)
}

import { ToolDefinition } from './tools'

/**
 * Resolve quais ferramentas devem ser enviadas ao LLM com base na mensagem atual
 * e no contexto da conversa, reduzindo o consumo de tokens.
 */
export function resolveToolScope(
  userMessage: string | undefined,
  history: any[],
  availableTools: ToolDefinition[]
): ToolDefinition[] {
  // Se nǜo hǭ mensagem clara (ex: chamadas de sistema, retry interno), retorna tudo por seguranǜa
  if (!userMessage) return availableTools

  const msg = userMessage
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()

  const words = msg.split(/\s+/)

  // 1. Identificar se é apenas Greeting
  const GREETINGS = new Set([
    'ola', 'oi', 'tudo', 'bem', 'bom', 'dia', 'boa', 'tarde', 'noite',
    'opa', 'eae', 'obrigado', 'obrigada', 'valeu', 'tchau', 'ate', 'logo',
    'beleza', 'ok', 'certo', 'entendi', 'sim', 'nao', 'aham', 'isso'
  ])
  
  const isOnlyGreeting = words.every(w => GREETINGS.has(w))

  // Se for APENAS saudaǜo curta e o histrico estiver limpo, nǜo precisa de tools.
  if (isOnlyGreeting && words.length <= 3 && history.length === 0) {
    return []
  }

  const selectedTools = new Set<ToolDefinition>()

  // 2. Extrair intenes via Keywords
  let hasTimeIntent = false
  let hasQuoteIntent = false
  let hasCommercialIntent = false

  const timeKeywords = ['hora', 'dia', 'hoje', 'data', 'agora', 'funcionamento']
  const quoteKeywords = ['orcamento', 'cotacao', 'pedido', 'fechar', 'finalizar', 'resumo']
  
  // Qualquer palavra relacionada a catǭlogo, busca, produto, marca, preo, valor, etc.
  const commercialKeywords = [
    'tem', 'buscar', 'procura', 'catalogo', 'produto', 'marca', 'qual', 'quais',
    'opcao', 'opcoes', 'sabor', 'sabores', 'quanto', 'preco', 'valor', 'custa',
    'fica', 'sair', 'cair', 'vende', 'vendem', 'temos', 'queria', 'quero', 'gostaria'
  ]

  for (const w of words) {
    if (timeKeywords.includes(w)) hasTimeIntent = true
    if (quoteKeywords.includes(w)) hasQuoteIntent = true
    if (commercialKeywords.includes(w)) hasCommercialIntent = true
  }

  // Se o usuǭrio falou alguma unidade comum de peso/medida (ex: 1kg, 500g), é quase certo que Ǹ intenǜo comercial
  if (/\b\d+(?:kg|g|ml|l|un|und)\b/.test(msg)) {
    hasCommercialIntent = true
  }

  // 3. Associar Intenes às Tools
  for (const tool of availableTools) {
    const category = tool.metadata?.category || 'general'

    if (category === 'datetime' && hasTimeIntent) {
      selectedTools.add(tool)
    }
    
    if (category === 'quotes' && hasQuoteIntent) {
      selectedTools.add(tool)
    }
    
    if ((category === 'catalog' || category === 'pricing' || category === 'commercial') && hasCommercialIntent) {
      selectedTools.add(tool)
    }
  }

  // 4. Fallback Controlado (Camada B)
  // Se nǜo detectou NENHUMA intenǜo clara, mas NÃO é apenas um greeting (ex: usuǭrio citou um nome de produto
  // sem usar as palavras 'quero', 'tem', etc), ou se for resposta curta (ex: "A de 1kg") no meio do atendimento,
  // ativamos a malha de fallback comercial para nǜo quebrar o fluxo.
  if (selectedTools.size === 0 && (!isOnlyGreeting || history.length > 0)) {
    for (const tool of availableTools) {
      if (
        tool.metadata?.category === 'catalog' ||
        tool.metadata?.category === 'pricing' ||
        tool.metadata?.category === 'commercial'
      ) {
        selectedTools.add(tool)
      }
    }
  }

  return Array.from(selectedTools)
}

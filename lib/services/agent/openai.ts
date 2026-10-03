// Backend-only wrapper for OpenAI API
// We use the standard fetch API to avoid dependency lock issues and maintain maximum edge-compatibility.

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function'
  content: string | null
  name?: string
  tool_calls?: any[]
  tool_call_id?: string
}

export interface OpenAIResponse {
  message: OpenAIMessage
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export async function callOpenAI(messages: OpenAIMessage[], model: string, tools?: any[]): Promise<OpenAIResponse> {
  const apiKey = process.env.OPENAI_API_KEY
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada no servidor.')
  }

  const payload: any = {
    model: model,
    messages: messages,
    temperature: 0.7, // Padrão equilibrado para atendimento
  }

  if (tools && tools.length > 0) {
    payload.tools = tools
    payload.tool_choice = 'auto'
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => null)
    throw new Error(`Erro na API OpenAI (HTTP ${response.status}): ${errorData?.error?.message || 'Falha desconhecida'}`)
  }

  const data = await response.json()

  if (!data.choices || data.choices.length === 0) {
    throw new Error('OpenAI retornou uma resposta vazia.')
  }

  const choice = data.choices[0]
  
  return {
    message: choice.message,
    usage: {
      prompt_tokens: data.usage?.prompt_tokens || 0,
      completion_tokens: data.usage?.completion_tokens || 0,
      total_tokens: data.usage?.total_tokens || 0
    }
  }
}

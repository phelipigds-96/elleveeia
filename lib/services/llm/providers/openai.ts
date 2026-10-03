import { LLMProvider, LLMRequest, LLMResponse } from '../types'

export class OpenAIProvider implements LLMProvider {
  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const apiKey = process.env.OPENAI_API_KEY
    
    if (!apiKey) {
      throw new Error('A chave OPENAI_API_KEY não está configurada neste ambiente.')
    }

    const payload: any = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
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
      content: choice.message.content || '',
      provider: 'openai',
      model: request.model,
      usage: {
        prompt_tokens: data.usage?.prompt_tokens || 0,
        completion_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0
      }
    }
  }
}

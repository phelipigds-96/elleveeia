import { LLMProvider, LLMRequest, LLMResponse } from '../types'
import { InternalToolCall } from '../../agent/tools'

export class OpenAIProvider implements LLMProvider {
  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const apiKey = process.env.OPENAI_API_KEY
    
    if (!apiKey) {
      throw new Error('A chave OPENAI_API_KEY nÃ£o estÃ¡ configurada neste ambiente.')
    }

    // Mapear mensagens do formato interno genÃ©rico para o formato OpenAI
    const openAIMessages = request.messages.map(msg => {
      if (msg.role === 'tool' && msg.tool_result) {
        const toolPayload = msg.tool_result.success ? (msg.tool_result.data ?? { success: true }) : { error: msg.tool_result.error }
        return {
          role: 'tool',
          tool_call_id: msg.tool_result.callId,
          content: JSON.stringify(toolPayload) || "{}"
        }
      }
      }
      }

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        return {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.tool_calls.map(tc => ({
            id: tc.callId,
            type: 'function',
            function: {
              name: tc.toolName,
              arguments: JSON.stringify(tc.arguments)
            }
          }))
        }
      }

      return {
        role: msg.role,
        content: msg.content
      }
    })

    const payload: any = {
      model: request.model,
      messages: openAIMessages,
      temperature: request.temperature ?? 0.7,
    }

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map(tool => ({
        type: 'function',
        function: tool
      }))
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

    const choice = data.choices[0].message
    
    // Extrair tool_calls no formato interno
    let internalToolCalls: InternalToolCall[] | undefined = undefined
    if (choice.tool_calls && choice.tool_calls.length > 0) {
      internalToolCalls = choice.tool_calls.map((tc: any) => {
        let args = {}
        try {
          args = JSON.parse(tc.function.arguments)
        } catch (e) {
          // Argumentos mal formatados
        }
        return {
          callId: tc.id,
          toolName: tc.function.name,
          arguments: args
        }
      })
    }
    
    return {
      content: choice.content || null,
      provider: 'openai',
      model: request.model,
      usage: {
        prompt_tokens: data.usage?.prompt_tokens || 0,
        completion_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0,
        cached_tokens: data.usage?.prompt_tokens_details?.cached_tokens,
        reasoning_tokens: data.usage?.completion_tokens_details?.reasoning_tokens
      },
      tool_calls: internalToolCalls
    }
  }
}



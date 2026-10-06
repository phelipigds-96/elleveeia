import { LLMProvider, LLMRequest, LLMResponse } from '../types'
import { InternalToolCall } from '../../agent/tools'
import { GoogleGenAI } from '@google/genai'

export class GeminiProvider implements LLMProvider {
  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const apiKey = process.env.GEMINI_API_KEY
    
    if (!apiKey) {
      throw new Error('O provedor Google Gemini nÃ£o estÃ¡ configurado neste ambiente (GEMINI_API_KEY).')
    }

    const ai = new GoogleGenAI({ apiKey })

    let systemInstruction = ''
    const contents: any[] = []

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemInstruction += msg.content + '\n'
      } else if (msg.role === 'tool' && msg.tool_result) {
        const toolPayload = msg.tool_result.success ? (msg.tool_result.data ?? { success: true }) : { error: msg.tool_result.error }
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.tool_result.toolName,
              response: toolPayload
            }
          }]
        })
      }
          }]
        })
      }
          }]
        })
      } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        // Restaurar as chamadas de funÃ§Ã£o com suas respectivas thoughtSignatures (obrigatÃ³rio no Gemini 3+)
        const functionCallParts = msg.tool_calls.map(tc => {
          const part: any = {
            functionCall: {
              name: tc.toolName,
              args: tc.arguments
            }
          }
          if (tc.providerMetadata?.thoughtSignature) {
            part.thoughtSignature = tc.providerMetadata.thoughtSignature
          }
          return part
        })

        contents.push({
          role: 'model',
          parts: functionCallParts
        })
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content || '' }]
        })
      }
    }

    const config: any = {
      temperature: request.temperature ?? 0.7,
    }

    if (systemInstruction.trim()) {
      config.systemInstruction = systemInstruction.trim()
    }

    if (request.tools && request.tools.length > 0) {
      config.tools = [{
        functionDeclarations: request.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }))
      }]
    }

    const response = await ai.models.generateContent({
      model: request.model,
      contents,
      config
    })

    const usage = response.usageMetadata
    let internalToolCalls: InternalToolCall[] | undefined = undefined
    let contentText = ''

    // Extrair function calls diretamente das parts para capturar a thoughtSignature
    const candidateParts = response.candidates?.[0]?.content?.parts || []
    const functionCallParts = candidateParts.filter(p => p.functionCall)

    if (functionCallParts.length > 0) {
      internalToolCalls = functionCallParts.map((part: any, index: number) => ({
        callId: `call_${index}`,
        toolName: part.functionCall.name,
        arguments: part.functionCall.args || {},
        providerMetadata: {
          thoughtSignature: part.thoughtSignature
        }
      }))
    }

    if (response.text) {
      contentText = response.text
    }

    if (!contentText && !internalToolCalls) {
      throw new Error('Google Gemini retornou uma resposta vazia sem texto ou chamada de funÃ§Ã£o.')
    }

    return {
      content: contentText || null,
      provider: 'gemini',
      model: request.model,
      usage: {
        prompt_tokens: usage?.promptTokenCount || 0,
        completion_tokens: usage?.candidatesTokenCount || 0,
        total_tokens: usage?.totalTokenCount || 0,
        cached_tokens: usage?.cachedContentTokenCount,
        reasoning_tokens: usage?.thoughtsTokenCount,
        tool_use_tokens: usage?.toolUsePromptTokenCount
      },
      tool_calls: internalToolCalls
    }
  }
}



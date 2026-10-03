import { LLMProvider, LLMRequest, LLMResponse } from '../types'
import { InternalToolCall } from '../../agent/tools'
import { GoogleGenAI } from '@google/genai'

export class GeminiProvider implements LLMProvider {
  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const apiKey = process.env.GEMINI_API_KEY
    
    if (!apiKey) {
      throw new Error('O provedor Google Gemini não está configurado neste ambiente (GEMINI_API_KEY).')
    }

    const ai = new GoogleGenAI({ apiKey })

    let systemInstruction = ''
    const contents: any[] = []

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemInstruction += msg.content + '\n'
      } else if (msg.role === 'tool' && msg.tool_result) {
        // Formato Gemini para resultado de tool
        contents.push({
          role: 'user', // Gemini SDK pode exigir role user contendo a part functionResponse
          parts: [{
            functionResponse: {
              name: msg.tool_result.toolName,
              response: msg.tool_result
            }
          }]
        })
      } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        // Formato Gemini para assistant solicitando tool
        const functionCallParts = msg.tool_calls.map(tc => ({
          functionCall: {
            name: tc.toolName,
            args: tc.arguments
          }
        }))
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
      // Mapear o payload genérico para o functionDeclarations do Gemini
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

    if (response.functionCalls && response.functionCalls.length > 0) {
      internalToolCalls = response.functionCalls.map((fc: any, index: number) => ({
        callId: `call_${index}`, // Gemini não usa ID único para a call como a OpenAI
        toolName: fc.name,
        arguments: fc.args || {}
      }))
    }

    if (response.text) {
      contentText = response.text
    }

    if (!contentText && !internalToolCalls) {
      throw new Error('Google Gemini retornou uma resposta vazia sem texto ou chamada de função.')
    }

    return {
      content: contentText || null,
      provider: 'gemini',
      model: request.model,
      usage: {
        prompt_tokens: usage?.promptTokenCount || 0,
        completion_tokens: usage?.candidatesTokenCount || 0,
        total_tokens: usage?.totalTokenCount || 0
      },
      tool_calls: internalToolCalls
    }
  }
}

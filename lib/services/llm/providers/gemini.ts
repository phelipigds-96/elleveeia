import { LLMProvider, LLMRequest, LLMResponse } from '../types'
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

    const response = await ai.models.generateContent({
      model: request.model,
      contents,
      config
    })

    if (!response.text) {
      throw new Error('Google Gemini retornou uma resposta vazia.')
    }

    const usage = response.usageMetadata

    return {
      content: response.text || '',
      provider: 'gemini',
      model: request.model,
      usage: {
        prompt_tokens: usage?.promptTokenCount || 0,
        completion_tokens: usage?.candidatesTokenCount || 0,
        total_tokens: usage?.totalTokenCount || 0
      }
    }
  }
}

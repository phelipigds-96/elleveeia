import { LLMProvider, LLMProviderType } from './types'
import { OpenAIProvider } from './providers/openai'
import { GeminiProvider } from './providers/gemini'

export function getLLMProvider(provider: LLMProviderType): LLMProvider {
  switch (provider) {
    case 'openai':
      return new OpenAIProvider()
    case 'gemini':
      return new GeminiProvider()
    default:
      throw new Error(`Provedor de LLM não suportado: ${provider}`)
  }
}

export const LLM_MODELS: Record<LLMProviderType, { id: string, name: string }[]> = {
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
    { id: 'gpt-4o', name: 'GPT-4o' }
  ],
  gemini: [
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }
  ]
}

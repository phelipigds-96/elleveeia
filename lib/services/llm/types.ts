export type LLMProviderType = 'openai' | 'gemini'

export interface LLMRequestMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMRequest {
  model: string
  messages: LLMRequestMessage[]
  temperature?: number
}

export interface LLMResponseUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface LLMResponse {
  content: string
  provider: LLMProviderType
  model: string
  usage: LLMResponseUsage
}

export interface LLMProvider {
  generateResponse(request: LLMRequest): Promise<LLMResponse>
}

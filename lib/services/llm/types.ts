import { InternalToolCall, InternalToolResult } from '../agent/tools'

export type LLMProviderType = 'openai' | 'gemini'

export interface LLMRequestMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  tool_calls?: InternalToolCall[]
  tool_result?: InternalToolResult // Utilizado quando role === 'tool'
}

export interface LLMRequest {
  model: string
  messages: LLMRequestMessage[]
  temperature?: number
  tools?: any[] // Formato nativo agnóstico (array retornado pelo registry)
}

export interface LLMResponseUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface LLMResponse {
  content: string | null
  provider: LLMProviderType
  model: string
  usage: LLMResponseUsage
  tool_calls?: InternalToolCall[]
}

export interface LLMProvider {
  generateResponse(request: LLMRequest): Promise<LLMResponse>
}

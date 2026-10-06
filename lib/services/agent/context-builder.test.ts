import { buildAgentContext } from './context-builder'
import * as supabaseService from '@/lib/supabase/service'

// Mock do supabase client
jest.mock('@/lib/supabase/service', () => ({
  createAdminClient: jest.fn()
}))

describe('ContextBuilder - Intelligent Selection & Working Memory', () => {
  let mockSupabase: any
  let mockFrom: any

  beforeEach(() => {
    mockFrom = jest.fn()
    mockSupabase = { from: mockFrom }
    ;(supabaseService.createAdminClient as jest.Mock).mockReturnValue(mockSupabase)
  })

  it('deve extrair a working memory da mensagem mais recente e limitar histórico a 8', async () => {
    const rawMessages = Array.from({ length: 20 }).map((_, i) => ({
      id: `msg-${i}`,
      sender_type: 'agent',
      content: 'bla',
      metadata: i === 5 ? { working_memory: { activeProduct: { id: '123', name: 'Sicao' } } } : null
    }))

    mockFrom.mockImplementation((table: string) => {
      if (table === 'agents') return { select: () => ({ eq: () => ({ eq: () => ({ single: () => ({ data: { is_active: true, name: 'Agent' } }) }) }) }) }
      if (table === 'conversations') return { select: () => ({ eq: () => ({ eq: () => ({ single: () => ({ data: { status: 'bot', customers: {} } }) }) }) }) }
      if (table === 'messages') return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ data: rawMessages }) }) }) }) }
    })

    const result = await buildAgentContext({ companyId: '1', agentId: '2', conversationId: '3' })

    expect(result.workingMemory).toEqual({ activeProduct: { id: '123', name: 'Sicao' } })
    // Deve limitar o histórico a 8 mensagens
    expect(result.contextMetrics.availableMessages).toBe(20)
    expect(result.contextMetrics.usedMessages).toBe(8)
  })

  it('deve injetar data/hora no system prompt', async () => {
    const rawMessages: any[] = []

    mockFrom.mockImplementation((table: string) => {
      if (table === 'agents') return { select: () => ({ eq: () => ({ eq: () => ({ single: () => ({ data: { is_active: true, name: 'Agent' } }) }) }) }) }
      if (table === 'conversations') return { select: () => ({ eq: () => ({ eq: () => ({ single: () => ({ data: { status: 'bot', customers: {} } }) }) }) }) }
      if (table === 'messages') return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ data: rawMessages }) }) }) }) }
    })

    const result = await buildAgentContext({ companyId: '1', agentId: '2', conversationId: '3' })

    const systemMsg = result.payloadMessages.find((m: any) => m.role === 'system')
    expect(systemMsg.content).toContain('DATA/HORA ATUAL')
    expect(systemMsg.content).toContain('Timezone: America/Sao_Paulo')
  })
})

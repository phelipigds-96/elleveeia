import type { LLMProvider } from '../llm/types'

export const SUMMARY_MIN_MESSAGES = 12
export const SUMMARY_MIN_DELTA_MESSAGES = 8
export const SUMMARY_MIN_REMAINING_BUDGET_MS = 6000
const SUMMARY_MAX_CHARS = 900

export interface MaybeRefreshSummaryParams {
  supabase: any
  provider: LLMProvider
  model: string
  companyId: string
  conversationId: string
  previousSummary?: string | null
  previousSummaryMessageCount?: number | null
  availableRecentCount: number
  remainingBudgetMs: number
}

export interface RefreshSummaryResult {
  updated: boolean
  reason: string
  messageCount?: number
  summaryLength?: number
}

/**
 * Atualiza de forma incremental e best-effort o resumo persistente da conversa (`conversations.summary`).
 * Só dispara em conversas longas (>= 12 mensagens e >= 8 novas desde o último resumo)
 * quando há folga no orçamento de tempo do turno (> 6s). Degrada silenciosamente se a coluna não existir (42703).
 */
export async function maybeRefreshConversationSummary(
  params: MaybeRefreshSummaryParams
): Promise<RefreshSummaryResult> {
  const {
    supabase,
    provider,
    model,
    companyId,
    conversationId,
    previousSummary,
    previousSummaryMessageCount,
    availableRecentCount,
    remainingBudgetMs
  } = params

  if (!supabase || !provider || !companyId || !conversationId) {
    return { updated: false, reason: 'missing_params' }
  }

  if (remainingBudgetMs <= SUMMARY_MIN_REMAINING_BUDGET_MS) {
    return { updated: false, reason: 'insufficient_time_budget' }
  }

  // Otimização de curto-circuito: context-builder já busca até 20 mensagens recentes
  if (availableRecentCount < SUMMARY_MIN_MESSAGES) {
    return { updated: false, reason: 'below_min_messages' }
  }

  try {
    const prevCount = typeof previousSummaryMessageCount === 'number' && previousSummaryMessageCount >= 0
      ? previousSummaryMessageCount
      : 0

    // Contagem exata de mensagens conversacionais para suportar históricos > 20 mensagens
    const { count: totalCount, error: countErr } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('conversation_id', conversationId)
      .in('sender_type', ['customer', 'agent', 'human'])

    if (countErr) {
      return { updated: false, reason: 'count_query_failed' }
    }

    const effectiveTotal = typeof totalCount === 'number' ? totalCount : availableRecentCount
    if (effectiveTotal < SUMMARY_MIN_MESSAGES) {
      return { updated: false, reason: 'below_min_messages' }
    }

    if (effectiveTotal - prevCount < SUMMARY_MIN_DELTA_MESSAGES) {
      return { updated: false, reason: 'delta_below_threshold' }
    }

    // Busca as últimas mensagens (até 16) para consolidar com o resumo anterior
    const { data: recentRows, error: histErr } = await supabase
      .from('messages')
      .select('sender_type, content, created_at')
      .eq('company_id', companyId)
      .eq('conversation_id', conversationId)
      .in('sender_type', ['customer', 'agent', 'human'])
      .order('created_at', { ascending: false })
      .limit(16)

    if (histErr || !Array.isArray(recentRows) || recentRows.length === 0) {
      return { updated: false, reason: 'history_unavailable' }
    }

    const chronological = [...recentRows].reverse()
    const transcriptLines = chronological
      .map((m: any) => {
        const speaker = m.sender_type === 'customer'
          ? 'Cliente'
          : (m.sender_type === 'human' ? 'Atendente' : 'IA')
        const content = String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 300)
        return content ? `${speaker}: ${content}` : null
      })
      .filter(Boolean)
      .join('\n')

    if (!transcriptLines) {
      return { updated: false, reason: 'empty_transcript' }
    }

    const prevBlock = previousSummary?.trim()
      ? `Resumo anterior:\n${previousSummary.trim().slice(0, 900)}\n\n`
      : ''

    const timeoutMs = Math.max(2500, Math.min(4500, remainingBudgetMs - 1500))

    const llmRes = await provider.generateResponse({
      model,
      temperature: 0.2,
      timeoutMs,
      messages: [
        {
          role: 'system',
          content:
            'Resuma de forma objetiva e factual em portugues (maximo 5 frases ou topicos curtos, ate 700 caracteres) ' +
            'apenas fatos confirmados da conversa: interesse principal, produtos/quantidades/orcamentos mencionados, restricoes do cliente e pendencias atuais. Nao invente valores nem dados.'
        },
        {
          role: 'user',
          content: `${prevBlock}Mensagens recentes:\n${transcriptLines}`
        }
      ]
    })

    const rawSummary = (llmRes?.content || '').trim()
    if (!rawSummary) {
      return { updated: false, reason: 'empty_llm_summary' }
    }

    const cleanSummary = rawSummary.slice(0, SUMMARY_MAX_CHARS)

    const { error: updateErr } = await supabase
      .from('conversations')
      .update({
        summary: cleanSummary,
        summary_updated_at: new Date().toISOString(),
        summary_message_count: effectiveTotal
      })
      .eq('id', conversationId)
      .eq('company_id', companyId)

    if (updateErr) {
      // 42703: migration ainda não aplicada no banco — degrada silenciosamente
      if (updateErr.code === '42703') {
        return { updated: false, reason: 'column_missing' }
      }
      console.warn('[conversation-summary] Falha não-bloqueante ao persistir resumo:', updateErr.message)
      return { updated: false, reason: 'update_failed' }
    }

    return {
      updated: true,
      reason: 'summary_updated',
      messageCount: effectiveTotal,
      summaryLength: cleanSummary.length
    }
  } catch (err: any) {
    console.warn('[conversation-summary] Falha não-bloqueante ao gerar resumo:', err?.message || err)
    return { updated: false, reason: 'unexpected_error' }
  }
}

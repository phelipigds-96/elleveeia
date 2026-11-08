import 'server-only'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/service'

export interface OutboxProcessOptions {
  batchSize?: number
  leaseSeconds?: number
  mock?: boolean
  adminClient?: any
}

export interface OutboxItemResult {
  outboxId: string
  messageId: string | null
  recipient: string
  status: 'sent' | 'failed'
  providerMessageId?: string | null
  error?: string
  attempts: number
}

export interface OutboxProcessSummary {
  success: boolean
  processed: number
  succeeded: number
  failed: number
  elapsedMs: number
  items: OutboxItemResult[]
  error?: string
}

/**
 * Extrai destinatário e conteúdo de texto da mensagem a partir da outbox.
 */
export function extractRecipientAndContent(row: any): { recipient: string; content: string } {
  let recipient = (
    row.recipient ||
    row.payload?.recipient ||
    row.payload?.customer?.phone ||
    row.payload?.number ||
    ''
  ).toString().trim()

  // Higieniza o número: remove @s.whatsapp.net e caracteres não-numéricos
  recipient = recipient.replace(/@s\.whatsapp\.net$/i, '').replace(/[^0-9]/g, '')

  let content = ''
  if (typeof row.payload?.message?.content === 'string') {
    content = row.payload.message.content
  } else if (typeof row.payload?.content === 'string') {
    content = row.payload.content
  } else if (typeof row.payload?.text === 'string') {
    content = row.payload.text
  } else if (typeof row.payload?.message?.text === 'string') {
    content = row.payload.message.text
  }

  return { recipient, content }
}

/**
 * Efetua o despacho para o Gateway.
 * Rota 1: Direct Evolution API se EVOLUTION_API_URL estiver definida em ambiente.
 * Rota 2: Integração ativa cadastrada no banco de dados (ex: Webhook n8n para WhatsApp).
 */
export async function sendToGateway(
  supabase: any,
  row: any,
  recipient: string,
  content: string,
  options?: { mock?: boolean }
): Promise<{ success: boolean; providerMessageId?: string | null; error?: string }> {
  // 1. Modo Mock para testes e validações locais
  if (options?.mock || process.env.EVOLUTION_API_URL === 'mock') {
    return {
      success: true,
      providerMessageId: `mock-${crypto.randomUUID()}`
    }
  }

  // 2. Rota Prioritária A: Direct Evolution API se configurada via env
  const rawUrl = process.env.EVOLUTION_API_URL
  if (rawUrl && rawUrl.trim() !== '') {
    const apiKey = process.env.EVOLUTION_API_KEY || ''
    const instance = process.env.EVOLUTION_INSTANCE_NAME || 'default'

    const mediaUrl = row.payload?.media_url
    const mediaType = row.payload?.media_type || 'image'
    const fileName = row.payload?.file_name || 'arquivo'

    let targetUrl = rawUrl.trim()
    let payload: any = {
      number: recipient,
      text: content
    }

    if (mediaUrl) {
      if (mediaType === 'audio') {
        targetUrl = `${targetUrl.replace(/\/+$/, '')}/message/sendWhatsAppAudio/${instance}`
        payload = {
          number: recipient,
          audio: mediaUrl
        }
      } else {
        targetUrl = `${targetUrl.replace(/\/+$/, '')}/message/sendMedia/${instance}`
        payload = {
          number: recipient,
          mediatype: mediaType === 'document' ? 'document' : 'image',
          media: mediaUrl,
          caption: content,
          fileName: fileName
        }
      }
    } else if (!targetUrl.includes('/message/sendText')) {
      targetUrl = `${targetUrl.replace(/\/+$/, '')}/message/sendText/${instance}`
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (apiKey) {
      headers['apikey'] = apiKey
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (response.ok) {
        let data: any = null
        try {
          data = await response.json()
        } catch {
          data = null
        }

        const providerMessageId =
          data?.key?.id ||
          data?.messageId ||
          data?.id ||
          data?.keyId ||
          null

        return { success: true, providerMessageId }
      } else {
        const errText = await response.text().catch(() => '')
        return {
          success: false,
          error: `Evolution API HTTP ${response.status} (${response.statusText}): ${errText.slice(0, 300)}`
        }
      }
    } catch (err: any) {
      clearTimeout(timeoutId)
      return {
        success: false,
        error: `Falha na Evolution API: ${err?.message || String(err)}`
      }
    }
  }

  // 3. Rota Prioritária B: Integração Ativa no Banco (Ex: Webhook n8n para WhatsApp)
  try {
    const { data: integration } = await supabase
      .from('integrations')
      .select('*')
      .eq('company_id', row.company_id)
      .eq('status', 'active')
      .maybeSingle()

    if (integration && integration.config?.webhook_url) {
      const webhookUrl = integration.config.webhook_url
      const secret = integration.credentials?.webhook_secret

      const payload = {
        event_id: row.idempotency_key || `outbox-${row.id}`,
        event_type: 'message.send',
        channel: row.channel || 'whatsapp',
        conversation_id: row.conversation_id,
        recipient: recipient,
        number: recipient,
        text: content,
        media_url: row.payload?.media_url || null,
        media_type: row.payload?.media_type || null,
        file_name: row.payload?.file_name || null,
        customer: {
          phone: recipient,
          name: row.payload?.customer?.name || 'Cliente'
        },
        message: {
          id: row.message_id || row.id,
          content: content,
          text: content,
          sender_type: 'agent',
          message_type: row.payload?.media_type || 'text',
          media_url: row.payload?.media_url || null,
          created_at: row.created_at
        },
        metadata: {
          ...(row.payload?.metadata || {}),
          media_url: row.payload?.media_url || null,
          media_type: row.payload?.media_type || null
        }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'x-ellevee-api-key': secret } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (response.ok) {
        let data: any = null
        try {
          data = await response.json()
        } catch {
          data = null
        }

        const providerMessageId =
          data?.provider_message_id ||
          data?.providerMessageId ||
          data?.messageId ||
          data?.key?.id ||
          null

        // Atualiza last_event_at na integration
        await supabase
          .from('integrations')
          .update({
            last_event_at: new Date().toISOString()
          })
          .eq('id', integration.id)

        return { success: true, providerMessageId }
      } else {
        const errText = await response.text().catch(() => '')
        return {
          success: false,
          error: `Webhook Gateway HTTP ${response.status}: ${errText.slice(0, 300)}`
        }
      }
    }
  } catch (intEx: any) {
    return {
      success: false,
      error: `Erro ao despachar via integração: ${intEx?.message || String(intEx)}`
    }
  }

  // 4. Sem gateway configurado
  return {
    success: false,
    error: 'Nenhum gateway configurado (nem EVOLUTION_API_URL configurada no ambiente nem integração ativa com webhook_url no banco).'
  }
}

/**
 * Atualiza o banco após envio com sucesso (message_outbox e messages).
 */
export async function resolveSuccess(supabase: any, row: any, providerMessageId?: string | null) {
  const nowIso = new Date().toISOString()

  // 1. message_outbox -> status = 'sent'
  const { error: outboxUpdateErr } = await supabase
    .from('message_outbox')
    .update({
      status: 'sent',
      sent_at: nowIso,
      attempts: (row.attempts || 0) + 1,
      provider_message_id: providerMessageId || null,
      last_error: null,
      locked_until: null,
      updated_at: nowIso
    })
    .eq('id', row.id)

  if (outboxUpdateErr) {
    console.error(`[OutboxDispatcher] Erro ao marcar outbox ${row.id} como sent:`, outboxUpdateErr)
  }

  // 2. messages -> metadata.delivery_status = 'sent'
  if (row.message_id) {
    const { data: msgData } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', row.message_id)
      .maybeSingle()

    const currentMetadata = msgData?.metadata && typeof msgData.metadata === 'object' ? msgData.metadata : {}

    await supabase
      .from('messages')
      .update({
        metadata: {
          ...currentMetadata,
          delivery_status: 'sent',
          provider_message_id: providerMessageId || undefined,
          sent_at: nowIso
        },
        ...(providerMessageId ? { external_id: providerMessageId } : {})
      })
      .eq('id', row.message_id)
  }
}

/**
 * Atualiza o banco após falha no envio (message_outbox e messages).
 */
export async function resolveFailure(supabase: any, row: any, errorMessage?: string) {
  const nowIso = new Date().toISOString()
  const newAttempts = (row.attempts || 0) + 1
  const errorMsg = errorMessage || 'Falha desconhecida no envio'

  // 1. message_outbox -> status = 'failed'
  const { error: outboxFailErr } = await supabase
    .from('message_outbox')
    .update({
      status: 'failed',
      attempts: newAttempts,
      last_error: errorMsg,
      locked_until: null,
      updated_at: nowIso
    })
    .eq('id', row.id)

  if (outboxFailErr) {
    console.error(`[OutboxDispatcher] Erro ao marcar outbox ${row.id} como failed:`, outboxFailErr)
  }

  // 2. messages -> metadata.delivery_status = 'failed'
  if (row.message_id) {
    const { data: msgData } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', row.message_id)
      .maybeSingle()

    const currentMetadata = msgData?.metadata && typeof msgData.metadata === 'object' ? msgData.metadata : {}

    await supabase
      .from('messages')
      .update({
        metadata: {
          ...currentMetadata,
          delivery_status: 'failed',
          last_error: errorMsg,
          failed_at: nowIso
        }
      })
      .eq('id', row.message_id)
  }
}

/**
 * Despacha imediatamente uma mensagem específica da outbox (usado ao enviar pelo chat).
 * Executa lock atômico para prevenir duplicação caso um worker concorrente esteja ativo.
 */
export async function dispatchOutboxMessage(
  outboxId: string,
  options?: { adminClient?: any; mock?: boolean }
): Promise<{ success: boolean; providerMessageId?: string | null; error?: string; alreadyProcessed?: boolean }> {
  const supabase = options?.adminClient || createAdminClient()
  const now = new Date()
  const lockedUntil = new Date(now.getTime() + 60000).toISOString()
  const claimToken = crypto.randomUUID()

  // Lock atômico da linha específica
  const { data: claimedRows, error: claimErr } = await supabase
    .from('message_outbox')
    .update({
      status: 'processing',
      locked_at: now.toISOString(),
      locked_until: lockedUntil,
      claim_token: claimToken,
      updated_at: now.toISOString()
    })
    .eq('id', outboxId)
    .or(`status.eq.pending,status.eq.failed,and(status.eq.processing,locked_until.lt.${now.toISOString()})`)
    .select('*')

  if (claimErr) {
    return { success: false, error: `Falha de lock atômico: ${claimErr.message}` }
  }

  const row = claimedRows?.[0]
  if (!row) {
    // Linha não encontrada ou já processada / travada por outro processo
    return { success: true, alreadyProcessed: true }
  }

  let { recipient, content } = extractRecipientAndContent(row)

  if (!content && row.message_id) {
    const { data: msg } = await supabase
      .from('messages')
      .select('content')
      .eq('id', row.message_id)
      .maybeSingle()
    if (msg?.content) {
      content = msg.content
    }
  }

  if (!recipient || !content) {
    const errorReason = !recipient
      ? 'Destinatário (recipient/número) não informado'
      : 'Conteúdo da mensagem está vazio'

    await resolveFailure(supabase, row, errorReason)
    return { success: false, error: errorReason }
  }

  const sendRes = await sendToGateway(supabase, row, recipient, content, { mock: options?.mock })

  if (sendRes.success) {
    await resolveSuccess(supabase, row, sendRes.providerMessageId)
    return { success: true, providerMessageId: sendRes.providerMessageId }
  } else {
    await resolveFailure(supabase, row, sendRes.error)
    return { success: false, error: sendRes.error }
  }
}

/**
 * Processa um lote de mensagens pendentes (usado pela rota /api/outbox/process e cron).
 */
export async function processOutboxBatch(options?: OutboxProcessOptions): Promise<OutboxProcessSummary> {
  const startTime = Date.now()
  const supabase = options?.adminClient || createAdminClient()
  const batchSize = Math.max(1, Math.min(50, options?.batchSize || 10))
  const leaseSeconds = Math.max(15, Math.min(300, options?.leaseSeconds || 60))

  const now = new Date()
  const lockedUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  const claimToken = crypto.randomUUID()

  // 1. Busca mensagens elegíveis
  const { data: candidates, error: searchError } = await supabase
    .from('message_outbox')
    .select('id')
    .or(`status.eq.pending,and(status.eq.processing,locked_until.lt.${now.toISOString()})`)
    .lt('attempts', 5)
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (searchError) {
    throw new Error(`Falha ao consultar message_outbox: ${searchError.message}`)
  }

  if (!candidates || candidates.length === 0) {
    return {
      success: true,
      processed: 0,
      succeeded: 0,
      failed: 0,
      elapsedMs: Date.now() - startTime,
      items: []
    }
  }

  const candidateIds = candidates.map((c: any) => c.id)

  // 2. Trava atômica no banco de dados para os IDs selecionados
  const { data: claimedRows, error: claimError } = await supabase
    .from('message_outbox')
    .update({
      status: 'processing',
      locked_at: now.toISOString(),
      locked_until: lockedUntil,
      claim_token: claimToken,
      updated_at: now.toISOString()
    })
    .in('id', candidateIds)
    .or(`status.eq.pending,and(status.eq.processing,locked_until.lt.${now.toISOString()})`)
    .select('*')

  if (claimError) {
    throw new Error(`Falha ao travar lote na message_outbox: ${claimError.message}`)
  }

  const items: OutboxItemResult[] = []
  let succeeded = 0
  let failed = 0

  for (const row of claimedRows || []) {
    let { recipient, content } = extractRecipientAndContent(row)

    if (!content && row.message_id) {
      const { data: msg } = await supabase
        .from('messages')
        .select('content')
        .eq('id', row.message_id)
        .maybeSingle()
      if (msg?.content) {
        content = msg.content
      }
    }

    if (!recipient || !content) {
      const errorReason = !recipient
        ? 'Destinatário (recipient/número) não informado'
        : 'Conteúdo da mensagem está vazio'

      await resolveFailure(supabase, row, errorReason)
      failed++
      items.push({
        outboxId: row.id,
        messageId: row.message_id || null,
        recipient,
        status: 'failed',
        error: errorReason,
        attempts: (row.attempts || 0) + 1
      })
      continue
    }

    const sendRes = await sendToGateway(supabase, row, recipient, content, { mock: options?.mock })

    if (sendRes.success) {
      succeeded++
      await resolveSuccess(supabase, row, sendRes.providerMessageId)
      items.push({
        outboxId: row.id,
        messageId: row.message_id || null,
        recipient,
        status: 'sent',
        providerMessageId: sendRes.providerMessageId,
        attempts: (row.attempts || 0) + 1
      })
    } else {
      failed++
      await resolveFailure(supabase, row, sendRes.error)
      items.push({
        outboxId: row.id,
        messageId: row.message_id || null,
        recipient,
        status: 'failed',
        error: sendRes.error,
        attempts: (row.attempts || 0) + 1
      })
    }
  }

  return {
    success: true,
    processed: claimedRows?.length || 0,
    succeeded,
    failed,
    elapsedMs: Date.now() - startTime,
    items
  }
}

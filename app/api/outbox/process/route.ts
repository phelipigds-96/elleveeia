import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface OutboxProcessOptions {
  batchSize?: number
  leaseSeconds?: number
  mock?: boolean
}

interface OutboxItemResult {
  outboxId: string
  messageId: string | null
  recipient: string
  status: 'sent' | 'failed'
  providerMessageId?: string | null
  error?: string
  attempts: number
}

interface OutboxProcessSummary {
  success: boolean
  processed: number
  succeeded: number
  failed: number
  elapsedMs: number
  items: OutboxItemResult[]
  error?: string
}

/**
 * Validação de autorização do processador de outbox.
 * Suporta:
 * 1. Bearer Token no cabeçalho Authorization
 * 2. Cabeçalho x-cron-secret ou x-api-key
 * 3. Query param ?secret=... ou ?token=...
 * Caso CRON_SECRET não esteja definido no ambiente (ex: desenvolvimento local), permite execução controlada.
 */
function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return true
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.trim() === `Bearer ${cronSecret}`) {
    return true
  }

  const headerSecret = request.headers.get('x-cron-secret') || request.headers.get('x-api-key')
  if (headerSecret && headerSecret === cronSecret) {
    return true
  }

  try {
    const url = new URL(request.url)
    const token = url.searchParams.get('secret') || url.searchParams.get('token')
    if (token && token === cronSecret) {
      return true
    }
  } catch {}

  return false
}

/**
 * Extrai destinatário e conteúdo de texto da mensagem a partir da outbox.
 */
function extractRecipientAndContent(row: any): { recipient: string; content: string } {
  let recipient = (
    row.recipient ||
    row.payload?.recipient ||
    row.payload?.customer?.phone ||
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
 * Efetua requisição HTTP nativa (fetch) para a API do Gateway (Evolution API).
 */
async function sendToGateway(
  recipient: string,
  content: string,
  options?: { mock?: boolean }
): Promise<{ success: boolean; providerMessageId?: string | null; error?: string }> {
  // Modo Mock para validações e testes unitários locais
  if (options?.mock || process.env.EVOLUTION_API_URL === 'mock') {
    return {
      success: true,
      providerMessageId: `mock-${crypto.randomUUID()}`
    }
  }

  const rawUrl = process.env.EVOLUTION_API_URL
  if (!rawUrl) {
    return {
      success: false,
      error: 'Variável de ambiente EVOLUTION_API_URL não configurada no servidor.'
    }
  }

  const apiKey = process.env.EVOLUTION_API_KEY || ''
  const instance = process.env.EVOLUTION_INSTANCE_NAME || 'default'

  // Normalização do endpoint da Evolution API
  let targetUrl = rawUrl.trim()
  if (!targetUrl.includes('/message/sendText')) {
    targetUrl = `${targetUrl.replace(/\/+$/, '')}/message/sendText/${instance}`
  }

  // Payload padrão: { "number": recipient, "text": content }
  const payload = {
    number: recipient,
    text: content
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (apiKey) {
    headers['apikey'] = apiKey
  }

  // Timeout resiliente de 15 segundos com AbortController
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

      // Extrai ID gerado pelo WhatsApp / Evolution API
      const providerMessageId =
        data?.key?.id ||
        data?.messageId ||
        data?.id ||
        data?.keyId ||
        null

      return {
        success: true,
        providerMessageId
      }
    } else {
      const errText = await response.text().catch(() => '')
      return {
        success: false,
        error: `Gateway HTTP ${response.status} (${response.statusText}): ${errText.slice(0, 300)}`
      }
    }
  } catch (err: any) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'Timeout na requisição para o gateway (limite de 15s excedido)'
      }
    }
    return {
      success: false,
      error: `Falha de rede/conexão com gateway: ${err?.message || String(err)}`
    }
  }
}

/**
 * Trava atomicamente um lote de mensagens pendentes usando UPDATE ... RETURNING seguro.
 * Previne concorrência e envios duplicados entre instâncias de workers.
 */
async function claimPendingOutboxRows(supabase: any, batchSize: number, leaseSeconds: number) {
  const now = new Date()
  const lockedUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  const claimToken = crypto.randomUUID()

  // 1. Busca mensagens elegíveis: status 'pending' ou 'processing' com lease expirado
  const { data: candidates, error: searchError } = await supabase
    .from('message_outbox')
    .select('id, company_id, conversation_id, message_id, channel, recipient, payload, status, attempts, created_at')
    .or(`status.eq.pending,and(status.eq.processing,locked_until.lt.${now.toISOString()})`)
    .lt('attempts', 5)
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (searchError) {
    throw new Error(`Falha ao consultar message_outbox: ${searchError.message}`)
  }

  if (!candidates || candidates.length === 0) {
    return []
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

  return claimedRows || []
}

/**
 * Atualiza o banco após envio com sucesso (message_outbox e messages).
 */
async function resolveSuccess(supabase: any, row: any, providerMessageId?: string | null) {
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
    console.error(`[OutboxProcessor] Erro ao marcar outbox ${row.id} como sent:`, outboxUpdateErr)
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
async function resolveFailure(supabase: any, row: any, errorMessage?: string) {
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
    console.error(`[OutboxProcessor] Erro ao marcar outbox ${row.id} como failed:`, outboxFailErr)
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
 * Motor central de processamento da fila de saída (Outbox Processor).
 */
async function processOutboxQueue(options?: OutboxProcessOptions): Promise<OutboxProcessSummary> {
  const startTime = Date.now()
  const supabase = createAdminClient()
  const batchSize = Math.max(1, Math.min(50, options?.batchSize || 10))
  const leaseSeconds = Math.max(15, Math.min(300, options?.leaseSeconds || 60))

  const claimedRows = await claimPendingOutboxRows(supabase, batchSize, leaseSeconds)

  const items: OutboxItemResult[] = []
  let succeeded = 0
  let failed = 0

  for (const row of claimedRows) {
    let { recipient, content } = extractRecipientAndContent(row)

    // Se o conteúdo estiver ausente no payload, busca na tabela messages
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

    const sendRes = await sendToGateway(recipient, content, { mock: options?.mock })

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
    processed: claimedRows.length,
    succeeded,
    failed,
    elapsedMs: Date.now() - startTime,
    items
  }
}

/**
 * Handler GET: permite trigger manual ou via agendador cron.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 })
  }

  try {
    const url = new URL(request.url)
    const qBatch = url.searchParams.get('batch_size') || url.searchParams.get('batchSize')
    const qLease = url.searchParams.get('lease_seconds') || url.searchParams.get('leaseSeconds')
    const qMock = url.searchParams.get('mock') === 'true'

    const batchSize = qBatch && !isNaN(Number(qBatch)) ? Number(qBatch) : undefined
    const leaseSeconds = qLease && !isNaN(Number(qLease)) ? Number(qLease) : undefined

    const result = await processOutboxQueue({ batchSize, leaseSeconds, mock: qMock })
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[OutboxProcessor GET Error]:', err?.message || err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Erro interno no processamento da outbox' },
      { status: 500 }
    )
  }
}

/**
 * Handler POST: permite trigger via webhook com payload configurável.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 })
  }

  try {
    const url = new URL(request.url)
    let batchSize = url.searchParams.get('batch_size') ? Number(url.searchParams.get('batch_size')) : undefined
    let leaseSeconds = url.searchParams.get('lease_seconds') ? Number(url.searchParams.get('lease_seconds')) : undefined
    let mock = url.searchParams.get('mock') === 'true'

    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}))
      if (body?.batch_size && !isNaN(Number(body.batch_size))) {
        batchSize = Number(body.batch_size)
      } else if (body?.batchSize && !isNaN(Number(body.batchSize))) {
        batchSize = Number(body.batchSize)
      }

      if (body?.lease_seconds && !isNaN(Number(body.lease_seconds))) {
        leaseSeconds = Number(body.lease_seconds)
      } else if (body?.leaseSeconds && !isNaN(Number(body.leaseSeconds))) {
        leaseSeconds = Number(body.leaseSeconds)
      }

      if (body?.mock === true) {
        mock = true
      }
    }

    const result = await processOutboxQueue({ batchSize, leaseSeconds, mock })
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[OutboxProcessor POST Error]:', err?.message || err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Erro interno no processamento da outbox' },
      { status: 500 }
    )
  }
}

import { createAdminClient } from '@/lib/supabase/service'
import { WebhookPayload } from '@/lib/validations/webhook'

export async function processWebhookEvent(companyId: string, payload: WebhookPayload) {
  const supabase = createAdminClient()

  // 1. Controle de Idempotência
  // Registra o evento. Se já existir o par company_id + event_id (Violate Unique Constraint), retornamos duplicate
  const { data: eventRecord, error: eventError } = await supabase.from('webhook_events').insert({
    company_id: companyId,
    event_id: payload.event_id,
    event_type: payload.event_type,
    payload: payload,
    status: 'processing'
  }).select().single()

  if (eventError) {
    // 23505 = Unique_violation em PostgreSQL
    if (eventError.code === '23505') {
      return { success: true, duplicate: true, event_id: payload.event_id }
    }
    throw new Error(`Falha ao registrar webhook event: ${eventError.message}`)
  }

  try {
    // 2. Customer Upsert (Localiza ou Cria cliente baseado em Company + Phone)
    let customerId: string
    const { data: existingCustomer } = await supabase.from('customers')
      .select('id').eq('company_id', companyId).eq('phone', payload.customer.phone).single()
    
    if (existingCustomer) {
      customerId = existingCustomer.id
      // Atualiza o nome do cliente se necessário
      await supabase.from('customers').update({ name: payload.customer.name }).eq('id', customerId)
    } else {
      const { data: newCustomer, error: cErr } = await supabase.from('customers').insert({
        company_id: companyId,
        name: payload.customer.name,
        phone: payload.customer.phone,
        email: payload.customer.email || null
      }).select().single()
      
      if (cErr) throw new Error('Falha ao criar cliente: ' + cErr.message)
      customerId = newCustomer.id
    }

    // 3. Conversation Upsert (Localiza por External ID ou busca conversa ativa para o cliente)
    let conversationId: string
    let convStatus = 'open'
    let currentUnread = 0
    
    let convQuery = supabase.from('conversations')
      .select('id, status, unread_count')
      .eq('company_id', companyId)
      
    if (payload.conversation?.external_id) {
      convQuery = convQuery.eq('external_id', payload.conversation.external_id)
    } else {
      // Se a integração nao manda ID de conversa, procura uma conversa que não esteja fechada do mesmo cliente no mesmo canal
      convQuery = convQuery.eq('customer_id', customerId)
        .eq('channel', payload.channel)
        .neq('status', 'closed')
    }

    const { data: existingConv } = await convQuery.maybeSingle()

    if (existingConv) {
      conversationId = existingConv.id
      convStatus = existingConv.status
      currentUnread = existingConv.unread_count
      
      // Regra de reabertura automática de conversa
      if (convStatus === 'closed' && payload.message.sender_type === 'customer') {
         convStatus = 'open'
      }
    } else {
      const { data: newConv, error: cvErr } = await supabase.from('conversations').insert({
        company_id: companyId,
        customer_id: customerId,
        channel: payload.channel,
        external_id: payload.conversation?.external_id || null,
        status: 'open'
      }).select().single()
      
      if (cvErr) throw new Error('Falha ao criar conversa: ' + cvErr.message)
      conversationId = newConv.id
    }

    // 4. Inserção da Mensagem
    const messageCreatedAt = payload.message.created_at || new Date().toISOString()
    const { data: msg, error: msgErr } = await supabase.from('messages').insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: payload.message.sender_type,
      content: payload.message.content,
      message_type: payload.message.message_type || 'text',
      external_id: payload.message.external_id || null,
      metadata: payload.metadata || null,
      created_at: messageCreatedAt
    }).select().single()
    
    if (msgErr) throw new Error('Falha ao inserir mensagem: ' + msgErr.message)

    // 5. Atualização de estado da Conversa
    let newUnread = currentUnread
    if (payload.message.sender_type === 'customer') {
      newUnread += 1
    }
    
    await supabase.from('conversations').update({
      status: convStatus,
      unread_count: newUnread,
      last_message_at: messageCreatedAt,
      closed_at: convStatus === 'open' ? null : undefined, // anula se reabriu
      updated_at: new Date().toISOString()
    }).eq('id', conversationId)

    // 6. Finaliza a transação lógica marcando o evento como processado
    await supabase.from('webhook_events').update({
      status: 'processed',
      processed_at: new Date().toISOString()
    }).eq('id', eventRecord.id)

    return {
      success: true,
      duplicate: false,
      event_id: payload.event_id,
      conversation_id: conversationId,
      message_id: msg.id
    }

  } catch (err: any) {
    // Falha em cascata detectada. Marca o evento como error na camada mais baixa.
    await supabase.from('webhook_events').update({
      status: 'error',
      error_message: err.message
    }).eq('id', eventRecord.id)
    
    throw err
  }
}

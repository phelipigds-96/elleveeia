'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getCompanyId() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single()
  return profile?.company_id
}

export async function getConversations(filter = 'all', search = '') {
  const supabase = createClient()
  
  let query = supabase
    .from('conversations')
    .select('*, customers(*)')
    .order('last_message_at', { ascending: false })

  if (filter === 'open') query = query.eq('status', 'open')
  if (filter === 'closed') query = query.eq('status', 'closed')
  if (filter === 'human') query = query.eq('status', 'human')

  const { data, error } = await query

  if (error || !data) {
    console.error('Error fetching conversations:', error)
    return []
  }

  let filteredData = data

  if (search) {
    const s = search.toLowerCase()
    filteredData = data.filter((c: any) => 
      c.customers?.name?.toLowerCase().includes(s) || 
      c.customers?.phone?.includes(s)
    )
  }

  return filteredData
}

export async function getConversation(id: string) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('conversations')
    .select('*, customers(*)')
    .eq('id', id)
    .single()
    
  if (error) return null
  return data
}

export async function getMessages(conversationId: string) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    
  if (error) return []
  return data
}

export async function sendMessage(conversationId: string, content: string) {
  if (!content.trim()) return null

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const companyId = await getCompanyId()
  if (!companyId) return null

  // 1. Persist local message
  const { data: message, error } = await supabase.from('messages').insert({
    company_id: companyId,
    conversation_id: conversationId,
    sender_type: 'human',
    sender_id: user.id,
    content,
    message_type: 'text'
  }).select().single()

  if (error) {
    console.error('Error sending message:', error)
    return null
  }

  // Update conversation last_message_at
  await supabase.from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId)

  // 2. Fetch customer details to build the outbound payload
  const { data: conv } = await supabase.from('conversations').select('*, customers(phone)').eq('id', conversationId).single()

  // 3. Dispatch to n8n (Outbound)
  // We use dynamic import so it doesn't break if not available, but since we created it, it is.
  const { sendOutboundMessage } = await import('@/lib/services/n8n-service')
  
  const outboundPayload = {
    event_id: `outbound-${message.id}`,
    event_type: 'message.send',
    channel: conv?.channel || 'whatsapp',
    conversation_id: conversationId,
    customer: {
      phone: conv?.customers?.phone
    },
    message: {
      content: content,
      message_type: 'text'
    },
    metadata: {}
  }
  
  await sendOutboundMessage(companyId, outboundPayload)

  revalidatePath('/conversations')
  return message
}

export async function updateConversationStatus(conversationId: string, status: string) {
  const supabase = createClient()
  
  const updateData: any = { status, updated_at: new Date().toISOString() }
  if (status === 'closed') {
    updateData.closed_at = new Date().toISOString()
  } else {
    updateData.closed_at = null
  }

  const { error } = await supabase.from('conversations')
    .update(updateData)
    .eq('id', conversationId)

  if (error) {
    console.error('Error updating status:', error)
    return false
  }

  revalidatePath('/conversations')
  return true
}

export async function markAsRead(conversationId: string) {
  const supabase = createClient()
  await supabase.from('conversations')
    .update({ unread_count: 0 })
    .eq('id', conversationId)
}

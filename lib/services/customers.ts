import { createAdminClient } from '@/lib/supabase/service'
import { isPlausibleHumanName } from '@/lib/services/customer-name'

export interface CustomerListItem {
  id: string
  name: string
  whatsapp_name: string | null
  name_confirmed: boolean
  name_source: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
  latest_conversation_id: string | null
  last_interaction_at: string | null
  latest_channel: string | null
  latest_status: 'open' | 'human' | 'closed' | null
  conversations_count: number
}

export interface ListCompanyCustomersResult {
  customers: CustomerListItem[]
  migrationPending: boolean
}

export async function listCompanyCustomers(companyId: string): Promise<ListCompanyCustomersResult> {
  const supabase = createAdminClient()
  let migrationPending = false

  // 1. Consulta clientes com fallback gracioso para colunas opcionais (42703)
  let rawCustomers: any[] | null = null

  const fullRes = await supabase
    .from('customers')
    .select(
      'id, name, phone, email, address, notes, avatar_url, whatsapp_name, name_confirmed, name_source, created_at, updated_at'
    )
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })

  if (!fullRes.error) {
    rawCustomers = fullRes.data || []
  } else if (fullRes.error.code === '42703') {
    migrationPending = true
    const midRes = await supabase
      .from('customers')
      .select('id, name, phone, email, address, notes, avatar_url, created_at, updated_at')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })

    if (!midRes.error) {
      rawCustomers = midRes.data || []
    } else if (midRes.error.code === '42703') {
      const baseRes = await supabase
        .from('customers')
        .select('id, name, phone, email, created_at, updated_at')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false })

      if (baseRes.error) {
        console.error('[listCompanyCustomers] Erro ao carregar clientes:', baseRes.error.message)
      }
      rawCustomers = baseRes.data || []
    } else {
      console.error('[listCompanyCustomers] Erro ao carregar clientes:', midRes.error.message)
      rawCustomers = []
    }
  } else {
    console.error('[listCompanyCustomers] Erro ao carregar clientes:', fullRes.error.message)
    rawCustomers = []
  }

  // 2. Carrega conversas para identificar última interação, canal e status atual de cada cliente
  const { data: rawConversations, error: convError } = await supabase
    .from('conversations')
    .select('id, customer_id, channel, status, last_message_at, updated_at, created_at')
    .eq('company_id', companyId)
    .not('customer_id', 'is', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })

  if (convError) {
    console.error('[listCompanyCustomers] Erro ao carregar conversas:', convError.message)
  }

  const latestConvByCustomer = new Map<
    string,
    {
      id: string
      last_interaction_at: string | null
      channel: string | null
      status: 'open' | 'human' | 'closed' | null
      count: number
    }
  >()

  for (const conv of rawConversations || []) {
    if (!conv.customer_id) continue
    const interactionTs = conv.last_message_at || conv.updated_at || conv.created_at || null
    const existing = latestConvByCustomer.get(conv.customer_id)
    if (!existing) {
      latestConvByCustomer.set(conv.customer_id, {
        id: conv.id,
        last_interaction_at: interactionTs,
        channel: conv.channel || null,
        status: (conv.status as 'open' | 'human' | 'closed') || null,
        count: 1,
      })
    } else {
      existing.count += 1
    }
  }

  // 3. Consolida e ordena pela interação mais recente (ou atualização do cadastro)
  const customers: CustomerListItem[] = (rawCustomers || []).map((c: any) => {
    const convInfo = latestConvByCustomer.get(c.id)
    const confirmed =
      typeof c.name_confirmed === 'boolean'
        ? c.name_confirmed
        : isPlausibleHumanName(c.name)

    return {
      id: c.id,
      name: c.name || 'Cliente',
      whatsapp_name: c.whatsapp_name ?? null,
      name_confirmed: confirmed,
      name_source: c.name_source ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
      address: c.address ?? null,
      notes: c.notes ?? null,
      avatar_url: c.avatar_url ?? null,
      created_at: c.created_at,
      updated_at: c.updated_at,
      latest_conversation_id: convInfo?.id ?? null,
      last_interaction_at: convInfo?.last_interaction_at ?? c.updated_at ?? c.created_at ?? null,
      latest_channel: convInfo?.channel ?? null,
      latest_status: convInfo?.status ?? null,
      conversations_count: convInfo?.count ?? 0,
    }
  })

  customers.sort((a, b) => {
    const tA = a.last_interaction_at ? Date.parse(a.last_interaction_at) : 0
    const tB = b.last_interaction_at ? Date.parse(b.last_interaction_at) : 0
    return tB - tA
  })

  return {
    customers,
    migrationPending,
  }
}

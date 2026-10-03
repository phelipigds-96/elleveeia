'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCompanyId } from '@/lib/services/conversations'
import { testN8nConnection } from '@/lib/services/n8n-service'

export async function getN8nIntegration() {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) return null

  const { data } = await supabase.from('integrations')
    .select('*')
    .eq('company_id', companyId)
    .eq('type', 'n8n')
    .single()

  if (data) {
    // Hide secret
    if (data.credentials?.webhook_secret) {
      data.credentials.webhook_secret = '••••••••••••••••'
    }
  }

  return data
}

export async function saveN8nIntegration(url: string, secret: string) {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) throw new Error('Unauthorized')

  // Run the test before saving
  const testResult = await testN8nConnection(url, secret)
  if (!testResult.success) {
    throw new Error(testResult.message)
  }

  const { data: existing } = await supabase.from('integrations')
    .select('id, credentials')
    .eq('company_id', companyId)
    .eq('type', 'n8n')
    .single()

  const finalSecret = secret === '••••••••••••••••' && existing?.credentials?.webhook_secret 
    ? existing.credentials.webhook_secret 
    : secret

  if (existing) {
    await supabase.from('integrations').update({
      config: { webhook_url: url },
      credentials: { webhook_secret: finalSecret },
      status: 'active',
      name: 'n8n Workflow',
      updated_at: new Date().toISOString()
    }).eq('id', existing.id)
  } else {
    await supabase.from('integrations').insert({
      company_id: companyId,
      type: 'n8n',
      name: 'n8n Workflow',
      status: 'active',
      config: { webhook_url: url },
      credentials: { webhook_secret: finalSecret }
    })
  }

  revalidatePath('/integrations')
}

export async function disconnectN8n() {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) throw new Error('Unauthorized')

  await supabase.from('integrations')
    .delete()
    .eq('company_id', companyId)
    .eq('type', 'n8n')

  revalidatePath('/integrations')
}

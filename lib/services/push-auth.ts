import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/service'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function resolvePushSessionContext() {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return null
  }

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('company_id, role, full_name')
    .eq('id', user.id)
    .maybeSingle()

  let companyId = profile?.company_id || null

  if (profile?.role === 'master') {
    const cookieStore = cookies()
    const impersonateId = cookieStore.get('ellevee_impersonate_active')?.value
    if (impersonateId && UUID_REGEX.test(impersonateId)) {
      companyId = impersonateId
    }
  }

  if (!companyId) {
    return null
  }

  return {
    userId: user.id,
    companyId,
    role: profile?.role || 'attendant',
    fullName: profile?.full_name || null,
    adminClient,
  }
}

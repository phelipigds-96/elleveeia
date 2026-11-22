import { createAdminClient } from '@/lib/supabase/service'
import { resolveEffectiveSessionContext } from '@/lib/services/platform/impersonation'

export async function resolvePushSessionContext() {
  try {
    const sessionContext = await resolveEffectiveSessionContext()
    if (!sessionContext?.effectiveCompanyId || sessionContext.effectiveCompanyId === '00000000-0000-0000-0000-000000000000') {
      return null
    }

    const adminClient = createAdminClient()
    return {
      userId: sessionContext.userId,
      companyId: sessionContext.effectiveCompanyId,
      role: sessionContext.effectiveRole,
      fullName: sessionContext.userName || null,
      adminClient,
    }
  } catch {
    return null
  }
}

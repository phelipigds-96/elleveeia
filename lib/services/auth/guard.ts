import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export interface CurrentUserProfile {
  id: string
  email: string
  full_name: string | null
  role: 'owner' | 'admin' | 'attendant' | 'user' | string
  company_id: string | null
}

/**
 * Obtém o perfil autenticado atual do usuário
 */
export async function getCurrentUserProfile(): Promise<CurrentUserProfile | null> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, company_id')
      .eq('id', user.id)
      .maybeSingle()

    return profile || null
  } catch {
    return null
  }
}

/**
 * Exige que o usuário seja Administrador ou Owner da empresa.
 * Se for Atendente (ou usuário comum restrito), redireciona compulsoriamente para /conversations.
 */
export async function requireCompanyAdmin(): Promise<CurrentUserProfile> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, company_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) {
    redirect('/login')
  }

  // Se estiver em modo Impersonate do SuperAdmin, opera com poderes de Admin na empresa alvo
  try {
    const { cookies } = await import('next/headers')
    const cookieStore = cookies()
    const impersonateId = cookieStore.get('ellevee_impersonate_active')?.value
    if (impersonateId) {
      return {
        id: user.id,
        email: profile.email || user.email || '',
        full_name: profile.full_name || 'Administrador',
        role: 'admin',
        company_id: impersonateId,
      }
    }
  } catch {
    // segue fluxo normal
  }

  // Atendentes e operadores comuns têm acesso exclusivo ao chat/conversas
  if (profile.role === 'attendant' || profile.role === 'user') {
    redirect('/conversations')
  }

  return profile
}

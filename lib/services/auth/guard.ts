import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export interface CurrentUserProfile {
  id: string
  email: string
  full_name: string | null
  role: 'owner' | 'admin' | 'attendant' | 'user' | string
  company_id: string | null
}

export class TenantAuthError extends Error {
  statusCode: number
  code: string

  constructor(message: string, statusCode: number = 403, code: string = 'FORBIDDEN') {
    super(message)
    this.name = 'TenantAuthError'
    this.statusCode = statusCode
    this.code = code
  }
}

export interface AssertTenantAdminOptions {
  client?: any
  allowedRoles?: string[]
  targetCompanyId?: string
}

/**
 * Validação rigorosa em tempo de execução de autorização administrativa do Tenant no servidor.
 * Rejeita incondicionalmente atendentes, usuários comuns ou operadores sem papel administrativo.
 * Previne IDOR garantindo que o tenant autenticado corresponda ao targetCompanyId especificado.
 */
export async function assertTenantAdmin(options: AssertTenantAdminOptions = {}): Promise<CurrentUserProfile> {
  const supabase = options.client || (await createClient())
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new TenantAuthError('Usuário não autenticado.', 401, 'UNAUTHORIZED')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, company_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || !profile.company_id) {
    throw new TenantAuthError('Perfil de usuário ou vínculo empresarial não localizado.', 403, 'NO_COMPANY')
  }

  // SuperAdmin da plataforma (role 'master') possui autorização global
  if (profile.role === 'master') {
    return {
      ...profile,
      company_id: options.targetCompanyId || profile.company_id,
    }
  }

  const allowedRoles = options.allowedRoles || ['owner', 'admin']
  if (!allowedRoles.includes(profile.role)) {
    throw new TenantAuthError('Ação restrita a administradores e proprietários da empresa.', 403, 'FORBIDDEN_ROLE')
  }

  // Prevenção estrita de IDOR: operador não pode agir em nome de outro tenant
  if (options.targetCompanyId && options.targetCompanyId !== profile.company_id) {
    throw new TenantAuthError('Acesso não autorizado aos recursos de outra empresa.', 403, 'TENANT_MISMATCH')
  }

  return profile
}

/**
 * Obtém o perfil autenticado atual do usuário
 */
export async function getCurrentUserProfile(): Promise<CurrentUserProfile | null> {
  try {
    const supabase = await createClient()
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
  const supabase = await createClient()
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

  // Se estiver em modo Impersonate do SuperAdmin (exclusivo para role master com UUID válido)
  if (profile.role === 'master') {
    try {
      const { cookies } = await import('next/headers')
      const cookieStore = await cookies()
      const impersonateId = cookieStore.get('ellevee_impersonate_active')?.value
      if (impersonateId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(impersonateId)) {
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
  }

  // Atendentes e operadores comuns têm acesso exclusivo ao chat/conversas
  if (profile.role === 'attendant' || profile.role === 'user') {
    redirect('/conversations')
  }

  return profile
}

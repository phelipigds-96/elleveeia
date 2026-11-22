import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveEffectiveSessionContext } from '@/lib/services/platform/impersonation'

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
  let sessionContext
  try {
    sessionContext = await resolveEffectiveSessionContext({
      contextGuard: options.targetCompanyId ? { expectedCompanyId: options.targetCompanyId } : undefined,
      injectedUserClient: options.client,
    })
  } catch (err: any) {
    if (err.code === 'UNAUTHORIZED' || err.statusCode === 401) {
      throw new TenantAuthError('Usuário não autenticado.', 401, 'UNAUTHORIZED')
    }
    if (err.code === 'TENANT_CONTEXT_MISMATCH' || err.code === 'TENANT_MISMATCH' || err.statusCode === 403) {
      throw new TenantAuthError('Acesso não autorizado aos recursos de outra empresa.', 403, 'TENANT_MISMATCH')
    }
    throw new TenantAuthError(err.message || 'Falha na autenticação do tenant.', err.statusCode || 401, err.code || 'UNAUTHORIZED')
  }

  if (!sessionContext?.effectiveCompanyId || sessionContext.effectiveCompanyId === '00000000-0000-0000-0000-000000000000') {
    throw new TenantAuthError('Perfil de usuário ou vínculo empresarial não localizado.', 403, 'NO_COMPANY')
  }

  // SuperAdmin da plataforma em rota administrativa
  if (sessionContext.isPlatformAdmin && !sessionContext.isImpersonating) {
    return {
      id: sessionContext.userId,
      email: sessionContext.operatorEmail,
      full_name: sessionContext.userName,
      role: 'owner',
      company_id: options.targetCompanyId || sessionContext.effectiveCompanyId,
    }
  }

  // Em sessão de suporte ativa
  if (sessionContext.isImpersonating) {
    if (options.targetCompanyId && options.targetCompanyId !== sessionContext.effectiveCompanyId) {
      throw new TenantAuthError('Acesso não autorizado aos recursos de outra empresa.', 403, 'TENANT_MISMATCH')
    }
    return {
      id: sessionContext.userId,
      email: sessionContext.operatorEmail,
      full_name: sessionContext.userName,
      role: sessionContext.effectiveRole,
      company_id: sessionContext.effectiveCompanyId,
    }
  }

  // Usuário comum do tenant
  const allowedRoles = options.allowedRoles || ['owner', 'admin']
  if (!allowedRoles.includes(sessionContext.effectiveRole)) {
    throw new TenantAuthError('Ação restrita a administradores e proprietários da empresa.', 403, 'FORBIDDEN_ROLE')
  }

  if (options.targetCompanyId && options.targetCompanyId !== sessionContext.effectiveCompanyId) {
    throw new TenantAuthError('Acesso não autorizado aos recursos de outra empresa.', 403, 'TENANT_MISMATCH')
  }

  return {
    id: sessionContext.userId,
    email: sessionContext.operatorEmail,
    full_name: sessionContext.userName,
    role: sessionContext.effectiveRole,
    company_id: sessionContext.effectiveCompanyId,
  }
}

/**
 * Obtém o perfil autenticado atual do usuário
 */
export async function getCurrentUserProfile(): Promise<CurrentUserProfile | null> {
  try {
    const sessionContext = await resolveEffectiveSessionContext()
    return {
      id: sessionContext.userId,
      email: sessionContext.operatorEmail,
      full_name: sessionContext.userName,
      role: sessionContext.effectiveRole,
      company_id: sessionContext.effectiveCompanyId,
    }
  } catch {
    return null
  }
}

/**
 * Exige que o usuário seja Administrador ou Owner da empresa.
 * Se for Atendente (ou usuário comum restrito), redireciona compulsoriamente para /conversations.
 */
export async function requireCompanyAdmin(): Promise<CurrentUserProfile> {
  let sessionContext
  try {
    sessionContext = await resolveEffectiveSessionContext()
  } catch {
    redirect('/login')
  }

  if (!sessionContext) {
    redirect('/login')
  }

  if (sessionContext.isPlatformAdmin && !sessionContext.isImpersonating) {
    return {
      id: sessionContext.userId,
      email: sessionContext.operatorEmail,
      full_name: sessionContext.userName,
      role: 'owner',
      company_id: sessionContext.effectiveCompanyId,
    }
  }

  if (sessionContext.isImpersonating) {
    return {
      id: sessionContext.userId,
      email: sessionContext.operatorEmail,
      full_name: sessionContext.userName,
      role: sessionContext.effectiveRole,
      company_id: sessionContext.effectiveCompanyId,
    }
  }

  if ((sessionContext.effectiveRole as string) === 'attendant' || (sessionContext.effectiveRole as string) === 'user') {
    redirect('/conversations')
  }

  return {
    id: sessionContext.userId,
    email: sessionContext.operatorEmail,
    full_name: sessionContext.userName,
    role: sessionContext.effectiveRole,
    company_id: sessionContext.effectiveCompanyId,
  }
}

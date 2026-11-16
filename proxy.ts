import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

/**
 * Proxy de Perímetro Next.js 16 (convenção oficial de proxy de rede)
 * Executa a renovação transparente de sessão Supabase e roteamento de proteção.
 */
export async function proxy(request: NextRequest) {
  // Permite acesso exclusivo a recursos públicos estáticos PWA e endpoints M2M protegidos por token/assinatura
  if (
    request.nextUrl.pathname === '/sw.js' ||
    request.nextUrl.pathname === '/manifest.webmanifest' ||
    request.nextUrl.pathname.startsWith('/icons/') ||
    request.nextUrl.pathname.startsWith('/api/webhooks') ||
    request.nextUrl.pathname.startsWith('/api/cron') ||
    request.nextUrl.pathname.startsWith('/api/outbox')
  ) {
    return NextResponse.next()
  }

  return await updateSession(request)
}

export default proxy

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

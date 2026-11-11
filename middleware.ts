import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  // 1. Permite acesso aos webhooks e crons sem exigir sessão de usuário
  // 2. Permite acesso às rotas do SuperAdmin e Chat durante homologação visual
  if (
    request.nextUrl.pathname === '/sw.js' ||
    request.nextUrl.pathname === '/manifest.webmanifest' ||
    request.nextUrl.pathname.startsWith('/icons/') ||
    request.nextUrl.pathname.startsWith('/api/push') ||
    request.nextUrl.pathname.startsWith('/api/webhooks') ||
    request.nextUrl.pathname.startsWith('/api/cron') ||
    request.nextUrl.pathname.startsWith('/api/outbox') ||
    request.nextUrl.pathname.startsWith('/paineladmin') ||
    request.nextUrl.pathname.startsWith('/companies') ||
    request.nextUrl.pathname.startsWith('/plans') ||
    request.nextUrl.pathname.startsWith('/agents') ||
    request.nextUrl.pathname.startsWith('/providers') ||
    request.nextUrl.pathname.startsWith('/audit') ||
    request.nextUrl.pathname.startsWith('/admin-settings') ||
    request.nextUrl.pathname.startsWith('/conversations')
  ) {
    return NextResponse.next()
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

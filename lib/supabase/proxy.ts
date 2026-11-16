import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Webhooks já são ignorados no proxy, mas garantimos aqui também
  if (pathname.startsWith('/api/webhooks')) {
    return NextResponse.next()
  }

  const hasAuthCookie = request.cookies.getAll().some(
    (c) => c.name.includes('-auth-token')
  )

  const isPublicRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/auth')

  // Se não tem cookie de autenticação e já está em rota pública, não precisa chamar o Supabase
  if (!hasAuthCookie && isPublicRoute) {
    return NextResponse.next({
      request: {
        headers: request.headers,
      },
    })
  }

  // Se não tem cookie de autenticação e está tentando acessar rota protegida ou a raiz (/), redireciona direto
  if (!hasAuthCookie && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Se tem cookie de autenticação, inicializa o cliente com o adaptador moderno getAll / setAll
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Timeout de segurança (2.5s) para não prender a requisição em lentidão de rede
  const timeoutPromise = new Promise<{ data: { user: null }; error: Error }>((resolve) => {
    setTimeout(() => {
      resolve({ data: { user: null }, error: new Error('SUPABASE_AUTH_TIMEOUT_2500MS') })
    }, 2500)
  })

  let userResult: any
  try {
    userResult = await Promise.race([
      supabase.auth.getUser(),
      timeoutPromise
    ])
  } catch (err) {
    userResult = { data: { user: null }, error: err }
  }

  const { data: { user }, error } = userResult

  if (error?.message === 'SUPABASE_AUTH_TIMEOUT_2500MS') {
    console.warn('[Proxy Supabase] Timeout de 2.5s ao validar sessão em rota protegida:', pathname)
    if (!isPublicRoute) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/conversations'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

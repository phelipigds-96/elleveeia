'use client'

import { useState } from 'react'
import Link from 'next/link'
import { login } from '../actions'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function onSubmit(formData: FormData) {
    setIsLoading(true)
    setError(null)

    const result = await login(formData)

    if (result?.error) {
      setError(result.error)
      setIsLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen w-full bg-background">
      {/* Coluna da marca — fundo de ícones em movimento suave */}
      <aside className="login-brand-panel relative hidden overflow-hidden lg:flex lg:w-1/2 lg:flex-col lg:justify-between lg:border-r lg:border-border lg:p-12">
        <div className="brand-blob brand-blob-1" aria-hidden />
        <div className="brand-blob brand-blob-2" aria-hidden />
        <div className="brand-blob brand-blob-3" aria-hidden />

        <div className="animated-bg" aria-hidden>
          {/* Balões de conversa */}
          <svg className="bg-icon icon-1" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 14h44a6 6 0 016 6v22a6 6 0 01-6 6H30L18 56v-8h-8a6 6 0 01-6-6V20a6 6 0 016-6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="24" cy="31" r="2.5" fill="currentColor" />
            <circle cx="32" cy="31" r="2.5" fill="currentColor" />
            <circle cx="40" cy="31" r="2.5" fill="currentColor" />
          </svg>
          <svg className="bg-icon icon-3" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 18h38a6 6 0 016 6v16a6 6 0 01-6 6H22l-10 8v-8h-4a6 6 0 01-6-6V24a6 6 0 016-6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M18 30h16M18 37h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <svg className="bg-icon icon-6" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 12h40a4 4 0 014 4v24a4 4 0 01-4 4H30L20 52v-8h-8a4 4 0 01-4-4V16a4 4 0 014-4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="26" cy="28" r="2.5" fill="currentColor" />
            <circle cx="38" cy="28" r="2.5" fill="currentColor" />
          </svg>

          {/* Ícones de IA */}
          <svg className="bg-icon icon-2" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="16" y="16" width="32" height="32" rx="8" stroke="currentColor" strokeWidth="2" />
            <rect x="26" y="26" width="12" height="12" rx="3" fill="currentColor" opacity="0.7" />
            <path d="M24 16V8M32 16V8M40 16V8M24 56v-8M32 56v-8M40 56v-8M16 24H8M16 32H8M16 40H8M56 24h-8M56 32h-8M56 40h-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <svg className="bg-icon icon-4" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M32 6l6.5 17.5L56 30l-17.5 6.5L32 54l-6.5-17.5L8 30l17.5-6.5L32 6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="48" cy="16" r="4" fill="currentColor" opacity="0.75" />
          </svg>
          <svg className="bg-icon icon-7" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="24" stroke="currentColor" strokeWidth="2" strokeDasharray="6 6" />
            <path d="M24 30a8 8 0 0116 0v6a8 8 0 01-16 0v-6z" stroke="currentColor" strokeWidth="2" />
            <path d="M32 26v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>

          {/* Letra E da Ellevee */}
          <span className="bg-icon bg-letter icon-5">E</span>
          <span className="bg-icon bg-letter icon-8">E</span>
        </div>

        <div className="relative z-10 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ellevee-ink text-sm font-bold text-ellevee-white shadow-sm">
            E
          </span>
          <span className="text-lg font-semibold tracking-tight">Ellevee IA</span>
        </div>

        <div className="relative z-10 max-w-md space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-ellevee-sage/30 bg-ellevee-sage-light px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ellevee-sage-strong">
            <span className="h-1.5 w-1.5 rounded-full bg-ellevee-accent" />
            Plataforma de IA conversacional
          </span>
          <h2 className="font-display text-4xl font-extrabold leading-tight tracking-tight text-ellevee-ink">
            Soluções de IA para o seu negócio
          </h2>
          <p className="text-base leading-relaxed text-ellevee-ink-muted">
            Atendimento automatizado, funis de vendas e integrações em um só painel — do primeiro
            contato ao orçamento enviado.
          </p>
          <ul className="flex flex-wrap gap-2 pt-2">
            {['Conversas', 'Catálogo', 'Funil Kanban', 'Automações'].map((item) => (
              <li
                key={item}
                className="rounded-full border border-ellevee-stone bg-ellevee-white/80 px-3 py-1 text-xs font-medium text-ellevee-ink-muted shadow-sm backdrop-blur-sm"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-ellevee-sage-strong">
          © {new Date().getFullYear()} Ellevee IA. Todos os direitos reservados.
        </p>
      </aside>

      {/* Coluna de acesso */}
      <main className="relative flex min-h-screen w-full flex-1 flex-col justify-center px-6 py-12 sm:px-10 lg:w-1/2">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ellevee-ink text-sm font-bold text-ellevee-white shadow-sm">
              E
            </span>
            <span className="text-lg font-semibold tracking-tight">Ellevee IA</span>
          </div>

          <div className="space-y-2">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ellevee-ink">Entrar na sua conta</h1>
            <p className="text-sm text-ellevee-ink-muted">
              Use seu e-mail e senha para acessar o painel Ellevee IA
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive"
            >
              {error}
            </div>
          )}

          <form action={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none" htmlFor="email">
                E-mail
              </label>
              <input
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                id="email"
                name="email"
                placeholder="seu@email.com"
                type="email"
                autoComplete="email"
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none" htmlFor="password">
                Senha
              </label>
              <input
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={isLoading}
              />
            </div>
            <button
              className="inline-flex h-11 w-full items-center justify-center whitespace-nowrap rounded-md bg-ellevee-ink px-4 py-2 text-sm font-semibold text-ellevee-white transition-colors hover:bg-ellevee-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ellevee-sage focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              type="submit"
              disabled={isLoading}
            >
              {isLoading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-ellevee-ink-muted">
            Não tem uma conta?{' '}
            <Link href="/signup" className="font-semibold text-ellevee-sage-strong underline underline-offset-4 hover:text-ellevee-ink">
              Cadastre-se
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}

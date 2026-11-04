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
    <div className="relative min-h-screen w-full bg-muted/30">
      <div className="animated-bg" aria-hidden>
        <svg className="bg-icon icon-1" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="2" />
        </svg>
        <svg className="bg-icon icon-2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="0.5" />
        </svg>
        <svg className="bg-icon icon-3" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1" />
        </svg>
        <svg className="bg-icon icon-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C8 6 4 8 2 12c2 4 6 6 10 10s8-6 10-10c-2-4-6-6-10-10z" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>

      <div className="relative z-10 flex min-h-screen flex-col-reverse items-center justify-center gap-8 p-6 md:flex-row md:items-center">
        <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
          <div className="space-y-2 text-left">
            <h1 className="text-2xl font-semibold tracking-tight">Entrar na sua conta</h1>
            <p className="text-sm text-muted-foreground">
              Use seu e-mail e senha para acessar o painel Ellevee IA
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive font-medium text-center">
              {error}
            </div>
          )}

          <form action={onSubmit} className="mt-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none" htmlFor="email">
                E-mail
              </label>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                id="email"
                name="email"
                placeholder="seu@email.com"
                type="email"
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none" htmlFor="password">
                Senha
              </label>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                id="password"
                name="password"
                type="password"
                required
                disabled={isLoading}
              />
            </div>
            <button
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-full"
              type="submit"
              disabled={isLoading}
            >
              {isLoading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-muted-foreground">
            Não tem uma conta?{' '}
            <Link href="/signup" className="underline underline-offset-4 hover:text-primary">
              Cadastre-se
            </Link>
          </div>
        </div>

        <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
          <div className="rounded-lg p-6">
            <h2 className="text-4xl font-extrabold tracking-tight">Ellevee IA</h2>
            <p className="text-sm text-muted-foreground">Soluções de IA para seu negócio</p>
          </div>
        </div>
      </div>
    </div>
  )
}

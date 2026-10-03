'use client'

import { useState } from 'react'
import { updateCompany } from '@/lib/services/settings'
import { Loader2 } from 'lucide-react'

export function CompanyForm({ company }: { company: any }) {
  const [name, setName] = useState(company?.name || '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    setSuccess(null)

    const res = await updateCompany(name)

    if (res?.error) {
      setError(res.error)
    } else {
      setSuccess('Dados da empresa atualizados com sucesso.')
    }
    
    setIsSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-md dark:bg-emerald-950/50 dark:border-emerald-900">
          {success}
        </div>
      )}

      <div className="grid gap-2">
        <label className="text-sm font-medium leading-none" htmlFor="companyName">
          Nome da Empresa
        </label>
        <input
          id="companyName"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium leading-none" htmlFor="companySlug">
          Slug (Identificador único)
        </label>
        <input
          id="companySlug"
          value={company?.slug || ''}
          disabled
          className="flex h-10 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-4 py-2 disabled:opacity-50"
      >
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Salvar Empresa
      </button>
    </form>
  )
}

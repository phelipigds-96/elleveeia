'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createAgent, updateAgent } from '@/lib/services/agents'
import { Loader2 } from 'lucide-react'

export function AgentForm({ initialData }: { initialData?: any }) {
  const router = useRouter()
  const isEditing = !!initialData

  const [name, setName] = useState(initialData?.name || '')
  const [segment, setSegment] = useState(initialData?.segment || '')
  const [customSegment, setCustomSegment] = useState('')
  const [personality, setPersonality] = useState(initialData?.personality || '')
  const [instructions, setInstructions] = useState(initialData?.instructions || '')
  const [isActive, setIsActive] = useState<boolean>(initialData?.is_active ?? true)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const segments = [
    'Consultório / Clínica',
    'Salão de festas / Eventos',
    'Salão de beleza',
    'Restaurante',
    'Loja',
    'Imobiliária',
    'Prestador de serviços',
    'Outro'
  ]

  const isCustomSegment = segment === 'Outro'
  
  // Initialize segment state correctly if it's a custom one loaded from DB
  useState(() => {
    if (initialData?.segment && !segments.includes(initialData.segment)) {
      setSegment('Outro')
      setCustomSegment(initialData.segment)
    }
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    setSuccess(null)

    const finalSegment = isCustomSegment ? customSegment : segment

    const payload = {
      name,
      segment: finalSegment,
      personality,
      instructions,
      is_active: isActive
    }

    try {
      if (isEditing) {
        await updateAgent(initialData.id, payload)
        setSuccess('Agente atualizado com sucesso.')
      } else {
        await createAgent(payload)
        setSuccess('Agente criado com sucesso.')
        router.push('/agent')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-6 rounded-xl border bg-card text-card-foreground shadow-sm p-6">
        
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
          <label className="text-sm font-medium leading-none">
            Nome do agente <span className="text-destructive">*</span>
          </label>
          <input
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Luna"
            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium leading-none">
            Segmento
          </label>
          <select
            value={segment}
            onChange={e => setSegment(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="" disabled>Selecione um segmento contextual...</option>
            {segments.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {isCustomSegment && (
            <input
              required
              value={customSegment}
              onChange={e => setCustomSegment(e.target.value)}
              placeholder="Digite o segmento da sua empresa..."
              className="mt-2 flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          )}
          <p className="text-[11px] text-muted-foreground">O segmento serve apenas para orientar as respostas, não definindo limites estritos de regras.</p>
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium leading-none">
            Personalidade
          </label>
          <input
            value={personality}
            onChange={e => setPersonality(e.target.value)}
            placeholder="Ex.: cordial, profissional, objetiva e acolhedora."
            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium leading-none">
            Instruções (System Prompt)
          </label>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            rows={8}
            placeholder="Defina como o agente deve atender os clientes, quais informações deve priorizar e quais comportamentos deve seguir."
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          />
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => setIsActive(!isActive)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isActive ? 'bg-primary' : 'bg-input'}`}
          >
            <span className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${isActive ? 'translate-x-2' : '-translate-x-2'}`} />
          </button>
          <label className="text-sm font-medium leading-none cursor-pointer" onClick={() => setIsActive(!isActive)}>
            Agente ativo
          </label>
        </div>

        <div className="pt-4 flex gap-4 border-t">
          <button
            type="button"
            onClick={() => router.push('/agent')}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted h-10 px-4 py-2"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-4 py-2 disabled:opacity-50"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? 'Salvar alterações' : 'Criar agente'}
          </button>
        </div>

      </div>
    </form>
  )
}

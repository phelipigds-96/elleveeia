"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { Bot, User, Clock } from "lucide-react"
import { moveConversationToStageAction } from "../kanban/actions"
import { getConversationsList } from "../actions"

type Stage = {
  id: string
  workflow_id: string
  name: string
  position: number
  stage_type: string
  is_active: boolean
  color?: string | null
  handled_by?: 'ai' | 'human' | 'waiting' | null
}

type CustomerRef = { name: string | null; phone: string | null }

type Conversation = {
  id: string
  customer_id: string | null
  channel: string | null
  status: string | null
  workflow_stage_id: string | null
  created_at: string | null
  customers: CustomerRef[] | CustomerRef | null
}

const UNSTAGED_KEY = "__unstaged__"

const STATUS_LABEL: Record<string, string> = {
  open: "Em aberto",
  human: "Com atendente",
  closed: "Encerrada",
}


const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  webchat: "Webchat",
  instagram: "Instagram",
  email: "E-mail",
  telegram: "Telegram",
}

function formatTime(value: string | null) {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

export default function KanbanPanelClient({
  stages,
  conversations,
}: {
  stages: Stage[]
  conversations: Conversation[]
}) {
  const [items, setItems] = useState<Conversation[]>(conversations)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [pendingStage, setPendingStage] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Normaliza o join de customers, que pode voltar como array ou objeto.
  const customerRef = (conv: Conversation): CustomerRef | null => {
    const raw = conv.customers
    if (!raw) return null
    if (Array.isArray(raw)) return raw[0] ?? null
    return raw
  }

  const customerName = (conv: Conversation) => {
    const ref = customerRef(conv)
    return ref?.name || ref?.phone || "Conversa sem cliente"
  }

  const cardsByStage = useMemo(() => {
    const map: Record<string, Conversation[]> = {}
    for (const stage of stages) map[stage.id] = []
    for (const conv of items) {
      const key =
        conv.workflow_stage_id && map[conv.workflow_stage_id] ? conv.workflow_stage_id : UNSTAGED_KEY
      if (!map[key]) map[key] = []
      map[key].push(conv)
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    }
    return map
  }, [items, stages])

  const unstaged = cardsByStage[UNSTAGED_KEY] || []

  // Sincronização com a lista de conversas: quando o status operacional muda
  // na tela de mensagens, o funil reflete a nova etapa sem recarregar a página.
  useEffect(() => {
    let isMounted = true

    const poll = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return
      try {
        const list = await getConversationsList()
        if (!isMounted || !list || list.length === 0) return
        setItems((current) => {
          let changed = false
          const next = current.map((conv) => {
            const fresh = list.find((c) => c.id === conv.id)
            if (!fresh) return conv
            const stageId = fresh.workflow_stage_id || null
            if (fresh.status === conv.status && stageId === conv.workflow_stage_id) return conv
            changed = true
            return { ...conv, status: fresh.status, workflow_stage_id: stageId }
          })
          return changed ? next : current
        })
      } catch {
        // silencioso
      }
    }, 8000)

    return () => {
      isMounted = false
      clearInterval(poll)
    }
  }, [])

  const moveTo = (conversationId: string, stageId: string) => {
    if (!conversationId || !stageId) return
    const previous = items
    const stage = stages.find((s) => s.id === stageId)
    // Atualiza também o status operacional, para que o cartão reflita
    // o mesmo estado exibido na lista de conversas.
    const nextStatus =
      stage?.stage_type === "final" ? "closed" : stage?.stage_type === "in_progress" ? "human" : "open"
    setItems((current) =>
      current.map((c) =>
        c.id === conversationId ? { ...c, workflow_stage_id: stageId, status: nextStatus } : c
      )
    )
    setPendingStage((p) => ({ ...p, [conversationId]: true }))
    setError(null)

    startTransition(async () => {
      const result = await moveConversationToStageAction(conversationId, stageId)
      setPendingStage((p) => ({ ...p, [conversationId]: false }))
      if (!result.success) {
        setItems(previous)
        setError(result.error || "Não foi possível mover a conversa.")
      }
    })
  }

  if (stages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-ellevee-stone bg-white p-8 text-center text-sm text-ellevee-ink-muted">
        Nenhuma etapa ativa configurada. Cadastre as etapas do funil em Configurações → Workflows.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-ellevee-danger/30 bg-ellevee-danger/10 px-3 py-2 text-sm text-ellevee-danger-strong"
        >
          {error}
        </div>
      ) : null}

      <div className="scroll-slim flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2">
        {stages.map((stage) => {
          const cards = cardsByStage[stage.id] || []
          return (
            <section
              key={stage.id}
              className="flex min-w-[280px] flex-1 flex-col rounded-xl border border-ellevee-stone bg-ellevee-stone-subtle overflow-hidden"
              style={{ borderTop: `4px solid ${stage.color || '#64748b'}` }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (draggingId) moveTo(draggingId, stage.id)
                setDraggingId(null)
              }}
            >
              <header className="flex items-center justify-between border-b border-ellevee-stone px-4 py-3 bg-white/70 backdrop-blur-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: stage.color || '#64748b' }}
                  />
                  <h2 className="text-sm font-semibold text-ellevee-ink truncate" title={stage.name}>
                    {stage.name}
                  </h2>
                  {stage.handled_by === 'ai' && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200 flex-shrink-0">
                      <Bot className="h-3 w-3" /> IA
                    </span>
                  )}
                  {stage.handled_by === 'waiting' && (
                    <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 border border-purple-200 flex-shrink-0">
                      <Clock className="h-3 w-3" /> Espera
                    </span>
                  )}
                  {stage.handled_by === 'human' && (
                    <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200 flex-shrink-0">
                      <User className="h-3 w-3" /> Humano
                    </span>
                  )}
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-meta font-medium text-ellevee-ink-muted ring-1 ring-ellevee-stone flex-shrink-0 ml-2">
                  {cards.length}
                </span>
              </header>

              <div className="scroll-slim flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-3">
                {cards.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-ellevee-stone bg-white/60 px-3 py-6 text-center text-meta text-ellevee-ink-muted">
                    Arraste uma conversa para cá
                  </p>
                ) : null}

                {cards.map((conv) => (
                  <article
                    key={conv.id}
                    draggable
                    onDragStart={() => setDraggingId(conv.id)}
                    onDragEnd={() => setDraggingId(null)}
                    aria-label={`Conversa ${customerName(conv)} — ${stage.name}`}
                    className={`cursor-grab rounded-lg border border-ellevee-stone bg-white p-3 shadow-sm transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ellevee-ink/20 active:cursor-grabbing ${
                      pendingStage[conv.id] ? "opacity-60" : ""
                    }`}
                  >
                    <p className="truncate text-sm font-medium text-ellevee-ink">
                      {customerName(conv)}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-ellevee-ink-muted">
                      {conv.channel ? (
                        <span className="rounded bg-ellevee-sage-light px-1.5 py-0.5 font-medium text-ellevee-ink-muted">
                          {CHANNEL_LABEL[conv.channel] || conv.channel}
                        </span>
                      ) : null}
                      {conv.status ? <span>{STATUS_LABEL[conv.status] || conv.status}</span> : null}
                      {conv.created_at ? <span>{formatTime(conv.created_at)}</span> : null}
                    </div>
                    <label className="mt-2 block">
                      <span className="sr-only">Mover para etapa</span>
                      <select
                        value={conv.workflow_stage_id || ""}
                        disabled={pendingStage[conv.id] || isPending}
                        onChange={(e) => moveTo(conv.id, e.target.value)}
                        aria-label={`Mover ${customerName(conv)} para outra etapa`}
                        className="focus-ring w-full rounded-md border border-ellevee-stone bg-white px-2 py-1 text-meta text-ellevee-ink"
                      >
                        <option value="">Sem etapa</option>
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </article>
                ))}
              </div>
            </section>
          )
        })}

        {unstaged.length > 0 ? (
          <section
            className="flex min-w-[280px] flex-1 flex-col rounded-xl border border-dashed border-ellevee-stone bg-white"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (draggingId) moveTo(draggingId, stages[0]?.id || "")
              setDraggingId(null)
            }}
          >
            <header className="flex items-center justify-between border-b border-ellevee-stone px-4 py-3">
              <h2 className="text-sm font-semibold text-ellevee-ink-muted">Sem etapa</h2>
              <span className="rounded-full bg-ellevee-ivory px-2 py-0.5 text-meta font-medium text-ellevee-ink-muted ring-1 ring-ellevee-stone">
                {unstaged.length}
              </span>
            </header>

            <div className="scroll-slim flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-3">
              {unstaged.map((conv) => (
                <article
                  key={conv.id}
                  draggable
                  onDragStart={() => setDraggingId(conv.id)}
                  onDragEnd={() => setDraggingId(null)}
                  aria-label={`Conversa ${customerName(conv)} — sem etapa`}
                  className={`cursor-grab rounded-lg border border-ellevee-stone bg-white p-3 shadow-sm transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ellevee-ink/20 active:cursor-grabbing ${
                    pendingStage[conv.id] ? "opacity-60" : ""
                  }`}
                >
                  <p className="truncate text-sm font-medium text-ellevee-ink">
                    {customerName(conv)}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-ellevee-ink-muted">
                    {conv.channel ? (
                      <span className="rounded bg-ellevee-sage-light px-1.5 py-0.5 font-medium text-ellevee-ink-muted">
                        {CHANNEL_LABEL[conv.channel] || conv.channel}
                      </span>
                    ) : null}
                    {conv.status ? <span>{STATUS_LABEL[conv.status] || conv.status}</span> : null}
                    {conv.created_at ? <span>{formatTime(conv.created_at)}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

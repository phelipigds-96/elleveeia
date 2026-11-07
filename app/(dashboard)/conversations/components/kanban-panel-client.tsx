"use client"

import { useMemo, useState, useTransition } from "react"
import { moveConversationToStageAction } from "../kanban/actions"

type Stage = {
  id: string
  workflow_id: string
  name: string
  position: number
  stage_type: string
  is_active: boolean
}

type Conversation = {
  id: string
  customer_name: string | null
  customer_phone: string | null
  channel: string | null
  status: string | null
  workflow_stage_id: string | null
  created_at: string | null
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

  const cardsByStage = useMemo(() => {
    const map: Record<string, Conversation[]> = {}
    for (const stage of stages) map[stage.id] = []
    for (const conv of items) {
      const key = conv.workflow_stage_id
      if (key && map[key]) map[key].push(conv)
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    }
    return map
  }, [items, stages])

  const moveTo = (conversationId: string, stageId: string) => {
    if (!conversationId || !stageId) return
    const previous = items
    setItems((current) =>
      current.map((c) => (c.id === conversationId ? { ...c, workflow_stage_id: stageId } : c))
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
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
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
              className="flex min-w-[280px] flex-1 flex-col rounded-xl border border-ellevee-stone bg-ellevee-stone-subtle"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (draggingId) moveTo(draggingId, stage.id)
                setDraggingId(null)
              }}
            >
              <header className="flex items-center justify-between border-b border-ellevee-stone px-4 py-3">
                <h2 className="text-sm font-semibold text-ellevee-ink">{stage.name}</h2>
                <span className="rounded-full bg-white px-2 py-0.5 text-meta font-medium text-ellevee-ink-muted ring-1 ring-ellevee-stone">
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
                    aria-label={`Conversa ${conv.customer_name || conv.customer_phone || "sem cliente"} — ${stage.name}`}
                    className={`cursor-grab rounded-lg border border-ellevee-stone bg-white p-3 shadow-sm transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ellevee-ink/20 active:cursor-grabbing ${
                      pendingStage[conv.id] ? "opacity-60" : ""
                    }`}
                  >
                    <p className="truncate text-sm font-medium text-ellevee-ink">
                      {conv.customer_name || conv.customer_phone || "Conversa sem cliente"}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-ellevee-ink-muted">
                      {conv.channel ? (
                        <span className="rounded bg-ellevee-sage-light px-1.5 py-0.5 font-medium text-ellevee-sage-strong">
                          {CHANNEL_LABEL[conv.channel] || conv.channel}
                        </span>
                      ) : null}
                      {conv.status ? <span>{conv.status}</span> : null}
                      {conv.created_at ? <span>{formatTime(conv.created_at)}</span> : null}
                    </div>
                    <label className="mt-2 block">
                      <span className="sr-only">Mover para etapa</span>
                      <select
                        value={conv.workflow_stage_id || ""}
                        disabled={pendingStage[conv.id] || isPending}
                        onChange={(e) => moveTo(conv.id, e.target.value)}
                        aria-label={`Mover ${conv.customer_name || conv.customer_phone || "conversa"} para outra etapa`}
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
      </div>
    </div>
  )
}

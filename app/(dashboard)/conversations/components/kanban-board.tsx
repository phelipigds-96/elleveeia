"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { Clock, Settings2, LayoutGrid, MessageSquare, Bot, UserCheck, CheckCircle2 } from "lucide-react"
import { moveConversationStage } from "../kanban-actions"

export interface KanbanStage {
  id: string
  name: string
  position: number
  stage_type?: "initial" | "in_progress" | "final" | string
}

export interface KanbanConversation {
  id: string
  workflow_stage_id?: string | null
  channel?: string | null
  status?: string | null
  last_message_preview?: string | null
  last_message_at?: string | null
  updated_at?: string | null
  created_at?: string | null
  customers?: { name?: string | null; phone?: string | null } | null
}

interface KanbanBoardProps {
  stages: KanbanStage[]
  conversations: KanbanConversation[]
  onSelectConversation?: (id: string) => void
  onConversationsChange?: (conversations: KanbanConversation[]) => void
}

function statusLabel(status?: string | null): string {
  if (status === "open") return "IA"
  if (status === "human") return "Humano"
  return "Encerrada"
}

function statusDot(status?: string | null): string {
  if (status === "open") return "bg-ellevee-accent"
  if (status === "human") return "bg-ellevee-sage-strong"
  return "bg-ellevee-stone"
}

export default function KanbanBoard({
  stages,
  conversations,
  onSelectConversation,
  onConversationsChange,
}: KanbanBoardProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const orderedStages = useMemo(
    () => [...(stages || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [stages]
  )

  const grouped = useMemo(() => {
    const map: Record<string, KanbanConversation[]> = {}
    for (const stage of orderedStages) map[stage.id] = []
    for (const conv of conversations || []) {
      const stageId = conv.workflow_stage_id || orderedStages[0]?.id
      if (!stageId || !map[stageId]) continue
      map[stageId].push(conv)
    }
    return map
  }, [orderedStages, conversations])

  if (orderedStages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full p-8 text-center bg-ellevee-ivory">
        <div className="h-12 w-12 rounded-xl border border-ellevee-stone bg-white flex items-center justify-center mb-5">
          <Settings2 className="h-5 w-5 text-ellevee-sage-strong" />
        </div>
        <h3 className="font-display text-base font-semibold text-ellevee-ink tracking-tight">
          Quadro Kanban não configurado
        </h3>
        <p className="text-sm mt-1.5 text-ellevee-sage-strong max-w-sm mb-6 leading-relaxed">
          Defina as etapas do funil de atendimento para visualizar as conversas por etapa.
        </p>
        <Link
          href="/settings/workflows"
          className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-ellevee-ink text-white text-sm font-medium transition-colors hover:bg-ellevee-ink-muted focus-ring"
        >
          Configurar Workflows
        </Link>
      </div>
    )
  }

  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault()
    const conversationId = e.dataTransfer.getData("conversationId")
    if (!conversationId) return

    setError(null)

    // Atualização otimista: a conversa muda de coluna antes da resposta do servidor.
    onConversationsChange?.(
      (conversations || []).map((c) =>
        c.id === conversationId ? { ...c, workflow_stage_id: stageId } : c
      )
    )

    startTransition(async () => {
      const result = await moveConversationStage(conversationId, stageId)
      if (!result.success) {
        setError(result.error || "Não foi possível mover a conversa.")
        // Reverte a movimentação otimista
        onConversationsChange?.(conversations || [])
        return
      }
    })
  }

  return (
    <div className="flex-1 min-w-0 h-full overflow-x-auto overflow-y-hidden bg-ellevee-ivory">
      <div className={`flex h-full p-4 sm:p-6 gap-4 min-w-max ${isPending ? "opacity-70 pointer-events-none" : ""}`}>
        {orderedStages.map((stage) => {
          const stageConversations = grouped[stage.id] || []
          return (
            <div
              key={stage.id}
              className="w-72 flex flex-col h-full bg-white rounded-xl border border-ellevee-stone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, stage.id)}
            >
              <div className="p-4 border-b border-ellevee-stone flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full bg-ellevee-accent shrink-0" />
                  <h3 className="font-display text-sm font-semibold text-ellevee-ink truncate">
                    {stage.name}
                  </h3>
                </div>
                <span className="text-xs font-mono font-medium text-ellevee-sage-strong bg-ellevee-stone-subtle border border-ellevee-stone px-1.5 py-0.5 rounded-full">
                  {stageConversations.length}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto scroll-slim p-3 space-y-2">
                {stageConversations.length === 0 ? (
                  <div className="flex items-center justify-center h-24 text-ellevee-sage-strong/60 text-xs text-center leading-relaxed">
                    Nenhuma conversa nesta etapa
                  </div>
                ) : (
                  stageConversations.map((conv) => (
                    <div
                      key={conv.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("conversationId", conv.id)
                      }}
                      onClick={() => onSelectConversation?.(conv.id)}
                      className="bg-ellevee-stone-subtle px-3 py-2.5 rounded-lg border border-ellevee-stone/80 hover:border-ellevee-sage-strong/40 hover:shadow-sm transition-all cursor-pointer active:cursor-grabbing select-none focus-ring"
                    >
                      <div className="flex justify-between items-center mb-1.5 gap-2">
                        <span className="font-semibold text-sm text-ellevee-ink truncate max-w-[150px]">
                          {conv.customers?.name || "Visitante"}
                        </span>
                        <span className="text-xs text-ellevee-sage-strong flex items-center shrink-0">
                          <Clock className="h-3 w-3 mr-1" />
                          {new Date(
                            conv.last_message_at || conv.updated_at || conv.created_at || Date.now()
                          ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>

                      {conv.last_message_preview && (
                        <p className="text-sm text-ellevee-sage-strong line-clamp-2 leading-relaxed mb-2">
                          {conv.last_message_preview}
                        </p>
                      )}

                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase tracking-wider font-medium text-ellevee-sage-strong/80">
                          {conv.channel || "chat"}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${statusDot(conv.status)}`} />
                          <span className="text-xs text-ellevee-sage-strong">
                            {statusLabel(conv.status)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 rounded-lg border border-ellevee-stone bg-white px-4 py-2 text-sm text-ellevee-ink shadow-lg">
          {error}
        </div>
      )}
    </div>
  )
}

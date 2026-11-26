"use client"

import { Bot, CheckCircle2, Hourglass, MessageSquare, type LucideIcon } from "lucide-react"

/**
 * Linguagem visual compartilhada do status de uma conversa.
 *
 * A Lista de conversas e o funil Kanban mostram o mesmo estado operacional
 * (`conversations.status` + `assigned_to`). Este módulo é a única fonte da
 * forma de exibi-lo, para que o mesmo estado seja lido do mesmo jeito nas duas
 * telas — e para que a Fase 1 (Lista) e o Kanban falem a mesma língua visual.
 */

export type StatusViewKey = "waiting" | "in_progress" | "ai" | "closed"

export type StatusView = {
  key: StatusViewKey
  label: string
  chipClass: string
  dotClass: string
  Icon: LucideIcon
}

const VIEWS: Record<StatusViewKey, StatusView> = {
  waiting: {
    key: "waiting",
    label: "Aguardando",
    chipClass: "bg-ellevee-warning/10 text-ellevee-warning-strong border-ellevee-warning/35",
    dotClass: "bg-ellevee-warning",
    Icon: Hourglass,
  },
  in_progress: {
    key: "in_progress",
    label: "Com operador",
    chipClass: "bg-ellevee-success/10 text-ellevee-success-strong border-ellevee-success/35",
    dotClass: "bg-ellevee-success",
    Icon: MessageSquare,
  },
  ai: {
    key: "ai",
    label: "IA ativa",
    chipClass: "bg-[#F3EEFE] text-[#5F1EC2] border-[#7028D9]/25",
    dotClass: "bg-ellevee-purple",
    Icon: Bot,
  },
  closed: {
    key: "closed",
    label: "Finalizado",
    chipClass: "bg-ellevee-stone-subtle text-ellevee-text-secondary border-ellevee-border",
    dotClass: "bg-ellevee-text-secondary",
    Icon: CheckCircle2,
  },
}

/**
 * Converte o status operacional em uma visão de estado única.
 * `human` sem responsável é "aguardando"; `human` com responsável é "em atendimento".
 */
export function resolveStatusView(status?: string | null, assigned?: boolean): StatusView {
  if (status === "human") return assigned ? VIEWS.in_progress : VIEWS.waiting
  if (status === "closed") return VIEWS.closed
  return VIEWS.ai
}

export function statusLabel(status?: string | null, assigned?: boolean): string {
  return resolveStatusView(status, assigned).label
}

/** Selo compacto de status, usado na lista e no cartão do funil. */
export function StatusChip({
  view,
  detail,
  className = "",
}: {
  view: StatusView
  detail?: string
  className?: string
}) {
  const Icon = view.Icon
  const cleanDetail = detail?.trim()
  const isRedundantDetail =
    !cleanDetail ||
    cleanDetail.toLowerCase() === view.label.trim().toLowerCase() ||
    (view.key === "ai" && /^(ia|ai|ia ativa|agente|agente ia|bot)$/i.test(cleanDetail))

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] font-semibold leading-tight ${view.chipClass} ${className}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{view.label}</span>
      {!isRedundantDetail ? (
        <span className="font-mono text-[10.5px] opacity-85 truncate">· {cleanDetail}</span>
      ) : null}
    </span>
  )
}

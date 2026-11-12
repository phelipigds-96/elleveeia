"use client"

import React, { useState } from "react"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Coins,
  Cpu,
  RefreshCw,
  Search,
  ShieldAlert,
  Timer,
  Workflow,
} from "lucide-react"
import type {
  TenantGovernanceReport,
  EventCorrelationTrace,
  QuotaStatus,
} from "@/lib/services/platform/tenant-governance"
import {
  refreshTenantGovernanceAction,
  traceEventCorrelationAction,
} from "@/app/(admin)/admin-settings/actions"

interface AdminGovernancePanelProps {
  initialGovernance: TenantGovernanceReport
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n || 0))
}

function formatUsd(n: number) {
  return `$${(Number(n) || 0).toFixed(4)}`
}

function formatBrl(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(n) || 0)
}

function formatTimestamp(iso?: string | null) {
  if (!iso) return "-"
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function getQuotaBadgeStyle(status: QuotaStatus) {
  if (status === "exceeded") {
    return "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30"
  }
  if (status === "warning") {
    return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
  }
  return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
}

function getQuotaLabel(status: QuotaStatus) {
  if (status === "exceeded") return "Excedida (>=100%)"
  if (status === "warning") return "Alerta (>=80%)"
  return "Normal"
}

function getStageColor(status: string) {
  const s = String(status || "").toLowerCase()
  if (s === "sent" || s === "success" || s === "processed" || s === "completed") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
  }
  if (s === "failed" || s === "error" || s === "timeout" || s === "dead_letter") {
    return "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
  }
  if (s === "processing" || s === "pending" || s === "suppressed") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
  }
  return "border-border bg-muted/40 text-muted-foreground"
}

export default function AdminGovernancePanel({
  initialGovernance,
}: AdminGovernancePanelProps) {
  const [governance, setGovernance] = useState<TenantGovernanceReport>(initialGovernance)
  const [windowDays, setWindowDays] = useState<number>(initialGovernance.windowDays || 30)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const [traceQuery, setTraceQuery] = useState("")
  const [isTracing, setIsTracing] = useState(false)
  const [traceResult, setTraceResult] = useState<EventCorrelationTrace | null>(null)
  const [traceError, setTraceError] = useState<string | null>(null)

  const handleRefreshGovernance = async (selectedDays: number) => {
    setWindowDays(selectedDays)
    setIsRefreshing(true)
    setRefreshError(null)
    try {
      const res = await refreshTenantGovernanceAction(selectedDays)
      if (res.success && res.data) {
        setGovernance(res.data)
      } else {
        setRefreshError(res.error || "Não foi possível atualizar a governança.")
      }
    } catch (err: any) {
      setRefreshError(err?.message || "Erro inesperado ao atualizar governança.")
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleSearchTrace = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = traceQuery.trim()
    if (!clean) return
    setIsTracing(true)
    setTraceError(null)
    try {
      const res = await traceEventCorrelationAction(clean)
      if (res.success && res.data) {
        setTraceResult(res.data)
      } else {
        setTraceError(res.error || "Erro ao consultar correlação.")
      }
    } catch (err: any) {
      setTraceError(err?.message || "Falha ao rastrear evento.")
    } finally {
      setIsTracing(false)
    }
  }

  return (
    <div className="space-y-8 pt-4 border-t border-border/60">
      {/* Cabeçalho Governança Multi-Tenant */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-emerald-500" />
            <h2 className="text-xl font-semibold tracking-tight">
              Governança Multi-Tenant: Custos LLM, Quotas e Correlação
            </h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Consolidação de tokens, custos estimados, latência, fallbacks de catálogo e alertas de
            quota em modo Soft-Alert (sem bloqueio de atendimento no WhatsApp).
          </p>
        </div>

        <div className="flex items-center gap-2">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => handleRefreshGovernance(days)}
              disabled={isRefreshing}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                windowDays === days
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:text-foreground"
              }`}
            >
              {days}d
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleRefreshGovernance(windowDays)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card hover:bg-muted/60 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </div>

      {refreshError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          {refreshError}
        </div>
      )}

      {governance.schemaWarnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 space-y-1">
          <div className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            Modo de compatibilidade de schema ativo
          </div>
          {governance.schemaWarnings.map((warn, idx) => (
            <div key={idx}>{warn}</div>
          ))}
        </div>
      )}

      {/* KPIs Globais de Custos e Quotas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Custo Estimado ({governance.windowDays}d)</span>
            <Coins className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold">{formatUsd(governance.totals.totalCostUsd)}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {formatBrl(governance.totals.totalCostBrl)} (taxa {governance.usdToBrlRate.toFixed(2)})
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Tokens Consumidos</span>
            <Cpu className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-bold">
            {formatNumber(governance.totals.totalTokens)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {formatNumber(governance.totals.totalRuns)} execuções IA
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Alertas de Quota Mensal</span>
            <ShieldAlert className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold">
            {governance.totals.warningTenantsCount + governance.totals.exceededTenantsCount}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {governance.totals.warningTenantsCount} em 80%+ ·{" "}
            {governance.totals.exceededTenantsCount} em 100%+
          </div>
          {(governance.totals.totalExtraInvoiceBrl > 0 || governance.totals.totalAddonMessages > 0) && (
            <div className="text-[11px] font-medium text-violet-600 dark:text-violet-400 mt-1">
              Extra mês: {formatBrl(governance.totals.totalExtraInvoiceBrl)} (
              {formatNumber(governance.totals.totalAddonMessages)} pkg ·{" "}
              {formatNumber(governance.totals.totalOverageMessages)} avulso)
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Fallbacks & Falhas IA</span>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold">
            {formatNumber(governance.totals.totalFallbacks)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {formatNumber(governance.totals.totalErrorsAndTimeouts)} erros/timeouts
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Latência Média IA</span>
            <Timer className="h-4 w-4 text-violet-500" />
          </div>
          <div className="mt-2 text-2xl font-bold">
            {formatNumber(governance.totals.avgDurationMs)} ms
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {formatNumber(governance.totals.totalMonthlyMessages)} msgs no mês
          </div>
        </div>
      </div>

      {/* Tabela por Tenant */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Consumo, Quotas e Custos por Empresa ({governance.tenants.length})
          </h3>
          <span className="text-xs text-muted-foreground">
            Soft Quota ativa (telemetria preventiva)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Empresa</th>
                <th className="px-4 py-2.5 font-medium">Quota Mensal (Msgs)</th>
                <th className="px-4 py-2.5 font-medium">Execuções / Fallbacks</th>
                <th className="px-4 py-2.5 font-medium">Latência (Méd / P95)</th>
                <th className="px-4 py-2.5 font-medium">Tokens / Custo Est.</th>
                <th className="px-4 py-2.5 font-medium">Outbox ({governance.windowDays}d)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {governance.tenants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    Nenhuma empresa ou execução registrada na janela selecionada.
                  </td>
                </tr>
              ) : (
                governance.tenants.map((tenant) => (
                  <tr key={tenant.companyId} className="hover:bg-muted/20">
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-foreground">{tenant.companyName}</div>
                      <div className="text-xs text-muted-foreground">
                        {tenant.planTier} · {tenant.companyStatus}
                      </div>
                      {tenant.providerBreakdown.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {tenant.providerBreakdown.map((pb, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {pb.provider}/{pb.model} ({pb.runs})
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {formatNumber(tenant.monthlySentMessagesUsed)} /{" "}
                          {formatNumber(tenant.effectiveMessagesLimit)}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${getQuotaBadgeStyle(
                            tenant.quotaStatus
                          )}`}
                        >
                          {tenant.quotaUsagePercent}% · {getQuotaLabel(tenant.quotaStatus)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-36 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full ${
                            tenant.quotaStatus === "exceeded"
                              ? "bg-red-500"
                              : tenant.quotaStatus === "warning"
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(100, tenant.quotaUsagePercent)}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Enviadas (IA+Hum) · Base {formatNumber(tenant.monthlyMessagesLimit)}
                        {tenant.addonMessagesPurchased > 0
                          ? ` + ${formatNumber(tenant.addonMessagesPurchased)} pkg`
                          : ""}
                      </div>
                      {(tenant.overageMessages > 0 || tenant.extraInvoiceTotalBrl > 0) && (
                        <div className="mt-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                          Avulso: {formatNumber(tenant.overageMessages)} · Extra:{" "}
                          {formatBrl(tenant.extraInvoiceTotalBrl)}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 align-top text-xs">
                      <div className="font-medium text-foreground">
                        {formatNumber(tenant.totalRuns)} runs ({tenant.successRuns} ok)
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        {tenant.errorRuns + tenant.timeoutRuns} erros/timeouts ·{" "}
                        {tenant.fallbackCount} fallbacks
                      </div>
                    </td>

                    <td className="px-4 py-3 align-top text-xs">
                      <div className="font-medium text-foreground">
                        {formatNumber(tenant.avgDurationMs)} ms
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        P95: {formatNumber(tenant.p95DurationMs)} ms
                      </div>
                    </td>

                    <td className="px-4 py-3 align-top text-xs">
                      <div className="font-medium text-foreground">
                        {formatNumber(tenant.totalTokens)} tokens
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        {formatUsd(tenant.estimatedCostUsd)} ({formatBrl(tenant.estimatedCostBrl)})
                      </div>
                    </td>

                    <td className="px-4 py-3 align-top text-xs">
                      <div className="text-emerald-600 dark:text-emerald-400">
                        {tenant.outboxSent} enviadas
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        {tenant.outboxFailed} falhas · {tenant.outboxPending} fila ·{" "}
                        {tenant.outboxSuppressed} suprimidas
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rastreador End-to-End */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold">
              Rastreador de Correlação End-to-End
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Pesquise por event_id do WhatsApp/n8n, webhook_event_id, conversation_id, outbox_id,
            idempotency_key ou provider_message_id para reconstruir a linha do tempo completa.
          </p>
        </div>

        <form onSubmit={handleSearchTrace} className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={traceQuery}
              onChange={(e) => setTraceQuery(e.target.value)}
              placeholder="Ex: wamid..., agent-reply-..., UUID da conversa, webhook ou outbox"
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <button
            type="submit"
            disabled={isTracing || !traceQuery.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Activity className="h-4 w-4" />
            {isTracing ? "Rastreando..." : "Rastrear"}
          </button>
        </form>

        {traceError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
            {traceError}
          </div>
        )}

        {traceResult && (
          <div className="space-y-4 pt-2">
            {traceResult.schemaWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                {traceResult.schemaWarnings.join(" · ")}
              </div>
            )}

            {!traceResult.found ? (
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
                Nenhum registro encontrado para a referência informada.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <span className="text-muted-foreground">Event ID:</span>{" "}
                    <span className="font-mono break-all">
                      {traceResult.resolvedIds.eventId || "-"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Conversation ID:</span>{" "}
                    <span className="font-mono break-all">
                      {traceResult.resolvedIds.conversationId || "-"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Outbox ID:</span>{" "}
                    <span className="font-mono break-all">
                      {traceResult.resolvedIds.outboxId || "-"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Provider Msg ID:</span>{" "}
                    <span className="font-mono break-all">
                      {traceResult.resolvedIds.providerMessageId || "-"}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {traceResult.timeline.map((step, index) => (
                    <div
                      key={`${step.stage}-${index}`}
                      className="flex flex-col gap-1 rounded-lg border border-border bg-background p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="font-semibold text-foreground">{step.title}</span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${getStageColor(
                              step.status
                            )}`}
                          >
                            {step.status}
                          </span>
                        </div>
                        <div className="text-muted-foreground pl-5">{step.detail}</div>
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground pl-5 sm:pl-0 shrink-0">
                        {formatTimestamp(step.timestamp)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

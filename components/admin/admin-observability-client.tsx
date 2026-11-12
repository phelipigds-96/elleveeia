"use client"

import React, { useState } from "react"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Play,
  RefreshCw,
  RotateCcw,
  Shield,
  Zap,
} from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  refreshTelemetryAction,
  triggerManualWorkerAction,
  reprocessOutboxDlqAction,
  reprocessWebhookDlqAction,
} from "@/app/(admin)/admin-settings/actions"
import type { OperationalTelemetrySummary } from "@/lib/services/platform/observability"

interface AdminObservabilityClientProps {
  initialTelemetry: OperationalTelemetrySummary
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}`
  } catch {
    return iso
  }
}

function formatShortId(id?: string | null): string {
  if (!id) return "—"
  return id.length > 14 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id
}

function WorkerStatusBadge({
  status,
}: {
  status: OperationalTelemetrySummary["queueHealth"]["workerStatus"]
}) {
  if (status === "warning") {
    return (
      <Badge variant="destructive" className="text-[10px] uppercase font-mono tracking-wider">
        Atenção
      </Badge>
    )
  }
  if (status === "idle") {
    return (
      <Badge variant="warning" className="text-[10px] uppercase font-mono tracking-wider">
        Aguardando
      </Badge>
    )
  }
  return (
    <Badge variant="success" className="text-[10px] uppercase font-mono tracking-wider">
      Saudável
    </Badge>
  )
}

function CronRunStatusBadge({ status }: { status: "success" | "partial" | "error" }) {
  if (status === "error") {
    return (
      <Badge variant="destructive" className="text-[10px] font-mono">
        Erro
      </Badge>
    )
  }
  if (status === "partial") {
    return (
      <Badge variant="warning" className="text-[10px] font-mono">
        Parcial
      </Badge>
    )
  }
  return (
    <Badge variant="success" className="text-[10px] font-mono">
      Sucesso
    </Badge>
  )
}

export default function AdminObservabilityClient({
  initialTelemetry,
}: AdminObservabilityClientProps) {
  const [telemetry, setTelemetry] = useState<OperationalTelemetrySummary>(initialTelemetry)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isRunningWorker, setIsRunningWorker] = useState(false)
  const [reprocessingId, setReprocessingId] = useState<string | null>(null)
  const [dlqTab, setDlqTab] = useState<"outbox" | "webhooks">(
    initialTelemetry.dlqOutbox.length >= initialTelemetry.dlqWebhooks.length
      ? "outbox"
      : "webhooks"
  )

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const res = await refreshTelemetryAction()
      if (!res.success || !res.data) {
        toast.error("Não foi possível atualizar", res.error || "Erro ao consultar telemetria.")
        return
      }
      setTelemetry(res.data)
      toast.success("Telemetria atualizada")
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleTriggerWorker = async () => {
    setIsRunningWorker(true)
    try {
      const res = await triggerManualWorkerAction()
      if (!res.success) {
        toast.error("Falha ao acionar worker", res.error || "Operação não autorizada ou erro interno.")
        return
      }
      if (res.telemetry) setTelemetry(res.telemetry)
      const s = res.summary
      toast.success(
        "Reconciliação concluída",
        s
          ? `Outbox: ${s.outboxSucceeded}/${s.outboxProcessed} • Webhooks recuperados: ${s.webhookRecovered}/${s.webhookProcessed} (${s.durationMs}ms)`
          : "Ciclo executado com sucesso."
      )
    } finally {
      setIsRunningWorker(false)
    }
  }

  const handleReprocessOutbox = async (outboxId: string) => {
    setReprocessingId(outboxId)
    try {
      const res = await reprocessOutboxDlqAction(outboxId)
      if (!res.success) {
        toast.error("Falha ao reprocessar outbox", res.error || "Não foi possível reenviar.")
        return
      }
      if (res.telemetry) setTelemetry(res.telemetry)
      toast.success(
        "Outbox reprocessada",
        `Desfecho: ${res.result?.outcome || "reenviado"}`
      )
    } finally {
      setReprocessingId(null)
    }
  }

  const handleReprocessWebhook = async (webhookId: string) => {
    setReprocessingId(webhookId)
    try {
      const res = await reprocessWebhookDlqAction(webhookId)
      if (!res.success) {
        toast.error("Falha ao reprocessar webhook", res.error || "Não foi possível executar replay.")
        return
      }
      if (res.telemetry) setTelemetry(res.telemetry)
      toast.success(
        "Webhook reprocessado",
        `Desfecho: ${res.result?.outcome || "processado"}`
      )
    } finally {
      setReprocessingId(null)
    }
  }

  const { cronStats, queueHealth, llmHealth, envFlags } = telemetry

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-ellevee-border">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-deep-ink">
              Configurações & Observabilidade
            </h1>
            <WorkerStatusBadge status={queueHealth.workerStatus} />
          </div>
          <p className="text-xs text-ellevee-text-secondary mt-1 font-sans">
            Saúde do motor transacional, histórico de execuções do Cron Worker e reprocessamento seguro da Dead Letter Queue.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing || isRunningWorker}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>Atualizar</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleTriggerWorker}
            disabled={isRunningWorker || isRefreshing}
            className="gap-1.5"
          >
            <Play className={`h-3.5 w-3.5 ${isRunningWorker ? "animate-pulse" : ""}`} />
            <span>{isRunningWorker ? "Executando..." : "Executar Worker Agora"}</span>
          </Button>
        </div>
      </div>

      {/* Cards de Saúde Operacional */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-ellevee-border shadow-card rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-text-secondary uppercase tracking-wider">
              Status do Worker
            </span>
            <Activity className="h-3.5 w-3.5 text-ellevee-text-secondary" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-sm font-display font-bold text-ellevee-deep-ink">
              {queueHealth.workerStatusText}
            </div>
            <p className="text-[11px] text-ellevee-text-secondary font-mono mt-1.5">
              Último ciclo: {formatDateTime(cronStats.lastRunAt)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-ellevee-border shadow-card rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-text-secondary uppercase tracking-wider">
              Confiabilidade do Cron
            </span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold text-ellevee-deep-ink font-mono">
                {cronStats.successRatePercent}%
              </span>
              <span className="text-xs text-ellevee-text-secondary font-mono">
                ({cronStats.totalRunsWindow} execuções)
              </span>
            </div>
            <p className="text-[11px] text-ellevee-text-secondary font-mono mt-1">
              Duração média: {cronStats.avgDurationMs}ms • SLA IA/Outbox {llmHealth.slaPercent}%
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-ellevee-border shadow-card rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-text-secondary uppercase tracking-wider">
              Travamentos & Locks
            </span>
            <Clock className="h-3.5 w-3.5 text-ellevee-text-secondary" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span
                className={`font-display text-2xl font-bold font-mono ${
                  queueHealth.stalledTotal > 0 ? "text-amber-700" : "text-ellevee-deep-ink"
                }`}
              >
                {queueHealth.stalledTotal}
              </span>
              <span className="text-xs text-ellevee-text-secondary">travadas agora</span>
            </div>
            <p className="text-[11px] text-ellevee-text-secondary font-mono mt-1">
              {queueHealth.stalledOutboxCount} outbox • {queueHealth.stalledWebhookCount} webhook • {queueHealth.activeGatewayLocks} lock(s)
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-ellevee-border shadow-card rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-text-secondary uppercase tracking-wider">
              Dead Letter Queue
            </span>
            <AlertTriangle
              className={`h-3.5 w-3.5 ${
                queueHealth.deadLetterTotal > 0 ? "text-rose-700" : "text-ellevee-text-secondary"
              }`}
            />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span
                className={`font-display text-2xl font-bold font-mono ${
                  queueHealth.deadLetterTotal > 0 ? "text-rose-700" : "text-ellevee-deep-ink"
                }`}
              >
                {queueHealth.deadLetterTotal}
              </span>
              <span className="text-xs text-ellevee-text-secondary">itens com falha</span>
            </div>
            <p className="text-[11px] text-ellevee-text-secondary font-mono mt-1">
              {queueHealth.deadLetterOutboxCount} outbox • {queueHealth.deadLetterWebhookCount} webhook(s)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Dead Letter Queue (Reprocessamento Manual Seguro) */}
      <Card className="bg-white border-ellevee-border shadow-card rounded-xl overflow-hidden">
        <CardHeader className="border-b border-ellevee-border pb-3.5 bg-[#F8F8F6]/60">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-rose-700" />
                <CardTitle className="font-display text-base font-bold text-ellevee-deep-ink">
                  Dead Letter Queue (Falhas Definitivas)
                </CardTitle>
              </div>
              <CardDescription className="text-xs text-ellevee-text-secondary mt-0.5 font-sans">
                Mensagens e eventos de webhook que excederam tentativas ou falharam. Cada replay manual exige validação de tenant e fica registrado na Auditoria.
              </CardDescription>
            </div>

            <div className="inline-flex rounded-lg border border-ellevee-border bg-white p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setDlqTab("outbox")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  dlqTab === "outbox"
                    ? "bg-ellevee-deep-ink text-white"
                    : "text-ellevee-text-secondary hover:text-ellevee-deep-ink"
                }`}
              >
                Outbox ({telemetry.dlqOutbox.length})
              </button>
              <button
                type="button"
                onClick={() => setDlqTab("webhooks")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  dlqTab === "webhooks"
                    ? "bg-ellevee-deep-ink text-white"
                    : "text-ellevee-text-secondary hover:text-ellevee-deep-ink"
                }`}
              >
                Webhooks ({telemetry.dlqWebhooks.length})
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {dlqTab === "outbox" ? (
            telemetry.dlqOutbox.length === 0 ? (
              <div className="py-10 text-center text-xs text-ellevee-text-secondary">
                Nenhuma mensagem na Dead Letter Queue da Outbox.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F8F8F6]">
                    <TableHead>Empresa / Destino</TableHead>
                    <TableHead>Tentativas</TableHead>
                    <TableHead>Último Erro</TableHead>
                    <TableHead>Atualizado</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {telemetry.dlqOutbox.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-semibold text-xs text-ellevee-deep-ink">
                          {item.companyName}
                        </div>
                        <div className="text-[11px] font-mono text-ellevee-text-secondary">
                          {item.channel} • {item.recipient || "—"} • {formatShortId(item.id)}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.attempts}/{item.maxAttempts}
                      </TableCell>
                      <TableCell className="text-xs text-rose-800 max-w-xs truncate" title={item.lastError || ""}>
                        {item.lastError || "Falha de entrega"}
                      </TableCell>
                      <TableCell className="text-[11px] font-mono text-ellevee-text-secondary whitespace-nowrap">
                        {formatDateTime(item.updatedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={reprocessingId === item.id}
                          onClick={() => handleReprocessOutbox(item.id)}
                          className="gap-1.5"
                        >
                          <RotateCcw
                            className={`h-3 w-3 ${reprocessingId === item.id ? "animate-spin" : ""}`}
                          />
                          <span>{reprocessingId === item.id ? "Reenviando..." : "Reprocessar"}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : telemetry.dlqWebhooks.length === 0 ? (
            <div className="py-10 text-center text-xs text-ellevee-text-secondary">
              Nenhum evento webhook falho na Dead Letter Queue.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F8F8F6]">
                  <TableHead>Empresa / Event ID</TableHead>
                  <TableHead>Estágio / Tentativas</TableHead>
                  <TableHead>Último Erro</TableHead>
                  <TableHead>Atualizado</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {telemetry.dlqWebhooks.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-semibold text-xs text-ellevee-deep-ink">
                        {item.companyName}
                      </div>
                      <div className="text-[11px] font-mono text-ellevee-text-secondary" title={item.eventId}>
                        {item.eventType} • {formatShortId(item.eventId)}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[11px]">
                      <div>
                        ingest: <span className="font-semibold">{item.status}</span> • auto:{" "}
                        <span className="font-semibold">{item.autonomousStatus}</span>
                      </div>
                      <div className="text-ellevee-text-secondary">
                        auto {item.autonomousAttempts}/{item.autonomousMaxAttempts} • rec {item.recoveryAttempts}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-rose-800 max-w-xs truncate" title={item.lastError || ""}>
                      {item.lastError || "Falha no processamento"}
                    </TableCell>
                    <TableCell className="text-[11px] font-mono text-ellevee-text-secondary whitespace-nowrap">
                      {formatDateTime(item.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={reprocessingId === item.id}
                        onClick={() => handleReprocessWebhook(item.id)}
                        className="gap-1.5"
                      >
                        <RotateCcw
                          className={`h-3 w-3 ${reprocessingId === item.id ? "animate-spin" : ""}`}
                        />
                        <span>{reprocessingId === item.id ? "Executando..." : "Reprocessar"}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Histórico Recente de Execuções do Cron Worker */}
      <Card className="bg-white border-ellevee-border shadow-card rounded-xl overflow-hidden">
        <CardHeader className="border-b border-ellevee-border pb-3.5 bg-[#F8F8F6]/60">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-ellevee-deep-ink" />
                <CardTitle className="font-display text-base font-bold text-ellevee-deep-ink">
                  Histórico do Worker de Reconciliação (<code className="font-mono text-xs">cron_execution_logs</code>)
                </CardTitle>
              </div>
              <CardDescription className="text-xs text-ellevee-text-secondary mt-0.5 font-sans">
                Últimas 25 execuções de <code className="font-mono">/api/cron/outbox-worker</code> e disparos manuais.
              </CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-[10px]">
              Latência média IA: {llmHealth.averageLatencySeconds}s ({llmHealth.totalRunsWindow} runs recentes)
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!telemetry.cronLogsAvailable ? (
            <div className="p-6 text-xs text-amber-800 bg-amber-50/70">
              A tabela <code className="font-mono font-semibold">cron_execution_logs</code> ainda não foi criada no Supabase. Rode a migration{" "}
              <code className="font-mono font-semibold">2026111202_enterprise_observability_3a.sql</code> no SQL Editor para habilitar o histórico persistido.
            </div>
          ) : telemetry.recentRuns.length === 0 ? (
            <div className="py-10 text-center text-xs text-ellevee-text-secondary">
              Nenhuma execução registrada ainda. O próximo ciclo do Cron ou um clique em &ldquo;Executar Worker Agora&rdquo; criará o primeiro registro.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F8F8F6]">
                  <TableHead>Status / Origem</TableHead>
                  <TableHead>Outbox</TableHead>
                  <TableHead>Webhook Recovery</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead>Erro</TableHead>
                  <TableHead className="text-right">Executado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {telemetry.recentRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CronRunStatusBadge status={run.status} />
                        <span className="font-mono text-[11px] text-ellevee-text-secondary">
                          {run.method} • HTTP {run.httpStatus}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {run.outboxSucceeded}/{run.outboxProcessed} ok
                      {run.outboxFailed > 0 && (
                        <span className="text-rose-700 ml-1">({run.outboxFailed} falha)</span>
                      )}
                      {run.outboxDeferred > 0 && (
                        <span className="text-amber-700 ml-1">({run.outboxDeferred} adiada)</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {run.webhookRecoveredIngest + run.webhookRecoveredAutonomous}/{run.webhookProcessed} rec
                      {run.webhookFailed > 0 && (
                        <span className="text-rose-700 ml-1">({run.webhookFailed} falha)</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-ellevee-deep-ink">
                      {run.durationMs}ms
                    </TableCell>
                    <TableCell className="text-xs text-rose-700 max-w-xs truncate" title={run.errorMessage || ""}>
                      {run.errorMessage || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] text-ellevee-text-secondary whitespace-nowrap">
                      {formatDateTime(run.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Cards de Configuração Real de Infraestrutura (Sem Exposição de Segredos) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-white border-ellevee-border shadow-card rounded-xl">
          <CardHeader className="border-b border-ellevee-border pb-4 bg-[#F8F8F6]/50">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-ellevee-purple" />
              <CardTitle className="font-display text-base font-bold text-ellevee-deep-ink">
                Provedores de Inteligência Artificial
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-ellevee-text-secondary mt-0.5 font-sans">
              Status real das variáveis de ambiente globais do servidor (nunca exibidas no navegador).
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-ellevee-border p-3 bg-[#F8F8F6]">
              <div>
                <div className="text-xs font-semibold text-ellevee-deep-ink">OPENAI_API_KEY</div>
                <div className="text-[11px] text-ellevee-text-secondary font-sans">
                  Provedor padrão do runtime de atendimento
                </div>
              </div>
              <Badge variant={envFlags.hasOpenAiKey ? "success" : "destructive"} className="font-mono text-[10px]">
                {envFlags.hasOpenAiKey ? "Configurada no servidor" : "Ausente no ambiente"}
              </Badge>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-ellevee-border p-3 bg-[#F8F8F6]">
              <div>
                <div className="text-xs font-semibold text-ellevee-deep-ink">GEMINI_API_KEY</div>
                <div className="text-[11px] text-ellevee-text-secondary font-sans">
                  Suporte a modelos Google Gemini e fallback multi-provider
                </div>
              </div>
              <Badge variant={envFlags.hasGeminiKey ? "success" : "warning"} className="font-mono text-[10px]">
                {envFlags.hasGeminiKey ? "Configurada no servidor" : "Não configurada"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-ellevee-border shadow-card rounded-xl">
          <CardHeader className="border-b border-ellevee-border pb-4 bg-[#F8F8F6]/50">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-ellevee-deep-ink" />
              <CardTitle className="font-display text-base font-bold text-ellevee-deep-ink">
                Segurança & Motor Transacional
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-ellevee-text-secondary mt-0.5 font-sans">
              Credenciais de background worker e janelas de segurança ativas em produção.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-ellevee-border p-3 bg-[#F8F8F6]">
              <div>
                <div className="text-xs font-semibold text-ellevee-deep-ink">CRON_SECRET</div>
                <div className="text-[11px] text-ellevee-text-secondary font-sans">
                  Autenticação Bearer com comparação constant-time
                </div>
              </div>
              <Badge variant={envFlags.hasCronSecret ? "success" : "destructive"} className="font-mono text-[10px]">
                {envFlags.hasCronSecret ? "Protegido" : "CRON_SECRET ausente"}
              </Badge>
            </div>

            <div className="rounded-lg border border-ellevee-border p-3 bg-[#F8F8F6] space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ellevee-deep-ink font-display">
                  Lease: {envFlags.leaseSeconds}s • Time Budget: {(envFlags.cronBudgetMs / 1000).toFixed(0)}s
                </span>
                <Badge variant={envFlags.hasServiceRoleKey ? "outline" : "destructive"} className="font-mono text-[10px]">
                  {envFlags.hasServiceRoleKey ? "Service Role Ativo" : "Service Role Ausente"}
                </Badge>
              </div>
              <p className="text-[11px] text-ellevee-text-secondary">
                Garante reivindicação exclusiva via PostgreSQL <code className="font-mono">FOR UPDATE SKIP LOCKED</code> e resposta abaixo do timeout HTTP de 30s.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

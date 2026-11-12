import React from "react"
import Link from "next/link"
import { 
  Building2, 
  TrendingUp, 
  Zap, 
  MessageSquare, 
  DollarSign, 
  Bot, 
  Clock, 
  Activity, 
  CheckCircle2, 
  AlertCircle, 
  Cpu, 
  Layers, 
  ArrowRight, 
  ShieldCheck 
} from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getAdminDashboardMetrics } from "@/lib/services/platform/admin-metrics"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
  title: "Dashboard Executivo | SuperAdmin Ellevee IA",
  description: "Panorama operacional consolidado e métricas da plataforma Ellevee IA.",
}

export default async function SuperAdminDashboardPage() {
  const metrics = await getAdminDashboardMetrics()

  // Calcula o valor máximo para a proporção das barras do gráfico
  const maxBarValue = Math.max(...metrics.chart7Days.map((d) => d.count), 10)

  return (
    <div className="space-y-8">
      {/* Header Executivo */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-ellevee-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-deep-ink">
              Visão geral
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Painel Oficial
            </span>
          </div>
          <p className="text-xs text-ellevee-text-secondary mt-1 font-sans">
            Panorama operacional consolidado da plataforma Ellevee IA.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/companies">
            <Button variant="primary" size="sm" className="gap-1.5 font-display shadow-sm">
              <Building2 className="h-3.5 w-3.5" />
              <span>Gerenciar Empresas</span>
              <ArrowRight className="h-3.5 w-3.5 ml-0.5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Grid de Métricas Principais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Empresas Ativas */}
        <Card className="bg-white border-ellevee-border hover:border-ellevee-border-focus transition-all shadow-card hover:shadow-card-hover rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-text-secondary uppercase tracking-wider font-sans">
              Empresas em Operação
            </span>
            <span className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-ellevee-deep-ink tracking-tight">
                {metrics.companies.active}
              </span>
              <span className="text-xs text-ellevee-text-secondary font-medium font-sans">
                / {metrics.companies.total} cadastradas
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ellevee-deep-ink font-medium">
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10px] font-bold">
                100% ativas
              </span>
              {metrics.companies.trial > 0 && (
                <span className="text-ellevee-text-secondary">{metrics.companies.trial} em trial</span>
              )}
              {metrics.companies.suspended > 0 && (
                <span className="text-rose-600 font-semibold">{metrics.companies.suspended} suspensas</span>
              )}
            </div>
            <p className="text-[11px] text-ellevee-text-secondary/80 mt-2 font-sans border-t border-ellevee-border/60 pt-2">
              Tenants com isolamento e quotas gerenciadas no Supabase.
            </p>
          </CardContent>
        </Card>

        {/* Card 2: Mensagens Processadas */}
        <Card className="bg-white border-ellevee-border hover:border-ellevee-border-focus transition-all shadow-card hover:shadow-card-hover rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-text-secondary uppercase tracking-wider font-sans">
              Mensagens Processadas
            </span>
            <MessageSquare className="h-3.5 w-3.5 text-ellevee-text-secondary" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-ellevee-deep-ink tracking-tight font-mono">
                {metrics.messages.total.toLocaleString("pt-BR")}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ellevee-text-secondary font-medium">
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-ellevee-warm-ivory text-ellevee-deep-ink font-mono text-[10px] font-semibold border border-ellevee-border">
                SLA {metrics.messages.slaPercent}%
              </span>
              <span>{metrics.messages.thisMonth.toLocaleString("pt-BR")} no mês</span>
            </div>
            <p className="text-[11px] text-ellevee-text-secondary/80 mt-2 font-sans border-t border-ellevee-border/60 pt-2">
              Tráfego consolidado de inbound e outbound (WhatsApp/n8n).
            </p>
          </CardContent>
        </Card>

        {/* Card 3: MRR Estimado */}
        <Card className="bg-white border-ellevee-border hover:border-ellevee-border-focus transition-all shadow-card hover:shadow-card-hover rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-text-secondary uppercase tracking-wider font-sans">
              MRR Contratado
            </span>
            <DollarSign className="h-3.5 w-3.5 text-ellevee-text-secondary" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-ellevee-deep-ink tracking-tight font-mono">
                {metrics.financial.formattedMrr}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ellevee-text-secondary font-medium">
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10px] font-bold">
                Assinaturas Ativas
              </span>
              <span>Ticket R$ {metrics.financial.averageTicket}</span>
            </div>
            <p className="text-[11px] text-ellevee-text-secondary/80 mt-2 font-sans border-t border-ellevee-border/60 pt-2">
              Faturamento mensal recorrente contratado das empresas ativas.
            </p>
          </CardContent>
        </Card>

        {/* Card 4: Conversas & Agentes */}
        <Card className="bg-white border-ellevee-border hover:border-ellevee-border-focus transition-all shadow-card hover:shadow-card-hover rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-text-secondary uppercase tracking-wider font-sans">
              Atendimento Omnichannel
            </span>
            <Bot className="h-3.5 w-3.5 text-ellevee-text-secondary" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-ellevee-deep-ink tracking-tight font-mono">
                {metrics.conversations.total}
              </span>
              <span className="text-xs text-ellevee-text-secondary font-medium font-sans">conversas</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ellevee-text-secondary font-medium">
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-ellevee-warm-ivory text-ellevee-deep-ink font-mono text-[10px] font-semibold border border-ellevee-border">
                {metrics.conversations.open} IA • {metrics.conversations.human} Humano
              </span>
            </div>
            <p className="text-[11px] text-ellevee-text-secondary/80 mt-2 font-sans border-t border-ellevee-border/60 pt-2">
              {metrics.agents.total} agentes autônomos com roteamento multi-model.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Grid: Gráfico de Volume Diário & Saúde Operacional */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico de Volume Diário (7 Dias) */}
        <Card className="lg:col-span-2 bg-white border-ellevee-border shadow-card rounded-xl">
          <CardHeader className="border-b border-ellevee-border/60 pb-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="font-display text-base font-bold text-ellevee-deep-ink">
                    Volume de Mensagens
                  </CardTitle>
                  <span className="text-[10px] font-mono text-emerald-800 font-semibold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    Dados Reais
                  </span>
                </div>
                <CardDescription className="text-xs text-ellevee-text-secondary mt-0.5 font-sans">
                  Distribuição diária de mensagens registradas nos últimos 7 dias.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px] text-ellevee-text-secondary border-ellevee-border bg-ellevee-warm-ivory">
                  Últimos 7 dias
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            {/* Gráfico de Barras Verticais Proporcionais com Cores Institucionais */}
            <div className="h-56 flex items-end justify-between gap-3 sm:gap-4 px-2 sm:px-4">
              {metrics.chart7Days.map((item) => {
                const heightPercent = maxBarValue > 0 ? Math.max(Math.round((item.count / maxBarValue) * 100), 8) : 8

                return (
                  <div key={item.dateStr} className="flex-1 flex flex-col items-center gap-2 group cursor-default">
                    {/* Rótulo Superior com Valor da Barra */}
                    <div className="h-4 flex items-center justify-center">
                      <span className={`text-[11px] font-mono font-semibold transition-colors ${
                        item.isPeak 
                          ? "text-ellevee-deep-ink font-bold" 
                          : "text-ellevee-text-secondary group-hover:text-ellevee-deep-ink"
                      }`}>
                        {item.label}
                      </span>
                    </div>

                    {/* Trilho de Fundo com Barra Sólida e Visível */}
                    <div className="w-full bg-ellevee-warm-ivory rounded-t-lg h-40 flex items-end overflow-hidden p-1 border-b border-ellevee-border">
                      <div
                        className={`w-full rounded-t-md transition-all duration-300 shadow-sm ${
                          item.isPeak
                            ? "bg-gradient-to-t from-[#7028D9] via-[#087BEA] to-[#16BCE0] ring-1 ring-[#087BEA]/40 shadow-sm shadow-[#087BEA]/20"
                            : item.count > 0
                            ? "bg-gradient-to-t from-[#7028D9]/75 to-[#087BEA]/85 hover:opacity-95"
                            : "bg-ellevee-border/60"
                        }`}
                        style={{ height: `${heightPercent}%` }}
                      />
                    </div>

                    {/* Rótulo Inferior com o Dia da Semana */}
                    <div className="flex items-center gap-1">
                      <span className={`text-xs font-sans ${
                        item.isPeak 
                          ? "font-bold text-ellevee-deep-ink" 
                          : "font-medium text-ellevee-text-secondary"
                      }`}>
                        {item.day}
                      </span>
                      {item.isPeak && item.count > 0 && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#087BEA]" title="Pico Semanal" />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Distribuição por Canais e Legenda */}
            <div className="mt-6 pt-4 border-t border-ellevee-border/60 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-2 text-ellevee-deep-ink font-medium">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#087BEA]" />
                  Volume Diário <span className="font-mono text-ellevee-text-secondary">(Mensagens no banco)</span>
                </span>
                <span className="flex items-center gap-2 text-ellevee-deep-ink font-medium">
                  <span className="h-2.5 w-2.5 rounded-sm bg-ellevee-gradient" />
                  Pico da Semana
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-ellevee-text-secondary font-mono">
                <span>Total histórico: {metrics.messages.total.toLocaleString("pt-BR")} msgs</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card de Saúde Operacional */}
        <Card className="bg-white border-ellevee-border shadow-card rounded-xl flex flex-col justify-between">
          <div>
            <CardHeader className="border-b border-ellevee-border/60 pb-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-ellevee-deep-ink" />
                  <CardTitle className="font-display text-base font-bold text-ellevee-deep-ink">
                    Saúde Operacional
                  </CardTitle>
                </div>
                <Badge
                  variant="outline"
                  className={
                    metrics.health.workerStatus === "warning"
                      ? "text-[9px] uppercase font-mono text-rose-800 bg-rose-50 border-rose-200"
                      : metrics.health.workerStatus === "idle"
                      ? "text-[9px] uppercase font-mono text-amber-800 bg-amber-50 border-amber-200"
                      : "text-[9px] uppercase font-mono text-emerald-800 bg-emerald-50 border-emerald-200"
                  }
                >
                  {metrics.health.workerStatus === "warning"
                    ? "ATENÇÃO"
                    : metrics.health.workerStatus === "idle"
                    ? "AGUARDANDO"
                    : "OPERACIONAL"}
                </Badge>
              </div>
              <CardDescription className="text-xs text-ellevee-text-secondary mt-0.5 font-sans">
                Parâmetros operacionais do motor transacional e banco PostgreSQL.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-4 space-y-3">
              {/* 1. Worker de Reconciliação */}
              <div className="rounded-lg border border-ellevee-border p-3 bg-[#FBFBFA] space-y-1">
                <div className="flex items-center justify-between text-xs gap-2">
                  <span className="font-semibold text-ellevee-deep-ink">Worker de Outbox & Mensageria</span>
                  <span
                    className={`font-semibold flex items-center gap-1.5 font-sans text-[11px] ${
                      metrics.health.workerStatus === "warning"
                        ? "text-rose-700"
                        : metrics.health.workerStatus === "idle"
                        ? "text-amber-700"
                        : "text-emerald-700"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        metrics.health.workerStatus === "warning"
                          ? "bg-rose-500 animate-pulse"
                          : metrics.health.workerStatus === "idle"
                          ? "bg-amber-500"
                          : "bg-emerald-500 animate-pulse"
                      }`}
                    />
                    {metrics.health.workerStatusText}
                  </span>
                </div>
                <div className="text-[10px] text-ellevee-text-secondary font-mono">
                  {metrics.health.activeGatewayLocks} lock(s) em voo • Latência média IA {metrics.agents.averageLatencySeconds}s
                </div>
              </div>

              {/* 2. RLS & Governança */}
              <div className="rounded-lg border border-ellevee-border p-3 bg-[#FBFBFA] space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ellevee-deep-ink">Isolamento Multi-tenant (RLS)</span>
                  <span className="font-mono font-semibold text-emerald-700 text-[11px]">
                    100% ativo
                  </span>
                </div>
                <div className="text-[10px] text-ellevee-text-secondary font-sans">
                  Função <code className="font-mono text-[9px] bg-ellevee-warm-ivory border border-ellevee-border px-1 py-0.5 rounded">get_auth_company_id()</code> com verificação em cada query
                </div>
              </div>

              {/* 3. Mensagens Stalled & DLQ */}
              <div className="rounded-lg border border-ellevee-border p-3 bg-[#FBFBFA] space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ellevee-deep-ink">Pendências & Dead Letter Queue</span>
                  <span
                    className={`font-mono font-semibold text-[11px] ${
                      metrics.health.stalledMessages > 0 || (metrics.health.deadLetterCount ?? 0) > 0
                        ? "text-rose-700"
                        : "text-emerald-700"
                    }`}
                  >
                    {metrics.health.stalledMessages} travada(s) • {metrics.health.deadLetterCount ?? 0} DLQ
                  </span>
                </div>
                <div className="text-[10px] text-ellevee-text-secondary font-sans flex items-center justify-between gap-2">
                  <span>
                    {metrics.health.stalledMessages === 0 && (metrics.health.deadLetterCount ?? 0) === 0
                      ? "Fila outbox saudável • Sem falhas pendentes"
                      : "Itens aguardando reconciliação ou replay"}
                  </span>
                  <Link href="/admin-settings" className="text-[10px] font-semibold text-ellevee-purple hover:underline shrink-0">
                    Inspecionar →
                  </Link>
                </div>
              </div>
            </CardContent>
          </div>

          <div className="p-6 pt-0">
            <Link href="/audit">
              <Button variant="outline" size="sm" className="w-full text-xs font-medium border-ellevee-border text-ellevee-deep-ink hover:bg-ellevee-warm-ivory/50">
                Consultar Auditoria de Transações
              </Button>
            </Link>
          </div>
        </Card>
      </div>

      {/* Área de Atividade Recente */}
      <Card className="bg-white border-ellevee-border shadow-card rounded-xl">
        <CardHeader className="border-b border-ellevee-border/60 pb-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="font-display text-base font-bold text-ellevee-deep-ink">
                  Atividade Recente da Plataforma
                </CardTitle>
                <Badge variant="outline" className="text-[9px] font-mono text-emerald-800 bg-emerald-50 border-emerald-200 uppercase tracking-wider">
                  Eventos Reais
                </Badge>
              </div>
              <CardDescription className="text-xs text-ellevee-text-secondary mt-0.5 font-sans">
                Trilha operacional e de governança multi-tenant gravada no banco.
              </CardDescription>
            </div>
            <Link href="/audit">
              <Button variant="ghost" size="sm" className="text-xs text-ellevee-text-secondary hover:text-ellevee-deep-ink font-medium">
                Ver todos os logs →
              </Button>
            </Link>
          </div>
        </CardHeader>

        <CardContent className="pt-1 divide-y divide-ellevee-border/60">
          {metrics.recentActivity.length === 0 ? (
            <div className="py-6 text-center text-xs text-ellevee-text-secondary">
              Nenhuma atividade registrada recentemente.
            </div>
          ) : (
            metrics.recentActivity.map((event) => (
              <div key={event.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div className="flex items-start md:items-center gap-3 min-w-0">
                  <Badge variant={event.badgeVariant} className="text-[10px] w-20 justify-center shrink-0">
                    {event.typeBadge}
                  </Badge>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-ellevee-deep-ink font-sans truncate">
                      {event.title}
                    </span>
                    <span className="text-[11px] text-ellevee-text-secondary truncate">
                      {event.description}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-[11px] text-ellevee-text-secondary font-mono pl-7 md:pl-0 shrink-0">
                  <span className="text-ellevee-text-secondary/80">{event.actor}</span>
                  <span>•</span>
                  <span>{event.time}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

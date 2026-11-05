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

export default function SuperAdminDashboardPage() {
  return (
    <div className="space-y-8">
      {/* Header Executivo */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-ellevee-stone">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-ink">
              Visão geral
            </h1>
            <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider text-ellevee-sage">
              Simulação
            </Badge>
          </div>
          <p className="text-xs text-ellevee-sage mt-1 font-sans">
            Panorama operacional da plataforma Ellevee IA.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/companies">
            <Button variant="default" size="sm" className="gap-1.5 font-display">
              <Building2 className="h-3.5 w-3.5" />
              <span>Gerenciar Empresas</span>
              <ArrowRight className="h-3.5 w-3.5 ml-0.5 text-ellevee-accent" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Grid de Métricas Principais (Hierarquia Editorial Refinada) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Empresas Ativas (Destaque Principal) */}
        <Card className="bg-white border-ellevee-stone hover:border-ellevee-ink/30 transition-all shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-sage uppercase tracking-wider font-sans">
              Empresas em Operação
            </span>
            <span className="h-2 w-2 rounded-full bg-ellevee-accent ring-2 ring-ellevee-accent/20" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-ellevee-ink tracking-tight">42</span>
              <span className="text-xs text-ellevee-sage font-medium font-sans">/ 48 cadastradas</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ellevee-ink font-medium">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F4F8E8] text-[#3D5215] font-mono text-[10px] font-bold">
                +12% no trimestre
              </span>
              <span className="text-ellevee-sage">6 em onboarding</span>
            </div>
            <p className="text-[11px] text-ellevee-sage/80 mt-2 font-sans border-t border-ellevee-stone/40 pt-2">
              Tenants ativos com fluxo transacional liberado.
            </p>
          </CardContent>
        </Card>

        {/* Card 2: Mensagens Processadas */}
        <Card className="bg-white border-ellevee-stone hover:border-ellevee-ink/30 transition-all shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-sage uppercase tracking-wider font-sans">
              Volume Trafegado Hoje
            </span>
            <MessageSquare className="h-3.5 w-3.5 text-ellevee-sage" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-ellevee-ink tracking-tight font-mono">128.450</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ellevee-sage font-medium">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F3F2ED] text-ellevee-ink font-mono text-[10px] font-semibold border border-ellevee-stone">
                SLA 99.85%
              </span>
              <span>1.42M no mês</span>
            </div>
            <p className="text-[11px] text-ellevee-sage/80 mt-2 font-sans border-t border-ellevee-stone/40 pt-2">
              Tráfego consolidado de inbound e outbound.
            </p>
          </CardContent>
        </Card>

        {/* Card 3: MRR Estimado */}
        <Card className="bg-white border-ellevee-stone hover:border-ellevee-ink/30 transition-all shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-sage uppercase tracking-wider font-sans">
              MRR Estimado
            </span>
            <DollarSign className="h-3.5 w-3.5 text-ellevee-sage" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-ellevee-ink tracking-tight font-mono">R$ 38.600</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ellevee-sage font-medium">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F4F8E8] text-[#3D5215] font-mono text-[10px] font-bold">
                +8.4% MoM
              </span>
              <span>Ticket R$ 919</span>
            </div>
            <p className="text-[11px] text-ellevee-sage/80 mt-2 font-sans border-t border-ellevee-stone/40 pt-2">
              Faturamento mensal recorrente contratado.
            </p>
          </CardContent>
        </Card>

        {/* Card 4: Agentes em Operação */}
        <Card className="bg-white border-ellevee-stone hover:border-ellevee-ink/30 transition-all shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-sage uppercase tracking-wider font-sans">
              Agentes Autônomos
            </span>
            <Bot className="h-3.5 w-3.5 text-ellevee-sage" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-ellevee-ink tracking-tight font-mono">64</span>
              <span className="text-xs text-ellevee-sage font-medium font-sans">instâncias</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ellevee-sage font-medium">
              <Clock className="h-3 w-3 text-ellevee-sage" />
              <span>Latência média: <strong className="text-ellevee-ink font-mono">1.1s</strong></span>
            </div>
            <p className="text-[11px] text-ellevee-sage/80 mt-2 font-sans border-t border-ellevee-stone/40 pt-2">
              Multi-model routing (GPT-4o & Gemini).
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Grid: Gráfico de Volume Diário & Saúde Operacional */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico de Volume Diário (7 Dias) — Altura e Barras Claramente Evidentes */}
        <Card className="lg:col-span-2 bg-white border-ellevee-stone shadow-sm">
          <CardHeader className="border-b border-ellevee-stone/60 pb-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="font-display text-base font-bold text-ellevee-ink">
                    Volume de Mensagens
                  </CardTitle>
                  <span className="text-[10px] font-mono text-ellevee-sage uppercase tracking-wider bg-[#F3F2ED] border border-ellevee-stone px-1.5 py-0.5 rounded">
                    Demonstração
                  </span>
                </div>
                <CardDescription className="text-xs text-ellevee-sage mt-0.5 font-sans">
                  Distribuição diária nos últimos 7 dias com destaque para o pico operacional.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px] text-ellevee-sage">
                  Últimos 7 dias
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            {/* Gráfico de Barras Verticais Proporcionais */}
            <div className="h-56 flex items-end justify-between gap-3 sm:gap-4 px-2 sm:px-4">
              {[
                { day: "Seg", val: 68, label: "68K", isPeak: false },
                { day: "Ter", val: 82, label: "82K", isPeak: false },
                { day: "Qua", val: 95, label: "95K", isPeak: false },
                { day: "Qui", val: 110, label: "110K", isPeak: false },
                { day: "Sex", val: 128, label: "128K", isPeak: true },
                { day: "Sáb", val: 74, label: "74K", isPeak: false },
                { day: "Dom", val: 55, label: "55K", isPeak: false },
              ].map((item) => {
                const heightPercent = Math.round((item.val / 135) * 100)

                return (
                  <div key={item.day} className="flex-1 flex flex-col items-center gap-2 group cursor-default">
                    {/* Rótulo Superior com Valor da Barra */}
                    <div className="h-4 flex items-center justify-center">
                      <span className={`text-[11px] font-mono font-semibold transition-colors ${
                        item.isPeak 
                          ? "text-ellevee-ink font-bold" 
                          : "text-ellevee-sage group-hover:text-ellevee-ink"
                      }`}>
                        {item.label}
                      </span>
                    </div>

                    {/* Trilho de Fundo com Barra Sólida e Visível */}
                    <div className="w-full bg-[#EAE8E1]/60 rounded-t-sm h-40 flex items-end overflow-hidden p-1 border-b border-ellevee-stone">
                      <div
                        className={`w-full rounded-t-[3px] transition-all duration-300 shadow-sm ${
                          item.isPeak
                            ? "bg-ellevee-accent ring-1 ring-[#9EB844]"
                            : "bg-[#718071] hover:bg-[#5A685A]"
                        }`}
                        style={{ height: `${heightPercent}%` }}
                      />
                    </div>

                    {/* Rótulo Inferior com o Dia da Semana */}
                    <div className="flex items-center gap-1">
                      <span className={`text-xs font-sans ${
                        item.isPeak 
                          ? "font-bold text-ellevee-ink" 
                          : "font-medium text-ellevee-sage"
                      }`}>
                        {item.day}
                      </span>
                      {item.isPeak && (
                        <span className="h-1.5 w-1.5 rounded-full bg-ellevee-accent" title="Pico Semanal" />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Distribuição por Canais e Legenda */}
            <div className="mt-6 pt-4 border-t border-ellevee-stone/60 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-2 text-ellevee-ink font-medium">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#718071]" />
                  Dias Regulares <span className="font-mono text-ellevee-sage">(Stone / Sage)</span>
                </span>
                <span className="flex items-center gap-2 text-ellevee-ink font-medium">
                  <span className="h-2.5 w-2.5 rounded-sm bg-ellevee-accent ring-1 ring-[#9EB844]" />
                  Pico Operacional <span className="font-mono text-ellevee-sage">(Sexta 128K)</span>
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-ellevee-sage font-mono">
                <span>WhatsApp: 88%</span>
                <span>•</span>
                <span>Webchat/APIs: 12%</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card de Saúde Operacional (Estruturado conforme Seção 3.3) */}
        <Card className="bg-white border-ellevee-stone shadow-sm flex flex-col justify-between">
          <div>
            <CardHeader className="border-b border-ellevee-stone/60 pb-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-ellevee-ink" />
                  <CardTitle className="font-display text-base font-bold text-ellevee-ink">
                    Saúde Operacional
                  </CardTitle>
                </div>
                <Badge variant="outline" className="text-[9px] uppercase font-mono text-amber-700 bg-amber-50/60 border-amber-200">
                  DEMO / SIMULAÇÃO
                </Badge>
              </div>
              <CardDescription className="text-xs text-ellevee-sage mt-0.5 font-sans">
                Parâmetros operacionais simulados do motor de fundo e banco.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-4 space-y-3">
              {/* 1. Worker de Reconciliação */}
              <div className="rounded-md border border-ellevee-stone/80 p-3 bg-[#FBFBFA] space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ellevee-ink">Worker de Reconciliação</span>
                  <span className="font-semibold text-emerald-700 flex items-center gap-1.5 font-sans text-[11px]">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Operando (idle)
                  </span>
                </div>
                <div className="text-[10px] text-ellevee-sage font-mono">
                  Ciclo a cada 60s • Última varredura há 38 segundos
                </div>
              </div>

              {/* 2. Gateway Lock Leases */}
              <div className="rounded-md border border-ellevee-stone/80 p-3 bg-[#FBFBFA] space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ellevee-ink">Gateway Lock Leases</span>
                  <span className="font-mono font-semibold text-ellevee-ink text-[11px]">
                    4 leases ativos
                  </span>
                </div>
                <div className="text-[10px] text-ellevee-sage font-sans">
                  Concorrência isolada via PostgreSQL <code className="font-mono text-[9px] bg-[#F3F2ED] px-1 py-0.5 rounded">SKIP LOCKED</code>
                </div>
              </div>

              {/* 3. Mensagens Stalled */}
              <div className="rounded-md border border-ellevee-stone/80 p-3 bg-[#FBFBFA] space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ellevee-ink">Mensagens Stalled</span>
                  <span className="font-mono font-semibold text-emerald-700 text-[11px]">
                    0 travadas
                  </span>
                </div>
                <div className="text-[10px] text-ellevee-sage font-sans">
                  Dead letter queue vazia • Fila outbox normalizada
                </div>
              </div>
            </CardContent>
          </div>

          <div className="p-6 pt-0">
            <Link href="/audit">
              <Button variant="outline" size="sm" className="w-full text-xs font-medium border-ellevee-stone text-ellevee-ink hover:bg-[#F8F8F5]">
                Consultar Auditoria de Transações
              </Button>
            </Link>
          </div>
        </Card>
      </div>

      {/* Área de Atividade Recente (Seção 3.4 com alinhamento rigoroso e tag demonstrativa) */}
      <Card className="bg-white border-ellevee-stone shadow-sm">
        <CardHeader className="border-b border-ellevee-stone/60 pb-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="font-display text-base font-bold text-ellevee-ink">
                  Atividade Recente da Plataforma
                </CardTitle>
                <Badge variant="outline" className="text-[9px] font-mono text-ellevee-sage uppercase tracking-wider">
                  Dados Demonstrativos
                </Badge>
              </div>
              <CardDescription className="text-xs text-ellevee-sage mt-0.5 font-sans">
                Fluxo simulado de governança e auditoria operacional multi-tenant (Demonstração).
              </CardDescription>
            </div>
            <Link href="/audit">
              <Button variant="ghost" size="sm" className="text-xs text-ellevee-sage hover:text-ellevee-ink font-medium">
                Ver todos os logs →
              </Button>
            </Link>
          </div>
        </CardHeader>

        <CardContent className="pt-1 divide-y divide-ellevee-stone/50">
          {[
            {
              id: "ev-1",
              typeBadge: "Cadastro",
              badgeVariant: "accent" as const,
              title: "Nova empresa cadastrada",
              description: "Vanguard Advocacia provisionada no plano Trial (1.000 msgs/mês)",
              actor: "Phelipi (SuperAdmin)",
              time: "Há 12 minutos",
            },
            {
              id: "ev-2",
              typeBadge: "Upgrade",
              badgeVariant: "default" as const,
              title: "Alteração de plano contratado",
              description: "Clínica Bem Estar Odonto promovida de Starter para Pro (25.000 msgs)",
              actor: "Phelipi (SuperAdmin)",
              time: "Há 2 horas",
            },
            {
              id: "ev-3",
              typeBadge: "Limites",
              badgeVariant: "outline" as const,
              title: "Ajuste manual de limites",
              description: "Coala Play Streaming teve cota expandida para 50.000 msgs e 5M tokens",
              actor: "Phelipi (SuperAdmin)",
              time: "Há 4 horas",
            },
            {
              id: "ev-4",
              typeBadge: "Agente",
              badgeVariant: "outline" as const,
              title: "Agente autônomo ativado",
              description: "Novo bot especializado de triagem habilitado em Nexus Logística & Cargas",
              actor: "Sistema Transacional",
              time: "Ontem às 19:30",
            },
            {
              id: "ev-5",
              typeBadge: "Suspensão",
              badgeVariant: "destructive" as const,
              title: "Acesso de empresa suspenso",
              description: "Alpha Imóveis Prime bloqueada temporariamente para conferência cadastral",
              actor: "Phelipi (SuperAdmin)",
              time: "Ontem às 14:10",
            },
          ].map((event) => (
            <div key={event.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className="flex items-start md:items-center gap-3 min-w-0">
                <Badge variant={event.badgeVariant} className="text-[10px] w-18 justify-center shrink-0">
                  {event.typeBadge}
                </Badge>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-ellevee-ink font-sans truncate">
                    {event.title}
                  </span>
                  <span className="text-[11px] text-ellevee-sage truncate">
                    {event.description}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4 text-[11px] text-ellevee-sage font-mono pl-7 md:pl-0 shrink-0">
                <span className="text-ellevee-sage/80">{event.actor}</span>
                <span>•</span>
                <span>{event.time}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

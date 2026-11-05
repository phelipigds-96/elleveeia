import React from "react"
import Link from "next/link"
import { 
  Building2, 
  TrendingUp, 
  Zap, 
  MessageSquare, 
  DollarSign, 
  Bot, 
  ArrowUpRight, 
  ShieldCheck, 
  Clock, 
  Activity,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Layers,
  ArrowRight
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

      {/* Grid de Métricas Principais (Hierarquia Variada / Quiet Technology) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Empresas Ativas (Destaque Principal) */}
        <Card className="bg-white border-ellevee-stone hover:border-ellevee-ink/30 transition-all shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-sage uppercase tracking-wider font-sans">
              Empresas Ativas
            </span>
            <span className="h-2 w-2 rounded-full bg-ellevee-accent ring-2 ring-ellevee-accent/20" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-ellevee-ink tracking-tight">42</span>
              <span className="text-xs text-ellevee-sage font-medium">/ 48 tenants</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2.5 text-[11px] text-ellevee-ink font-medium">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F4F8E8] text-[#425916] font-mono text-[10px] font-bold">
                +12%
              </span>
              <span className="text-ellevee-sage">vs trimestre anterior</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Mensagens Hoje */}
        <Card className="bg-white border-ellevee-stone hover:border-ellevee-ink/30 transition-all shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-sage uppercase tracking-wider font-sans">
              Mensagens Hoje
            </span>
            <MessageSquare className="h-4 w-4 text-ellevee-sage" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-ellevee-ink tracking-tight font-mono">128.450</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2.5 text-[11px] text-ellevee-sage font-medium">
              <span className="font-mono text-ellevee-ink font-semibold">1.42M</span>
              <span>acumulado no mês (SLA 99.85%)</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: MRR Estimado */}
        <Card className="bg-white border-ellevee-stone hover:border-ellevee-ink/30 transition-all shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-sage uppercase tracking-wider font-sans">
              Receita Recorrente (MRR)
            </span>
            <DollarSign className="h-4 w-4 text-ellevee-sage" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-ellevee-ink tracking-tight font-mono">R$ 38.600</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2.5 text-[11px] text-ellevee-sage font-medium">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F8F8F5] text-ellevee-ink font-mono text-[10px] font-bold border border-ellevee-stone">
                +8.4% MoM
              </span>
              <span>Ticket médio R$ 919</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Agentes em Operação */}
        <Card className="bg-white border-ellevee-stone hover:border-ellevee-ink/30 transition-all shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <span className="text-[11px] font-semibold text-ellevee-sage uppercase tracking-wider font-sans">
              Agentes em Operação
            </span>
            <Bot className="h-4 w-4 text-ellevee-sage" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-ellevee-ink tracking-tight font-mono">64</span>
              <span className="text-xs text-ellevee-sage font-medium">instâncias ativas</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2.5 text-[11px] text-ellevee-sage font-medium">
              <Clock className="h-3.5 w-3.5 text-ellevee-sage" />
              <span>Latência média de inferência: <strong className="text-ellevee-ink font-mono">1.1s</strong></span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grid: Gráfico de Volume & Saúde Operacional */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico de Volume Diário (7 Dias) */}
        <Card className="lg:col-span-2 bg-white border-ellevee-stone shadow-sm">
          <CardHeader className="border-b border-ellevee-stone/60 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="font-display text-base font-bold text-ellevee-ink">
                  Volume de Mensagens
                </CardTitle>
                <CardDescription className="text-xs text-ellevee-sage mt-0.5 font-sans">
                  Distribuição de tráfego transacionado nos últimos 7 dias.
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
            {/* Gráfico de Barras Estilizado - Quiet Technology */}
            <div className="h-52 flex items-end justify-between gap-3 px-2">
              {[
                { day: "Seg", val: 68, label: "68K" },
                { day: "Ter", val: 82, label: "82K" },
                { day: "Qua", val: 95, label: "95K" },
                { day: "Qui", val: 110, label: "110K" },
                { day: "Sex", val: 128, label: "128K", highlight: true },
                { day: "Sáb", val: 74, label: "74K" },
                { day: "Dom", val: 55, label: "55K" },
              ].map((item) => (
                <div key={item.day} className="flex-1 flex flex-col items-center gap-2 group cursor-default">
                  <span className={`text-[10px] font-mono font-semibold transition-colors ${
                    item.highlight ? "text-ellevee-ink font-bold" : "text-ellevee-sage group-hover:text-ellevee-ink"
                  }`}>
                    {item.label}
                  </span>
                  <div className="w-full bg-[#F3F2ED] rounded-t-sm h-36 flex items-end overflow-hidden p-0.5">
                    <div
                      className={`w-full rounded-t-sm transition-all duration-300 ${
                        item.highlight 
                          ? "bg-ellevee-ink" 
                          : "bg-ellevee-ink/75 group-hover:bg-ellevee-ink"
                      }`}
                      style={{ height: `${(item.val / 130) * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-ellevee-sage font-sans">{item.day}</span>
                </div>
              ))}
            </div>

            {/* Distribuição por Canais */}
            <div className="mt-6 pt-4 border-t border-ellevee-stone/60 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-2 text-ellevee-ink font-medium">
                  <span className="h-2 w-2 rounded-full bg-ellevee-ink" />
                  WhatsApp Cloud Gateway <span className="font-mono text-ellevee-sage">(88%)</span>
                </span>
                <span className="flex items-center gap-2 text-ellevee-ink font-medium">
                  <span className="h-2 w-2 rounded-full bg-ellevee-stone" />
                  Webchat & APIs <span className="font-mono text-ellevee-sage">(12%)</span>
                </span>
              </div>
              <span className="text-[11px] text-ellevee-sage font-mono">
                Pico: 128K msgs (Sexta)
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card de Saúde Operacional (Claramente Identificado como DEMO / SIMULAÇÃO) */}
        <Card className="bg-white border-ellevee-stone shadow-sm flex flex-col justify-between">
          <div>
            <CardHeader className="border-b border-ellevee-stone/60 pb-4">
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
                Monitoramento simulado dos workers e banco transacional.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-4 space-y-3">
              {/* Worker Reconciliação */}
              <div className="rounded-md border border-ellevee-stone/80 p-3 bg-[#FBFBFA] space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ellevee-sage font-medium">Worker de Reconciliação:</span>
                  <span className="font-semibold text-emerald-700 flex items-center gap-1 font-sans">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Operando (idle)
                  </span>
                </div>
                <div className="text-[10px] text-ellevee-sage font-mono">
                  Última varredura há 38 segundos
                </div>
              </div>

              {/* Concorrência & Locks */}
              <div className="rounded-md border border-ellevee-stone/80 p-3 bg-[#FBFBFA] space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ellevee-sage font-medium">Gateway Lock Leases:</span>
                  <span className="font-mono font-semibold text-ellevee-ink">4 leases ativos</span>
                </div>
                <div className="text-[10px] text-ellevee-sage font-sans">
                  Concorrência isolada (PostgreSQL SKIP LOCKED)
                </div>
              </div>

              {/* Fila & Dead Letters */}
              <div className="rounded-md border border-ellevee-stone/80 p-3 bg-[#FBFBFA] space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ellevee-sage font-medium">Mensagens Stalled:</span>
                  <span className="font-mono font-semibold text-emerald-700">0 mensagens travadas</span>
                </div>
                <div className="text-[10px] text-ellevee-sage font-sans">
                  Outbox limpa e reconciliada
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

      {/* Área de Atividade Recente (Histórico Operacional Empresarial Simulado) */}
      <Card className="bg-white border-ellevee-stone shadow-sm">
        <CardHeader className="border-b border-ellevee-stone/60 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-display text-base font-bold text-ellevee-ink">
                Atividade Recente da Plataforma
              </CardTitle>
              <CardDescription className="text-xs text-ellevee-sage mt-0.5 font-sans">
                Eventos administrativos e transacionais recentes gravados em auditoria (Simulação).
              </CardDescription>
            </div>
            <Link href="/audit">
              <Button variant="ghost" size="sm" className="text-xs text-ellevee-sage hover:text-ellevee-ink font-medium">
                Ver todos os logs →
              </Button>
            </Link>
          </div>
        </CardHeader>

        <CardContent className="pt-2 divide-y divide-ellevee-stone/60">
          {[
            {
              id: "ev-1",
              type: "tenant_provisioned",
              title: "Nova empresa cadastrada",
              description: "Vanguard Advocacia provisionada no plano Trial (1.000 msgs/mês)",
              actor: "Phelipi (SuperAdmin)",
              time: "Há 12 minutos",
              badge: { text: "Cadastro", variant: "accent" as const }
            },
            {
              id: "ev-2",
              type: "plan_changed",
              title: "Alteração de plano contratado",
              description: "Clínica Bem Estar Odonto promovida de Starter para Pro (25.000 msgs)",
              actor: "Phelipi (SuperAdmin)",
              time: "Há 2 horas",
              badge: { text: "Upgrade", variant: "default" as const }
            },
            {
              id: "ev-3",
              type: "limits_adjusted",
              title: "Ajuste manual de limites",
              description: "Coala Play Streaming teve cota expandida para 50.000 msgs e 5M tokens",
              actor: "Phelipi (SuperAdmin)",
              time: "Há 4 horas",
              badge: { text: "Limites", variant: "outline" as const }
            },
            {
              id: "ev-4",
              type: "agent_activated",
              title: "Agente autônomo ativado",
              description: "Novo bot especializado de triagem habilitado em Nexus Logística & Cargas",
              actor: "Sistema",
              time: "Ontem às 19:30",
              badge: { text: "Agente", variant: "outline" as const }
            },
            {
              id: "ev-5",
              type: "company_suspended",
              title: "Acesso de empresa suspenso",
              description: "Alpha Imóveis Prime bloqueada temporariamente para emissão de faturamento",
              actor: "Phelipi (SuperAdmin)",
              time: "Ontem às 14:10",
              badge: { text: "Suspensão", variant: "destructive" as const }
            },
          ].map((event) => (
            <div key={event.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-start sm:items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-ellevee-ink shrink-0 mt-1 sm:mt-0" />
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ellevee-ink font-sans">
                      {event.title}
                    </span>
                    <Badge variant={event.badge.variant} className="text-[9px] px-1.5 py-0">
                      {event.badge.text}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-ellevee-sage mt-0.5">
                    {event.description}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4 text-[11px] text-ellevee-sage font-mono pl-5 sm:pl-0">
                <span className="hidden md:inline text-ellevee-sage/80">{event.actor}</span>
                <span>{event.time}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

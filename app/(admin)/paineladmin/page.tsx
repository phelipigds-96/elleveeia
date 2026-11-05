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
  AlertCircle
} from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export default function SuperAdminDashboardPage() {
  return (
    <div className="space-y-8">
      {/* Header Boas-Vindas */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Painel Geral do SuperAdmin
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Métricas consolidadas de infraestrutura, volume de mensagens e tenants ativos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/companies">
            <Button variant="primary" size="sm">
              <Building2 className="h-4 w-4 mr-1.5" />
              Gerenciar Empresas
            </Button>
          </Link>
        </div>
      </div>

      {/* Grid de Métricas Principais (Cards Enterprise) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Empresas Ativas */}
        <Card className="hover:border-slate-300 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Empresas Ativas
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Building2 className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold text-slate-900">42</div>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-emerald-600 font-medium">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>+12% novos tenants este mês</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Mensagens Hoje */}
        <Card className="hover:border-slate-300 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Mensagens Hoje
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <MessageSquare className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold text-slate-900">128.450</div>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-emerald-600 font-medium">
              <ArrowUpRight className="h-3.5 w-3.5" />
              <span>99.85% de taxa de entrega</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: MRR Estimado */}
        <Card className="hover:border-slate-300 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              MRR Estimado
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <DollarSign className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold text-slate-900">R$ 38.600</div>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-emerald-600 font-medium">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>+8.4% vs mês anterior</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Agentes IA em Operação */}
        <Card className="hover:border-slate-300 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Agentes IA Ativos
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Bot className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold text-slate-900">64</div>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500 font-medium">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <span>Latência média: 1.1s</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Seção Gráfico e Monitor de Outbox */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico Simulado de Volume Diário */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Tráfego e Volume de Mensagens</CardTitle>
                <CardDescription>Distribuição de mensagens transacionadas nos últimos 7 dias</CardDescription>
              </div>
              <Badge variant="secondary">Últimos 7 dias</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {/* Visualizador de Barras Simulado em SVG */}
            <div className="h-56 flex items-end justify-between gap-3 pt-6 px-2">
              {[
                { day: "Seg", val: 68, label: "68K" },
                { day: "Ter", val: 82, label: "82K" },
                { day: "Qua", val: 95, label: "95K" },
                { day: "Qui", val: 110, label: "110K" },
                { day: "Sex", val: 128, label: "128K" },
                { day: "Sáb", val: 74, label: "74K" },
                { day: "Dom", val: 55, label: "55K" },
              ].map((item) => (
                <div key={item.day} className="flex-1 flex flex-col items-center gap-2 group">
                  <span className="text-[10px] font-mono text-slate-400 group-hover:text-indigo-600 font-semibold transition-colors">
                    {item.label}
                  </span>
                  <div className="w-full bg-slate-100 rounded-t-lg h-40 flex items-end overflow-hidden p-1">
                    <div
                      className="w-full bg-indigo-600 rounded-t group-hover:bg-indigo-500 transition-all duration-300"
                      style={{ height: `${(item.val / 130) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-600">{item.day}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-indigo-600"></span>
                WhatsApp Cloud Gateway (88%)
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-slate-400"></span>
                Webchat & APIs (12%)
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card de Saúde do Motor Transacional */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-600" />
              <CardTitle>Saúde Transacional</CardTitle>
            </div>
            <CardDescription>Status da Outbox e Workers de Fundo</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/50 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Worker de Reconciliação:</span>
                <span className="font-semibold text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Operando (idle)
                </span>
              </div>
              <span className="text-[11px] text-slate-400">Última varredura há 38 segundos</span>
            </div>

            <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/50 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Gateway Lock Leases:</span>
                <span className="font-mono font-bold text-slate-800">4 leases ativos</span>
              </div>
              <span className="text-[11px] text-slate-400">Tolerância a concorrência zero-conflict</span>
            </div>

            <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/50 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Mensagens Stalled / Poison:</span>
                <span className="font-semibold text-slate-800">0 mensagens travadas</span>
              </div>
              <span className="text-[11px] text-slate-400">Dead letter queue limpa</span>
            </div>

            <div className="pt-2">
              <Link href="/companies">
                <Button variant="outline" size="sm" className="w-full text-xs">
                  Ver Todas as Empresas
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Atalhos e Destaques */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors shadow-sm">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
            <Building2 className="h-4 w-4" />
          </div>
          <h3 className="font-bold text-sm text-slate-900">Provisionar Empresa</h3>
          <p className="text-xs text-slate-500 mt-1">
            Cadastre novos clientes, defina planos de mensagens e aloque cotas de tokens.
          </p>
          <Link href="/companies" className="inline-flex items-center text-xs font-semibold text-indigo-600 hover:text-indigo-700 mt-3">
            Acessar Empresas →
          </Link>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors shadow-sm">
          <div className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <h3 className="font-bold text-sm text-slate-900">Auditoria & Logs</h3>
          <p className="text-xs text-slate-500 mt-1">
            Histórico imutável de alterações em planos, limites de quotas e suspensões.
          </p>
          <Link href="/audit" className="inline-flex items-center text-xs font-semibold text-indigo-600 hover:text-indigo-700 mt-3">
            Ver Logs de Auditoria →
          </Link>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors shadow-sm">
          <div className="h-8 w-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center mb-3">
            <Zap className="h-4 w-4" />
          </div>
          <h3 className="font-bold text-sm text-slate-900">Provedores de IA</h3>
          <p className="text-xs text-slate-500 mt-1">
            Monitore o consumo consolidado de OpenAI GPT-4o e Google Gemini Flash.
          </p>
          <Link href="/admin-settings" className="inline-flex items-center text-xs font-semibold text-indigo-600 hover:text-indigo-700 mt-3">
            Configurar Modelos →
          </Link>
        </div>
      </div>
    </div>
  )
}

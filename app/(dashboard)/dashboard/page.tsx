import React from 'react'
import Link from 'next/link'
import {
  MessageSquare,
  Users,
  Clock,
  Sparkles,
  Bot,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Zap,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getDashboardData } from '@/lib/services/dashboard'
import { MetricCard } from '@/components/dashboard/metric-card'
import { ActivityChart } from '@/components/dashboard/activity-chart'
import { RecentActivity } from '@/components/dashboard/recent-activity'
import { IntegrationStatus } from '@/components/dashboard/integration-status'
import { PeriodSelector } from '@/components/dashboard/period-selector'
import { requireCompanyAdmin } from '@/lib/services/auth/guard'

export const dynamic = 'force-dynamic'

interface DashboardPageProps {
  searchParams: { period?: string }
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  // Barreira de proteção: autenticação obrigatória
  await requireCompanyAdmin()

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let greetingName = 'Usuário'

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.full_name) {
      greetingName = profile.full_name.split(' ')[0]
    }
  }

  const period =
    searchParams.period === 'today' || searchParams.period === '30days'
      ? searchParams.period
      : '7days'

  // Consulta consolidada e 100% dinâmica
  const dashboard = await getDashboardData(period)
  const { metrics, chartData, recentActivity, integrationsStatus, companyInfo } = dashboard

  const periodLabel =
    period === 'today'
      ? 'Hoje'
      : period === '7days'
      ? 'Últimos 7 dias'
      : 'Últimos 30 dias'

  return (
    <div className="space-y-8 pb-12 max-w-7xl mx-auto">
      {/* CABEÇALHO EXECUTIVO */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200/80">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-gray-900">
              Olá, {greetingName}!
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Operação Ativa
            </span>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Painel operacional e inteligência de atendimento da sua empresa{' '}
            <strong className="font-semibold text-gray-900">{companyInfo.name}</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <PeriodSelector />
          <Link
            href="/conversations"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#005d4b] hover:bg-[#004738] text-white rounded-xl shadow-2xs transition-colors"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Abrir Chat
          </Link>
        </div>
      </div>

      {/* 1. GRID DE CARDS EXECUTIVOS */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Volume Total de Conversas */}
        <MetricCard
          title="Total de Conversas"
          value={metrics.total_conversations}
          description={`Volume no período (${periodLabel})`}
          Icon={MessageSquare}
          accentColor="emerald"
          badge="WhatsApp"
        />

        {/* Card 2: Taxa de Resolução Automatizada da IA */}
        <MetricCard
          title="Resolução pela IA"
          value={`${metrics.ai_resolution_rate}%`}
          description={`${metrics.ai_resolved_count} de ${metrics.total_conversations} tratadas sem humano`}
          Icon={Bot}
          accentColor="violet"
          trend="Autônomo"
        />

        {/* Card 3: Transbordo / Fila Humana */}
        <MetricCard
          title="Transbordos para Humano"
          value={metrics.transfers}
          description="Casos que solicitaram operador"
          Icon={Users}
          accentColor="amber"
          badge={metrics.transfers === 0 ? 'Zero Fila' : `${metrics.transfers} transferidos`}
        />

        {/* Card 4: Clientes Únicos Atendidos */}
        <MetricCard
          title="Clientes Atendidos"
          value={metrics.unique_customers}
          description="Contatos únicos no período"
          Icon={CheckCircle2}
          accentColor="blue"
          badge="100% Retenção"
        />
      </div>

      {/* 2. GRID CENTRAL: GRÁFICO DE ATIVIDADE + STATUS DAS CONEXÕES */}
      <div className="grid gap-6 lg:grid-cols-7 items-start">
        {/* Coluna Esquerda (4/7): Gráfico de Volume Diário */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-gray-200/90 shadow-2xs p-6 flex flex-col justify-between">
          <div className="flex items-start justify-between pb-4 border-b border-gray-100">
            <div>
              <h2 className="font-bold text-base text-gray-900">
                Volume de Atendimentos
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Evolução cronológica de conversas no período selecionado.
              </p>
            </div>
            <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">
              {periodLabel}
            </span>
          </div>

          <div className="pt-4 flex-1">
            <ActivityChart data={chartData} />
          </div>
        </div>

        {/* Coluna Direita (3/7): Status Real dos Canais e Motores */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-200/90 shadow-2xs p-6 space-y-4">
          <div className="flex items-start justify-between pb-3 border-b border-gray-100">
            <div>
              <h2 className="font-bold text-base text-gray-900">
                Canais & Motores
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Saúde operacional das conexões ativas.
              </p>
            </div>
            <Link
              href="/integrations"
              className="text-xs text-[#005d4b] hover:underline font-medium inline-flex items-center gap-0.5"
            >
              Gerenciar
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <IntegrationStatus items={integrationsStatus} />
        </div>
      </div>

      {/* 3. SEÇÃO INFERIOR: ATIVIDADE RECENTE EM TEMPO REAL */}
      <div className="bg-white rounded-2xl border border-gray-200/90 shadow-2xs overflow-hidden">
        <div className="p-6 pb-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-base text-gray-900">
              Atendimentos Recentes
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Últimas conversas processadas e respondidas pela plataforma em tempo real.
            </p>
          </div>

          <Link
            href="/conversations"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#005d4b] hover:text-[#004738] hover:underline"
          >
            Ver todas as conversas
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <RecentActivity items={recentActivity} />
      </div>
    </div>
  )
}

import { MessageSquare, Users, Clock, ArrowRightLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getDashboardMetrics } from '@/lib/services/dashboard'
import { MetricCard } from '@/components/dashboard/metric-card'
import { ActivityChart } from '@/components/dashboard/activity-chart'
import { RecentActivity } from '@/components/dashboard/recent-activity'
import { IntegrationStatus } from '@/components/dashboard/integration-status'
import { PeriodSelector } from '@/components/dashboard/period-selector'

interface DashboardPageProps {
  searchParams: { period?: string }
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  let profile = null
  let company = null

  if (user) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*, companies(*)')
      .eq('id', user.id)
      .single()
      
    if (profileData) {
      profile = profileData
      company = profileData.companies as any
    }
  }

  const period = (searchParams.period === 'today' || searchParams.period === '30days') 
    ? searchParams.period 
    : '7days'

  const metrics = await getDashboardMetrics(period)

  const greetingName = profile?.full_name ? profile.full_name.split(' ')[0] : 'Usuário'

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Olá, {greetingName}!</h1>
          <p className="text-muted-foreground">Visão geral do atendimento da sua empresa <strong>{company?.name}</strong>.</p>
        </div>
        <PeriodSelector />
      </div>
      
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard 
          title="Conversas" 
          value={metrics.total_conversations} 
          description={period === 'today' ? 'Hoje' : period === '7days' ? 'Últimos 7 dias' : 'Últimos 30 dias'} 
          Icon={MessageSquare} 
        />
        <MetricCard 
          title="Conversas Abertas" 
          value={metrics.open_conversations} 
          description="Aguardando resposta" 
          Icon={Clock} 
        />
        <MetricCard 
          title="Clientes Atendidos" 
          value={metrics.unique_customers} 
          description="Clientes únicos no período" 
          Icon={Users} 
        />
        <MetricCard 
          title="Transferências" 
          value={metrics.transfers} 
          description="Para atendimento humano" 
          Icon={ArrowRightLeft} 
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <div className="col-span-4 rounded-xl border bg-card text-card-foreground shadow-sm flex flex-col">
          <div className="flex flex-col space-y-1.5 p-6 pb-0">
            <h3 className="font-semibold leading-none tracking-tight">Atividade</h3>
            <p className="text-sm text-muted-foreground">Volume de conversas no período selecionado.</p>
          </div>
          <div className="p-6 pt-0 flex-1">
            {/* Array vazio para garantir o empty state solicitado, já que não temos conversas reais */}
            <ActivityChart data={[]} />
          </div>
        </div>

        <div className="col-span-3 space-y-4">
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
            <div className="flex flex-col space-y-1.5 p-6 pb-4">
              <h3 className="font-semibold leading-none tracking-tight">Status das Integrações</h3>
              <p className="text-sm text-muted-foreground">Serviços conectados à plataforma.</p>
            </div>
            <div className="p-6 pt-0">
              <IntegrationStatus />
            </div>
          </div>

          <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
            <div className="flex flex-col space-y-1.5 p-6 pb-4">
              <h3 className="font-semibold leading-none tracking-tight">Atividade Recente</h3>
            </div>
            <div className="p-6 pt-0">
              <RecentActivity items={[]} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

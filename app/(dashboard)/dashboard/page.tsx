import { MessageSquare, Users, Clock, ArrowRightLeft } from 'lucide-react'

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral do seu atendimento.</p>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Card 1 */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="tracking-tight text-sm font-medium">Conversas hoje</h3>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">+0% em relação a ontem</p>
          </div>
        </div>

        {/* Card 2 */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="tracking-tight text-sm font-medium">Conversas abertas</h3>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">Aguardando resposta</p>
          </div>
        </div>

        {/* Card 3 */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="tracking-tight text-sm font-medium">Clientes atendidos</h3>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">Neste mês</p>
          </div>
        </div>

        {/* Card 4 */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="tracking-tight text-sm font-medium">Transferências</h3>
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">Para atendimento humano</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <div className="col-span-4 rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="font-semibold leading-none tracking-tight">Atividade recente</h3>
            <p className="text-sm text-muted-foreground">Últimos eventos do seu agente.</p>
          </div>
          <div className="p-6 pt-0">
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Nenhuma atividade recente.
            </div>
          </div>
        </div>

        <div className="col-span-3 rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="font-semibold leading-none tracking-tight">Status das Integrações</h3>
            <p className="text-sm text-muted-foreground">Serviços conectados à plataforma.</p>
          </div>
          <div className="p-6 pt-0 space-y-4">
            <div className="flex items-center">
              <div className="ml-4 space-y-1">
                <p className="text-sm font-medium leading-none">Supabase</p>
                <p className="text-sm text-muted-foreground">Banco e Auth conectados</p>
              </div>
              <div className="ml-auto font-medium text-sm text-emerald-500">Conectado</div>
            </div>
            <div className="flex items-center">
              <div className="ml-4 space-y-1">
                <p className="text-sm font-medium leading-none">IA (OpenAI)</p>
                <p className="text-sm text-muted-foreground">Modelo de linguagem</p>
              </div>
              <div className="ml-auto font-medium text-sm text-amber-500">Em configuração</div>
            </div>
            <div className="flex items-center">
              <div className="ml-4 space-y-1">
                <p className="text-sm font-medium leading-none">n8n</p>
                <p className="text-sm text-muted-foreground">Webhooks e automações</p>
              </div>
              <div className="ml-auto font-medium text-sm text-muted-foreground">Não conectado</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

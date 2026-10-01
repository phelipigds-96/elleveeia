import { Database, Bot, Webhook, MessageCircle } from 'lucide-react'

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Integrações</h1>
        <p className="text-muted-foreground">Conecte os serviços essenciais à plataforma Ellevee IA.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Supabase */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="p-6 flex flex-col items-start gap-4">
            <div className="flex items-center gap-4 w-full">
              <div className="h-10 w-10 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center">
                <Database className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold leading-none tracking-tight">Supabase</h3>
                <p className="text-sm text-emerald-500 font-medium">Conectado</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Banco de dados principal e sistema de autenticação (Auth).
            </p>
          </div>
        </div>

        {/* OpenAI */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="p-6 flex flex-col items-start gap-4">
            <div className="flex items-center gap-4 w-full">
              <div className="h-10 w-10 bg-amber-100 text-amber-600 rounded-lg flex items-center justify-center">
                <Bot className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold leading-none tracking-tight">OpenAI</h3>
                <p className="text-sm text-amber-500 font-medium">Em configuração</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Provedor do modelo de linguagem utilizado pelos agentes.
            </p>
          </div>
        </div>

        {/* n8n */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="p-6 flex flex-col items-start gap-4">
            <div className="flex items-center gap-4 w-full">
              <div className="h-10 w-10 bg-muted text-muted-foreground rounded-lg flex items-center justify-center">
                <Webhook className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold leading-none tracking-tight">n8n</h3>
                <p className="text-sm text-muted-foreground font-medium">Não conectado</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Plataforma de automação para orquestrar fluxos e ferramentas.
            </p>
          </div>
        </div>

        {/* WhatsApp */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="p-6 flex flex-col items-start gap-4">
            <div className="flex items-center gap-4 w-full">
              <div className="h-10 w-10 bg-muted text-muted-foreground rounded-lg flex items-center justify-center">
                <MessageCircle className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold leading-none tracking-tight">WhatsApp API</h3>
                <p className="text-sm text-muted-foreground font-medium">Não conectado</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Canal principal de atendimento ao cliente final.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function IntegrationStatus() {
  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <div className="ml-4 space-y-1">
          <p className="text-sm font-medium leading-none">Supabase</p>
          <p className="text-sm text-muted-foreground">Banco e Auth conectados</p>
        </div>
        <div className="ml-auto font-medium text-sm text-emerald-500 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
          Conectado
        </div>
      </div>
      <div className="flex items-center opacity-70">
        <div className="ml-4 space-y-1">
          <p className="text-sm font-medium leading-none">IA (OpenAI)</p>
          <p className="text-sm text-muted-foreground">Modelo de linguagem</p>
        </div>
        <div className="ml-auto font-medium text-sm text-muted-foreground flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-muted-foreground"></span>
          Não configurado
        </div>
      </div>
      <div className="flex items-center opacity-70">
        <div className="ml-4 space-y-1">
          <p className="text-sm font-medium leading-none">n8n</p>
          <p className="text-sm text-muted-foreground">Webhooks e automações</p>
        </div>
        <div className="ml-auto font-medium text-sm text-muted-foreground flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-muted-foreground"></span>
          Não conectado
        </div>
      </div>
      <div className="flex items-center opacity-70">
        <div className="ml-4 space-y-1">
          <p className="text-sm font-medium leading-none">WhatsApp</p>
          <p className="text-sm text-muted-foreground">Canal de atendimento</p>
        </div>
        <div className="ml-auto font-medium text-sm text-muted-foreground flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-muted-foreground"></span>
          Não conectado
        </div>
      </div>
    </div>
  )
}

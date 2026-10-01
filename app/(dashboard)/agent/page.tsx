export default function AgentPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configuração do Agente</h1>
        <p className="text-muted-foreground">Ajuste o comportamento e as instruções do seu agente de IA.</p>
      </div>

      <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
        <div className="p-6 space-y-6">
          <form className="space-y-6">
            
            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none" htmlFor="name">
                Nome do agente
              </label>
              <input
                id="name"
                defaultValue="Assistente de Vendas"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none" htmlFor="description">
                Descrição interna
              </label>
              <input
                id="description"
                placeholder="Ex: Agente para atendimento inicial e triagem"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none" htmlFor="model">
                Modelo de IA
              </label>
              <select 
                id="model"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="gpt-4o-mini">GPT-4o mini (Recomendado)</option>
                <option value="gpt-4o">GPT-4o</option>
              </select>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none" htmlFor="prompt">
                Prompt principal (System Instruction)
              </label>
              <textarea
                id="prompt"
                rows={6}
                placeholder="Você é um assistente virtual prestativo..."
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              ></textarea>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none" htmlFor="initialMsg">
                Mensagem inicial
              </label>
              <textarea
                id="initialMsg"
                rows={3}
                placeholder="Olá! Como posso ajudar você hoje?"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              ></textarea>
            </div>

            <div className="flex items-center space-x-2 pt-4">
              <button
                type="button"
                className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
              >
                Salvar Configurações
              </button>
            </div>

          </form>
        </div>
      </div>
    </div>
  )
}

import { Send } from 'lucide-react'

export default function ConversationsPage() {
  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Lista de Conversas */}
      <div className="w-1/3 flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="font-semibold">Conversas</h2>
        </div>
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center text-sm text-muted-foreground">
          Nenhuma conversa no momento.
        </div>
      </div>

      {/* Área da Conversa */}
      <div className="flex-1 flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
        <div className="p-4 border-b flex justify-between items-center bg-muted/10">
          <div className="font-semibold text-muted-foreground">Selecione uma conversa</div>
          <div className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-md">Status: --</div>
        </div>
        
        <div className="flex-1 overflow-auto p-4 flex flex-col justify-center items-center text-muted-foreground bg-muted/5">
          <MessageSquareIcon className="h-12 w-12 mb-4 text-muted" />
          <p>Selecione uma conversa na lista para ver os detalhes</p>
        </div>

        <div className="p-4 border-t bg-card">
          <form className="flex gap-2">
            <input 
              type="text" 
              placeholder="Digite sua mensagem..." 
              className="flex-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled
            />
            <button 
              type="button" 
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
              disabled
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function MessageSquareIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

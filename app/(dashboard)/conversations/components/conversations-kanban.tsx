'use client'

import { Clock, MessageSquare, User } from 'lucide-react'

export function ConversationsKanban({ 
  workflows, 
  conversations, 
  onSelectConversation 
}: { 
  workflows: any[], 
  conversations: any[],
  onSelectConversation: (id: string) => void
}) {
  if (!workflows || workflows.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground bg-muted/10">
        <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
          <MessageSquare className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-medium text-foreground">Sem Workflow Configurado</h3>
        <p className="text-sm mt-1 max-w-sm">Para visualizar o quadro Kanban, você precisa configurar as etapas de atendimento nas configurações.</p>
      </div>
    )
  }

  const activeWorkflow = workflows[0]
  const stages = activeWorkflow.workflow_stages || []

  // Agrupar conversas pelas etapas. Conversas antigas sem stage vão para a primeira coluna por padrão.
  const groupedConversations = stages.reduce((acc: any, stage: any) => {
    acc[stage.id] = conversations.filter(c => 
      c.workflow_stage_id === stage.id || 
      (!c.workflow_stage_id && stage.position === 0)
    )
    return acc
  }, {})

  return (
    <div className="flex-1 h-full overflow-x-auto overflow-y-hidden bg-[#fafafa] dark:bg-background">
      <div className="flex h-full p-6 gap-6 min-w-max">
        {stages.map((stage: any) => {
          const stageConvs = groupedConversations[stage.id] || []
          
          return (
            <div key={stage.id} className="w-80 flex flex-col h-full bg-muted/30 rounded-xl border border-border/50">
              <div className="p-4 border-b border-border/50 flex items-center justify-between shrink-0 bg-background/50 rounded-t-xl">
                <h3 className="font-medium text-sm text-foreground">{stage.name}</h3>
                <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {stageConvs.length}
                </span>
              </div>
              
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {stageConvs.map((conv: any) => (
                  <div 
                    key={conv.id}
                    onClick={() => onSelectConversation(conv.id)}
                    className="bg-background p-4 rounded-lg border shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center">
                          <User className="h-3 w-3 text-secondary-foreground" />
                        </div>
                        <span className="font-medium text-sm truncate max-w-[120px]">
                          {conv.customers?.name || 'Visitante'}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground flex items-center">
                        <Clock className="h-3 w-3 mr-1" />
                        {new Date(conv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {conv.last_message_preview || 'Nenhuma mensagem ainda...'}
                    </p>
                    
                    <div className="mt-3 flex items-center justify-between pt-3 border-t border-border/50">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                        {conv.channel}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <div className={`h-2 w-2 rounded-full ${
                          conv.status === 'open' ? 'bg-blue-500' :
                          conv.status === 'human' ? 'bg-amber-500' : 'bg-gray-400'
                        }`} />
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {conv.status === 'open' ? 'Agente' : conv.status === 'human' ? 'Humano' : 'Encerrada'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

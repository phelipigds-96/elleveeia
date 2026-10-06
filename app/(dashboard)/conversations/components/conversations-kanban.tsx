'use client'

import { useState, useTransition } from 'react'
import { Clock, User, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { moveConversationStageAction } from '../../settings/workflows/actions'
import { useRouter } from 'next/navigation'

export function ConversationsKanban({ 
  workflows, 
  conversations, 
  onSelectConversation 
}: { 
  workflows: any[], 
  conversations: any[],
  onSelectConversation: (id: string) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // Local state for optimistic UI — initialized from props
  const [localConversations, setLocalConversations] = useState(conversations)

  if (!workflows || workflows.length === 0 || !workflows[0]?.workflow_stages || workflows[0].workflow_stages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full p-8 text-center bg-background">
        <div className="h-12 w-12 rounded-lg border bg-muted/30 flex items-center justify-center mb-5 shadow-sm">
          <Settings2 className="h-5 w-5 text-muted-foreground" />
        </div>
        <h3 className="text-base font-medium text-foreground tracking-tight">Quadro Kanban não configurado</h3>
        <p className="text-sm mt-1.5 text-muted-foreground max-w-sm mb-6 leading-relaxed">
          Para utilizar esta visualização, você precisa definir as etapas do seu funil de atendimento.
        </p>
        <Link 
          href="/settings/workflows" 
          className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Configurar Workflows
        </Link>
      </div>
    )
  }

  const activeWorkflow = workflows[0]
  const stages = activeWorkflow.workflow_stages || []

  const groupedConversations = stages.reduce((acc: any, stage: any) => {
    acc[stage.id] = localConversations.filter(c => 
      c.workflow_stage_id === stage.id || 
      (!c.workflow_stage_id && stage.position === 0)
    )
    return acc
  }, {})

  const handleDragStart = (e: React.DragEvent, conversationId: string) => {
    e.dataTransfer.setData('conversationId', conversationId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault()
    const conversationId = e.dataTransfer.getData('conversationId')
    if (!conversationId) return

    // ✅ Optimistic update: move card locally before server responds
    setLocalConversations(prev =>
      prev.map(c => c.id === conversationId ? { ...c, workflow_stage_id: stageId } : c)
    )

    startTransition(async () => {
      try {
        await moveConversationStageAction(conversationId, stageId)
        router.refresh()
      } catch (error) {
        console.error('Erro ao mover conversa', error)
        // Revert on failure by reloading
        router.refresh()
      }
    })
  }

  return (
    <div className={`flex-1 h-full overflow-x-auto overflow-y-hidden bg-[#fafafa] dark:bg-background ${isPending ? 'opacity-70 pointer-events-none' : ''}`}>
      <div className="flex h-full p-6 gap-6 min-w-max">
        {stages.map((stage: any) => {
          const stageConvs = groupedConversations[stage.id] || []
          
          return (
            <div 
              key={stage.id} 
              className="w-80 flex flex-col h-full bg-muted/30 rounded-xl border border-border/50"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, stage.id)}
            >
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
                    draggable
                    onDragStart={(e) => handleDragStart(e, conv.id)}
                    onClick={() => onSelectConversation(conv.id)}
                    className="bg-background p-4 rounded-lg border shadow-sm hover:shadow-md transition-shadow cursor-pointer group active:cursor-grabbing"
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

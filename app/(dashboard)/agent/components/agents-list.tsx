'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bot, MoreVertical, Play, Power, PowerOff, Settings, Trash2 } from 'lucide-react'
import { toggleAgentStatus, deleteAgent } from '@/lib/services/agents'

export function AgentsList({ initialAgents }: { initialAgents: any[] }) {
  const [agents, setAgents] = useState(initialAgents)
  const [isProcessing, setIsProcessing] = useState<string | null>(null)

  const handleToggleStatus = async (id: string, currentStatus: boolean) => {
    setIsProcessing(id)
    try {
      await toggleAgentStatus(id, currentStatus)
      setAgents(prev => prev.map(a => a.id === id ? { ...a, is_active: !currentStatus } : a))
    } catch (error: any) {
      alert(error.message)
    } finally {
      setIsProcessing(null)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Excluir este agente?\nA exclusão do agente "${name}" é permanente e apagará o histórico de execuções atrelado a ele. O histórico das conversas não será apagado, mas perderão a referência ao agente.`)) {
      return
    }
    
    setIsProcessing(id)
    try {
      await deleteAgent(id)
      setAgents(prev => prev.filter(a => a.id !== id))
    } catch (error: any) {
      alert(error.message)
      setIsProcessing(null)
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {agents.map(agent => (
        <div key={agent.id} className="relative flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="p-6 pb-4 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-md">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold leading-none tracking-tight">{agent.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">{agent.segment || 'Geral'}</p>
              </div>
            </div>
            
            <div className="group relative">
              <button disabled={isProcessing === agent.id} className="p-1 hover:bg-muted rounded-md text-muted-foreground transition-colors disabled:opacity-50">
                <MoreVertical className="h-4 w-4" />
              </button>
              
              <div className="absolute right-0 top-full mt-1 w-40 hidden group-hover:flex group-focus-within:flex flex-col border bg-popover rounded-md shadow-md z-10 p-1">
                <button
                  onClick={() => handleToggleStatus(agent.id, agent.is_active)}
                  className="flex items-center w-full px-2 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors"
                >
                  {agent.is_active ? <PowerOff className="h-3 w-3 mr-2" /> : <Power className="h-3 w-3 mr-2" />}
                  {agent.is_active ? 'Desativar' : 'Ativar'}
                </button>
                <Link
                  href={`/agent/${agent.id}`}
                  className="flex items-center w-full px-2 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors"
                >
                  <Settings className="h-3 w-3 mr-2" /> Editar
                </Link>
                <div className="my-1 border-t"></div>
                <button
                  onClick={() => handleDelete(agent.id, agent.name)}
                  className="flex items-center w-full px-2 py-1.5 text-xs rounded-sm hover:bg-destructive/10 text-destructive transition-colors"
                >
                  <Trash2 className="h-3 w-3 mr-2" /> Excluir
                </button>
              </div>
            </div>
          </div>

          <div className="px-6 py-2 flex flex-col gap-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Status:</span>
              {agent.is_active ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Ativo</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400 font-medium">Inativo</span>
              )}
            </div>
            <div>
              <span className="font-medium text-foreground">Criado em:</span> {new Date(agent.created_at).toLocaleDateString()}
            </div>
          </div>

          <div className="p-4 pt-4 border-t mt-auto">
            <Link
              href={`/agent/test?agentId=${agent.id}`}
              className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted h-9 px-4 py-2 border"
            >
              <Play className="h-4 w-4 mr-2" /> Testar Agente
            </Link>
          </div>
        </div>
      ))}
    </div>
  )
}

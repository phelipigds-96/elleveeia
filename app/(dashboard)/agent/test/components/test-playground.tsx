'use client'

import { useState } from 'react'
import { testAgentEngine } from '@/lib/services/agent/actions'
import { Loader2, Bot, MessageSquare, Activity } from 'lucide-react'

export function TestPlayground({ agents, conversations, defaultAgentId }: { agents: any[], conversations: any[], defaultAgentId?: string }) {
  const [selectedAgent, setSelectedAgent] = useState(defaultAgentId || agents[0]?.id || '')
  const [selectedConv, setSelectedConv] = useState(conversations[0]?.id || '')
  const [message, setMessage] = useState('')
  
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<any>(null)

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAgent || !selectedConv || !message) return

    setIsRunning(true)
    setResult(null)
    
    try {
      const res = await testAgentEngine(selectedAgent, selectedConv, message)
      setResult(res)
    } catch (err: any) {
      setResult({ success: false, error: err.message })
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
      <div className="p-6 border rounded-xl bg-card shadow-sm space-y-6">
        <div className="flex items-center gap-2 border-b pb-4">
          <Bot className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Simulador de Execução</h2>
        </div>

        <form onSubmit={handleTest} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">1. Selecione o Agente</label>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              required
              className="w-full rounded-md border p-2 text-sm focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="">Selecione...</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.model})</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">2. Selecione a Conversa (Contexto)</label>
            <select
              value={selectedConv}
              onChange={(e) => setSelectedConv(e.target.value)}
              required
              className="w-full rounded-md border p-2 text-sm focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="">Selecione...</option>
              {conversations.map(c => (
                <option key={c.id} value={c.id}>
                  {c.customers?.name || 'Cliente'} - {new Date(c.updated_at).toLocaleString()}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground">Isso define o histórico e as propriedades do cliente que o agente vai ler.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">3. Mensagem de Teste</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              placeholder="Digite o que o cliente diria..."
              className="w-full h-24 rounded-md border p-2 text-sm focus:ring-1 focus:ring-primary outline-none resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={isRunning || !selectedAgent || !selectedConv || !message}
            className="w-full h-10 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50 transition-colors hover:bg-primary/90"
          >
            {isRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isRunning ? 'Processando (OpenAI)...' : 'Executar Agent Engine'}
          </button>
        </form>
      </div>

      <div className="space-y-6">
        {result ? (
          <div className="p-6 border rounded-xl bg-card shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b pb-4">
              <MessageSquare className="h-5 w-5 text-emerald-500" />
              <h2 className="font-semibold">Resultado da Execução</h2>
            </div>
            
            {result.success ? (
              <div className="space-y-6">
                <div className="space-y-2">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Resposta do LLM:</span>
                  <div className="p-4 bg-muted/50 rounded-lg text-sm whitespace-pre-wrap leading-relaxed border">
                    {result.message}
                  </div>
                </div>

                {result.usage && (
                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1">
                      <Activity className="h-3 w-3" /> Métricas e Usage (Tokens)
                    </span>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="p-2 border rounded-md bg-background">
                        <span className="block text-muted-foreground mb-1">Prompt</span>
                        <span className="font-mono font-medium">{result.usage.prompt_tokens}</span>
                      </div>
                      <div className="p-2 border rounded-md bg-background">
                        <span className="block text-muted-foreground mb-1">Completion</span>
                        <span className="font-mono font-medium">{result.usage.completion_tokens}</span>
                      </div>
                      <div className="p-2 border rounded-md bg-background">
                        <span className="block text-muted-foreground mb-1">Total</span>
                        <span className="font-mono font-bold text-primary">{result.usage.total_tokens}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                <strong>Falha na Execução:</strong>
                <p className="mt-1">{result.error}</p>
                {result.details && <p className="mt-2 text-xs opacity-80">{result.details}</p>}
              </div>
            )}
          </div>
        ) : (
          <div className="p-12 border rounded-xl border-dashed flex flex-col items-center justify-center text-center text-muted-foreground opacity-60">
            <Bot className="h-12 w-12 mb-4" />
            <p className="text-sm">Preencha o formulário e clique em Executar para testar a comunicação com a OpenAI.</p>
          </div>
        )}
      </div>
    </div>
  )
}

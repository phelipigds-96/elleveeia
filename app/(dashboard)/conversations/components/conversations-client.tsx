'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { getConversations, getMessages, sendMessage, updateConversationStatus, markAsRead } from '@/lib/services/conversations'
import { Search, Send, User, Clock, MessageSquare, AlertCircle } from 'lucide-react'

import { ConversationsKanban } from './conversations-kanban'
import { moveConversationStageAction } from '../../settings/workflows/actions'
import { useRouter } from 'next/navigation'

export function ConversationsClient({ 
  initialConversations, 
  initialWorkflows, 
  companyId 
}: { 
  initialConversations: any[],
  initialWorkflows?: any[],
  companyId?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [conversations, setConversations] = useState(initialConversations)
  const [activeTab, setActiveTab] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list')
  
  const [messages, setMessages] = useState<any[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const [sending, setSending] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Re-fetch conversations when tab or search changes
    const fetchConversations = async () => {
      const data = await getConversations(activeTab, search)
      setConversations(data)
    }
    // Debounce search slightly
    const timer = setTimeout(() => {
      fetchConversations()
    }, 300)
    return () => clearTimeout(timer)
  }, [activeTab, search])

  useEffect(() => {
    if (selectedConvId) {
      setLoadingMessages(true)
      getMessages(selectedConvId).then((data) => {
        setMessages(data)
        setLoadingMessages(false)
        scrollToBottom()
        markAsRead(selectedConvId)
      })
    } else {
      setMessages([])
    }
  }, [selectedConvId])

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!messageInput.trim() || !selectedConvId) return
    
    setSending(true)
    const content = messageInput
    setMessageInput('') // Optimistic clear

    const newMessage = await sendMessage(selectedConvId, content)
    if (newMessage) {
      setMessages((prev) => [...prev, newMessage])
      scrollToBottom()
      // Optimistically update conversation list last_message_at
      setConversations(prev => prev.map(c => 
        c.id === selectedConvId ? { ...c, last_message_at: new Date().toISOString() } : c
      ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()))
    }
    setSending(false)
  }

  const handleChangeStatus = async (status: string) => {
    if (!selectedConvId) return
    const success = await updateConversationStatus(selectedConvId, status)
    if (success) {
      setConversations(prev => prev.map(c => 
        c.id === selectedConvId ? { ...c, status } : c
      ))
    }
  }

  const handleChangeStage = (stageId: string) => {
    if (!selectedConvId) return
    startTransition(async () => {
      try {
        await moveConversationStageAction(selectedConvId, stageId)
        setConversations(prev => prev.map(c => 
          c.id === selectedConvId ? { ...c, workflow_stage_id: stageId } : c
        ))
        router.refresh()
      } catch (error) {
        console.error(error)
      }
    })
  }

  const selectedConv = conversations.find(c => c.id === selectedConvId)
  const activeWorkflow = initialWorkflows?.[0]
  const stages = activeWorkflow?.workflow_stages || []

  return (
    <div className={`flex h-full w-full bg-background overflow-hidden border-t flex-col ${isPending ? 'opacity-70 pointer-events-none' : ''}`}>
      {/* HEADER BAR FOR VIEW TOGGLE */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/5 shrink-0">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Central de Atendimento</h2>
        <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
          <button 
            onClick={() => setViewMode('list')} 
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === 'list' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Lista
          </button>
          <button 
            onClick={() => setViewMode('kanban')} 
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === 'kanban' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Kanban
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
      {viewMode === 'kanban' ? (
        <ConversationsKanban 
          workflows={initialWorkflows || []} 
          conversations={conversations} 
          onSelectConversation={(id) => {
            setSelectedConvId(id)
            setViewMode('list')
          }} 
        />
      ) : (
        <>
          {/* LEFT COLUMN: LIST */}
          <div className="w-full md:w-80 lg:w-96 border-r flex flex-col bg-background h-full shrink-0">
            <div className="p-3 border-b border-border/40 space-y-3 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground/50" />
                <input
                  type="text"
                  placeholder="Buscar cliente..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex h-9 w-full rounded-md border-0 bg-muted/30 pl-9 py-2 text-sm shadow-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="flex gap-1 overflow-x-auto pb-0.5 text-xs font-medium scrollbar-hide">
                <button onClick={() => setActiveTab('all')} className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap ${activeTab === 'all' ? 'bg-secondary text-secondary-foreground shadow-sm' : 'hover:bg-muted/50 text-muted-foreground'}`}>
                  Todas
                </button>
                <button onClick={() => setActiveTab('open')} className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap ${activeTab === 'open' ? 'bg-secondary text-secondary-foreground shadow-sm' : 'hover:bg-muted/50 text-muted-foreground'}`}>
                  Abertas
                </button>
                <button onClick={() => setActiveTab('human')} className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap ${activeTab === 'human' ? 'bg-secondary text-secondary-foreground shadow-sm' : 'hover:bg-muted/50 text-muted-foreground'}`}>
                  Humanos
                </button>
                <button onClick={() => setActiveTab('closed')} className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap ${activeTab === 'closed' ? 'bg-secondary text-secondary-foreground shadow-sm' : 'hover:bg-muted/50 text-muted-foreground'}`}>
                  Encerradas
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50 p-8 text-center space-y-2">
                  <MessageSquare className="h-6 w-6" />
                  <p className="text-sm">Nenhuma conversa encontrada.</p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConvId(conv.id)}
                    className={`flex flex-col items-start px-3 py-2.5 w-full rounded-lg text-left transition-colors ${selectedConvId === conv.id ? 'bg-secondary/60' : 'hover:bg-muted/40'}`}
                  >
                    <div className="flex w-full justify-between items-center mb-0.5">
                      <span className="font-medium text-[13px] text-foreground truncate pr-2">
                        {conv.customers?.name || 'Cliente Desconhecido'}
                      </span>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {new Date(conv.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex w-full justify-between items-center">
                      <span className="text-[12px] text-muted-foreground truncate max-w-[200px]">
                        {conv.last_message_preview || (conv.customers?.phone || 'Sem número')}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {conv.status === 'open' && <span className="h-1.5 w-1.5 rounded-full bg-blue-500"></span>}
                        {conv.status === 'human' && <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>}
                        {conv.status === 'closed' && <span className="h-1.5 w-1.5 rounded-full bg-gray-400"></span>}
                        
                        {conv.unread_count > 0 && (
                          <span className="bg-primary text-primary-foreground text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                            {conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

      {/* CENTER AND RIGHT WRAPPER */}
      {selectedConv ? (
        <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden">
          
          {/* CENTER: CHAT AREA */}
          <div className="flex-1 flex flex-col h-full border-r relative">
            <div className="h-14 border-b flex items-center justify-between px-4 bg-background z-10 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
                  <User className="h-4 w-4 text-secondary-foreground" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold leading-none">{selectedConv.customers?.name}</h2>
                  <p className="text-xs text-muted-foreground mt-1 capitalize">{selectedConv.channel}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {stages.length > 0 && (
                  <select 
                    value={selectedConv.workflow_stage_id || stages[0].id}
                    onChange={(e) => handleChangeStage(e.target.value)}
                    className="text-xs rounded-md border border-input bg-transparent px-2 py-1 shadow-sm focus:outline-none"
                  >
                    {stages.map((stage: any) => (
                      <option key={stage.id} value={stage.id}>{stage.name}</option>
                    ))}
                  </select>
                )}
                <select 
                  value={selectedConv.status}
                  onChange={(e) => handleChangeStatus(e.target.value)}
                  className="text-xs rounded-md border border-input bg-transparent px-2 py-1 shadow-sm focus:outline-none"
                >
                  <option value="open">Agente (Aberto)</option>
                  <option value="human">Atendimento Humano</option>
                  <option value="closed">Encerrada</option>
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-background">
              {loadingMessages ? (
                <div className="flex justify-center p-4">
                  <span className="text-xs text-muted-foreground animate-pulse font-medium tracking-tight">Carregando histórico...</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2 opacity-50">
                  <MessageSquare className="h-6 w-6" />
                  <p className="text-sm">Nenhuma mensagem registrada ainda.</p>
                </div>
              ) : (
                messages.map((msg, i) => {
                  const isCustomer = msg.sender_type === 'customer'
                  const isAgent = msg.sender_type === 'agent'
                  const isSystem = msg.sender_type === 'system'
                  
                  if (isSystem) {
                    return (
                      <div key={msg.id} className="flex justify-center my-6">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                          — {msg.content} —
                        </span>
                      </div>
                    )
                  }

                  return (
                    <div key={msg.id} className={`flex flex-col ${isCustomer ? 'items-start' : 'items-end'} group`}>
                      <div className="flex items-center gap-2 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {isCustomer ? (selectedConv.customers?.name || 'Cliente') : (isAgent ? 'Agente IA' : 'Humano')}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div 
                        className={`max-w-[85%] sm:max-w-[75%] px-4 py-2.5 text-[14px] shadow-sm ${
                          isCustomer 
                            ? 'bg-muted/30 border border-border/50 text-foreground rounded-2xl rounded-tl-sm' 
                            : 'bg-primary text-primary-foreground rounded-2xl rounded-tr-sm'
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-background border-t shrink-0">
              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={selectedConv.status === 'closed' ? 'Conversa encerrada' : 'Digite uma mensagem...'}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  disabled={selectedConv.status === 'closed' || sending}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!messageInput.trim() || selectedConv.status === 'closed' || sending}
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 w-10 shrink-0 shadow-sm"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>

          {/* RIGHT: CUSTOMER PANEL (Hidden on very small screens, visible on md+) */}
          <div className="hidden md:flex flex-col w-64 lg:w-80 bg-background h-full shrink-0">
            <div className="p-6 border-b flex flex-col items-center justify-center space-y-3">
              <div className="h-16 w-16 rounded-full bg-secondary flex items-center justify-center shadow-sm">
                <User className="h-8 w-8 text-secondary-foreground" />
              </div>
              <div className="text-center">
                <h3 className="font-semibold text-lg">{selectedConv.customers?.name}</h3>
                <p className="text-sm text-muted-foreground">{selectedConv.customers?.phone}</p>
              </div>
            </div>
            
            <div className="p-6 space-y-6 flex-1 overflow-y-auto">
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Sobre o Cliente</h4>
                <div className="text-sm space-y-1">
                  {selectedConv.customers?.email && (
                    <p className="text-muted-foreground"><span className="font-medium text-foreground">Email:</span> {selectedConv.customers.email}</p>
                  )}
                  <p className="text-muted-foreground"><span className="font-medium text-foreground">Canal:</span> <span className="capitalize">{selectedConv.channel}</span></p>
                  <p className="text-muted-foreground"><span className="font-medium text-foreground">Cadastrado em:</span> {new Date(selectedConv.customers?.created_at).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Status Atual</h4>
                <div className="text-sm space-y-1">
                  <p className="text-muted-foreground"><span className="font-medium text-foreground">Responsável:</span> {
                    selectedConv.status === 'open' ? 'Agente IA' : 
                    selectedConv.status === 'human' ? 'Atendimento Humano' : 
                    'Nenhum (Encerrada)'
                  }</p>
                  <p className="text-muted-foreground"><span className="font-medium text-foreground">Etapa do Funil:</span> {
                    stages.find((s: any) => s.id === selectedConv.workflow_stage_id)?.name || 'Sem Etapa'
                  }</p>
                  <p className="text-muted-foreground"><span className="font-medium text-foreground">Iniciada:</span> {new Date(selectedConv.started_at).toLocaleString()}</p>
                </div>
              </div>

              <div className="rounded-lg bg-muted/50 p-4 border border-dashed text-center">
                <p className="text-xs text-muted-foreground">Futuramente: Pedidos, produtos, histórico de navegação e tags do cliente aparecerão aqui.</p>
              </div>
            </div>
          </div>

        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-muted/10 h-full text-muted-foreground p-8 text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <MessageSquare className="h-8 w-8 opacity-40" />
          </div>
          <div>
            <h3 className="font-medium text-lg text-foreground">Central de Conversas</h3>
            <p className="text-sm mt-1 max-w-sm">Selecione uma conversa na barra lateral para ver o histórico e enviar mensagens.</p>
          </div>
        </div>
      )}
      </>
      )}
      </div>
    </div>
  )
}

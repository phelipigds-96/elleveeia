'use client'

import { useState, useEffect, useRef } from 'react'
import { getConversations, getMessages, sendMessage, updateConversationStatus, markAsRead } from '@/lib/services/conversations'
import { Search, Send, User, Clock, MessageSquare, AlertCircle } from 'lucide-react'

import { ConversationsKanban } from './conversations-kanban'

export function ConversationsClient({ 
  initialConversations, 
  initialWorkflows, 
  companyId 
}: { 
  initialConversations: any[],
  initialWorkflows?: any[],
  companyId?: string
}) {
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

  const selectedConv = conversations.find(c => c.id === selectedConvId)

  return (
    <div className="flex h-full w-full bg-background overflow-hidden border-t flex-col">
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
          <div className="w-full md:w-80 lg:w-96 border-r flex flex-col bg-muted/10 h-full shrink-0">
            <div className="p-4 border-b space-y-4 shrink-0">
              <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar cliente ou número..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background pl-9 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 text-sm scrollbar-hide">
            <button onClick={() => setActiveTab('all')} className={`px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${activeTab === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}>
              Todas
            </button>
            <button onClick={() => setActiveTab('open')} className={`px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${activeTab === 'open' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}>
              Abertas
            </button>
            <button onClick={() => setActiveTab('human')} className={`px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${activeTab === 'human' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}>
              Humanos
            </button>
            <button onClick={() => setActiveTab('closed')} className={`px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${activeTab === 'closed' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}>
              Encerradas
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center space-y-3">
              <MessageSquare className="h-8 w-8 opacity-20" />
              <p className="text-sm">Nenhuma conversa encontrada neste filtro.</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConvId(conv.id)}
                  className={`flex flex-col items-start p-4 border-b text-left transition-colors hover:bg-muted/50 ${selectedConvId === conv.id ? 'bg-muted' : ''}`}
                >
                  <div className="flex w-full justify-between items-center mb-1">
                    <span className="font-semibold text-sm truncate pr-2">
                      {conv.customers?.name || 'Cliente Desconhecido'}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(conv.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex w-full justify-between items-center mt-1">
                    <span className="text-xs text-muted-foreground truncate pr-2">
                      {conv.customers?.phone || 'Sem número'}
                    </span>
                    <div className="flex items-center gap-2">
                      {conv.status === 'open' && <span className="h-2 w-2 rounded-full bg-blue-500" title="Aberta"></span>}
                      {conv.status === 'human' && <span className="h-2 w-2 rounded-full bg-amber-500" title="Humano"></span>}
                      {conv.status === 'closed' && <span className="h-2 w-2 rounded-full bg-gray-400" title="Encerrada"></span>}
                      
                      {conv.unread_count > 0 && (
                        <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
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

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-900/20">
              {loadingMessages ? (
                <div className="flex justify-center p-4">
                  <span className="text-xs text-muted-foreground animate-pulse">Carregando histórico...</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2 opacity-50">
                  <AlertCircle className="h-8 w-8" />
                  <p className="text-sm">Nenhuma mensagem registrada ainda.</p>
                </div>
              ) : (
                messages.map((msg, i) => {
                  const isCustomer = msg.sender_type === 'customer'
                  const isAgent = msg.sender_type === 'agent'
                  const isSystem = msg.sender_type === 'system'
                  
                  if (isSystem) {
                    return (
                      <div key={msg.id} className="flex justify-center my-4">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted px-2 py-1 rounded-md font-medium">
                          {msg.content}
                        </span>
                      </div>
                    )
                  }

                  return (
                    <div key={msg.id} className={`flex flex-col ${isCustomer ? 'items-start' : 'items-end'}`}>
                      <div 
                        className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm shadow-sm ${
                          isCustomer 
                            ? 'bg-card border text-card-foreground rounded-tl-sm' 
                            : isAgent
                              ? 'bg-primary/10 border border-primary/20 text-foreground rounded-tr-sm'
                              : 'bg-primary text-primary-foreground rounded-tr-sm' // human
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground mt-1 mx-1">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {!isCustomer && msg.sender_type === 'human' && ' • Humano'}
                        {!isCustomer && msg.sender_type === 'agent' && ' • Agente IA'}
                      </span>
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
                  <p className="text-muted-foreground"><span className="font-medium text-foreground">Fase:</span> {
                    selectedConv.status === 'open' ? 'Agente IA' : 
                    selectedConv.status === 'human' ? 'Atendimento Humano' : 
                    'Encerrada'
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

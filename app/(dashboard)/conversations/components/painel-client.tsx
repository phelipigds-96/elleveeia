"use client"

import React, { useState, useRef, useEffect, useMemo } from "react"
import { 
  Search, 
  Sparkles, 
  Bot, 
  User, 
  Clock, 
  Check, 
  CheckCheck, 
  MessageSquare, 
  Radio, 
  Phone, 
  AlertCircle,
  Wifi,
  UserCheck
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { 
  ConversationData, 
  MessageData, 
  getConversationMessages 
} from "../actions"

interface PainelClientProps {
  initialConversations: ConversationData[]
  initialMessages: MessageData[]
  initialSelectedId?: string | null
}

function timeAgo(isoString: string): string {
  if (!isoString) return ""
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "agora"
  if (mins < 60) return `há ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `há ${days}d`
  return new Date(isoString).toLocaleDateString([], { day: "2-digit", month: "2-digit" })
}

function formatTime(isoString: string): string {
  if (!isoString) return ""
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export default function PainelClient({
  initialConversations,
  initialMessages,
  initialSelectedId = null,
}: PainelClientProps) {
  // 1. Estados locais de conversas e mensagens
  const [conversations, setConversations] = useState<ConversationData[]>(initialConversations)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [messages, setMessages] = useState<MessageData[]>(initialMessages)
  
  // 2. Estados de navegação, busca e filtros
  const [activeTab, setActiveTab] = useState<"all" | "open" | "human" | "closed">("all")
  const [search, setSearch] = useState("")
  const [loadingMessages, setLoadingMessages] = useState(false)
  
  // 3. Efeito visual para quando uma conversa receber atualização em tempo real
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null)
  const [isRealtimeActive, setIsRealtimeActive] = useState(false)

  // Referências para scroll automático
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId]
  )

  // Cliente público do navegador para subscrição WebSocket (sem chave service_role)
  const supabase = useMemo(() => createClient(), [])

  const scrollToBottom = (smooth = true) => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" })
    }, 50)
  }

  // Efeito inicial para rolar até o final da conversa
  useEffect(() => {
    scrollToBottom(false)
  }, [])

  // =========================================================================
  // SUB-SCRIÇÃO REALTIME: Mensagens da Conversa Ativa
  // =========================================================================
  useEffect(() => {
    if (!selectedId) return

    const messagesChannel = supabase
      .channel(`realtime:messages:${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const newMsg = payload.new as MessageData
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev
            return [...prev, newMsg]
          })

          // Atualiza também o preview na barra lateral
          setConversations((prev) =>
            prev.map((c) =>
              c.id === selectedId
                ? {
                    ...c,
                    last_message_at: newMsg.created_at || new Date().toISOString(),
                    last_message_preview: newMsg.content || c.last_message_preview,
                  }
                : c
            ).sort(
              (a, b) =>
                new Date(b.last_message_at || 0).getTime() -
                new Date(a.last_message_at || 0).getTime()
            )
          )

          scrollToBottom(true)
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const updatedMsg = payload.new as MessageData
          setMessages((prev) =>
            prev.map((m) => (m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m))
          )
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setIsRealtimeActive(true)
        }
      })

    return () => {
      supabase.removeChannel(messagesChannel)
    }
  }, [selectedId, supabase])

  // =========================================================================
  // SUB-SCRIÇÃO REALTIME: Lista de Conversas (Atualizações de status / nova msg)
  // =========================================================================
  useEffect(() => {
    const convChannel = supabase
      .channel("realtime:conversations-list")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
        },
        (payload) => {
          const updated = payload.new as Partial<ConversationData> & { id: string }
          
          // Dispara efeito visual de piscar na barra lateral
          setRecentlyUpdatedId(updated.id)
          setTimeout(() => setRecentlyUpdatedId(null), 3000)

          setConversations((prev) => {
            const exists = prev.some((c) => c.id === updated.id)
            if (!exists) return prev

            return prev
              .map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
              .sort(
                (a, b) =>
                  new Date(b.last_message_at || 0).getTime() -
                  new Date(a.last_message_at || 0).getTime()
              )
          })
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversations",
        },
        (payload) => {
          const newConv = payload.new as ConversationData

          setRecentlyUpdatedId(newConv.id)
          setTimeout(() => setRecentlyUpdatedId(null), 3000)

          setConversations((prev) => {
            if (prev.some((c) => c.id === newConv.id)) return prev
            return [newConv, ...prev].sort(
              (a, b) =>
                new Date(b.last_message_at || 0).getTime() -
                new Date(a.last_message_at || 0).getTime()
            )
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(convChannel)
    }
  }, [supabase])

  // =========================================================================
  // SELEÇÃO DE CONVERSA
  // =========================================================================
  const handleSelectConversation = async (convId: string) => {
    if (convId === selectedId) return
    setSelectedId(convId)
    setLoadingMessages(true)

    try {
      const history = await getConversationMessages(convId)
      setMessages(history)
      scrollToBottom(false)
    } catch (err) {
      console.error("[Chat] Erro ao carregar histórico da conversa:", err)
    } finally {
      setLoadingMessages(false)
    }
  }

  // =========================================================================
  // FILTRAGEM DA BARRA LATERAL
  // =========================================================================
  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      // Filtro por tab
      if (activeTab === "open" && c.status !== "open") return false
      if (activeTab === "human" && c.status !== "human") return false
      if (activeTab === "closed" && c.status !== "closed") return false

      // Filtro por texto de busca
      if (!search.trim()) return true
      const term = search.toLowerCase()
      const customerName = c.customers?.name?.toLowerCase() || ""
      const phone = c.customers?.phone?.toLowerCase() || ""
      const preview = c.last_message_preview?.toLowerCase() || ""

      return customerName.includes(term) || phone.includes(term) || preview.includes(term)
    })
  }, [conversations, activeTab, search])

  // =========================================================================
  // RENDERIZAÇÃO DE STATUS DE ENTREGA (DELIVERY_STATUS)
  // =========================================================================
  const renderDeliveryStatus = (msg: MessageData) => {
    if (msg.sender_type === "customer") return null

    const status =
      msg.metadata?.delivery_status ||
      (msg as any).delivery_status ||
      "sent"

    switch (status) {
      case "pending":
        return (
          <span className="inline-flex items-center gap-0.5 text-white/70" title="Pendente de envio">
            <Clock className="h-3 w-3" />
          </span>
        )
      case "delivered":
        return (
          <span className="inline-flex items-center gap-0.5 text-white/80" title="Entregue ao cliente">
            <CheckCheck className="h-3 w-3" />
          </span>
        )
      case "read":
        return (
          <span className="inline-flex items-center gap-0.5 text-sky-200" title="Lida pelo cliente">
            <CheckCheck className="h-3 w-3 stroke-[2.5]" />
          </span>
        )
      case "sent":
      default:
        return (
          <span className="inline-flex items-center gap-0.5 text-white/80" title="Transmitida">
            <Check className="h-3 w-3" />
          </span>
        )
    }
  }

  return (
    <div className="h-full w-full flex border border-border/80 rounded-xl overflow-hidden bg-card shadow-sm text-foreground">
      {/* =====================================================================
          SIDEBAR: LISTA DE CONVERSAS (30% / 340px)
      ====================================================================== */}
      <aside className="w-full sm:w-80 md:w-88 lg:w-96 border-r border-border h-full flex flex-col bg-background shrink-0">
        {/* Header da Sidebar */}
        <div className="p-3.5 border-b border-border space-y-3 bg-card/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm tracking-tight font-display">Conversas</h2>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Realtime</span>
            </div>
          </div>

          {/* Campo de Busca */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, telefone ou texto..."
              className="w-full pl-9 pr-3 py-1.5 border border-border rounded-lg text-xs bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary focus:bg-background transition-colors"
            />
          </div>

          {/* Tabs de Filtro */}
          <div className="flex gap-1 text-[11px] font-medium overflow-x-auto scrollbar-none pb-0.5">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                activeTab === "all"
                  ? "bg-secondary text-secondary-foreground font-semibold shadow-2xs"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              Todas ({conversations.length})
            </button>
            <button
              onClick={() => setActiveTab("open")}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                activeTab === "open"
                  ? "bg-secondary text-secondary-foreground font-semibold shadow-2xs"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              Abertas
            </button>
            <button
              onClick={() => setActiveTab("human")}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                activeTab === "human"
                  ? "bg-secondary text-secondary-foreground font-semibold shadow-2xs"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              Humano
            </button>
            <button
              onClick={() => setActiveTab("closed")}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                activeTab === "closed"
                  ? "bg-secondary text-secondary-foreground font-semibold shadow-2xs"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              Resolvidos
            </button>
          </div>
        </div>

        {/* Lista de Itens */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground p-6 text-center space-y-2">
              <MessageSquare className="h-6 w-6 stroke-1 text-muted-foreground/60" />
              <p className="text-xs">Nenhuma conversa encontrada para os filtros aplicados.</p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = selectedId === conv.id
              const isPulsing = recentlyUpdatedId === conv.id
              const customerName = conv.customers?.name || "Cliente Desconhecido"
              const initials = customerName
                .split(" ")
                .filter(Boolean)
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase() || "CL"

              return (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className={`w-full text-left flex items-start gap-3 p-3 rounded-xl transition-all relative ${
                    isSelected
                      ? "bg-secondary/70 border border-border/80 shadow-xs"
                      : "hover:bg-muted/40 border border-transparent"
                  } ${isPulsing ? "ring-2 ring-emerald-500/60 bg-emerald-50/30 dark:bg-emerald-950/20 animate-pulse" : ""}`}
                >
                  {/* Avatar com Iniciais */}
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold font-display shrink-0 ${
                      conv.status === "human"
                        ? "bg-amber-100 text-amber-800 border border-amber-200"
                        : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                    }`}
                  >
                    {initials}
                  </div>

                  {/* Informações da Conversa */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-xs text-foreground truncate pr-2">
                        {customerName}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                        {timeAgo(conv.last_message_at)}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground truncate leading-relaxed">
                      {conv.last_message_preview || "Sem mensagens registradas"}
                    </p>

                    <div className="flex items-center justify-between mt-2 pt-1 border-t border-border/40 text-[10px]">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            conv.status === "open"
                              ? "bg-emerald-500"
                              : conv.status === "human"
                              ? "bg-amber-500"
                              : "bg-stone-400"
                          }`}
                        />
                        <span className="text-muted-foreground capitalize font-medium">
                          {conv.status === "open"
                            ? "IA Atendendo"
                            : conv.status === "human"
                            ? "Aguardando Humano"
                            : "Resolvido"}
                        </span>
                      </div>

                      {conv.unread_count > 0 && (
                        <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.2 rounded-full font-mono">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </aside>

      {/* =====================================================================
          MAIN: ÁREA DE CHAT OMNICHANNEL (70%)
      ====================================================================== */}
      <main className="flex-1 flex flex-col h-full bg-background overflow-hidden">
        {activeConversation ? (
          <>
            {/* Header do Chat */}
            <header className="h-16 border-b border-border px-6 flex items-center justify-between bg-card/50 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                  <User className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-sm text-foreground truncate">
                      {activeConversation.customers?.name || "Cliente Desconhecido"}
                    </h2>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border uppercase">
                      {activeConversation.channel || "WhatsApp"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {activeConversation.customers?.phone && (
                      <span className="flex items-center gap-1 font-mono">
                        <Phone className="h-3 w-3" />
                        {activeConversation.customers.phone}
                      </span>
                    )}
                    <span>•</span>
                    <span className="capitalize">
                      Status: {activeConversation.status === "open" ? "IA Ativa" : activeConversation.status === "human" ? "Humano" : "Encerrado"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status do WebSocket Realtime */}
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-secondary text-secondary-foreground border border-border font-mono">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Subscrição Ativa</span>
                </div>
              </div>
            </header>

            {/* Histórico de Mensagens com Renderização Estilizada dos Balões */}
            <section className="flex-1 overflow-y-auto p-4 sm:p-6 bg-muted/15 space-y-4">
              <div className="max-w-3xl mx-auto space-y-4">
                {loadingMessages ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground space-y-2">
                    <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs font-medium">Sincronizando histórico do banco...</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground space-y-3">
                    <MessageSquare className="h-8 w-8 stroke-1 text-muted-foreground/60" />
                    <p className="text-xs font-medium">Nenhuma mensagem registrada nesta conversa.</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isCustomer = msg.sender_type === "customer"
                    const isSystemOrIa =
                      msg.sender_type === "system" ||
                      msg.sender_type === "ia" ||
                      msg.sender_type === "bot"
                    const isAgent = msg.sender_type === "agent" || msg.sender_type === "human"

                    // Balão do Cliente (Esquerda)
                    if (isCustomer) {
                      return (
                        <div key={msg.id} className="flex justify-start items-end gap-2 group">
                          <div className="h-7 w-7 rounded-full bg-muted border border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0 mb-1">
                            {activeConversation.customers?.name?.slice(0, 1).toUpperCase() || "C"}
                          </div>
                          <div className="max-w-[85%] sm:max-w-[75%] bg-card text-card-foreground border border-border/80 shadow-xs rounded-2xl rounded-bl-xs p-3.5 space-y-1">
                            <p className="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed break-words">
                              {msg.content || <span className="italic text-muted-foreground text-xs">[Mensagem de mídia/áudio]</span>}
                            </p>
                            <div className="text-[10px] text-muted-foreground font-mono text-right pt-0.5">
                              {formatTime(msg.created_at)}
                            </div>
                          </div>
                        </div>
                      )
                    }

                    // Balão do Sistema / IA (Direita - Fundo Azul com Ícone Robô)
                    if (isSystemOrIa) {
                      return (
                        <div key={msg.id} className="flex justify-end items-end gap-2 group">
                          <div className="max-w-[85%] sm:max-w-[75%] bg-blue-600 text-white shadow-xs rounded-2xl rounded-br-xs p-3.5 space-y-1.5">
                            {/* Identificação do Bot */}
                            <div className="flex items-center gap-1.5 text-blue-100 text-[10px] font-semibold tracking-wider uppercase border-b border-white/15 pb-1">
                              <Bot className="h-3.5 w-3.5 text-blue-200" />
                              <span>Agente IA (Ellevée Engine)</span>
                            </div>

                            <p className="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed break-words text-white">
                              {msg.content}
                            </p>

                            <div className="flex items-center justify-end gap-1.5 text-[10px] text-blue-100/90 font-mono pt-1">
                              <span>{formatTime(msg.created_at)}</span>
                              {renderDeliveryStatus(msg)}
                            </div>
                          </div>
                          <div className="h-7 w-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs shrink-0 mb-1 shadow-xs">
                            <Bot className="h-4 w-4" />
                          </div>
                        </div>
                      )
                    }

                    // Balão do Atendente Humano (Direita - Cor Primária / Emerald)
                    return (
                      <div key={msg.id} className="flex justify-end items-end gap-2 group">
                        <div className="max-w-[85%] sm:max-w-[75%] bg-emerald-600 text-white shadow-xs rounded-2xl rounded-br-xs p-3.5 space-y-1.5">
                          {/* Identificação do Atendente */}
                          <div className="flex items-center gap-1.5 text-emerald-100 text-[10px] font-semibold tracking-wider uppercase border-b border-white/15 pb-1">
                            <UserCheck className="h-3.5 w-3.5 text-emerald-200" />
                            <span>Atendente Humano</span>
                          </div>

                          <p className="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed break-words text-white">
                            {msg.content}
                          </p>

                          <div className="flex items-center justify-end gap-1.5 text-[10px] text-emerald-100/90 font-mono pt-1">
                            <span>{formatTime(msg.created_at)}</span>
                            {renderDeliveryStatus(msg)}
                          </div>
                        </div>
                        <div className="h-7 w-7 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs shrink-0 mb-1 shadow-xs">
                          <User className="h-4 w-4" />
                        </div>
                      </div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </section>

            {/* Rodapé / Input: Conforme Diretriz da Fase 3.1, envio de mensagem desabilitado nesta etapa */}
            <footer className="h-20 border-t border-border px-6 py-3 flex items-center bg-card shrink-0">
              <div className="flex items-center gap-3 w-full max-w-3xl mx-auto">
                <div className="flex-1 bg-muted/40 border border-border/80 rounded-lg p-2.5 text-xs text-muted-foreground flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-emerald-500 animate-pulse shrink-0" />
                    <span>Conexão WebSocket ativa. Novas mensagens do WhatsApp/Webhook aparecerão automaticamente.</span>
                  </div>
                  <span className="text-[10px] font-mono bg-muted px-2 py-0.5 rounded border border-border text-foreground/80 shrink-0 hidden sm:inline">
                    Fase 3.1 (Read-Only)
                  </span>
                </div>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground space-y-3">
            <MessageSquare className="h-10 w-10 stroke-1 text-muted-foreground/50" />
            <h3 className="font-semibold text-sm text-foreground">Nenhuma conversa selecionada</h3>
            <p className="text-xs max-w-xs">
              Selecione uma conversa na barra lateral para visualizar o histórico de mensagens e monitorar eventos em tempo real.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

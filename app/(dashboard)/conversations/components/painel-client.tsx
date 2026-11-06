"use client"

import React, { useState, useRef, useEffect, useMemo } from "react"
import { 
  Search, 
  Bot, 
  User, 
  Clock, 
  Check, 
  CheckCheck, 
  MessageSquare, 
  Phone, 
  UserCheck,
  Send,
  Loader2,
  Building2,
  RotateCcw,
  CheckCircle2,
  Sparkles,
  AlertCircle
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "@/components/ui/toast"
import { 
  ConversationData, 
  MessageData, 
  UserProfileContext,
  getConversationMessages,
  sendMessageAction,
  takeoverConversationAction,
  returnToAIAction,
  closeConversationAction,
  reopenConversationAction
} from "../actions"

interface PainelClientProps {
  initialConversations: ConversationData[]
  initialMessages: MessageData[]
  initialSelectedId?: string | null
  currentUser?: UserProfileContext | null
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

function formatWaitTime(isoString: string): string {
  if (!isoString) return "instantes"
  const diff = Math.max(0, Date.now() - new Date(isoString).getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "instantes"
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function formatTime(isoString: string): string {
  if (!isoString) return ""
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export default function PainelClient({
  initialConversations,
  initialMessages,
  initialSelectedId = null,
  currentUser = null,
}: PainelClientProps) {
  // 1. Estados locais de conversas e mensagens
  const [conversations, setConversations] = useState<ConversationData[]>(initialConversations)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [messages, setMessages] = useState<MessageData[]>(initialMessages)
  
  // 2. Estados de navegação e filtros (Nova Taxonomia corporativa)
  const isMasterOrAdmin = currentUser?.role === "master" || currentUser?.role === "admin"
  const [activeTab, setActiveTab] = useState<"all" | "waiting" | "in_progress" | "ai" | "closed">(
    isMasterOrAdmin ? "all" : "waiting"
  )
  const [search, setSearch] = useState("")
  const [loadingMessages, setLoadingMessages] = useState(false)
  
  // 3. Estados de envio de mensagem e Ações de Ciclo de Vida (Fase 1)
  const [inputContent, setInputContent] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [isTakingOver, setIsTakingOver] = useState(false)
  const [isReturningToAI, setIsReturningToAI] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [isReopening, setIsReopening] = useState(false)

  // 4. Efeito visual para quando uma conversa receber atualização em tempo real
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null)
  const [isRealtimeActive, setIsRealtimeActive] = useState(false)

  // Referências para scroll automático e foco no textarea
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

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
            const filtered = prev.filter(
              (m) => !(m.id.startsWith("temp-") && m.content === newMsg.content)
            )
            if (filtered.some((m) => m.id === newMsg.id)) return filtered
            return [...filtered, newMsg]
          })

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
  // TROCA DE CONVERSA
  // =========================================================================
  const handleSelectConversation = async (convId: string) => {
    if (convId === selectedId) return

    setSelectedId(convId)
    setLoadingMessages(true)

    try {
      const msgs = await getConversationMessages(convId)
      setMessages(msgs)
      scrollToBottom(false)
    } catch (err: any) {
      console.error("[Chat] Falha ao carregar mensagens:", err)
      toast.error("Erro ao carregar mensagens", "Não foi possível sincronizar o histórico.")
    } finally {
      setLoadingMessages(false)
    }
  }

  // =========================================================================
  // ENVIO DE MENSAGEM PELO OPERADOR (Outbox Idempotente)
  // =========================================================================
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = inputContent.trim()
    if (!trimmed || !selectedId || isSending) return

    if (activeConversation?.status === "closed") {
      toast.error("Conversa Encerrada", "Reabra o atendimento antes de enviar novas mensagens.")
      return
    }

    const clientMessageId = crypto.randomUUID()
    const tempId = `temp-${clientMessageId}`

    // Mensagem otimista na tela
    const optimisticMsg: MessageData = {
      id: tempId,
      conversation_id: selectedId,
      sender_type: "agent",
      sender_id: currentUser?.userId || null,
      content: trimmed,
      message_type: "text",
      metadata: {
        delivery_status: "pending",
        client_message_id: clientMessageId,
      },
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, optimisticMsg])
    setInputContent("")
    setIsSending(true)
    scrollToBottom(true)

    try {
      const result = await sendMessageAction(selectedId, trimmed, clientMessageId)

      if (result.success) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: result.messageId || m.id,
                  metadata: { ...m.metadata, delivery_status: "sent" },
                }
              : m
          )
        )
      } else {
        toast.error("Falha no Envio", result.error || "Não foi possível registrar a mensagem na fila.")
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? { ...m, metadata: { ...m.metadata, delivery_status: "failed" } }
              : m
          )
        )
      }
    } catch (err: any) {
      console.error("[Chat] Exceção ao enviar mensagem:", err)
      toast.error("Erro inesperado", err.message || "Falha na comunicação com o servidor.")
    } finally {
      setIsSending(false)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // =========================================================================
  // CICLO DE VIDA: 1. ASSUMIR ATENDIMENTO (TRANSBORDO HUMANO)
  // =========================================================================
  const handleTakeover = async () => {
    if (!selectedId || isTakingOver) return

    setIsTakingOver(true)
    try {
      const result = await takeoverConversationAction(selectedId)

      if (result.success) {
        toast.success(
          "Atendimento Assumido!",
          "A IA foi pausada e a conversa agora está atribuída a você."
        )

        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId
              ? { ...c, status: "human", assigned_to: currentUser?.userId || null }
              : c
          )
        )

        const takeoverEventMsg: MessageData = {
          id: `temp-takeover-${Date.now()}`,
          conversation_id: selectedId,
          sender_type: "system",
          content: `Atendimento assumido por ${currentUser?.userName || "operador"}. A IA foi pausada nesta conversa.`,
          message_type: "event",
          metadata: { event: "conversation.takeover" },
          created_at: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, takeoverEventMsg])
        scrollToBottom(true)
      } else {
        toast.error("Erro ao assumir conversa", result.error || "Falha na transferência.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err.message || "Falha ao assumir atendimento.")
    } finally {
      setIsTakingOver(false)
    }
  }

  // =========================================================================
  // CICLO DE VIDA: 2. DEVOLVER PARA O AGENTE IA (COM NOME DINÂMICO)
  // =========================================================================
  const handleReturnToAI = async () => {
    if (!selectedId || isReturningToAI) return

    setIsReturningToAI(true)
    const currentAgentName = activeConversation?.agent_name || "IA"

    try {
      const result = await returnToAIAction(selectedId)

      if (result.success) {
        const resolvedName = result.agentName || currentAgentName
        toast.success(
          "Devolvido para a IA!",
          `O atendimento foi transferido e o agente ${resolvedName} está ativo novamente.`
        )

        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId
              ? { ...c, status: "open", assigned_to: null, agent_name: resolvedName }
              : c
          )
        )

        const resumeEventMsg: MessageData = {
          id: `temp-resume-${Date.now()}`,
          conversation_id: selectedId,
          sender_type: "system",
          content: `Atendimento devolvido para ${resolvedName}. O agente autônomo está ativo novamente.`,
          message_type: "event",
          metadata: { event: "conversation.ai_resume", agent_name: resolvedName },
          created_at: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, resumeEventMsg])
        scrollToBottom(true)
      } else {
        toast.error("Erro ao devolver para IA", result.error || "Falha na operação.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err.message || "Falha ao devolver para IA.")
    } finally {
      setIsReturningToAI(false)
    }
  }

  // =========================================================================
  // CICLO DE VIDA: 3. ENCERRAR ATENDIMENTO (FINALIZAR TICKET)
  // =========================================================================
  const handleCloseConversation = async () => {
    if (!selectedId || isClosing) return

    setIsClosing(true)
    try {
      const result = await closeConversationAction(selectedId)

      if (result.success) {
        toast.success(
          "Atendimento Encerrado",
          "A conversa foi finalizada com sucesso e movida para Finalizados."
        )

        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId
              ? { ...c, status: "closed", closed_at: new Date().toISOString() }
              : c
          )
        )

        const closeEventMsg: MessageData = {
          id: `temp-close-${Date.now()}`,
          conversation_id: selectedId,
          sender_type: "system",
          content: `Atendimento encerrado por ${currentUser?.userName || "operador"}.`,
          message_type: "event",
          metadata: { event: "conversation.closed" },
          created_at: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, closeEventMsg])
        scrollToBottom(true)
      } else {
        toast.error("Erro ao encerrar", result.error || "Falha ao finalizar conversa.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err.message || "Falha ao encerrar conversa.")
    } finally {
      setIsClosing(false)
    }
  }

  // =========================================================================
  // CICLO DE VIDA: 4. REABRIR ATENDIMENTO ENCERRADO
  // =========================================================================
  const handleReopenConversation = async () => {
    if (!selectedId || isReopening) return

    setIsReopening(true)
    try {
      const result = await reopenConversationAction(selectedId)

      if (result.success) {
        toast.success(
          "Atendimento Reaberto",
          "A conversa foi reaberta com sucesso e atribuída a você."
        )

        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId
              ? {
                  ...c,
                  status: "human",
                  assigned_to: currentUser?.userId || null,
                  closed_at: null,
                }
              : c
          )
        )

        const reopenEventMsg: MessageData = {
          id: `temp-reopen-${Date.now()}`,
          conversation_id: selectedId,
          sender_type: "system",
          content: `Atendimento reaberto por ${currentUser?.userName || "operador"}.`,
          message_type: "event",
          metadata: { event: "conversation.reopened" },
          created_at: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, reopenEventMsg])
        scrollToBottom(true)
      } else {
        toast.error("Erro ao reabrir", result.error || "Falha ao reabrir conversa.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err.message || "Falha ao reabrir conversa.")
    } finally {
      setIsReopening(false)
    }
  }

  // =========================================================================
  // CONTAGENS E FILTRAGEM DA BARRA LATERAL (Nova Taxonomia)
  // =========================================================================
  const counts = useMemo(() => {
    let waiting = 0
    let inProgress = 0
    let ai = 0
    let closed = 0

    for (const c of conversations) {
      if (c.status === "closed") {
        closed++
      } else if (c.status === "human") {
        if (!c.assigned_to) {
          waiting++
        } else {
          inProgress++
        }
      } else if (c.status === "open") {
        ai++
      }
    }

    return {
      all: conversations.length,
      waiting,
      inProgress,
      ai,
      closed,
    }
  }, [conversations])

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (activeTab === "waiting" && !(c.status === "human" && !c.assigned_to)) return false
      if (activeTab === "in_progress" && !(c.status === "human" && !!c.assigned_to)) return false
      if (activeTab === "ai" && c.status !== "open") return false
      if (activeTab === "closed" && c.status !== "closed") return false

      if (!search.trim()) return true
      const term = search.toLowerCase()
      const customerName = c.customers?.name?.toLowerCase() || ""
      const phone = c.customers?.phone?.toLowerCase() || ""
      const preview = c.last_message_preview?.toLowerCase() || ""

      return customerName.includes(term) || phone.includes(term) || preview.includes(term)
    })
  }, [conversations, activeTab, search])

  // Renderizador de ícones de status de entrega da mensagem
  const renderDeliveryStatus = (msg: MessageData) => {
    if (msg.sender_type !== "agent" && msg.sender_type !== "human") return null

    const status =
      msg.metadata?.delivery_status ||
      (msg as any).delivery_status ||
      "sent"

    switch (status) {
      case "pending":
        return (
          <span title="Pendente na fila da Outbox" className="text-ellevee-sage/70">
            <Clock className="h-3 w-3 animate-spin" />
          </span>
        )
      case "sent":
        return (
          <span title="Enviado ao WhatsApp (Gateway)" className="text-emerald-600">
            <CheckCheck className="h-3 w-3 stroke-[2.5]" />
          </span>
        )
      case "delivered":
        return (
          <span title="Entregue no aparelho do cliente" className="text-emerald-600">
            <CheckCheck className="h-3 w-3 stroke-[2.5]" />
          </span>
        )
      case "read":
        return (
          <span title="Lido pelo cliente" className="text-blue-500">
            <CheckCheck className="h-3 w-3 stroke-[2.5]" />
          </span>
        )
      case "failed":
        return (
          <span title="Falha no despacho do gateway" className="text-rose-500">
            <AlertCircle className="h-3 w-3" />
          </span>
        )
      default:
        return (
          <span className="text-emerald-600">
            <Check className="h-3 w-3" />
          </span>
        )
    }
  }

  return (
    <div className="flex h-full w-full bg-[#F3F2ED] text-ellevee-ink overflow-hidden border-t border-ellevee-stone font-sans">
      {/* =====================================================================
          SIDEBAR: LISTA DE CONVERSAS (Quiet Luxury / Deep Ink)
      ====================================================================== */}
      <aside className="w-80 sm:w-96 border-r border-ellevee-stone bg-white flex flex-col shrink-0 h-full">
        {/* Cabeçalho de Busca e Filtros */}
        <div className="p-3 border-b border-ellevee-stone space-y-2.5">
          <div className="flex items-center justify-between">
            <h1 className="font-display font-bold text-sm tracking-tight text-ellevee-ink flex items-center gap-1.5">
              <span>Atendimento</span>
              <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-[#F8F8F5] text-ellevee-sage border border-ellevee-stone">
                {conversations.length}
              </span>
            </h1>

            {/* Perfil do usuário atual */}
            {currentUser && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F8F8F5] text-ellevee-ink border border-ellevee-stone capitalize">
                {currentUser.role === "master" || currentUser.role === "admin" ? "Master" : "Atendente"}
              </span>
            )}
          </div>

          {/* Campo de Busca */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ellevee-sage" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, telefone ou texto..."
              className="w-full pl-9 pr-3 py-1.5 border border-ellevee-stone rounded-md text-xs bg-[#F8F8F5] text-ellevee-ink placeholder:text-ellevee-sage/70 focus:outline-none focus:ring-1 focus:ring-ellevee-ink focus:bg-white transition-colors"
            />
          </div>

          {/* Tabs de Filtro: Nova Taxonomia */}
          <div className="flex gap-1 text-[11px] font-medium overflow-x-auto scrollbar-none pb-0.5">
            {isMasterOrAdmin && (
              <button
                onClick={() => setActiveTab("all")}
                className={`px-2 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === "all"
                    ? "bg-ellevee-ink text-white font-semibold shadow-2xs border border-ellevee-ink"
                    : "text-ellevee-sage hover:text-ellevee-ink hover:bg-[#F8F8F5]"
                }`}
              >
                Todas ({counts.all})
              </button>
            )}

            <button
              onClick={() => setActiveTab("waiting")}
              className={`px-2 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                activeTab === "waiting"
                  ? "bg-ellevee-ink text-white font-semibold shadow-2xs border border-ellevee-ink"
                  : "text-ellevee-sage hover:text-ellevee-ink hover:bg-[#F8F8F5]"
              }`}
            >
              <span>Aguardando</span>
              {counts.waiting > 0 ? (
                <span className="h-4 px-1 rounded-full text-[9px] font-bold bg-amber-500 text-white flex items-center justify-center">
                  {counts.waiting}
                </span>
              ) : (
                <span className="text-[10px] opacity-70">({counts.waiting})</span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("in_progress")}
              className={`px-2 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === "in_progress"
                  ? "bg-ellevee-ink text-white font-semibold shadow-2xs border border-ellevee-ink"
                  : "text-ellevee-sage hover:text-ellevee-ink hover:bg-[#F8F8F5]"
              }`}
            >
              Em Atendimento ({counts.inProgress})
            </button>

            <button
              onClick={() => setActiveTab("ai")}
              className={`px-2 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === "ai"
                  ? "bg-ellevee-ink text-white font-semibold shadow-2xs border border-ellevee-ink"
                  : "text-ellevee-sage hover:text-ellevee-ink hover:bg-[#F8F8F5]"
              }`}
            >
              IA Ativa ({counts.ai})
            </button>

            <button
              onClick={() => setActiveTab("closed")}
              className={`px-2 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === "closed"
                  ? "bg-ellevee-ink text-white font-semibold shadow-2xs border border-ellevee-ink"
                  : "text-ellevee-sage hover:text-ellevee-ink hover:bg-[#F8F8F5]"
              }`}
            >
              Finalizados ({counts.closed})
            </button>
          </div>
        </div>

        {/* Lista de Itens */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-ellevee-sage p-6 text-center space-y-2">
              <MessageSquare className="h-6 w-6 stroke-1 text-ellevee-sage/60" />
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

              const isWaiting = conv.status === "human" && !conv.assigned_to

              return (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className={`w-full text-left flex items-start gap-3 p-3 rounded-lg transition-all relative cursor-pointer ${
                    isSelected
                      ? "bg-[#FBFBFA] border border-ellevee-stone shadow-2xs ring-1 ring-ellevee-ink/10"
                      : "hover:bg-[#F8F8F5] border border-transparent"
                  } ${isPulsing ? "ring-2 ring-emerald-500/60 bg-emerald-50/40 animate-pulse" : ""} ${
                    isWaiting ? "border-l-4 border-l-amber-500" : ""
                  }`}
                >
                  {/* Avatar com Iniciais */}
                  <div
                    className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                      isSelected
                        ? "bg-ellevee-ink text-white"
                        : isWaiting
                        ? "bg-amber-100 text-amber-900 border border-amber-300"
                        : "bg-[#F3F2ED] text-ellevee-ink border border-ellevee-stone"
                    }`}
                  >
                    {initials}
                  </div>

                  {/* Informações da Conversa */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="font-semibold text-xs text-ellevee-ink truncate">
                        {customerName}
                      </span>
                      <span className="text-[10px] text-ellevee-sage shrink-0 font-mono">
                        {timeAgo(conv.last_message_at || conv.created_at)}
                      </span>
                    </div>

                    <p className="text-[11px] text-ellevee-sage truncate leading-relaxed">
                      {conv.last_message_preview || "Nenhuma mensagem recente"}
                    </p>

                    {/* Status da Fila / Atendente / Espera */}
                    <div className="flex items-center justify-between mt-1 text-[10px]">
                      {isWaiting ? (
                        <div className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                          <span className="font-mono font-medium text-amber-900 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded">
                            esperando há {formatWaitTime(conv.last_message_at || conv.updated_at || conv.created_at)}
                          </span>
                        </div>
                      ) : conv.status === "human" ? (
                        <div className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          <span className="text-ellevee-sage font-medium">
                            {conv.assigned_to === currentUser?.userId ? "Com você" : "Em atendimento"}
                          </span>
                        </div>
                      ) : conv.status === "open" ? (
                        <div className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                          <span className="text-ellevee-sage font-medium">
                            IA ({conv.agent_name || "Ativa"})
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
                          <span className="text-ellevee-sage font-medium">Finalizado</span>
                        </div>
                      )}

                      {conv.unread_count > 0 && (
                        <span className="bg-ellevee-ink text-white text-[10px] font-bold px-1.5 py-0.2 rounded font-mono">
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
          MAIN: ÁREA DE CHAT (Warm Ivory #F3F2ED + Deep Ink)
      ====================================================================== */}
      <main className="flex-1 flex flex-col h-full bg-[#F3F2ED] overflow-hidden">
        {activeConversation ? (
          <>
            {/* Header do Chat */}
            <header className="h-16 border-b border-ellevee-stone px-6 flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-9 w-9 rounded-md bg-[#F3F2ED] border border-ellevee-stone text-ellevee-ink font-display font-bold text-sm flex items-center justify-center shrink-0">
                  <User className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-display font-bold text-sm text-ellevee-ink truncate">
                      {activeConversation.customers?.name || "Cliente Desconhecido"}
                    </h2>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F8F8F5] text-ellevee-ink border border-ellevee-stone uppercase">
                      {activeConversation.channel || "WhatsApp"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ellevee-sage mt-0.5">
                    {activeConversation.customers?.phone && (
                      <span className="flex items-center gap-1 font-mono">
                        <Phone className="h-3 w-3 text-ellevee-sage" />
                        {activeConversation.customers.phone}
                      </span>
                    )}
                    <span>•</span>
                    <span className="font-medium text-ellevee-ink">
                      {activeConversation.status === "closed"
                        ? "Atendimento Finalizado"
                        : activeConversation.status === "human"
                        ? !activeConversation.assigned_to
                          ? "Aguardando Atendente"
                          : activeConversation.assigned_to === currentUser?.userId
                          ? "Atendimento com Você"
                          : "Atendimento com Operador"
                        : `Atendimento por IA (${activeConversation.agent_name || "Ativa"})`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Ações de Ciclo de Vida da Conversa */}
              <div className="flex items-center gap-2">
                {/* 1. Conversa Finalizada -> Reabrir */}
                {activeConversation.status === "closed" ? (
                  <>
                    <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-stone-100 text-stone-700 border border-stone-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-stone-500" />
                      <span>Finalizado</span>
                    </div>

                    <button
                      onClick={handleReopenConversation}
                      disabled={isReopening}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-ellevee-ink hover:bg-black text-white transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                      title="Reativar esta conversa"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>{isReopening ? "Reabrindo..." : "Reabrir Atendimento"}</span>
                    </button>
                  </>
                ) : activeConversation.status === "human" ? (
                  /* 2. Conversa em Atendimento Humano */
                  <>
                    {!activeConversation.assigned_to ? (
                      <button
                        onClick={handleTakeover}
                        disabled={isTakingOver}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                        title="Pegar esta conversa que está aguardando na fila"
                      >
                        {isTakingOver ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Pegando...</span>
                          </>
                        ) : (
                          <>
                            <UserCheck className="h-3.5 w-3.5" />
                            <span>Pegar para Mim</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-[#F4F8E8] text-[#3D5215] border border-[#D5E89B]">
                        <span className="h-1.5 w-1.5 rounded-full bg-ellevee-accent ring-1 ring-ellevee-ink/10" />
                        <UserCheck className="h-3.5 w-3.5" />
                        <span>{activeConversation.assigned_to === currentUser?.userId ? "Com Você" : "Em Atendimento"}</span>
                      </div>
                    )}

                    {/* Botão Dinâmico: Devolver para o Agente IA */}
                    <button
                      onClick={handleReturnToAI}
                      disabled={isReturningToAI}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-white hover:bg-[#F8F8F5] text-ellevee-ink border border-ellevee-stone transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                      title={`Pausar atendimento humano e devolver para o agente ${activeConversation.agent_name || "IA"}`}
                    >
                      {isReturningToAI ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Devolvendo...</span>
                        </>
                      ) : (
                        <>
                          <Bot className="h-3.5 w-3.5 text-blue-600" />
                          <span>Devolver para {activeConversation.agent_name || "a IA"}</span>
                        </>
                      )}
                    </button>

                    {/* Botão: Encerrar Atendimento */}
                    <button
                      onClick={handleCloseConversation}
                      disabled={isClosing}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-100 border border-stone-200 transition-colors cursor-pointer disabled:opacity-50"
                      title="Finalizar e arquivar este atendimento"
                    >
                      {isClosing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="hidden sm:inline">Encerrar</span>
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  /* 3. Conversa com IA Ativa (status === 'open') */
                  <>
                    <button
                      onClick={handleTakeover}
                      disabled={isTakingOver}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-ellevee-ink hover:bg-black text-white transition-colors shadow-2xs disabled:opacity-60 cursor-pointer"
                      title="Pausar a IA e assumir o atendimento humano"
                    >
                      {isTakingOver ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Assumindo...</span>
                        </>
                      ) : (
                        <>
                          <UserCheck className="h-3.5 w-3.5" />
                          <span>Assumir Conversa</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={handleCloseConversation}
                      disabled={isClosing}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-100 border border-stone-200 transition-colors cursor-pointer disabled:opacity-50"
                      title="Finalizar atendimento"
                    >
                      {isClosing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="hidden sm:inline">Encerrar</span>
                        </>
                      )}
                    </button>
                  </>
                )}

                <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono font-medium bg-[#F8F8F5] text-ellevee-ink border border-ellevee-stone">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Realtime</span>
                </div>
              </div>
            </header>

            {/* Histórico de Mensagens: Fundo Warm Ivory (#F3F2ED) */}
            <section className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#F3F2ED] space-y-4">
              <div className="max-w-3xl mx-auto space-y-4">
                {loadingMessages ? (
                  <div className="flex items-center justify-center p-8 text-ellevee-sage">
                    <Loader2 className="h-6 w-6 animate-spin text-ellevee-ink" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center p-8 text-ellevee-sage text-xs">
                    Nenhuma mensagem registrada nesta conversa.
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isCustomer = msg.sender_type === "customer"
                    const isSystem = msg.sender_type === "system" || msg.message_type === "event"
                    const isAgent = msg.sender_type === "agent" || msg.sender_type === "human"
                    const isIA = msg.sender_type === "ia" || msg.sender_type === "bot"

                    // Mensagem de Evento do Sistema (Handoff / Devolução / Encerramento)
                    if (isSystem) {
                      return (
                        <div key={msg.id} className="flex justify-center my-3">
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-white text-ellevee-ink border border-ellevee-stone shadow-2xs max-w-md text-center">
                            <Sparkles className="h-3.5 w-3.5 text-ellevee-accent shrink-0" />
                            <span>{msg.content}</span>
                          </div>
                        </div>
                      )
                    }

                    // Mensagem de Cliente (Alinhada à Esquerda)
                    if (isCustomer) {
                      return (
                        <div key={msg.id} className="flex flex-col items-start space-y-1">
                          <span className="text-[10px] text-ellevee-sage px-1 font-mono">
                            {activeConversation.customers?.name || "Cliente"}
                          </span>
                          <div className="max-w-md bg-white border border-ellevee-stone rounded-2xl rounded-tl-sm px-4 py-2.5 text-xs text-ellevee-ink shadow-2xs leading-relaxed break-words">
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                            <div className="flex justify-end items-center gap-1 mt-1 text-[10px] text-ellevee-sage font-mono">
                              <span>{formatTime(msg.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    }

                    // Mensagens de Saída: IA (Deep Ink com acento) ou Atendente Humano (Emerald suave)
                    return (
                      <div key={msg.id} className="flex flex-col items-end space-y-1">
                        <span className="text-[10px] text-ellevee-sage px-1 font-mono flex items-center gap-1">
                          {isAgent ? (
                            <>
                              <User className="h-2.5 w-2.5 text-emerald-700" />
                              <span className="text-emerald-700 font-semibold">Atendente Humano</span>
                            </>
                          ) : (
                            <>
                              <Bot className="h-2.5 w-2.5 text-blue-600" />
                              <span className="text-blue-600 font-semibold">
                                {activeConversation.agent_name || "Ellevee IA"}
                              </span>
                            </>
                          )}
                        </span>

                        <div
                          className={`max-w-md rounded-2xl rounded-tr-sm px-4 py-2.5 text-xs shadow-2xs leading-relaxed break-words ${
                            isAgent
                              ? "bg-white text-ellevee-ink border border-emerald-300 ring-1 ring-emerald-500/20"
                              : "bg-ellevee-ink text-white border border-ellevee-ink"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                          <div
                            className={`flex justify-end items-center gap-1.5 mt-1 text-[10px] font-mono ${
                              isAgent ? "text-ellevee-sage" : "text-white/70"
                            }`}
                          >
                            <span>{formatTime(msg.created_at)}</span>
                            {renderDeliveryStatus(msg)}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </section>

            {/* Rodapé: Textarea Ativo OU Banner de Atendimento Encerrado */}
            {activeConversation.status === "closed" ? (
              <footer className="border-t border-ellevee-stone px-6 py-4 bg-white shrink-0 flex items-center justify-between">
                <div className="flex items-center gap-2 text-ellevee-sage">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="text-xs font-semibold text-ellevee-ink">
                    Este atendimento foi finalizado.
                  </span>
                  <span className="text-xs text-ellevee-sage hidden sm:inline">
                    O histórico está preservado.
                  </span>
                </div>

                <button
                  onClick={handleReopenConversation}
                  disabled={isReopening}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-ellevee-ink hover:bg-black text-white transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>{isReopening ? "Reabrindo..." : "Reabrir Atendimento"}</span>
                </button>
              </footer>
            ) : (
              <footer className="border-t border-ellevee-stone px-4 py-3 bg-white shrink-0">
                <form onSubmit={handleSendMessage} className="max-w-3xl mx-auto flex items-end gap-2.5">
                  <div className="flex-1 relative rounded-lg border border-ellevee-stone bg-[#FBFBFA] focus-within:bg-white focus-within:border-ellevee-ink focus-within:ring-1 focus-within:ring-ellevee-ink transition-all">
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      value={inputContent}
                      onChange={(e) => setInputContent(e.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={isSending}
                      placeholder="Digite uma mensagem como operador humano... (Enter para enviar, Shift+Enter para nova linha)"
                      className="w-full resize-none bg-transparent px-3.5 py-2.5 text-xs text-ellevee-ink placeholder:text-ellevee-sage/70 focus:outline-none min-h-[44px] max-h-32 disabled:opacity-50"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSending || !inputContent.trim()}
                    className="h-11 px-4 rounded-lg bg-ellevee-ink hover:bg-black text-white transition-colors flex items-center justify-center gap-1.5 font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-2xs cursor-pointer font-sans"
                    title="Enviar mensagem para o cliente (Outbox idempotente)"
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-ellevee-accent" />
                        <span className="hidden sm:inline">Enviando...</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        <span className="hidden sm:inline">Enviar</span>
                      </>
                    )}
                  </button>
                </form>
              </footer>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-ellevee-sage space-y-3">
            <MessageSquare className="h-10 w-10 stroke-1 text-ellevee-sage/50" />
            <h3 className="font-display font-semibold text-sm text-ellevee-ink">Nenhuma conversa selecionada</h3>
            <p className="text-xs max-w-xs text-ellevee-sage">
              Selecione uma conversa na barra lateral para visualizar o histórico de mensagens e monitorar eventos em tempo real.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

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
  AlertCircle,
  X,
  MapPin,
  Mail,
  StickyNote,
  Lock,
  FileText,
  Save,
  Hourglass,
  ListFilter,
  ArrowLeftRight,
  Menu,
  ChevronDown,
  LayoutGrid
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "@/components/ui/toast"
import { 
  ConversationData, 
  MessageData, 
  UserProfileContext,
  getConversationMessages,
  getConversationsList,
  sendMessageAction,
  takeoverConversationAction,
  returnToAIAction,
  closeConversationAction,
  reopenConversationAction,
  getCustomerDetailsAction,
  updateCustomerProfileAction,
  createInternalNoteAction
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

function isSameDay(a: string, b: string): boolean {
  if (!a || !b) return false
  const d1 = new Date(a)
  const d2 = new Date(b)
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

function formatDayLabel(isoString: string): string {
  if (!isoString) return ""
  const date = new Date(isoString)
  const now = new Date()
  const yesterday = new Date()
  yesterday.setDate(now.getDate() - 1)

  if (isSameDay(isoString, now.toISOString())) return "Hoje"
  if (isSameDay(isoString, yesterday.toISOString())) return "Ontem"
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
}

function WhatsAppIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 00-3.48-8.413Z"/>
    </svg>
  )
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
  // Lista de conversas recolhida em telas pequenas (mobile)
  const [isListOpen, setIsListOpen] = useState(false)
  
  // 3. Estados de envio de mensagem e Ações de Ciclo de Vida (Fase 1)
  const [inputContent, setInputContent] = useState("")
  const [sendMode, setSendMode] = useState<"whatsapp" | "note">("whatsapp")
  const [isSending, setIsSending] = useState(false)
  const [isSendingInternalNote, setIsSendingInternalNote] = useState(false)
  const [isTakingOver, setIsTakingOver] = useState(false)
  const [isReturningToAI, setIsReturningToAI] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [isReopening, setIsReopening] = useState(false)

  // 4. Estados do Perfil do Cliente e Painel Retrátil (Fase 2)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [customerForm, setCustomerForm] = useState<{
    id: string
    name: string
    phone: string
    email: string
    address: string
    notes: string
    avatar_url: string
  }>({
    id: "",
    name: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
    avatar_url: "",
  })
  const [isSavingCustomer, setIsSavingCustomer] = useState(false)
  const [isLoadingCustomer, setIsLoadingCustomer] = useState(false)
  const [quickNoteContent, setQuickNoteContent] = useState("")
  const [isSavingQuickNote, setIsSavingQuickNote] = useState(false)

  // 5. Efeito visual para quando uma conversa receber atualização em tempo real
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null)
  const [isRealtimeActive, setIsRealtimeActive] = useState(false)

  // Referências para scroll automático e foco no textarea
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId]
  )

  // Notas internas filtradas desta conversa
  const internalNotes = useMemo(() => {
    return messages.filter(
      (m) => m.message_type === "internal_note" || m.metadata?.is_internal
    )
  }, [messages])

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

  // Sincroniza formulário de cliente ao selecionar conversa com fallback resiliente
  useEffect(() => {
    if (!activeConversation) return
    const cust = activeConversation.customers
    const targetCustId = activeConversation.customer_id || cust?.id || ""

    setCustomerForm({
      id: targetCustId,
      name: cust?.name || "",
      phone: cust?.phone || activeConversation.external_id || "",
      email: cust?.email || "",
      address: (cust as any)?.address || "",
      notes: (cust as any)?.notes || "",
      avatar_url: (cust as any)?.avatar_url || "",
    })

    if (targetCustId) {
      setIsLoadingCustomer(true)
      getCustomerDetailsAction(targetCustId)
        .then((res) => {
          if (res.success && res.customer) {
            setCustomerForm((prev) => ({
              ...prev,
              name: res.customer?.name || prev.name,
              phone: res.customer?.phone || prev.phone,
              email: res.customer?.email || prev.email,
              address: res.customer?.address || prev.address || "",
              notes: res.customer?.notes || prev.notes || "",
              avatar_url: res.customer?.avatar_url || prev.avatar_url || "",
            }))
          }
        })
        .catch(() => {})
        .finally(() => {
          setIsLoadingCustomer(false)
        })
    }
  }, [activeConversation?.id, activeConversation?.customer_id])

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
  // RECONCILIAÇÃO REALTIME CONTÍNUA: Polling em Segundo Plano (Zero F5)
  // =========================================================================
  // 1. Sincroniza novas mensagens da conversa ativa a cada 3.5 segundos
  useEffect(() => {
    if (!selectedId) return

    let isMounted = true

    const pollMessagesInterval = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return

      try {
        const latestMsgs = await getConversationMessages(selectedId)
        if (!isMounted || !latestMsgs) return

        setMessages((prev) => {
          // Se lista vazia ou idêntica, evita recriar estado
          if (
            latestMsgs.length === prev.length &&
            latestMsgs[latestMsgs.length - 1]?.id === prev[prev.length - 1]?.id
          ) {
            return prev
          }

          // Se chegou mensagem nova vinda do cliente WhatsApp
          const hasNew = latestMsgs.some((m) => !prev.some((p) => p.id === m.id))
          if (hasNew) {
            scrollToBottom(true)
          }

          return latestMsgs
        })
      } catch {
        // Silencioso em caso de oscilação momentânea
      }
    }, 3500)

    return () => {
      isMounted = false
      clearInterval(pollMessagesInterval)
    }
  }, [selectedId])

  // 2. Sincroniza a lista de conversas e contadores das abas a cada 8 segundos
  useEffect(() => {
    let isMounted = true

    const pollListInterval = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return

      try {
        const updatedList = await getConversationsList()
        if (!isMounted || !updatedList || updatedList.length === 0) return

        setConversations((prev) => {
          const hasDiff =
            updatedList.length !== prev.length ||
            updatedList[0]?.id !== prev[0]?.id ||
            updatedList[0]?.last_message_at !== prev[0]?.last_message_at ||
            updatedList.some((u) => {
              const p = prev.find((x) => x.id === u.id)
              return (
                !p ||
                p.status !== u.status ||
                p.unread_count !== u.unread_count ||
                p.customers?.avatar_url !== u.customers?.avatar_url
              )
            })

          if (!hasDiff) return prev
          return updatedList
        })
      } catch {
        // Silencioso
      }
    }, 8000)

    return () => {
      isMounted = false
      clearInterval(pollListInterval)
    }
  }, [])

  // =========================================================================
  // TROCA DE CONVERSA
  // =========================================================================
  const handleSelectConversation = async (convId: string) => {
    if (convId === selectedId) return

    setSelectedId(convId)
    setIsListOpen(false)
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

    const attendantName = (currentUser?.userName?.trim() || "Atendente").split(/\s+/)[0] || "Atendente"
    const prefix = `*Atendente ${attendantName}:*\n`
    const optimisticContent = trimmed.startsWith("*Atendente") ? trimmed : `${prefix}${trimmed}`

    // Mensagem otimista na tela
    const optimisticMsg: MessageData = {
      id: tempId,
      conversation_id: selectedId,
      sender_type: "agent",
      sender_id: currentUser?.userId || null,
      content: optimisticContent,
      message_type: "text",
      metadata: {
        delivery_status: "pending",
        client_message_id: clientMessageId,
        operator_name: attendantName,
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

  // =========================================================================
  // FASE 2: CRIAÇÃO DE NOTA INTERNA (Não enviada ao WhatsApp)
  // =========================================================================
  const handleCreateInternalNote = async (customContent?: string) => {
    const text = (customContent !== undefined ? customContent : inputContent).trim()
    if (!selectedId || !text || isSendingInternalNote) return

    setIsSendingInternalNote(true)

    try {
      const res = await createInternalNoteAction({
        conversationId: selectedId,
        content: text,
      })

      if (res.success && res.message) {
        setMessages((prev) => [...prev, res.message!])
        if (customContent !== undefined) {
          setQuickNoteContent("")
        } else {
          setInputContent("")
        }
        scrollToBottom(true)
        toast.success("Nota Salva", "A anotação interna foi registrada na conversa.")
      } else {
        toast.error("Erro ao salvar nota", res.error || "Falha ao registrar nota.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err.message || "Falha ao registrar nota.")
    } finally {
      setIsSendingInternalNote(false)
    }
  }

  // =========================================================================
  // FASE 2: SALVAR PERFIL DO CLIENTE
  // =========================================================================
  const handleSaveCustomer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const targetCustId = customerForm.id || activeConversation?.customer_id || activeConversation?.customers?.id
    if (!targetCustId) {
      toast.error("Erro", "Cliente não identificado nesta conversa.")
      return
    }

    setIsSavingCustomer(true)

    try {
      const res = await updateCustomerProfileAction({
        customerId: targetCustId,
        name: customerForm.name,
        phone: customerForm.phone,
        email: customerForm.email,
        address: customerForm.address,
        notes: customerForm.notes,
      })

      if (res.success) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId
              ? {
                  ...c,
                  customers: {
                    ...c.customers,
                    name: customerForm.name,
                    phone: customerForm.phone,
                    email: customerForm.email,
                    address: customerForm.address,
                    notes: customerForm.notes,
                  },
                }
              : c
          )
        )

        if (res.pendingMigration) {
          toast.success(
            "Dados salvos!",
            "Nome, telefone e email atualizados. (Para salvar endereço e notas, aplique o script SQL no Supabase)."
          )
        } else {
          toast.success("Perfil atualizado!", "As informações do cliente foram salvas com sucesso.")
        }
      } else {
        toast.error("Erro ao salvar", res.error || "Não foi possível atualizar o perfil.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err.message || "Falha ao salvar dados do cliente.")
    } finally {
      setIsSavingCustomer(false)
    }
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (sendMode === "note") {
      handleCreateInternalNote()
    } else {
      handleSendMessage(e)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (sendMode === "note") {
        handleCreateInternalNote()
      } else {
        handleSendMessage()
      }
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
          <span title="Pendente na fila da Outbox" className="text-ellevee-sage-strong/70">
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

  // Feed de mensagens com separadores de dia inseridos entre mensagens
  const messageFeed = useMemo(() => {
    const feed: any[] = []
    let lastDay = ""
    for (const m of messages) {
      const day = m.created_at ? new Date(m.created_at).toDateString() : ""
      if (day && day !== lastDay) {
        feed.push({
          id: `divider-${day}-${m.id}`,
          sender_type: "__divider__",
          content: formatDayLabel(m.created_at),
          created_at: m.created_at,
        })
        lastDay = day
      }
      feed.push(m)
    }
    return feed
  }, [messages])

  return (
    <div className="flex h-full min-h-0 w-full bg-ellevee-ivory text-ellevee-ink overflow-hidden border-t border-ellevee-stone font-sans relative">
      {/* Botão flutuante para abrir a lista de conversas em telas pequenas */}
      {!activeConversation && (
        <button
          type="button"
          onClick={() => setIsListOpen(true)}
          className="lg:hidden absolute top-3 left-3 z-30 inline-flex items-center gap-2 h-9 px-3 rounded-md bg-ellevee-ink text-white text-meta font-medium shadow-lg focus-ring"
          aria-label="Abrir a lista de conversas"
        >
          <Menu className="h-4 w-4" />
          <span>Conversas</span>
        </button>
      )}
      {/* =====================================================================
          SIDEBAR: LISTA DE CONVERSAS (Quiet Luxury / Deep Ink)
      ====================================================================== */}
      <aside
        className={`w-80 sm:w-96 border-r border-ellevee-stone bg-white flex-col shrink-0 h-full transition-transform duration-200 z-40 ${
          isListOpen ? "absolute inset-y-0 left-0 flex shadow-2xl" : "hidden lg:flex"
        }`}
      >
        {/* Cabeçalho de Busca e Filtros */}
        <div className="p-3 border-b border-ellevee-stone space-y-2.5">
          <div className="flex items-center justify-between">
            <h1 className="font-display font-bold text-sm tracking-tight text-ellevee-ink flex items-center gap-1.5">
              <span>Atendimento</span>
              <span className="text-meta font-mono font-medium px-1.5 py-0.2 rounded bg-ellevee-stone-subtle text-ellevee-sage-strong border border-ellevee-stone">
                {conversations.length}
              </span>
            </h1>

            {/* Fechar lista (mobile) */}
            <button
              type="button"
              onClick={() => setIsListOpen(false)}
              className="lg:hidden inline-flex items-center justify-center h-7 w-7 rounded-md text-ellevee-sage-strong hover:bg-ellevee-ivory hover:text-ellevee-ink focus-ring"
              aria-label="Fechar lista de conversas"
              title="Fechar lista de conversas"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Perfil do usuário atual */}
            {currentUser && (
              <span className="text-meta font-mono px-2 py-0.5 rounded bg-ellevee-stone-subtle text-ellevee-ink border border-ellevee-stone capitalize">
                {currentUser.role === "master" || currentUser.role === "admin" ? "Master" : "Atendente"}
              </span>
            )}

            {/* Acesso ao quadro de funil (Kanban) */}
            <a
              href="/conversations/kanban"
              className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-meta font-medium text-ellevee-sage-strong hover:text-ellevee-ink hover:bg-ellevee-ivory border border-ellevee-stone transition-colors focus-ring"
              title="Abrir o funil de atendimento (Kanban)"
              aria-label="Abrir o funil de atendimento (Kanban)"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Funil</span>
            </a>
          </div>

          {/* Campo de Busca */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ellevee-sage-strong" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, telefone ou texto..."
              aria-label="Buscar conversas por cliente, telefone ou texto"
              className="w-full pl-9 pr-3 py-2 border border-ellevee-stone rounded-md text-sm bg-ellevee-stone-subtle text-ellevee-ink placeholder:text-ellevee-sage-strong focus:outline-none focus:ring-2 focus:ring-ellevee-ink/50 focus:bg-white transition-colors"
            />
          </div>

          {/* Tabs de Filtro: Ergonomia por Ícones Rápidos (Estilo ChatPro) */}
          <div className={`grid ${isMasterOrAdmin ? "grid-cols-5" : "grid-cols-4"} gap-1 p-1 bg-ellevee-ivory rounded-lg border border-ellevee-stone/70`}>
            {isMasterOrAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                aria-pressed={activeTab === "all"}
                title={`Todas as Conversas (${counts.all})`}
                className={`relative flex items-center justify-center py-1.5 rounded-md text-meta transition-all cursor-pointer focus-ring ${
                  activeTab === "all"
                    ? "bg-white text-ellevee-ink font-semibold shadow-2xs border border-ellevee-stone ring-1 ring-ellevee-ink/5"
                    : "text-ellevee-sage-strong hover:text-ellevee-ink hover:bg-white/60"
                }`}
              >
                <ListFilter className="h-4 w-4" />
                {counts.all > 0 && (
                  <span className="ml-1 text-meta font-mono text-ellevee-sage-strong font-medium hidden sm:inline">
                    {counts.all}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveTab("waiting")}
              aria-pressed={activeTab === "waiting"}
              title={`Aguardando Atendimento (${counts.waiting})`}
              className={`relative flex items-center justify-center py-1.5 rounded-md text-meta transition-all cursor-pointer focus-ring ${
                activeTab === "waiting"
                  ? "bg-white text-amber-900 font-semibold shadow-2xs border border-amber-300 ring-1 ring-amber-400/20"
                  : "text-ellevee-sage-strong hover:text-amber-800 hover:bg-white/60"
              }`}
            >
              <Hourglass className={`h-4 w-4 ${counts.waiting > 0 ? "text-amber-600 animate-pulse" : "text-amber-600/70"}`} />
              {counts.waiting > 0 ? (
                <span className="ml-1 px-1 min-w-[16px] h-4 rounded-full text-meta font-bold bg-amber-500 text-white flex items-center justify-center">
                  {counts.waiting}
                </span>
              ) : (
                <span className="ml-1 text-meta font-mono text-ellevee-sage-strong/60 font-medium hidden sm:inline">
                  0
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("in_progress")}
              aria-pressed={activeTab === "in_progress"}
              title={`Em Atendimento Humano (${counts.inProgress})`}
              className={`relative flex items-center justify-center py-1.5 rounded-md text-meta transition-all cursor-pointer focus-ring ${
                activeTab === "in_progress"
                  ? "bg-white text-emerald-900 font-semibold shadow-2xs border border-emerald-300 ring-1 ring-emerald-400/20"
                  : "text-ellevee-sage-strong hover:text-emerald-800 hover:bg-white/60"
              }`}
            >
              <MessageSquare className="h-4 w-4 text-emerald-600" />
              {counts.inProgress > 0 && (
                <span className="ml-1 px-1 min-w-[16px] h-4 rounded-full text-meta font-bold bg-emerald-600 text-white flex items-center justify-center">
                  {counts.inProgress}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("ai")}
              aria-pressed={activeTab === "ai"}
              title={`IA Ativa (${counts.ai})`}
              className={`relative flex items-center justify-center py-1.5 rounded-md text-meta transition-all cursor-pointer focus-ring ${
                activeTab === "ai"
                  ? "bg-white text-blue-900 font-semibold shadow-2xs border border-blue-300 ring-1 ring-blue-400/20"
                  : "text-ellevee-sage-strong hover:text-blue-800 hover:bg-white/60"
              }`}
            >
              <Bot className="h-4 w-4 text-blue-600" />
              {counts.ai > 0 && (
                <span className="ml-1 text-meta font-mono text-blue-700 font-medium hidden sm:inline">
                  {counts.ai}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("closed")}
              aria-pressed={activeTab === "closed"}
              title={`Atendimentos Finalizados (${counts.closed})`}
              className={`relative flex items-center justify-center py-1.5 rounded-md text-meta transition-all cursor-pointer focus-ring ${
                activeTab === "closed"
                  ? "bg-white text-ellevee-ink font-semibold shadow-2xs border border-ellevee-stone ring-1 ring-ellevee-ink/10"
                  : "text-ellevee-sage-strong hover:text-ellevee-ink hover:bg-white/60"
              }`}
            >
              <CheckCircle2 className="h-4 w-4 text-ellevee-sage-strong" />
              {counts.closed > 0 && (
                <span className="ml-1 text-meta font-mono text-ellevee-sage-strong font-medium hidden sm:inline">
                  {counts.closed}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Lista de Itens */}
        <div className="flex-1 overflow-y-auto scroll-slim p-2 space-y-1">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-ellevee-sage-strong p-6 text-center space-y-2">
              <div className="h-12 w-12 rounded-full bg-ellevee-ivory flex items-center justify-center">
                <MessageSquare className="h-5 w-5 stroke-1 text-ellevee-sage-strong/70" />
              </div>
              <p className="text-sm font-medium text-ellevee-ink">Nenhuma conversa encontrada</p>
              <p className="text-sm text-ellevee-sage-strong max-w-[240px] leading-relaxed">
                Ajuste a busca ou troque a aba de status para ver outros atendimentos.
              </p>
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
                  className={`conv-item focus-ring w-full text-left flex items-start gap-3 p-3 rounded-lg transition-all relative cursor-pointer ${
                    isSelected
                      ? "bg-ellevee-stone-subtle border border-ellevee-stone shadow-2xs ring-1 ring-ellevee-ink/10"
                      : "hover:bg-ellevee-stone-subtle border border-transparent"
                  } ${isPulsing ? "ring-2 ring-emerald-500/60 bg-emerald-50/40 animate-pulse" : ""} ${
                    isWaiting ? "border-l-4 border-l-amber-500" : ""
                  }`}
                >
                  {/* Avatar com Foto Real ou Iniciais + Selo WhatsApp */}
                  <div className="relative shrink-0">
                    {conv.customers?.avatar_url ? (
                      <img
                        src={conv.customers.avatar_url}
                        alt={customerName}
                        referrerPolicy="no-referrer"
                        className="h-9 w-9 rounded-full object-cover border border-ellevee-stone/80"
                        onError={(e) => {
                          e.currentTarget.style.display = "none"
                          if (e.currentTarget.nextElementSibling) {
                            (e.currentTarget.nextElementSibling as HTMLElement).style.display = "flex"
                          }
                        }}
                      />
                    ) : null}
                    <div
                      className={`h-9 w-9 rounded-full flex items-center justify-center text-meta font-bold shrink-0 transition-colors ${
                        conv.customers?.avatar_url ? "hidden" : ""
                      } ${
                        isSelected
                          ? "bg-ellevee-ink text-white"
                          : isWaiting
                          ? "bg-amber-100 text-amber-900 border border-amber-300"
                          : "bg-ellevee-ivory text-ellevee-ink border border-ellevee-stone"
                      }`}
                    >
                      {initials}
                    </div>
                    {/* Selo verde do WhatsApp estilo ChatPro */}
                    <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xs ring-1 ring-white">
                      <WhatsAppIcon className="h-2 w-2" />
                    </div>
                  </div>

                  {/* Informações da Conversa */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="font-semibold text-sm text-ellevee-ink truncate">
                        {customerName}
                      </span>
                      <span className="text-meta text-ellevee-sage-strong shrink-0 font-mono">
                        {timeAgo(conv.last_message_at || conv.created_at)}
                      </span>
                    </div>

                    <p className="text-sm text-ellevee-sage-strong truncate leading-relaxed">
                      {conv.last_message_preview || "Nenhuma mensagem recente"}
                    </p>

                    {/* Status da Fila / Atendente / Espera */}
                    <div className="flex items-center justify-between mt-1 text-meta leading-relaxed">
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
                          <span className="text-ellevee-sage-strong font-medium">
                            {conv.assigned_to === currentUser?.userId ? "Com você" : "Em atendimento"}
                          </span>
                        </div>
                      ) : conv.status === "open" ? (
                        <div className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                          <span className="text-ellevee-sage-strong font-medium">
                            IA ({conv.agent_name || "Ativa"})
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-ellevee-stone" />
                          <span className="text-ellevee-sage-strong font-medium">Finalizado</span>
                        </div>
                      )}

                      {conv.unread_count > 0 && (
                        <span className="min-w-[18px] h-4 px-1 rounded-full bg-emerald-500 text-white text-meta font-bold flex items-center justify-center font-mono shadow-xs">
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

      {/* Overlay mobile: escurece o fundo quando a lista de conversas está aberta */}
      {isListOpen && (
        <button
          type="button"
          aria-label="Fechar lista de conversas"
          onClick={() => setIsListOpen(false)}
          className="lg:hidden fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px]"
        />
      )}

      {/* =====================================================================
          MAIN: ÁREA DE CHAT (Warm Ivory #F3F2ED + Deep Ink) COM DRAWER RETRÁTIL
      ====================================================================== */}
      <main className="flex-1 flex flex-row h-full min-h-0 bg-ellevee-ivory overflow-hidden">
        {activeConversation ? (
          <>
            {/* Coluna Central do Chat */}
            <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden min-w-0">
            {/* Header do Chat (Harmonização Didática Estilo ChatPro / WhatsApp Web) */}
            <header className="h-16 border-b border-ellevee-stone px-4 sm:px-6 flex items-center justify-between bg-white shrink-0 gap-3 shadow-[0_1px_0_0_rgba(0,0,0,0.02)]">
              {/* Lado Esquerdo: Avatar + Nome com Selo WhatsApp + Subtítulo */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {/* Botão voltar para a lista (mobile) */}
                <button
                  type="button"
                  onClick={() => setIsListOpen(true)}
                  className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md text-ellevee-ink hover:bg-ellevee-ivory focus-ring shrink-0"
                  title="Ver lista de conversas"
                  aria-label="Ver lista de conversas"
                >
                  <Menu className="h-4 w-4" />
                </button>
                {/* Avatar com Foto Real ou Iniciais + Selo WhatsApp */}
                <div className="relative shrink-0">
                  {activeConversation.customers?.avatar_url ? (
                    <img
                      src={activeConversation.customers.avatar_url}
                      alt={activeConversation.customers?.name || "Cliente"}
                      referrerPolicy="no-referrer"
                      className="h-10 w-10 rounded-full object-cover border border-ellevee-stone shadow-2xs"
                      onError={(e) => {
                        e.currentTarget.style.display = "none"
                        if (e.currentTarget.nextElementSibling) {
                          (e.currentTarget.nextElementSibling as HTMLElement).style.display = "flex"
                        }
                      }}
                    />
                  ) : null}
                  <div
                    className={`h-10 w-10 rounded-full bg-ellevee-ink text-white font-bold text-meta flex items-center justify-center shrink-0 shadow-2xs ${
                      activeConversation.customers?.avatar_url ? "hidden" : ""
                    }`}
                  >
                    {(activeConversation.customers?.name || "C").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xs ring-1 ring-white">
                    <WhatsAppIcon className="h-2 w-2" />
                  </div>
                </div>

                {/* Nome e Metadados do Atendimento */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h2
                      className="font-semibold text-sm sm:text-base text-ellevee-ink truncate"
                      title={activeConversation.customers?.name || "Cliente Desconhecido"}
                    >
                      {activeConversation.customers?.name || "Cliente Desconhecido"}
                    </h2>
                    <span title="WhatsApp Oficial" className="text-emerald-500 shrink-0">
                      <WhatsAppIcon className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-meta text-ellevee-sage-strong mt-0.5 truncate">
                    {activeConversation.customers?.phone && (
                      <span className="flex items-center gap-1 font-mono text-ellevee-ink/80">
                        <Phone className="h-3 w-3 text-ellevee-sage-strong" />
                        {activeConversation.customers.phone}
                      </span>
                    )}
                    <span>•</span>
                    <span className="truncate">
                      {activeConversation.status === "closed" ? (
                        <span className="text-ellevee-sage-strong font-medium">Finalizado</span>
                      ) : activeConversation.status === "human" ? (
                        !activeConversation.assigned_to ? (
                          <span className="text-amber-600 font-medium">Aguardando Atendente</span>
                        ) : activeConversation.assigned_to === currentUser?.userId ? (
                          <span className="text-emerald-700 font-semibold">Com Você</span>
                        ) : (
                          <span className="text-ellevee-sage-strong font-medium">Com Operador</span>
                        )
                      ) : (
                        <span className="text-blue-700 font-medium">IA: {activeConversation.agent_name || "Ativa"}</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Lado Direito: Ações em Linha Reta Minimalistas Estilo ChatPro */}
              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                {/* 1. Conversa Finalizada -> Reabrir */}
                {activeConversation.status === "closed" ? (
                  <button
                    onClick={handleReopenConversation}
                    disabled={isReopening}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-meta font-medium text-ellevee-ink-muted hover:text-ellevee-ink hover:bg-ellevee-stone-subtle border border-ellevee-stone transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap focus-ring"
                    title="Reativar esta conversa"
                    aria-label="Reativar esta conversa"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-ellevee-sage-strong" />
                    <span>{isReopening ? "Reabrindo..." : "Reabrir"}</span>
                  </button>
                ) : activeConversation.status === "human" ? (
                  /* 2. Conversa em Atendimento Humano */
                  <>
                    {!activeConversation.assigned_to && (
                      <button
                        onClick={handleTakeover}
                        disabled={isTakingOver}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-meta font-semibold bg-amber-500 hover:bg-amber-600 text-white transition-colors shadow-2xs cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        title="Pegar esta conversa que está na fila"
                        aria-label="Assumir conversa que está na fila"
                      >
                        {isTakingOver ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <UserCheck className="h-3.5 w-3.5" />
                        )}
                        <span>Pegar para Mim</span>
                      </button>
                    )}

                    {/* Botão Devolver para IA (ChatPro: ⇄ transferir) */}
                    <button
                      onClick={handleReturnToAI}
                      disabled={isReturningToAI}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-meta font-medium text-ellevee-sage-strong hover:text-ellevee-ink hover:bg-ellevee-stone-subtle transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap focus-ring"
                      title={`Pausar atendimento humano e devolver para o agente ${activeConversation.agent_name || "IA"}`}
                    >
                      {isReturningToAI ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ArrowLeftRight className="h-3.5 w-3.5 text-ellevee-sage-strong" />
                      )}
                      <span>Devolver p/ {activeConversation.agent_name || "IA"}</span>
                    </button>

                    {/* Botão Encerrar (ChatPro: ✓ finalizar) */}
                    <button
                      onClick={handleCloseConversation}
                      disabled={isClosing}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-meta font-medium text-ellevee-sage-strong hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap focus-ring"
                      title="Finalizar atendimento"
                      aria-label="Finalizar atendimento"
                    >
                      {isClosing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 text-ellevee-sage-strong" />
                      )}
                      <span>Encerrar</span>
                    </button>
                  </>
                ) : (
                  /* 3. Conversa com IA Ativa */
                  <>
                    <button
                      onClick={handleTakeover}
                      disabled={isTakingOver}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-meta font-medium text-ellevee-ink-muted hover:text-ellevee-ink hover:bg-ellevee-stone-subtle transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap focus-ring"
                      title="Pausar a IA e assumir o atendimento humano"
                      aria-label="Pausar a IA e assumir o atendimento humano"
                    >
                      {isTakingOver ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <UserCheck className="h-3.5 w-3.5 text-ellevee-sage-strong" />
                      )}
                      <span>Assumir Conversa</span>
                    </button>

                    <button
                      onClick={handleCloseConversation}
                      disabled={isClosing}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-meta font-medium text-ellevee-sage-strong hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap focus-ring"
                      title="Finalizar atendimento"
                      aria-label="Finalizar atendimento"
                    >
                      {isClosing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 text-ellevee-sage-strong" />
                      )}
                      <span>Encerrar</span>
                    </button>
                  </>
                )}

                {/* Botão Perfil (ChatPro: 👤 perfil) */}
                <button
                  onClick={() => setIsProfileOpen((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-meta font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    isProfileOpen
                      ? "bg-ellevee-ink text-white shadow-2xs"
                      : "text-ellevee-sage-strong hover:text-ellevee-ink hover:bg-ellevee-stone-subtle"
                  }`}
                  title={isProfileOpen ? "Ocultar perfil do cliente" : "Ver perfil e notas do cliente"}
                >
                  <User className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Perfil</span>
                </button>
              </div>
            </header>

            {/* Histórico de Mensagens: Fundo Warm Ivory (#F3F2ED) */}
            <section className="flex-1 overflow-y-auto scroll-slim p-4 sm:p-6 bg-ellevee-ivory space-y-4">
              <div className="max-w-3xl mx-auto space-y-4">
                {loadingMessages ? (
                  <div className="flex flex-col items-center justify-center p-10 text-ellevee-sage-strong space-y-3">
                    <Loader2 className="h-6 w-6 animate-spin text-ellevee-ink" />
                    <p className="text-meta">Carregando histórico…</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-10 text-center space-y-2">
                    <div className="h-12 w-12 rounded-full bg-white border border-ellevee-stone flex items-center justify-center">
                      <MessageSquare className="h-5 w-5 stroke-1 text-ellevee-sage-strong" />
                    </div>
                    <p className="text-sm font-medium text-ellevee-ink">Nenhuma mensagem registrada</p>
                    <p className="text-meta text-ellevee-sage-strong max-w-[280px] leading-relaxed">
                      Esta conversa ainda não possui histórico. Envie a primeira mensagem para começar.
                    </p>
                  </div>
                ) : (
                  messageFeed.map((msg) => {
                    // Separador de dia (Hoje / Ontem / data completa)
                    if ((msg as any).sender_type === "__divider__") {
                      return (
                        <div key={msg.id} className="flex justify-center py-1">
                          <span className="text-meta font-mono uppercase tracking-[0.12em] text-ellevee-sage-strong bg-white border border-ellevee-stone rounded-full px-2.5 py-0.5 shadow-2xs">
                            {msg.content}
                          </span>
                        </div>
                      )
                    }

                    const isCustomer = msg.sender_type === "customer"
                    const isSystem = msg.sender_type === "system" || msg.message_type === "event"
                    const isInternalNote = msg.message_type === "internal_note" || msg.metadata?.is_internal
                    const isAgent = msg.sender_type === "agent" || msg.sender_type === "human"
                    const isIA = msg.sender_type === "ia" || msg.sender_type === "bot"

                    // Mensagem de Evento do Sistema (Handoff / Devolução / Encerramento)
                    if (isSystem) {
                      return (
                        <div key={msg.id} className="flex justify-center my-3">
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-meta font-medium bg-white text-ellevee-ink border border-ellevee-stone shadow-2xs max-w-md text-center msg-bubble-system">
                            <Sparkles className="h-3.5 w-3.5 text-ellevee-accent shrink-0" />
                            <span>{msg.content}</span>
                          </div>
                        </div>
                      )
                    }

                    // Mensagem de Nota Interna da Equipe (Fase 2)
                    if (isInternalNote) {
                      return (
                        <div key={msg.id} className="flex justify-center my-3">
                          <div className="w-full max-w-xl bg-ellevee-note-bg border border-ellevee-note-border rounded-xl p-3.5 shadow-2xs">
                            <div className="flex items-center justify-between border-b border-ellevee-note-border/70 pb-1.5 mb-2">
                              <div className="flex items-center gap-1.5 text-meta font-semibold text-ellevee-note-strong">
                                <Lock className="h-3.5 w-3.5 text-ellevee-note-accent" />
                                <span>Nota Interna</span>
                                <span className="text-meta font-normal text-ellevee-note-accent">
                                  • {msg.metadata?.operator_name || "Equipe"}
                                </span>
                              </div>
                              <span className="text-meta font-mono text-ellevee-note-accent">
                                {formatTime(msg.created_at)}
                              </span>
                            </div>
                            <p className="text-meta text-ellevee-note-text whitespace-pre-wrap leading-relaxed">
                              {msg.content}
                            </p>
                            <div className="mt-1.5 text-meta text-ellevee-note-accent/70 italic flex items-center gap-1">
                              <span>Privado • Visível apenas para atendentes internos (não enviado ao WhatsApp)</span>
                            </div>
                          </div>
                        </div>
                      )
                    }

                    // Mensagem de Cliente (Alinhada à Esquerda)
                    if (isCustomer) {
                      return (
                        <div key={msg.id} className="group flex flex-col items-start space-y-1">
                          <span className="text-meta text-ellevee-sage-strong px-1 font-mono">
                            {activeConversation.customers?.name || "Cliente"}
                          </span>
                          <div className="max-w-[85%] sm:max-w-md msg-bubble msg-bubble-in rounded-tl-sm transition-shadow duration-200 hover:shadow-md">
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                            <div className="flex justify-end items-center gap-1 mt-1 text-meta text-ellevee-sage-strong font-mono opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                              <span>{formatTime(msg.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    }

                    // Mensagens de Saída: IA (Deep Ink com acento) ou Atendente Humano (Emerald suave)
                    return (
                      <div key={msg.id} className="group flex flex-col items-end space-y-1">
                        <span className="text-meta text-ellevee-sage-strong px-1 font-mono flex items-center gap-1">
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
                          className={`max-w-[85%] sm:max-w-md msg-bubble rounded-tr-sm transition-shadow duration-200 hover:shadow-md ${
                            isAgent
                              ? "msg-bubble-in border-emerald-300 ring-1 ring-emerald-500/20"
                              : "msg-bubble-out"
                          }`}
                        >
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                          <div
                            className={`flex justify-end items-center gap-1.5 mt-1 text-meta font-mono ${
                              isAgent ? "text-ellevee-sage-strong" : "text-white/70"
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
                <div className="flex items-center gap-2 text-ellevee-sage-strong">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="text-meta font-semibold text-ellevee-ink">
                    Este atendimento foi finalizado.
                  </span>
                  <span className="text-meta text-ellevee-sage-strong hidden sm:inline">
                    O histórico está preservado.
                  </span>
                </div>

                <button
                  onClick={handleReopenConversation}
                  disabled={isReopening}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-meta font-semibold bg-ellevee-ink hover:bg-black text-white transition-colors cursor-pointer disabled:opacity-50 shadow-2xs focus-ring"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>{isReopening ? "Reabrindo..." : "Reabrir Atendimento"}</span>
                </button>
              </footer>
            ) : (
              <footer className="border-t border-ellevee-stone px-4 py-3 bg-white shrink-0">
                <div className="max-w-3xl mx-auto space-y-2">
                  {/* Abas de Modo: Mensagem WhatsApp vs Nota Interna */}
                  <div className="flex items-center gap-2 text-meta">
                    <button
                      type="button"
                      onClick={() => setSendMode("whatsapp")}
                      aria-pressed={sendMode === "whatsapp"}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer focus-ring ${
                        sendMode === "whatsapp"
                          ? "bg-ellevee-ink text-white shadow-2xs"
                          : "text-ellevee-sage-strong hover:text-ellevee-ink bg-transparent"
                      }`}
                    >
                      <Send className="h-3 w-3" />
                      <span>Mensagem WhatsApp</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSendMode("note")}
                      aria-pressed={sendMode === "note"}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer focus-ring ${
                        sendMode === "note"
                          ? "bg-ellevee-note-border text-ellevee-note-strong shadow-2xs border border-ellevee-note-border-strong"
                          : "text-ellevee-sage-strong hover:text-ellevee-note-strong bg-transparent"
                      }`}
                    >
                      <Lock className="h-3 w-3" />
                      <span>Nota Interna (Equipe)</span>
                    </button>
                  </div>

                  <form onSubmit={handleFormSubmit} className="flex items-end gap-2.5">
                    <div
                      className={`flex-1 relative rounded-lg border transition-all ${
                        sendMode === "note"
                          ? "border-ellevee-note-border-strong bg-ellevee-note-bg focus-within:bg-ellevee-note-bg focus-within:border-ellevee-note-focus focus-within:ring-1 focus-within:ring-ellevee-note-focus"
                          : "border-ellevee-stone bg-ellevee-stone-subtle focus-within:bg-white focus-within:border-ellevee-ink focus-within:ring-1 focus-within:ring-ellevee-ink"
                      }`}
                    >
                      <textarea
                        ref={textareaRef}
                        rows={sendMode === "note" ? 2 : 1}
                        value={inputContent}
                        onChange={(e) => setInputContent(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isSending || isSendingInternalNote}
                        placeholder={
                          sendMode === "note"
                            ? "Adicione uma nota interna sobre este atendimento (visível apenas para sua equipe)..."
                            : "Digite uma mensagem como operador humano... (Enter para enviar, Shift+Enter para nova linha)"
                        }
                        aria-label={sendMode === "note" ? "Escrever nota interna" : "Escrever mensagem para o cliente"}
                        className="w-full resize-none bg-transparent px-3.5 py-2.5 text-sm text-ellevee-ink placeholder:text-ellevee-sage-strong/70 focus:outline-none min-h-[44px] max-h-32 disabled:opacity-50"
                      />
                    </div>

                    {sendMode === "note" ? (
                      <button
                        type="submit"
                        disabled={isSendingInternalNote || !inputContent.trim()}
                        className="h-11 px-4 rounded-lg bg-ellevee-note-accent hover:bg-ellevee-note-strong text-white transition-colors flex items-center justify-center gap-1.5 font-semibold text-meta focus-ring disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-2xs cursor-pointer font-sans"
                        title="Salvar nota interna nesta conversa"
                        aria-label="Salvar nota interna nesta conversa"
                      >
                        {isSendingInternalNote ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin text-white" />
                            <span className="hidden sm:inline">Salvando...</span>
                          </>
                        ) : (
                          <>
                            <Lock className="h-4 w-4" />
                            <span className="hidden sm:inline">Salvar Nota</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={isSending || !inputContent.trim()}
                        className="h-11 px-4 rounded-lg bg-ellevee-ink hover:bg-black text-white transition-colors flex items-center justify-center gap-1.5 font-semibold text-meta disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-2xs cursor-pointer font-sans focus-ring"
                        title="Enviar mensagem para o cliente (Outbox idempotente)"
                        aria-label="Enviar mensagem para o cliente"
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
                    )}
                  </form>
                </div>
              </footer>
            )}
          </div>

          {/* PAINEL LATERAL RETRÁTIL: PERFIL DO CLIENTE (Fase 2) */}
          {isProfileOpen && (
            <aside className="w-80 lg:w-96 border-l border-ellevee-stone bg-white h-full flex flex-col shrink-0 overflow-y-auto scroll-slim z-40 fixed lg:static inset-y-0 right-0 shadow-2xl lg:shadow-none">
              {/* Header do Drawer */}
              <div className="p-4 border-b border-ellevee-stone flex items-center justify-between bg-ellevee-stone-subtle">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-ellevee-ink" />
                  <h3 className="font-semibold text-meta uppercase tracking-wider text-ellevee-ink">
                    Perfil do Cliente
                  </h3>
                </div>
                <button
                  onClick={() => setIsProfileOpen(false)}
                  className="p-1 rounded-md text-ellevee-sage-strong hover:text-ellevee-ink hover:bg-ellevee-stone-subtle transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ellevee-ink/40"
                  title="Fechar painel"
                  aria-label="Fechar painel do cliente"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Conteúdo do Drawer com Scroll */}
              <div className="p-4 space-y-5 flex-1">
                {/* Card de Identificação */}
                <div className="flex items-center gap-3 p-3 rounded-xl bg-ellevee-stone-subtle border border-ellevee-stone">
                  {customerForm.avatar_url || activeConversation.customers?.avatar_url ? (
                    <img
                      src={customerForm.avatar_url || activeConversation.customers?.avatar_url || ""}
                      alt={customerForm.name || "Cliente"}
                      referrerPolicy="no-referrer"
                      className="h-11 w-11 rounded-full object-cover border border-ellevee-stone shrink-0"
                    />
                  ) : (
                    <div className="h-11 w-11 rounded-full bg-ellevee-ink text-white flex items-center justify-center font-bold text-sm shrink-0">
                      {(customerForm.name || "C").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-meta text-ellevee-ink truncate">
                      {customerForm.name || "Cliente Sem Nome"}
                    </h4>
                    <p className="text-meta text-ellevee-sage-strong font-mono truncate">
                      {customerForm.phone || activeConversation.external_id || "Sem telefone"}
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-meta text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-medium mt-1">
                      <WhatsAppIcon className="h-2.5 w-2.5 text-emerald-600" />
                      WhatsApp
                    </span>
                  </div>
                </div>

                {/* Formulário de Edição de Dados */}
                <form onSubmit={handleSaveCustomer} className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-meta font-semibold uppercase tracking-wider text-ellevee-sage-strong">
                      Dados Cadastrais
                    </span>
                    {isLoadingCustomer && (
                      <Loader2 className="h-3 w-3 animate-spin text-ellevee-sage-strong" />
                    )}
                  </div>

                  {/* Nome */}
                  <div className="space-y-1">
                    <label className="text-meta font-medium text-ellevee-ink flex items-center gap-1">
                      <User className="h-3 w-3 text-ellevee-sage-strong" />
                      Nome Completo
                    </label>
                    <input
                      type="text"
                      value={customerForm.name}
                      onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                      placeholder="Nome do cliente"
                      className="w-full text-sm px-3 py-2.5 rounded-lg border border-ellevee-stone bg-ellevee-stone-subtle focus:bg-white focus:outline-none focus:border-ellevee-ink focus:ring-1 focus:ring-ellevee-ink text-ellevee-ink"
                    />
                  </div>

                  {/* Telefone / WhatsApp */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-meta font-medium text-ellevee-ink flex items-center gap-1">
                        <Phone className="h-3 w-3 text-ellevee-sage-strong" />
                        WhatsApp / Telefone
                      </label>
                      {customerForm.phone && (
                        <a
                          href={`https://wa.me/${customerForm.phone.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-meta text-emerald-700 hover:underline"
                        >
                          Abrir no WhatsApp
                        </a>
                      )}
                    </div>
                    <input
                      type="text"
                      value={customerForm.phone}
                      onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                      placeholder="Ex: 5511999999999"
                      className="w-full text-sm px-3 py-2.5 rounded-lg border border-ellevee-stone bg-ellevee-stone-subtle focus:bg-white focus:outline-none focus:border-ellevee-ink focus:ring-1 focus:ring-ellevee-ink text-ellevee-ink font-mono"
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-1">
                    <label className="text-meta font-medium text-ellevee-ink flex items-center gap-1">
                      <Mail className="h-3 w-3 text-ellevee-sage-strong" />
                      E-mail
                    </label>
                    <input
                      type="email"
                      value={customerForm.email}
                      onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                      placeholder="cliente@email.com"
                      className="w-full text-sm px-3 py-2.5 rounded-lg border border-ellevee-stone bg-ellevee-stone-subtle focus:bg-white focus:outline-none focus:border-ellevee-ink focus:ring-1 focus:ring-ellevee-ink text-ellevee-ink"
                    />
                  </div>

                  {/* Endereço */}
                  <div className="space-y-1">
                    <label className="text-meta font-medium text-ellevee-ink flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-ellevee-sage-strong" />
                      Endereço Completo
                    </label>
                    <textarea
                      rows={2}
                      value={customerForm.address}
                      onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                      placeholder="Rua, Número, Complemento, Bairro, Cidade - UF"
                      className="w-full text-sm px-3 py-2.5 rounded-lg border border-ellevee-stone bg-ellevee-stone-subtle focus:bg-white focus:outline-none focus:border-ellevee-ink focus:ring-1 focus:ring-ellevee-ink text-ellevee-ink resize-none"
                    />
                  </div>

                  {/* Observações Gerais */}
                  <div className="space-y-1">
                    <label className="text-meta font-medium text-ellevee-ink flex items-center gap-1">
                      <FileText className="h-3 w-3 text-ellevee-sage-strong" />
                      Observações do Cliente
                    </label>
                    <textarea
                      rows={3}
                      value={customerForm.notes}
                      onChange={(e) => setCustomerForm({ ...customerForm, notes: e.target.value })}
                      placeholder="Preferências, histórico de compras, observações cadastrais..."
                      className="w-full text-sm px-3 py-2.5 rounded-lg border border-ellevee-stone bg-ellevee-stone-subtle focus:bg-white focus:outline-none focus:border-ellevee-ink focus:ring-1 focus:ring-ellevee-ink text-ellevee-ink resize-none"
                    />
                  </div>

                  {/* Botão Salvar Perfil */}
                  <button
                    type="submit"
                    disabled={isSavingCustomer}
                    className="w-full h-9 rounded-lg bg-ellevee-ink hover:bg-black text-white font-semibold text-meta flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-50 focus-ring"
                  >
                    {isSavingCustomer ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-ellevee-accent" />
                        <span>Salvando Perfil...</span>
                      </>
                    ) : (
                      <>
                        <Save className="h-3.5 w-3.5" />
                        <span>Salvar Alterações</span>
                      </>
                    )}
                  </button>
                </form>

                {/* Divisor */}
                <hr className="border-ellevee-stone" />

                {/* Seção de Notas Internas no Drawer */}
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wider text-ellevee-sage-strong">
                    <Lock className="h-3.5 w-3.5 text-ellevee-note-accent" />
                    <span>Notas Internas da Equipe</span>
                  </div>

                  {/* Inserção rápida de nota no drawer */}
                  <div className="space-y-1.5">
                    <textarea
                      rows={2}
                      value={quickNoteContent}
                      onChange={(e) => setQuickNoteContent(e.target.value)}
                      placeholder="Adicionar nota rápida sobre este atendimento..."
                      aria-label="Escrever nota rápida sobre este atendimento"
                      className="w-full text-meta px-3 py-2 rounded-lg border border-ellevee-note-border-strong bg-ellevee-note-bg text-ellevee-note-text placeholder:text-ellevee-note-accent/60 focus:outline-none focus:border-ellevee-note-focus focus:ring-1 focus:ring-ellevee-note-focus resize-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleCreateInternalNote(quickNoteContent)}
                      disabled={isSavingQuickNote || !quickNoteContent.trim()}
                      className="w-full h-8 rounded-lg bg-ellevee-note-accent hover:bg-ellevee-note-strong text-white font-semibold text-meta flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-40 focus-ring"
                    >
                      {isSavingQuickNote ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Registrando...</span>
                        </>
                      ) : (
                        <>
                          <StickyNote className="h-3.5 w-3.5" />
                          <span>Adicionar Nota</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Lista de Notas Recentes na Conversa */}
                  <div className="space-y-2 pt-1 max-h-56 overflow-y-auto">
                    {internalNotes.length === 0 ? (
                      <p className="text-meta text-ellevee-sage-strong italic text-center py-2">
                        Nenhuma nota interna registrada nesta conversa.
                      </p>
                    ) : (
                      internalNotes.map((n) => (
                        <div
                          key={n.id}
                          className="p-2.5 rounded-lg bg-ellevee-note-bg border border-ellevee-note-border text-meta text-ellevee-note-text space-y-1"
                        >
                          <div className="flex items-center justify-between text-meta text-ellevee-note-accent">
                            <span className="font-semibold">{n.metadata?.operator_name || "Atendente"}</span>
                            <span className="font-mono">{formatTime(n.created_at)}</span>
                          </div>
                          <p className="whitespace-pre-wrap">{n.content}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </aside>
          )}
        </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-ellevee-sage-strong space-y-3">
            <MessageSquare className="h-10 w-10 stroke-1 text-ellevee-sage-strong/50" />
            <h3 className="font-display font-semibold text-sm text-ellevee-ink">Nenhuma conversa selecionada</h3>
            <p className="text-meta max-w-xs text-ellevee-sage-strong">
              Selecione uma conversa na barra lateral para visualizar o histórico de mensagens e monitorar eventos em tempo real.
            </p>
            <button
              type="button"
              onClick={() => setIsListOpen(true)}
              className="lg:hidden mt-2 inline-flex items-center gap-2 h-9 px-3 rounded-md bg-ellevee-ink text-white text-meta font-medium shadow-2xs focus-ring"
            >
              <Menu className="h-4 w-4" />
              <span>Ver conversas</span>
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

"use client"

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { MessageSquare, Menu } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "@/components/ui/toast"
import { 
  ConversationData, 
  MessageData, 
  UserProfileContext,
  UploadMediaResult,
  CloseReason,
  QuickReply,
  getConversationMessages,
  getConversationsList,
  sendMessageAction,
  takeoverConversationAction,
  returnToAIAction,
  closeConversationAction,
  reopenConversationAction,
  getCustomerDetailsAction,
  updateCustomerProfileAction,
  createInternalNoteAction,
  uploadChatMediaAction,
  sendMediaMessageAction,
  startNewConversationAction,
  markConversationAsReadAction,
  WorkflowStageOption,
  updateConversationStageAction
} from "../actions"
import {
  CONVERSATIONS_DESKTOP_BREAKPOINT_PX,
  isFeedNearBottom,
  resolveMobileChatVisibility,
} from "@/lib/ui/conversations-viewport"
import { useVisualViewport } from "@/lib/ui/use-visual-viewport"
import { shouldAutoOpenInspector } from "@/lib/ui/conversations-quote-card"
import { resolveConversationStageColor } from "@/lib/ui/conversations-list"
import {
  isStaleConversationLoad,
  mergeRealtimeInsertedMessage,
  reconcileOptimisticMessage,
  validateAttachmentFile,
} from "@/lib/ui/conversations-composer"
import {
  type CustomerProfileDraft,
  applyConfirmedCustomerUpdate,
  areInternalNotesEqual,
} from "@/lib/ui/conversations-inspector"
import { ConversationListPane } from "./conversation-list-pane"
import { ConversationHeader } from "./conversation-header"
import { ConversationMessageStream } from "./conversation-message-stream"
import { ConversationComposer } from "./conversation-composer"
import { ConversationCustomerInspector } from "./conversation-customer-inspector"
import {
  ConversationCloseDialog,
  ConversationImageLightbox,
  ConversationStageDialog,
} from "./conversation-lifecycle-dialogs"
import { ConversationNewChatDialog } from "./conversation-new-chat-dialog"

interface PainelClientProps {
  initialConversations: ConversationData[]
  initialMessages: MessageData[]
  initialSelectedId?: string | null
  hasExplicitSelection?: boolean
  currentUser?: UserProfileContext | null
  initialCloseReasons?: CloseReason[]
  requireCloseReason?: boolean
  initialQuickReplies?: QuickReply[]
  initialWorkflowStages?: WorkflowStageOption[]
}

export default function PainelClient({
  initialConversations,
  initialMessages,
  initialSelectedId = null,
  hasExplicitSelection = false,
  currentUser = null,
  initialCloseReasons = [],
  requireCloseReason = false,
  initialQuickReplies = [],
  initialWorkflowStages = [],
}: PainelClientProps) {
  // 1. Estados locais de conversas e mensagens
  const [conversations, setConversations] = useState<ConversationData[]>(initialConversations)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [messages, setMessages] = useState<MessageData[]>(initialMessages)

  // 1.1. Motivos de Finalização (Close Reasons)
  const [closeReasons] = useState<CloseReason[]>(initialCloseReasons)
  const [companyRequireCloseReason] = useState<boolean>(Boolean(requireCloseReason))
  const [isCloseReasonModalOpen, setIsCloseReasonModalOpen] = useState(false)

  // 1.2. Mensagens Rápidas (Quick Replies)
  const [quickReplies] = useState<QuickReply[]>(initialQuickReplies)

  // 1.3. Etapas de Workflow / Etiquetas
  const [workflowStages, setWorkflowStages] = useState<WorkflowStageOption[]>(initialWorkflowStages || [])
  const [isStageModalOpen, setIsStageModalOpen] = useState(false)
  const [isChangingStage, setIsChangingStage] = useState(false)

  useEffect(() => {
    if (initialWorkflowStages && initialWorkflowStages.length > 0) {
      setWorkflowStages(initialWorkflowStages)
    }
  }, [initialWorkflowStages])
  
  // 2. Estados de navegação e filtros (Nova Taxonomia corporativa)
  const isMasterOrAdmin = currentUser?.role === "master" || currentUser?.role === "admin"
  const contextGuard = useMemo(() => {
    if (!currentUser?.isImpersonating) return undefined
    return {
      expectedCompanyId: currentUser.companyId,
      expectedSessionId: currentUser.sessionId,
    }
  }, [currentUser?.isImpersonating, currentUser?.companyId, currentUser?.sessionId])
  const [loadingMessages, setLoadingMessages] = useState(false)
  // Controla sincronização inicial da pilha mobile pós-hidratação sem divergence SSR
  const [mobileInitialized, setMobileInitialized] = useState(false)
  const isMobileMountDoneRef = useRef(false)

  // Em smartphones e tablets (< 1024px), inicia sempre na lista de conversas (estilo WhatsApp mobile),
  // a menos que um ID específico tenha sido passado explicitamente na URL (ex: ?id=xxx)
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (window.innerWidth < CONVERSATIONS_DESKTOP_BREAKPOINT_PX) {
        const params = new URLSearchParams(window.location.search)
        if (!params.get("id")) {
          shouldSkipInitialMobileAutoReadRef.current = true
          selectedIdRef.current = null
          setSelectedId(null)
          setMessages([])
          isMobileMountDoneRef.current = true
          setMobileInitialized(true)
          window.dispatchEvent(new CustomEvent("ellevee:chat-selection-change", { detail: { hasSelection: false } }))
          return
        }
      }
      isMobileMountDoneRef.current = true
      setMobileInitialized(true)
      window.dispatchEvent(new CustomEvent("ellevee:chat-selection-change", { detail: { hasSelection: Boolean(selectedId) } }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  
  // 3. Estados de envio de mensagem e Ações de Ciclo de Vida (Fase 1)
  const [isUploadingMedia, setIsUploadingMedia] = useState(false)
  const [isUploadingAudio, setIsUploadingAudio] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isSendingInternalNote, setIsSendingInternalNote] = useState(false)
  const [isTakingOver, setIsTakingOver] = useState(false)
  const [isReturningToAI, setIsReturningToAI] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [isReopening, setIsReopening] = useState(false)
  // FASE 4 — Confirmação em dois passos para ação destrutiva (encerrar).
  const [confirmClose, setConfirmClose] = useState(false)

  // Lightbox Modal para visualização ampliada de imagem
  const [previewImage, setPreviewImage] = useState<{ url: string; fileName?: string } | null>(null)

  // Modal de Nova Conversa Ativa
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false)
  const [isStartingNewChat, setIsStartingNewChat] = useState(false)

  // 4. Estados do Inspector (Fase 2 / UI-02 / UI-03.5)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<"profile" | "notes">("profile")
  useEffect(() => {
    if (typeof window === "undefined") return
    const frameId = window.requestAnimationFrame(() => {
      if (shouldAutoOpenInspector(window.innerWidth)) {
        setIsProfileOpen(true)
      }
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [])
  const handleOpenPreview = useCallback((url: string, fileName?: string) => {
    setPreviewImage({ url, fileName })
  }, [])
  const handleClosePreview = useCallback(() => {
    setPreviewImage(null)
  }, [])
  const [isSavingCustomer, setIsSavingCustomer] = useState(false)
  const [isSavingQuickNote, setIsSavingQuickNote] = useState(false)

  // 5. Efeito visual para quando uma conversa receber atualização em tempo real
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null)
  const [isRealtimeActive, setIsRealtimeActive] = useState(false)

  // Referências para scroll restrito ao feed e sincronização de leitura / concorrência
  const feedContainerRef = useRef<HTMLElement | null>(null)
  const isUserNearBottomRef = useRef(true)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const viewportMetrics = useVisualViewport()
  const selectedIdRef = useRef<string | null>(selectedId)
  const conversationsRef = useRef<ConversationData[]>(conversations)
  const messagesRef = useRef<MessageData[]>(messages)
  const markReadSeqRef = useRef(0)
  const loadMessagesSeqRef = useRef(0)
  const convLastMarkedSeqRef = useRef<Record<string, number>>({})
  const inFlightMarkReadRef = useRef<Record<string, number>>({})
  const needsReMarkReadRef = useRef<Record<string, boolean>>({})
  const lastHandledSelectionRef = useRef<string | null>(null)
  const shouldSkipInitialMobileAutoReadRef = useRef(false)
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lifecycleBusyRef = useRef(false)
  const stageChangingRef = useRef(false)
  const sendingLockRef = useRef(false)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId]
  )

  // Notas internas com estabilidade referencial (mensagens comuns via Realtime não re-renderizam o Inspector)
  const internalNotesCacheRef = useRef<MessageData[]>([])
  const internalNotes = useMemo(() => {
    const next = messages.filter(
      (m) => m.message_type === "internal_note" || m.metadata?.is_internal
    )
    if (areInternalNotesEqual(internalNotesCacheRef.current, next)) {
      return internalNotesCacheRef.current
    }
    internalNotesCacheRef.current = next
    return next
  }, [messages])

  // Cliente público do navegador para subscrição WebSocket (sem chave service_role)
  const supabase = useMemo(() => createClient(), [])

  const markConversationAsRead = useCallback((convId: string) => {
    if (!convId) return

    if (inFlightMarkReadRef.current[convId]) {
      if (selectedIdRef.current === convId && (typeof document === "undefined" || !document.hidden)) {
        needsReMarkReadRef.current[convId] = true
      }
      return
    }

    const run = async (targetId: string) => {
      const seqStart = ++markReadSeqRef.current
      inFlightMarkReadRef.current[targetId] = seqStart
      convLastMarkedSeqRef.current[targetId] = seqStart

      setConversations((prev) => {
        const target = prev.find((c) => c.id === targetId)
        if (!target || (target.unread_count || 0) === 0) return prev
        return prev.map((c) => (c.id === targetId ? { ...c, unread_count: 0 } : c))
      })

      try {
        await markConversationAsReadAction(targetId)
      } catch (err) {
        console.error("[Chat] Falha ao marcar conversa como lida:", err)
      } finally {
        const seqEnd = ++markReadSeqRef.current
        convLastMarkedSeqRef.current[targetId] = seqEnd
        if (inFlightMarkReadRef.current[targetId] === seqStart) {
          delete inFlightMarkReadRef.current[targetId]
        }
        if (
          needsReMarkReadRef.current[targetId] &&
          selectedIdRef.current === targetId &&
          (typeof document === "undefined" || !document.hidden)
        ) {
          delete needsReMarkReadRef.current[targetId]
          void run(targetId)
        } else {
          delete needsReMarkReadRef.current[targetId]
        }
      }
    }

    void run(convId)
  }, [])

  // Marca a conversa automaticamente como lida na abertura inicial (desktop / ?id=) e ao iniciar nova conversa
  useEffect(() => {
    if (!selectedId) return

    if (
      !isMobileMountDoneRef.current &&
      typeof window !== "undefined" &&
      window.innerWidth < CONVERSATIONS_DESKTOP_BREAKPOINT_PX &&
      !hasExplicitSelection
    ) {
      return
    }

    if (shouldSkipInitialMobileAutoReadRef.current) {
      shouldSkipInitialMobileAutoReadRef.current = false
      return
    }

    if (lastHandledSelectionRef.current === selectedId) {
      return
    }

    if (typeof document !== "undefined" && document.hidden) return

    lastHandledSelectionRef.current = selectedId
    markConversationAsRead(selectedId)
  }, [selectedId, markConversationAsRead, hasExplicitSelection])

  // Se o operador voltar para a aba/janela com uma conversa aberta que recebeu mensagens em segundo plano
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (typeof document !== "undefined" && document.hidden) return
      const currentId = selectedIdRef.current
      if (!currentId) return
      const currentConv = conversationsRef.current.find((c) => c.id === currentId)
      if (currentConv && (currentConv.unread_count || 0) > 0) {
        markConversationAsRead(currentId)
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityOrFocus)
    window.addEventListener("focus", handleVisibilityOrFocus)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus)
      window.removeEventListener("focus", handleVisibilityOrFocus)
    }
  }, [markConversationAsRead])

  const handleFeedScroll = useCallback(() => {
    const scroller = feedContainerRef.current
    if (!scroller) return
    isUserNearBottomRef.current = isFeedNearBottom({
      scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
    })
  }, [])

  const scrollToBottom = useCallback((smooth = true) => {
    isUserNearBottomRef.current = true
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const scroller = feedContainerRef.current ?? messagesEndRef.current?.closest("section")
        if (!scroller) return
        scroller.scrollTo({
          top: scroller.scrollHeight,
          behavior: smooth ? "smooth" : "auto",
        })
      })
    })
  }, [])

  const scrollToBottomIfPinned = useCallback(
    (smooth = true) => {
      if (!isUserNearBottomRef.current) return
      scrollToBottom(smooth)
    },
    [scrollToBottom]
  )

  // Mantém a posição ancorada no rodapé do feed apenas quando o teclado abre e o usuário já estava no final
  useEffect(() => {
    if (!viewportMetrics.isKeyboardOpen || !isUserNearBottomRef.current) return
    const rafId = window.requestAnimationFrame(() => {
      const scroller = feedContainerRef.current
      if (!scroller) return
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" })
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [viewportMetrics.isKeyboardOpen, viewportMetrics.effectiveHeight])

  // Efeito inicial para rolar até o final da conversa
  useEffect(() => {
    scrollToBottom(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // =========================================================================
  // SUB-SCRIÇÃO REALTIME: Mensagens da Conversa Ativa
  // =========================================================================
  useEffect(() => {
    if (!selectedId || currentUser?.isImpersonating) return

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
          setMessages((prev) => mergeRealtimeInsertedMessage(prev, newMsg))

          const isTabVisible = typeof document === "undefined" || !document.hidden
          const shouldClearUnreadNow = newMsg.sender_type === "customer" && isTabVisible

          setConversations((prev) =>
            prev.map((c) =>
              c.id === selectedId
                ? {
                    ...c,
                    last_message_at: newMsg.created_at || new Date().toISOString(),
                    last_message_preview: newMsg.content || c.last_message_preview,
                    unread_count: shouldClearUnreadNow ? 0 : c.unread_count,
                  }
                : c
            ).sort(
              (a, b) =>
                new Date(b.last_message_at || 0).getTime() -
                new Date(a.last_message_at || 0).getTime()
            )
          )

          if (shouldClearUnreadNow) {
            markConversationAsRead(selectedId)
          }

          scrollToBottomIfPinned(true)
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
  }, [selectedId, supabase, markConversationAsRead, currentUser?.isImpersonating, scrollToBottomIfPinned])

  // =========================================================================
  // SUB-SCRIÇÃO REALTIME: Lista de Conversas (Atualizações de status / nova msg)
  // =========================================================================
  useEffect(() => {
    if (currentUser?.isImpersonating) return

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
          const prevConv = conversationsRef.current.find((c) => c.id === updated.id)
          const isActiveAndVisible =
            updated.id === selectedIdRef.current &&
            (typeof document === "undefined" || !document.hidden)
          const isPendingMarkRead = Boolean(inFlightMarkReadRef.current[updated.id])

          const isMarkReadOnlyUpdate =
            Boolean(prevConv) &&
            updated.unread_count === 0 &&
            prevConv?.unread_count !== 0 &&
            updated.last_message_at === prevConv?.last_message_at &&
            updated.status === prevConv?.status &&
            updated.assigned_to === prevConv?.assigned_to

          // Evita pulsar verde quando for apenas confirmação do próprio markAsRead ou conversa aberta na tela
          if (!isActiveAndVisible && !isMarkReadOnlyUpdate) {
            setRecentlyUpdatedId(updated.id)
            if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current)
            pulseTimeoutRef.current = setTimeout(() => setRecentlyUpdatedId(null), 3000)
          }

          const shouldZeroOnActive =
            isActiveAndVisible && typeof updated.unread_count === "number" && updated.unread_count > 0

          const sanitizedUnread =
            isActiveAndVisible || isPendingMarkRead ? 0 : updated.unread_count

          setConversations((prev) => {
            const exists = prev.some((c) => c.id === updated.id)
            if (!exists) return prev

            return prev
              .map((c) =>
                c.id === updated.id
                  ? {
                      ...c,
                      ...updated,
                      unread_count:
                        typeof sanitizedUnread === "number" ? sanitizedUnread : c.unread_count,
                    }
                  : c
              )
              .sort(
                (a, b) =>
                  new Date(b.last_message_at || 0).getTime() -
                  new Date(a.last_message_at || 0).getTime()
              )
          })

          if (shouldZeroOnActive) {
            markConversationAsRead(updated.id)
          }
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
      if (pulseTimeoutRef.current) {
        clearTimeout(pulseTimeoutRef.current)
        pulseTimeoutRef.current = null
      }
      supabase.removeChannel(convChannel)
    }
  }, [supabase, markConversationAsRead, currentUser?.isImpersonating])

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
        const latestMsgs = await getConversationMessages(selectedId, contextGuard)
        if (!isMounted || !latestMsgs) return

        const prevMsgs = messagesRef.current
        const hasNewCustomerMsg = latestMsgs.some(
          (m) => m.sender_type === "customer" && !prevMsgs.some((p) => p.id === m.id)
        )

        setMessages((prev) => {
          // Se lista vazia ou idêntica, evita recriar estado
          if (
            latestMsgs.length === prev.length &&
            latestMsgs[latestMsgs.length - 1]?.id === prev[prev.length - 1]?.id
          ) {
            return prev
          }

          // Se chegou mensagem nova vinda do cliente WhatsApp, rola apenas se o usuário já estava no final
          const hasNew = latestMsgs.some((m) => !prev.some((p) => p.id === m.id))
          if (hasNew) {
            scrollToBottomIfPinned(true)
          }

          return latestMsgs
        })

        if (hasNewCustomerMsg && typeof document !== "undefined" && !document.hidden) {
          markConversationAsRead(selectedId)
        }
      } catch {
        // Silencioso em caso de oscilação momentânea
      }
    }, 3500)

    return () => {
      isMounted = false
      clearInterval(pollMessagesInterval)
    }
  }, [selectedId, markConversationAsRead, scrollToBottomIfPinned])

  // 2. Sincroniza a lista de conversas e contadores das abas a cada 8 segundos
  useEffect(() => {
    let isMounted = true

    const pollListInterval = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return

      try {
        const pollStartVersion = markReadSeqRef.current
        const updatedList = await getConversationsList(contextGuard)
        if (!isMounted || !updatedList || updatedList.length === 0) return

        const activeId = selectedIdRef.current
        const isVisible = typeof document === "undefined" || !document.hidden
        let shouldMarkActiveRead = false

        const normalizedList = updatedList.map((u) => {
          const isActiveAndVisible = Boolean(activeId && u.id === activeId && isVisible)
          if (isActiveAndVisible && (u.unread_count || 0) > 0) {
            shouldMarkActiveRead = true
          }

          const markedDuringOrAfterPoll =
            Boolean(inFlightMarkReadRef.current[u.id]) ||
            (convLastMarkedSeqRef.current[u.id] || 0) > pollStartVersion

          if (isActiveAndVisible || markedDuringOrAfterPoll) {
            return { ...u, unread_count: 0 }
          }
          return u
        })

        if (shouldMarkActiveRead && activeId) {
          markConversationAsRead(activeId)
        }

        setConversations((prev) => {
          const hasDiff =
            normalizedList.length !== prev.length ||
            normalizedList[0]?.id !== prev[0]?.id ||
            normalizedList[0]?.last_message_at !== prev[0]?.last_message_at ||
            normalizedList.some((u) => {
              const p = prev.find((x) => x.id === u.id)
              return (
                !p ||
                p.status !== u.status ||
                p.unread_count !== u.unread_count ||
                p.workflow_stage_id !== u.workflow_stage_id ||
                p.workflow_stage_name !== u.workflow_stage_name ||
                p.workflow_stage_color !== u.workflow_stage_color ||
                p.customers?.avatar_url !== u.customers?.avatar_url
              )
            })

          if (!hasDiff) return prev
          return normalizedList
        })
      } catch {
        // Silencioso
      }
    }, 8000)

    return () => {
      isMounted = false
      clearInterval(pollListInterval)
    }
  }, [markConversationAsRead])

  // =========================================================================
  // TROCA DE CONVERSA (referência estável para preservação de memoização da lista)
  // =========================================================================
  const handleSelectConversation = useCallback(
    async (convId: string) => {
      if (convId === selectedIdRef.current) {
        const current = conversationsRef.current.find((c) => c.id === convId)
        if (current && (current.unread_count || 0) > 0) {
          markConversationAsRead(convId)
        }
        return
      }

      const requestSeq = ++loadMessagesSeqRef.current
      lastHandledSelectionRef.current = convId
      selectedIdRef.current = convId
      isUserNearBottomRef.current = true
      setSelectedId(convId)
      setConfirmClose(false)
      setIsProfileOpen(false)
      setLoadingMessages(true)
      markConversationAsRead(convId)

      try {
        const msgs = await getConversationMessages(convId, contextGuard)
        if (
          !isStaleConversationLoad({
            activeConversationId: selectedIdRef.current,
            requestConversationId: convId,
            activeSeq: loadMessagesSeqRef.current,
            requestSeq,
          })
        ) {
          setMessages(msgs)
          scrollToBottom(false)
        }
      } catch (err: unknown) {
        console.error("[Chat] Falha ao carregar mensagens:", err)
        toast.error("Erro ao carregar mensagens", "Não foi possível sincronizar o histórico.")
      } finally {
        if (
          !isStaleConversationLoad({
            activeConversationId: selectedIdRef.current,
            requestConversationId: convId,
            activeSeq: loadMessagesSeqRef.current,
            requestSeq,
          })
        ) {
          setLoadingMessages(false)
        }
      }
    },
    [contextGuard, markConversationAsRead, scrollToBottom]
  )

  const handleOpenNewChat = useCallback(() => {
    setIsNewChatModalOpen(true)
  }, [])

  // =========================================================================
  // ENVIO DE MENSAGEM PELO OPERADOR (Outbox Idempotente)
  // =========================================================================
  const handleSendTextMessage = useCallback(
    async (targetConvId: string, rawText: string): Promise<boolean> => {
      const trimmed = rawText.trim()
      if (!trimmed || !targetConvId || sendingLockRef.current) return false

      const targetConv = conversationsRef.current.find((c) => c.id === targetConvId)
      if (targetConv?.status === "closed") {
        toast.error("Conversa Encerrada", "Reabra o atendimento antes de enviar novas mensagens.")
        return false
      }

      sendingLockRef.current = true
      setIsSending(true)

      const clientMessageId = crypto.randomUUID()
      const tempId = `temp-${clientMessageId}`
      const attendantName =
        (currentUser?.userName?.trim() || "Atendente").split(/\s+/)[0] || "Atendente"
      const prefix = `*Atendente ${attendantName}:*\n`
      const optimisticContent = trimmed.startsWith("*Atendente") ? trimmed : `${prefix}${trimmed}`

      const optimisticMsg: MessageData = {
        id: tempId,
        conversation_id: targetConvId,
        sender_type: "agent",
        sender_id: currentUser?.userId || null,
        content: optimisticContent,
        message_type: "text",
        metadata: {
          delivery_status: "pending",
          client_message_id: clientMessageId,
          operator_name: attendantName,
          raw_text: trimmed,
        },
        created_at: new Date().toISOString(),
      }

      if (selectedIdRef.current === targetConvId) {
        setMessages((prev) => [...prev, optimisticMsg])
        scrollToBottom(true)
      }

      try {
        const result = await sendMessageAction(targetConvId, trimmed, clientMessageId, contextGuard)

        if (result?.success) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === targetConvId && (c.unread_count || 0) > 0
                ? { ...c, unread_count: 0 }
                : c
            )
          )
          if (selectedIdRef.current === targetConvId) {
            setMessages((prev) =>
              reconcileOptimisticMessage(prev, tempId, result.messageId, {
                delivery_status: "sent",
              })
            )
          }
          return true
        }

        toast.error(
          "Falha no Envio",
          result?.error || "Não foi possível registrar a mensagem na fila."
        )
        if (selectedIdRef.current === targetConvId) {
          setMessages((prev) =>
            reconcileOptimisticMessage(prev, tempId, undefined, {
              delivery_status: "failed",
            })
          )
        }
        return false
      } catch (err: unknown) {
        console.error("[Chat] Exceção ao enviar mensagem:", err)
        const message = err instanceof Error ? err.message : "Falha na comunicação com o servidor."
        toast.error("Erro inesperado", message)
        if (selectedIdRef.current === targetConvId) {
          setMessages((prev) =>
            reconcileOptimisticMessage(prev, tempId, undefined, {
              delivery_status: "failed",
            })
          )
        }
        return false
      } finally {
        sendingLockRef.current = false
        setIsSending(false)
      }
    },
    [contextGuard, currentUser?.userId, currentUser?.userName, scrollToBottom]
  )

  const handleRetryMessage = useCallback(
    async (failedMsg: MessageData) => {
      const targetConvId = failedMsg.conversation_id || selectedIdRef.current
      if (!targetConvId || sendingLockRef.current) return
      const rawText =
        (typeof failedMsg.metadata?.raw_text === "string" && failedMsg.metadata.raw_text.trim()) ||
        failedMsg.content.replace(/^\*Atendente[^*]*:\*\n?/, "").trim()
      if (!rawText) return

      const clientMessageId =
        (typeof failedMsg.metadata?.client_message_id === "string" &&
          failedMsg.metadata.client_message_id) ||
        crypto.randomUUID()

      sendingLockRef.current = true
      if (selectedIdRef.current === targetConvId) {
        setMessages((prev) =>
          reconcileOptimisticMessage(prev, failedMsg.id, undefined, {
            delivery_status: "pending",
            client_message_id: clientMessageId,
          })
        )
      }

      try {
        const result = await sendMessageAction(targetConvId, rawText, clientMessageId, contextGuard)
        if (result?.success) {
          if (selectedIdRef.current === targetConvId) {
            setMessages((prev) =>
              reconcileOptimisticMessage(prev, failedMsg.id, result.messageId, {
                delivery_status: "sent",
              })
            )
          }
        } else {
          toast.error("Falha no Reenvio", result?.error || "Não foi possível reenviar a mensagem.")
          if (selectedIdRef.current === targetConvId) {
            setMessages((prev) =>
              reconcileOptimisticMessage(prev, failedMsg.id, undefined, {
                delivery_status: "failed",
              })
            )
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Falha na comunicação com o servidor."
        toast.error("Erro inesperado", message)
        if (selectedIdRef.current === targetConvId) {
          setMessages((prev) =>
            reconcileOptimisticMessage(prev, failedMsg.id, undefined, {
              delivery_status: "failed",
            })
          )
        }
      } finally {
        sendingLockRef.current = false
      }
    },
    [contextGuard]
  )

  // =========================================================================
  // MELHORIA 2: UPLOAD E ENVIO DE ANEXOS DE MÍDIA (Imagem, Áudio, Documento)
  // =========================================================================
  /**
   * Otimiza fotos de smartphone/câmera antes do envio via HTML5 Canvas.
   * Reduz imagens pesadas (ex: 8MB a 12MB de câmera móvel) para ~250KB - 400KB
   * sem perda perceptível de qualidade, evitando limitações de payload e acelerando o envio no celular.
   */
  const compressImageIfNeeded = useCallback(async (file: File): Promise<File> => {
    if (!file.type.match(/^image\/(jpeg|jpg|png|webp)$/i)) {
      return file
    }
    if (file.size <= 800 * 1024) {
      return file
    }

    try {
      return await new Promise<File>((resolve) => {
        const img = new Image()
        const objectUrl = URL.createObjectURL(file)

        img.onload = () => {
          URL.revokeObjectURL(objectUrl)
          const MAX_DIM = 1920
          let { width, height } = img

          if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) {
              height = Math.round((height * MAX_DIM) / width)
              width = MAX_DIM
            } else {
              width = Math.round((width * MAX_DIM) / height)
              height = MAX_DIM
            }
          }

          const canvas = document.createElement("canvas")
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext("2d")
          if (!ctx) {
            resolve(file)
            return
          }

          ctx.fillStyle = "#FFFFFF"
          ctx.fillRect(0, 0, width, height)
          ctx.drawImage(img, 0, 0, width, height)

          canvas.toBlob(
            (blob) => {
              if (!blob || blob.size >= file.size) {
                resolve(file)
                return
              }
              const cleanName = file.name.replace(/\.[^.]+$/, "") + ".jpg"
              const compressedFile = new File([blob], cleanName, {
                type: "image/jpeg",
                lastModified: Date.now(),
              })
              resolve(compressedFile)
            },
            "image/jpeg",
            0.82
          )
        }

        img.onerror = () => {
          URL.revokeObjectURL(objectUrl)
          resolve(file)
        }

        img.src = objectUrl
      })
    } catch {
      return file
    }
  }, [])

  /**
   * Realiza upload de mídia com fallback resiliente:
   * 1. Comprime imagem se necessário
   * 2. Tenta Route Handler dedicado /api/chat/upload
   * 3. Se falhar, tenta Server Action uploadChatMediaAction
   * 4. Retorna sempre objeto seguro { success: boolean, url?: string, error?: string } sem envio parcial
   */
  const uploadMediaFile = useCallback(
    async (rawFile: File): Promise<UploadMediaResult> => {
      let fileToUpload = rawFile
      try {
        fileToUpload = await compressImageIfNeeded(rawFile)
      } catch (optErr) {
        console.warn("[Upload] Fallback para arquivo original:", optErr)
      }

      const formData = new FormData()
      formData.append("file", fileToUpload)

      try {
        const uploadHeaders: Record<string, string> = {}
        if (contextGuard?.expectedCompanyId) {
          uploadHeaders["x-expected-company-id"] = contextGuard.expectedCompanyId
        }
        if (contextGuard?.expectedSessionId) {
          uploadHeaders["x-expected-session-id"] = contextGuard.expectedSessionId
        }

        const response = await fetch("/api/chat/upload", {
          method: "POST",
          headers: uploadHeaders,
          body: formData,
        })

        if (response.ok) {
          const json = await response.json()
          if (json?.url) {
            return {
              success: true,
              url: json.url,
              fileName: json.fileName || fileToUpload.name,
              fileType: json.fileType || fileToUpload.type,
              fileSize: json.fileSize || fileToUpload.size,
            }
          }
        } else {
          const errorData = await response.json().catch(() => null)
          console.warn("[Upload] Route Handler retornou status:", response.status, errorData)
        }
      } catch (fetchErr) {
        console.warn("[Upload] Fetch /api/chat/upload falhou, tentando Server Action:", fetchErr)
      }

      try {
        const actionRes = await uploadChatMediaAction(formData, contextGuard)
        if (actionRes?.success && actionRes?.url) {
          return actionRes
        }
        return {
          success: false,
          error: actionRes?.error || "Não foi possível carregar o arquivo no servidor.",
        }
      } catch (actionErr: unknown) {
        console.error("[Upload] Server Action falhou:", actionErr)
        const message = actionErr instanceof Error ? actionErr.message : "Erro de rede ao enviar arquivo."
        return {
          success: false,
          error: message,
        }
      }
    },
    [compressImageIfNeeded, contextGuard]
  )

  const handleSendAttachedFile = useCallback(
    async (
      targetConvId: string,
      fileToSend: File,
      caption: string,
      previewUrl: string | null
    ): Promise<boolean> => {
      if (!targetConvId || !fileToSend || sendingLockRef.current) return false

      const validation = validateAttachmentFile(fileToSend)
      if (!validation.ok) {
        toast.error("Arquivo inválido", validation.error)
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        return false
      }

      sendingLockRef.current = true
      setIsUploadingMedia(true)

      const attendantName = (currentUser?.userName || "Atendente").split(/\s+/)[0] || "Atendente"
      const clientMessageId = crypto.randomUUID()
      const tempId = `temp-media-${clientMessageId}`
      const mediaType = validation.mediaType

      const optimisticMsg: MessageData = {
        id: tempId,
        conversation_id: targetConvId,
        sender_type: "agent",
        sender_id: currentUser?.userId || null,
        content: caption
          ? `*Atendente ${attendantName}:*\n${caption}`
          : `*Atendente ${attendantName}:*\n[${
              mediaType === "image"
                ? "Imagem"
                : mediaType === "audio"
                ? "Mensagem de Voz"
                : "Documento"
            }]`,
        message_type: mediaType,
        metadata: {
          delivery_status: "pending",
          client_message_id: clientMessageId,
          operator_name: attendantName,
          media_url: previewUrl || undefined,
          file_name: fileToSend.name,
          media_type: mediaType,
        },
        created_at: new Date().toISOString(),
      }

      if (selectedIdRef.current === targetConvId) {
        setMessages((prev) => [...prev, optimisticMsg])
        scrollToBottom(true)
      }

      try {
        const uploadRes = await uploadMediaFile(fileToSend)
        if (!uploadRes?.success || !uploadRes?.url) {
          throw new Error(uploadRes?.error || "Falha no upload do arquivo.")
        }

        const sendRes = await sendMediaMessageAction({
          conversationId: targetConvId,
          mediaUrl: uploadRes.url,
          mediaType,
          fileName: fileToSend.name,
          caption: caption || undefined,
          clientMessageId,
          contextGuard,
        })

        if (sendRes?.success) {
          if (selectedIdRef.current === targetConvId) {
            setMessages((prev) =>
              reconcileOptimisticMessage(prev, tempId, sendRes.messageId, {
                delivery_status: "sent",
                media_url: uploadRes.url,
              })
            )
          }
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          return true
        }

        toast.error("Falha no Envio", sendRes?.error || "Não foi possível enviar a mídia.")
        if (selectedIdRef.current === targetConvId) {
          setMessages((prev) =>
            reconcileOptimisticMessage(prev, tempId, undefined, {
              delivery_status: "failed",
            })
          )
        }
        return false
      } catch (err: unknown) {
        console.error("[Chat] Falha no envio de mídia:", err)
        const message = err instanceof Error ? err.message : "Erro ao processar arquivo."
        toast.error("Erro no Envio", message)
        if (selectedIdRef.current === targetConvId) {
          setMessages((prev) =>
            reconcileOptimisticMessage(prev, tempId, undefined, {
              delivery_status: "failed",
            })
          )
        }
        return false
      } finally {
        sendingLockRef.current = false
        setIsUploadingMedia(false)
      }
    },
    [contextGuard, currentUser?.userId, currentUser?.userName, scrollToBottom, uploadMediaFile]
  )

  // =========================================================================
  // MELHORIA 4: ENVIO DE ÁUDIO GRAVADO (Captura gerenciada no Composer)
  // =========================================================================
  const handleSendRecordedAudio = useCallback(
    async (targetConvId: string, audioBlob: Blob, mimeType: string): Promise<boolean> => {
      if (!targetConvId || sendingLockRef.current) return false

      if (audioBlob.size < 400) {
        toast.info("Áudio muito curto", "Gravação descartada por ter duração insuficiente.")
        return false
      }

      sendingLockRef.current = true
      setIsUploadingAudio(true)

      const extension = mimeType.includes("ogg")
        ? "ogg"
        : mimeType.includes("mp4")
        ? "m4a"
        : "webm"
      const audioFileName = `audio-${Date.now()}.${extension}`
      const audioFile = new File([audioBlob], audioFileName, {
        type: audioBlob.type || mimeType || "audio/webm",
      })

      const attendantName = (currentUser?.userName || "Atendente").split(/\s+/)[0] || "Atendente"
      const clientMessageId = crypto.randomUUID()
      const tempId = `temp-audio-${clientMessageId}`
      const localAudioUrl = URL.createObjectURL(audioBlob)

      const optimisticMsg: MessageData = {
        id: tempId,
        conversation_id: targetConvId,
        sender_type: "agent",
        sender_id: currentUser?.userId || null,
        content: `*Atendente ${attendantName}:*\n[Mensagem de Voz]`,
        message_type: "audio",
        metadata: {
          delivery_status: "pending",
          client_message_id: clientMessageId,
          operator_name: attendantName,
          media_url: localAudioUrl,
          file_name: audioFileName,
          media_type: "audio",
        },
        created_at: new Date().toISOString(),
      }

      if (selectedIdRef.current === targetConvId) {
        setMessages((prev) => [...prev, optimisticMsg])
        scrollToBottom(true)
      }

      try {
        const uploadRes = await uploadMediaFile(audioFile)
        if (!uploadRes?.success || !uploadRes?.url) {
          throw new Error(uploadRes?.error || "Falha ao fazer upload da gravação de áudio.")
        }

        const sendRes = await sendMediaMessageAction({
          conversationId: targetConvId,
          mediaUrl: uploadRes.url,
          mediaType: "audio",
          fileName: audioFileName,
          clientMessageId,
          contextGuard,
        })

        if (sendRes?.success) {
          if (selectedIdRef.current === targetConvId) {
            setMessages((prev) =>
              reconcileOptimisticMessage(prev, tempId, sendRes.messageId, {
                delivery_status: "sent",
                media_url: uploadRes.url,
              })
            )
          }
          URL.revokeObjectURL(localAudioUrl)
          return true
        }

        toast.error("Falha no Envio de Áudio", sendRes?.error || "Não foi possível enviar o áudio.")
        if (selectedIdRef.current === targetConvId) {
          setMessages((prev) =>
            reconcileOptimisticMessage(prev, tempId, undefined, {
              delivery_status: "failed",
            })
          )
        }
        return false
      } catch (err: unknown) {
        console.error("[AudioRecord] Erro ao processar gravação:", err)
        const message = err instanceof Error ? err.message : "Falha ao gravar ou enviar áudio."
        toast.error("Erro no Áudio", message)
        if (selectedIdRef.current === targetConvId) {
          setMessages((prev) =>
            reconcileOptimisticMessage(prev, tempId, undefined, {
              delivery_status: "failed",
            })
          )
        }
        return false
      } finally {
        sendingLockRef.current = false
        setIsUploadingAudio(false)
      }
    },
    [contextGuard, currentUser?.userId, currentUser?.userName, scrollToBottom, uploadMediaFile]
  )

  // =========================================================================
  // FASE 2: CRIAÇÃO DE NOTA INTERNA (Estritamente privada, nunca enviada ao WhatsApp)
  // =========================================================================
  const handleCreateInternalNote = useCallback(
    async (targetConvId: string, rawText: string, fromInspector = false): Promise<boolean> => {
      const text = rawText.trim()
      if (!targetConvId || !text || sendingLockRef.current) return false

      sendingLockRef.current = true
      setIsSendingInternalNote(true)
      if (fromInspector) setIsSavingQuickNote(true)

      try {
        const res = await createInternalNoteAction({
          conversationId: targetConvId,
          content: text,
        })

        if (res?.success && res?.message) {
          if (selectedIdRef.current === targetConvId) {
            setMessages((prev) => mergeRealtimeInsertedMessage(prev, res.message!))
            scrollToBottom(true)
          }
          toast.success("Nota Salva", "A anotação interna foi registrada na conversa.")
          return true
        }

        toast.error("Erro ao salvar nota", res?.error || "Falha ao registrar nota.")
        return false
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Falha ao registrar nota."
        toast.error("Erro inesperado", message)
        return false
      } finally {
        sendingLockRef.current = false
        setIsSendingInternalNote(false)
        if (fromInspector) setIsSavingQuickNote(false)
      }
    },
    [scrollToBottom]
  )

  const handleSendComposerInternalNote = useCallback(
    (targetConvId: string, text: string) => handleCreateInternalNote(targetConvId, text, false),
    [handleCreateInternalNote]
  )

  const handleCreateInspectorNote = useCallback(
    (targetConvId: string, text: string) => handleCreateInternalNote(targetConvId, text, true),
    [handleCreateInternalNote]
  )

  // =========================================================================
  // FASE 2: ALTERAÇÃO DE ETAPA / ETIQUETA DO FUNIL (aguarda confirmação do servidor)
  // =========================================================================
  const handleChangeConversationStage = useCallback(
    async (newStageId: string) => {
      const targetId = selectedIdRef.current
      if (!targetId || !newStageId || stageChangingRef.current) return

      const currentConv = conversationsRef.current.find((c) => c.id === targetId)
      if (currentConv?.workflow_stage_id === newStageId) {
        setIsStageModalOpen(false)
        return
      }

      const targetStage = workflowStages.find((s) => s.id === newStageId)
      if (!targetStage) return

      stageChangingRef.current = true
      setIsChangingStage(true)

      try {
        const res = await updateConversationStageAction(targetId, targetStage.id, contextGuard)
        if (!res.success) {
          toast.error("Erro ao alterar etiqueta", res.error || "Não foi possível mover a conversa.")
        } else {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === targetId
                ? {
                    ...c,
                    workflow_stage_id: targetStage.id,
                    workflow_stage_name: targetStage.name,
                    workflow_stage_color: targetStage.color || null,
                  }
                : c
            )
          )
          setIsStageModalOpen(false)
          toast.success("Etiqueta atualizada", `Conversa movida para "${targetStage.name}".`)
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Falha ao atualizar etiqueta."
        toast.error("Erro inesperado", message)
      } finally {
        stageChangingRef.current = false
        setIsChangingStage(false)
      }
    },
    [contextGuard, workflowStages]
  )

  // =========================================================================
  // FASE 2: CARREGAR E SALVAR PERFIL DO CLIENTE (aguarda confirmação do servidor)
  // =========================================================================
  const handleLoadCustomerDetails = useCallback((customerId: string) => {
    return getCustomerDetailsAction(customerId)
  }, [])

  const handleSaveCustomerProfile = useCallback(
    async (params: {
      conversationId: string
      customerId: string
      draft: CustomerProfileDraft
    }): Promise<boolean> => {
      const targetConv = conversationsRef.current.find((c) => c.id === params.conversationId)
      const targetCustId =
        params.customerId || targetConv?.customer_id || targetConv?.customers?.id || ""

      if (!targetCustId) {
        toast.error("Erro", "Cliente não identificado nesta conversa.")
        return false
      }

      setIsSavingCustomer(true)

      try {
        const res = await updateCustomerProfileAction({
          customerId: targetCustId,
          name: params.draft.name,
          phone: params.draft.phone,
          email: params.draft.email,
          address: params.draft.address,
          notes: params.draft.notes,
        })

        if (res?.success) {
          setConversations((prev) =>
            applyConfirmedCustomerUpdate(prev, params.conversationId, targetCustId, {
              name: params.draft.name,
              phone: params.draft.phone,
              email: params.draft.email,
              address: params.draft.address,
              notes: params.draft.notes,
            })
          )

          if (res.pendingMigration) {
            toast.success(
              "Dados salvos!",
              "Nome, telefone e email atualizados. (Para salvar endereço e notas, aplique o script SQL no Supabase)."
            )
          } else {
            toast.success(
              "Perfil atualizado!",
              "As informações do cliente foram salvas com sucesso."
            )
          }
          return true
        }

        toast.error("Erro ao salvar", res?.error || "Não foi possível atualizar o perfil.")
        return false
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Falha ao salvar dados do cliente."
        toast.error("Erro inesperado", message)
        return false
      } finally {
        setIsSavingCustomer(false)
      }
    },
    []
  )

  // =========================================================================
  // CICLO DE VIDA: 1. ASSUMIR ATENDIMENTO (TRANSBORDO HUMANO)
  // =========================================================================
  const handleTakeover = useCallback(async () => {
    const targetId = selectedIdRef.current
    if (!targetId || lifecycleBusyRef.current) return

    lifecycleBusyRef.current = true
    setIsTakingOver(true)
    try {
      const result = await takeoverConversationAction(targetId, contextGuard)

      if (result?.success) {
        toast.success(
          "Atendimento Assumido!",
          "A IA foi pausada e a conversa agora está atribuída a você."
        )

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetId
              ? { ...c, status: "human", assigned_to: currentUser?.userId || null, unread_count: 0 }
              : c
          )
        )

        const takeoverEventMsg: MessageData = {
          id: `temp-takeover-${Date.now()}`,
          conversation_id: targetId,
          sender_type: "system",
          content: `Atendimento assumido por ${currentUser?.userName || "operador"}. A IA foi pausada nesta conversa.`,
          message_type: "event",
          metadata: { event: "conversation.takeover" },
          created_at: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, takeoverEventMsg])
        scrollToBottom(true)
      } else {
        toast.error("Erro ao assumir conversa", result?.error || "Falha na transferência.")
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Falha ao assumir atendimento."
      toast.error("Erro inesperado", message)
    } finally {
      lifecycleBusyRef.current = false
      setIsTakingOver(false)
    }
  }, [contextGuard, currentUser?.userId, currentUser?.userName, scrollToBottom])

  // =========================================================================
  // CICLO DE VIDA: 2. DEVOLVER PARA O AGENTE IA (COM NOME DINÂMICO)
  // =========================================================================
  const handleReturnToAI = useCallback(async () => {
    const targetId = selectedIdRef.current
    if (!targetId || lifecycleBusyRef.current) return

    lifecycleBusyRef.current = true
    setIsReturningToAI(true)
    const currentAgentName =
      conversationsRef.current.find((c) => c.id === targetId)?.agent_name || "IA"

    try {
      const result = await returnToAIAction(targetId, contextGuard)

      if (result?.success) {
        const resolvedName = result.agentName || currentAgentName
        toast.success(
          "Devolvido para a IA!",
          `O atendimento foi transferido e o agente ${resolvedName} está ativo novamente.`
        )

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetId
              ? { ...c, status: "open", assigned_to: null, agent_name: resolvedName, unread_count: 0 }
              : c
          )
        )

        const resumeEventMsg: MessageData = {
          id: `temp-resume-${Date.now()}`,
          conversation_id: targetId,
          sender_type: "system",
          content: `Atendimento devolvido para ${resolvedName}. O agente autônomo está ativo novamente.`,
          message_type: "event",
          metadata: { event: "conversation.ai_resume", agent_name: resolvedName },
          created_at: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, resumeEventMsg])
        scrollToBottom(true)
      } else {
        toast.error("Erro ao devolver para IA", result?.error || "Falha na operação.")
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Falha ao devolver para IA."
      toast.error("Erro inesperado", message)
    } finally {
      lifecycleBusyRef.current = false
      setIsReturningToAI(false)
    }
  }, [contextGuard, scrollToBottom])

  // =========================================================================
  // CICLO DE VIDA: 3. ENCERRAR ATENDIMENTO (FINALIZAR TICKET)
  // =========================================================================
  const handleCloseConversation = useCallback(
    async (reasonIdParam?: string | null, notesParam?: string): Promise<boolean> => {
      const targetId = selectedIdRef.current
      if (!targetId || lifecycleBusyRef.current) return false

      const targetReasonId = reasonIdParam ?? null
      const reasonObj = closeReasons.find((r) => r.id === targetReasonId)
      const reasonTitle = reasonObj?.title || null
      const notes = (notesParam ?? "").trim()

      if (companyRequireCloseReason && !targetReasonId && !reasonTitle) {
        toast.error(
          "Motivo Obrigatório",
          "Por favor, selecione um motivo para finalizar este atendimento."
        )
        return false
      }

      lifecycleBusyRef.current = true
      setIsClosing(true)
      try {
        const result = await closeConversationAction(
          targetId,
          {
            reasonId: targetReasonId,
            reasonText: reasonTitle,
            closedNotes: notes || null,
          },
          contextGuard
        )

        if (result?.success) {
          toast.success(
            "Atendimento Encerrado",
            reasonTitle
              ? `Conversa finalizada • Motivo: "${reasonTitle}".`
              : "A conversa foi finalizada com sucesso e movida para Finalizados."
          )

          setConversations((prev) =>
            prev.map((c) =>
              c.id === targetId
                ? { ...c, status: "closed", closed_at: new Date().toISOString(), unread_count: 0 }
                : c
            )
          )

          const reasonSuffix = reasonTitle ? ` • Motivo: ${reasonTitle}` : ""
          const notesSuffix = notes ? ` (${notes})` : ""

          const closeEventMsg: MessageData = {
            id: `temp-close-${Date.now()}`,
            conversation_id: targetId,
            sender_type: "system",
            content: `Atendimento encerrado por ${currentUser?.userName || "operador"}${reasonSuffix}${notesSuffix}.`,
            message_type: "event",
            metadata: {
              event: "conversation.closed",
              close_reason: reasonTitle,
              closed_notes: notes,
            },
            created_at: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, closeEventMsg])
          scrollToBottom(true)
          setConfirmClose(false)
          setIsCloseReasonModalOpen(false)
          return true
        }

        toast.error("Erro ao encerrar", result?.error || "Falha ao finalizar conversa.")
        return false
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Falha ao encerrar conversa."
        toast.error("Erro inesperado", message)
        return false
      } finally {
        lifecycleBusyRef.current = false
        setIsClosing(false)
      }
    },
    [
      closeReasons,
      companyRequireCloseReason,
      contextGuard,
      currentUser?.userName,
      scrollToBottom,
    ]
  )

  // =========================================================================
  // CICLO DE VIDA: 4. REABRIR ATENDIMENTO ENCERRADO
  // =========================================================================
  const handleReopenConversation = useCallback(async () => {
    const targetId = selectedIdRef.current
    if (!targetId || lifecycleBusyRef.current) return

    lifecycleBusyRef.current = true
    setIsReopening(true)
    try {
      const result = await reopenConversationAction(targetId, contextGuard)

      if (result?.success) {
        toast.success(
          "Atendimento Reaberto",
          "A conversa foi reaberta com sucesso e atribuída a você."
        )

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetId
              ? {
                  ...c,
                  status: "human",
                  assigned_to: currentUser?.userId || null,
                  closed_at: null,
                  unread_count: 0,
                }
              : c
          )
        )

        const reopenEventMsg: MessageData = {
          id: `temp-reopen-${Date.now()}`,
          conversation_id: targetId,
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Falha ao reabrir conversa."
      toast.error("Erro inesperado", message)
    } finally {
      lifecycleBusyRef.current = false
      setIsReopening(false)
    }
  }, [contextGuard, currentUser?.userId, currentUser?.userName, scrollToBottom])

  // =========================================================================
  // CICLO DE VIDA: 5. INICIAR NOVA CONVERSA ATIVA (DO PAINEL PARA O WHATSAPP)
  // =========================================================================
  const handleStartNewChat = useCallback(
    async (params: {
      phone: string
      name?: string
      initialMessage?: string
    }): Promise<boolean> => {
      if (!params.phone.trim() || lifecycleBusyRef.current) return false

      lifecycleBusyRef.current = true
      setIsStartingNewChat(true)
      try {
        const res = await startNewConversationAction({
          phone: params.phone.trim(),
          name: params.name?.trim() || undefined,
          initialMessage: params.initialMessage?.trim() || undefined,
        })

        if (res?.success && res?.conversationId) {
          toast.success("Conversa Iniciada!", "Atendimento aberto com sucesso.")
          setIsNewChatModalOpen(false)

          const updatedList = await getConversationsList(contextGuard)
          if (updatedList && updatedList.length > 0) {
            setConversations(updatedList)
          }
          setSelectedId(res.conversationId)
          return true
        }

        toast.error(
          "Erro ao iniciar conversa",
          res?.error || "Não foi possível abrir o atendimento."
        )
        return false
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Falha ao iniciar conversa."
        toast.error("Erro inesperado", message)
        return false
      } finally {
        lifecycleBusyRef.current = false
        setIsStartingNewChat(false)
      }
    },
    [contextGuard]
  )

  // =========================================================================
  // FASE 1 — NAVEGACAO MOBILE EM PILHA (Padrao WhatsApp Web)
  // Abaixo de `lg` o painel funciona como app de celular: uma tela por vez.
  // Sem selecao -> so a lista; com selecao -> so a conversa. O botao de voltar
  // do cabecalho limpa a selecao e retorna para a lista.
  // =========================================================================
  const hasSelection = Boolean(selectedId)
  const showChatOnMobile = resolveMobileChatVisibility({
    hasSelection,
    hasExplicitSelection,
    mobileInitialized,
  })

  useEffect(() => {
    if (typeof window !== "undefined" && isMobileMountDoneRef.current) {
      window.dispatchEvent(
        new CustomEvent("ellevee:chat-selection-change", {
          detail: { hasSelection: showChatOnMobile },
        })
      )
    }
  }, [showChatOnMobile])

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ellevee:chat-selection-change", { detail: { hasSelection: false } }))
      }
    }
  }, [])

  const handleBackToList = useCallback(() => {
    lastHandledSelectionRef.current = null
    selectedIdRef.current = null
    isUserNearBottomRef.current = true
    setSelectedId(null)
    setConfirmClose(false)
    setIsProfileOpen(false)
    setLoadingMessages(false)
    setMessages([])
  }, [])

  const handleOpenProfile = useCallback(() => {
    setInspectorTab("profile")
    setIsProfileOpen(true)
  }, [])

  const handleOpenNotes = useCallback(() => {
    setInspectorTab("notes")
    setIsProfileOpen(true)
  }, [])

  const handleToggleInspector = useCallback(() => {
    setIsProfileOpen((v) => !v)
  }, [])

  const handleCloseInspector = useCallback(() => {
    setIsProfileOpen(false)
  }, [])

  const handleOpenStageModal = useCallback(() => {
    setIsStageModalOpen(true)
  }, [])

  const handleCloseStageModal = useCallback(() => {
    setIsStageModalOpen(false)
  }, [])

  const handleOpenCloseModal = useCallback(() => {
    setIsCloseReasonModalOpen(true)
  }, [])

  const handleCloseCloseModal = useCallback(() => {
    setIsCloseReasonModalOpen(false)
  }, [])

  const handleCloseNewChatModal = useCallback(() => {
    setIsNewChatModalOpen(false)
  }, [])

  const handleComposerFocus = useCallback(() => {
    if (typeof window === "undefined" || window.innerWidth >= CONVERSATIONS_DESKTOP_BREAKPOINT_PX) {
      return
    }
    // Restringe o ajuste de rolagem exclusivamente ao histórico de mensagens e
    // apenas quando o operador já estiver acompanhando as mensagens recentes.
    if (!isUserNearBottomRef.current) return
    window.requestAnimationFrame(() => {
      const scroller = feedContainerRef.current
      if (!scroller) return
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" })
    })
  }, [])

  // =========================================================================
  // FASE 4 — Confirmação em dois passos: o primeiro clique arma a confirmação
  // (rótulo vira "Confirmar encerramento"), o segundo executa. O estado arma
  // expira sozinho para não deixar o atendente em dúvida.
  // =========================================================================
  const requestClose = useCallback(() => {
    if (lifecycleBusyRef.current) return
    // Se a organização exige motivo OU se existem motivos cadastrados, abre o diálogo de seleção
    if (companyRequireCloseReason || closeReasons.length > 0) {
      setIsCloseReasonModalOpen(true)
      return
    }

    if (confirmClose) {
      setConfirmClose(false)
      void handleCloseConversation()
      return
    }
    setConfirmClose(true)
    window.setTimeout(() => setConfirmClose(false), 5000)
  }, [closeReasons.length, companyRequireCloseReason, confirmClose, handleCloseConversation])

  return (
    <div
      className="flex flex-1 min-h-0 w-full bg-ellevee-warm-ivory text-ellevee-deep-ink overflow-hidden font-sans relative"
    >
      {/* =====================================================================
          SIDEBAR: LISTA DE CONVERSAS (Modularizada em UI-03.1)
      ====================================================================== */}
      <ConversationListPane
        conversations={conversations}
        selectedId={selectedId}
        recentlyUpdatedId={recentlyUpdatedId}
        showChatOnMobile={showChatOnMobile}
        isMasterOrAdmin={isMasterOrAdmin}
        currentUserId={currentUser?.userId}
        onSelectConversation={handleSelectConversation}
        onOpenNewChat={handleOpenNewChat}
      />

      {/* =====================================================================
          MAIN: ÁREA DE CHAT (Ellevee Stone Subtle #F8F8F6 + Deep Ink) COM INSPECTOR
      ====================================================================== */}
      <main
        className={`flex-1 flex-row min-h-0 w-full bg-ellevee-stone-subtle overflow-hidden ${
          showChatOnMobile ? "flex" : "hidden lg:flex"
        }`}
      >
        {activeConversation ? (
          <>
            {/* Coluna Central do Chat */}
            <div className="flex-1 basis-0 flex flex-col min-h-0 w-full overflow-hidden min-w-0">
            {/* Header do Chat (Modularizado em UI-03.2) */}
            <ConversationHeader
              contactName={activeConversation.customers?.name || "Cliente Desconhecido"}
              contactAvatarUrl={activeConversation.customers?.avatar_url}
              contactPhone={activeConversation.customers?.phone}
              status={activeConversation.status}
              assignedTo={activeConversation.assigned_to}
              agentName={activeConversation.agent_name}
              workflowStageId={activeConversation.workflow_stage_id}
              workflowStageName={activeConversation.workflow_stage_name}
              workflowStageColor={resolveConversationStageColor(activeConversation)}
              workflowStages={workflowStages}
              currentUserId={currentUser?.userId}
              isProfileOpen={isProfileOpen}
              internalNotesCount={internalNotes.length}
              confirmClose={confirmClose}
              isTakingOver={isTakingOver}
              isReturningToAI={isReturningToAI}
              isClosing={isClosing}
              isReopening={isReopening}
              isChangingStage={isChangingStage}
              onBackToList={handleBackToList}
              onOpenProfile={handleOpenProfile}
              onOpenNotes={handleOpenNotes}
              onToggleInspector={handleToggleInspector}
              onOpenStageModal={handleOpenStageModal}
              onChangeStage={handleChangeConversationStage}
              onTakeover={handleTakeover}
              onReturnToAI={handleReturnToAI}
              onRequestClose={requestClose}
              onOpenCloseModal={handleOpenCloseModal}
              onReopen={handleReopenConversation}
            />

            {/* Histórico de Mensagens (Modularizado em UI-03.3) */}
            <ConversationMessageStream
              messages={messages}
              loadingMessages={loadingMessages}
              contactName={activeConversation.customers?.name || "Cliente"}
              agentName={activeConversation.agent_name}
              feedContainerRef={feedContainerRef}
              messagesEndRef={messagesEndRef}
              onFeedScroll={handleFeedScroll}
              onOpenPreview={handleOpenPreview}
              onRetryMessage={handleRetryMessage}
            />

            {/* Composer de Mensagens / Banner Encerrado (Modularizado em UI-03.4; key isola rascunhos por conversa) */}
            <ConversationComposer
              key={activeConversation.id}
              conversationId={activeConversation.id}
              conversationStatus={activeConversation.status}
              quickReplies={quickReplies}
              quickReplyListMaxHeight={viewportMetrics.quickReplyListMaxHeight}
              isSending={isSending}
              isSendingInternalNote={isSendingInternalNote}
              isUploadingMedia={isUploadingMedia}
              isUploadingAudio={isUploadingAudio}
              isReopening={isReopening}
              onComposerFocus={handleComposerFocus}
              onReopen={handleReopenConversation}
              onSendText={handleSendTextMessage}
              onSendInternalNote={handleSendComposerInternalNote}
              onSendAttachment={handleSendAttachedFile}
              onSendAudio={handleSendRecordedAudio}
            />
          </div>

          {/* Inspector Desktop & Bottom Sheet Mobile (Modularizado em UI-03.5) */}
          <ConversationCustomerInspector
            isOpen={isProfileOpen}
            activeTab={inspectorTab}
            conversationId={activeConversation.id}
            customerId={activeConversation.customer_id || activeConversation.customers?.id || ""}
            customerName={activeConversation.customers?.name}
            customerPhone={activeConversation.customers?.phone}
            customerEmail={activeConversation.customers?.email}
            customerAddress={activeConversation.customers?.address}
            customerNotes={activeConversation.customers?.notes}
            customerAvatarUrl={activeConversation.customers?.avatar_url}
            externalId={activeConversation.external_id}
            workflowStageId={activeConversation.workflow_stage_id}
            workflowStages={workflowStages}
            internalNotes={internalNotes}
            isChangingStage={isChangingStage}
            isSavingCustomer={isSavingCustomer}
            isSavingQuickNote={isSavingQuickNote}
            onSelectTab={setInspectorTab}
            onClose={handleCloseInspector}
            onChangeStage={handleChangeConversationStage}
            onLoadCustomerDetails={handleLoadCustomerDetails}
            onSaveCustomer={handleSaveCustomerProfile}
            onCreateInternalNote={handleCreateInspectorNote}
          />
        </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-ellevee-ink-muted space-y-3">
            <MessageSquare className="h-10 w-10 stroke-1 text-ellevee-ink-muted/50" />
            <h3 className="font-display font-semibold text-sm text-ellevee-ink">Nenhuma conversa selecionada</h3>
            <p className="text-meta max-w-xs text-ellevee-ink-muted">
              Selecione uma conversa na barra lateral para visualizar o histórico de mensagens e monitorar eventos em tempo real.
            </p>
            <button
              type="button"
              onClick={handleBackToList}
              className="lg:hidden mt-2 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-md bg-ellevee-ink text-white text-meta font-medium shadow-2xs focus-ring"
            >
              <Menu className="h-4 w-4" />
              <span>Ver conversas</span>
            </button>
          </div>
        )}
      </main>

      {/* Modais Operacionais e Lightbox (Modularizados em UI-03.5) */}
      <ConversationImageLightbox
        previewImage={previewImage}
        onClose={handleClosePreview}
      />

      <ConversationNewChatDialog
        isOpen={isNewChatModalOpen}
        isStarting={isStartingNewChat}
        onClose={handleCloseNewChatModal}
        onStartNewChat={handleStartNewChat}
      />

      <ConversationCloseDialog
        isOpen={isCloseReasonModalOpen}
        closeReasons={closeReasons}
        requireCloseReason={companyRequireCloseReason}
        isClosing={isClosing}
        onClose={handleCloseCloseModal}
        onConfirmClose={handleCloseConversation}
      />

      <ConversationStageDialog
        isOpen={isStageModalOpen}
        activeStageId={activeConversation?.workflow_stage_id}
        workflowStages={workflowStages}
        isChangingStage={isChangingStage}
        onClose={handleCloseStageModal}
        onSelectStage={handleChangeConversationStage}
      />
    </div>
  )
}

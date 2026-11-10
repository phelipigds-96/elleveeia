"use client"

import React, { useState, useRef, useEffect, useMemo } from "react"
import Link from "next/link"
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
  LayoutGrid,
  ArrowLeft,
  MoreVertical,
  SquarePen,
  Edit,
  Edit2,
  Eye,
  SlidersHorizontal,
  Smile,
  Paperclip,
  Mic,
  Tag,
  Calendar,
  Trash2,
  Play,
  Pause,
  Download,
  ExternalLink,
  Zap,
  HelpCircle,
  ShieldCheck
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "@/components/ui/toast"
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
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
  startNewConversationAction
} from "../actions"
import {
  StatusChip,
  resolveStatusView,
} from "@/components/conversations/conversation-status"

interface PainelClientProps {
  initialConversations: ConversationData[]
  initialMessages: MessageData[]
  initialSelectedId?: string | null
  currentUser?: UserProfileContext | null
  initialCloseReasons?: CloseReason[]
  requireCloseReason?: boolean
  initialQuickReplies?: QuickReply[]
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

function formatPhoneNumber(phone?: string | null): string {
  if (!phone) return ""
  const clean = phone.replace(/\D/g, "")
  if (clean.length === 13 && clean.startsWith("55")) {
    return `+55 (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`
  }
  if (clean.length === 12 && clean.startsWith("55")) {
    return `+55 (${clean.slice(2, 4)}) ${clean.slice(4, 8)}-${clean.slice(8)}`
  }
  if (clean.length === 11) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`
  }
  if (clean.length === 10) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`
  }
  return phone
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


function formatRecordingTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s < 10 ? "0" : ""}${s}`
}


function WhatsAppAudioPlayer({ src, isCustomer }: { src: string; isCustomer?: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }

    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    audio.addEventListener("loadedmetadata", onLoadedMetadata)
    audio.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("ended", onEnded)

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata)
      audio.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("ended", onEnded)
    }
  }, [src])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play().then(() => setIsPlaying(true)).catch((e) => {
        console.error("Audio playback error:", e)
      })
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value)
    setCurrentTime(time)
    if (audioRef.current) {
      audioRef.current.currentTime = time
    }
  }

  const formatSecs = (sec: number) => {
    if (isNaN(sec) || !isFinite(sec)) return "0:00"
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s < 10 ? "0" : ""}${s}`
  }

  return (
    <div className="flex items-center gap-3 py-1.5 px-1 w-full min-w-[240px] max-w-[280px]">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        onClick={togglePlay}
        className="h-9 w-9 rounded-full bg-[#005d4b] hover:bg-[#004738] text-white flex items-center justify-center shrink-0 shadow-xs transition-transform active:scale-95"
        title={isPlaying ? "Pausar áudio" : "Reproduzir áudio"}
      >
        {isPlaying ? (
          <Pause className="h-4 w-4 fill-white text-white" />
        ) : (
          <Play className="h-4 w-4 fill-white text-white ml-0.5" />
        )}
      </button>

      <div className="flex-1 flex flex-col justify-center min-w-0">
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1.5 bg-gray-300 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-[#005d4b]"
        />
        <div className="flex justify-between items-center text-[10px] text-[#54656f] font-mono mt-1 font-medium">
          <span>{formatSecs(currentTime)}</span>
          <span>{duration > 0 ? formatSecs(duration) : "--:--"}</span>
        </div>
      </div>
    </div>
  )
}

function MessageMedia({
  msg,
  isCustomer = false,
  onOpenPreview,
}: {
  msg: MessageData
  isCustomer?: boolean
  onOpenPreview?: (url: string, fileName?: string) => void
}) {
  const mediaUrl =
    msg.metadata?.media_url ||
    (msg as any).media_url ||
    (msg.message_type !== "text" && msg.content?.startsWith("http") ? msg.content : null)

  const mediaType =
    msg.metadata?.media_type ||
    msg.message_type ||
    (mediaUrl?.match(/\.(png|jpe?g|webp|gif)/i)
      ? "image"
      : mediaUrl?.match(/\.(mp3|ogg|wav|m4a|webm)/i)
      ? "audio"
      : mediaUrl?.match(/\.(pdf|docx?|xlsx?)/i)
      ? "document"
      : null)

  if (!mediaUrl && !mediaType) return null

  const fileName = msg.metadata?.file_name || (msg as any).file_name || "arquivo"

  if (mediaType === "image" || (mediaUrl && /\.(png|jpe?g|webp|gif)/i.test(mediaUrl))) {
    return (
      <div className="my-1.5 overflow-hidden rounded-lg">
        <button
          type="button"
          onClick={() => {
            if (onOpenPreview && mediaUrl) {
              onOpenPreview(mediaUrl, fileName)
            } else if (mediaUrl) {
              window.open(mediaUrl, "_blank")
            }
          }}
          className="block group/img cursor-zoom-in text-left focus:outline-none focus:ring-2 focus:ring-emerald-500/50 rounded-lg transition-transform active:scale-[0.99]"
          title="Clique para ampliar na tela"
        >
          <img
            src={mediaUrl}
            alt={fileName || "Imagem"}
            className="max-h-72 w-auto max-w-full rounded-lg object-cover transition-transform group-hover:scale-[1.01]"
            loading="lazy"
          />
        </button>
      </div>
    )
  }

  if (mediaType === "audio" || (mediaUrl && /\.(mp3|ogg|wav|m4a|webm)/i.test(mediaUrl))) {
    return (
      <div className={`my-1 rounded-xl ${
        isCustomer ? "bg-black/5" : "bg-black/5"
      }`}>
        <WhatsAppAudioPlayer src={mediaUrl} isCustomer={isCustomer} />
      </div>
    )
  }

  if (mediaType === "document" || mediaUrl) {
    return (
      <a
        href={mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`my-1.5 p-2.5 rounded-lg flex items-center gap-3 transition-colors ${
          isCustomer ? "bg-black/5 hover:bg-black/10 text-gray-800" : "bg-white/20 hover:bg-white/30 text-white"
        }`}
      >
        <FileText className="h-6 w-6 text-red-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">{fileName}</p>
          <p className="text-[10px] opacity-75">Documento • Clique para abrir</p>
        </div>
      </a>
    )
  }

  return null
}

function getDisplayContent(msg: MessageData): string | null {
  const content = msg.content || ""
  const mediaUrl = msg.metadata?.media_url || (msg as any).media_url

  if (mediaUrl && content.trim() === mediaUrl.trim()) return null

  // Só suprime o texto se a mídia foi realmente carregada (mediaUrl existe)
  if (
    Boolean(mediaUrl) &&
    (content.trim() === "[Imagem]" ||
      content.trim() === "[Mensagem de Voz]" ||
      content.trim().startsWith("[Documento]") ||
      content.endsWith("[Imagem]") ||
      content.endsWith("[Mensagem de Voz]"))
  ) {
    const cleaned = content.replace(/\[(Imagem|Mensagem de Voz|Documento.*?)\]/g, "").trim()
    if (!cleaned || /^(\*Atendente[^*]*:\*|\s)*$/.test(cleaned)) {
      return null
    }
    return cleaned
  }

  return content
}

export default function PainelClient({
  initialConversations,
  initialMessages,
  initialSelectedId = null,
  currentUser = null,
  initialCloseReasons = [],
  requireCloseReason = false,
  initialQuickReplies = [],
}: PainelClientProps) {
  // 1. Estados locais de conversas e mensagens
  const [conversations, setConversations] = useState<ConversationData[]>(initialConversations)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [messages, setMessages] = useState<MessageData[]>(initialMessages)

  // 1.1. Motivos de Finalização (Close Reasons)
  const [closeReasons, setCloseReasons] = useState<CloseReason[]>(initialCloseReasons)
  const [companyRequireCloseReason, setCompanyRequireCloseReason] = useState<boolean>(Boolean(requireCloseReason))
  const [isCloseReasonModalOpen, setIsCloseReasonModalOpen] = useState(false)
  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null)
  const [closeNotes, setCloseNotes] = useState("")

  // 1.2. Mensagens Rápidas (Quick Replies)
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>(initialQuickReplies)
  const [isQuickRepliesOpen, setIsQuickRepliesOpen] = useState(false)
  const [quickReplySearch, setQuickReplySearch] = useState("")
  const [selectedQuickCategory, setSelectedQuickCategory] = useState<string>("TODAS")
  
  // 2. Estados de navegação e filtros (Nova Taxonomia corporativa)
  const isMasterOrAdmin = currentUser?.role === "master" || currentUser?.role === "admin"
  const [activeTab, setActiveTab] = useState<"all" | "waiting" | "in_progress" | "ai" | "closed">(
    isMasterOrAdmin ? "all" : "waiting"
  )
  const [search, setSearch] = useState("")
  const [loadingMessages, setLoadingMessages] = useState(false)
  // Lista de conversas recolhida em telas pequenas (mobile)
  const [isListOpen, setIsListOpen] = useState(false)

  // Em smartphones e telas pequenas (< 1024px), inicia sempre na lista de conversas (estilo WhatsApp mobile),
  // a menos que um ID específico tenha sido passado explicitamente na URL (ex: ?id=xxx)
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      const params = new URLSearchParams(window.location.search)
      if (!params.get("id")) {
        setSelectedId(null)
      }
    }
  }, [])
  
  // 3. Estados de envio de mensagem e Ações de Ciclo de Vida (Fase 1)
  const [inputContent, setInputContent] = useState("")
  // Anexo de Mídia (Melhoria 2)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null)
  const [isUploadingMedia, setIsUploadingMedia] = useState(false)

  // Gravação de Áudio no Navegador (Melhoria 4)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [isUploadingAudio, setIsUploadingAudio] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const [sendMode, setSendMode] = useState<"whatsapp" | "note">("whatsapp")
  const [isSending, setIsSending] = useState(false)
  const [isSendingInternalNote, setIsSendingInternalNote] = useState(false)
  const [isTakingOver, setIsTakingOver] = useState(false)
  const [isReturningToAI, setIsReturningToAI] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [isReopening, setIsReopening] = useState(false)
  // FASE 4 — Confirmação em dois passos para ação destrutiva (encerrar).
  const [confirmClose, setConfirmClose] = useState(false)

  // Lightbox Modal para visualização ampliada de imagem na mesma página (estilo WhatsApp Web)
  const [previewImage, setPreviewImage] = useState<{ url: string; fileName?: string } | null>(null)

  // Modal de Nova Conversa Ativa
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false)
  const [newChatPhone, setNewChatPhone] = useState("")
  const [newChatName, setNewChatName] = useState("")
  const [newChatMessage, setNewChatMessage] = useState("")
  const [isStartingNewChat, setIsStartingNewChat] = useState(false)

  // Fecha o lightbox modal ao pressionar a tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && previewImage) {
        setPreviewImage(null)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [previewImage])

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
      const anchor = messagesEndRef.current
      // Rolagem restrita ao contêiner do histórico: evita que a página inteira
      // (o <main> do layout) role junto e empurre a conversa para baixo.
      const scroller = anchor?.closest("section")
      if (scroller) {
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" })
      } else {
        anchor?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" })
      }
    }, 50)
  }

  // Efeito inicial para rolar até o final da conversa
  useEffect(() => {
    scrollToBottom(false)
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl)
    }
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
          if (res?.success && res?.customer) {
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
                p.workflow_stage_id !== u.workflow_stage_id ||
                p.workflow_stage_name !== u.workflow_stage_name ||
                p.workflow_stage_color !== u.workflow_stage_color ||
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
    setConfirmClose(false)
    setIsProfileOpen(false)
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

      if (result?.success) {
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
        toast.error("Falha no Envio", result?.error || "Não foi possível registrar a mensagem na fila.")
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
      toast.error("Erro inesperado", err?.message || "Falha na comunicação com o servidor.")
    } finally {
      setIsSending(false)
      textareaRef.current?.focus()
    }
  }

  // =========================================================================
  // MELHORIA 2: GESTÃO DE ANEXOS DE MÍDIA (Imagem, Áudio, Documento)
  // =========================================================================
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 20 * 1024 * 1024) {
      toast.error("Arquivo muito grande", "O tamanho máximo permitido é de 20MB.")
      return
    }

    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl)
    }

    setSelectedFile(file)
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file)
      setFilePreviewUrl(url)
    } else {
      setFilePreviewUrl(null)
    }

    e.target.value = ""
  }

  const handleClearSelectedFile = () => {
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl)
    }
    setSelectedFile(null)
    setFilePreviewUrl(null)
  }

  /**
   * Otimiza fotos de smartphone/câmera antes do envio via HTML5 Canvas.
   * Reduz imagens pesadas (ex: 8MB a 12MB de câmera móvel) para ~250KB - 400KB
   * sem perda perceptível de qualidade, evitando limitações de payload e acelerando o envio no celular.
   */
  const compressImageIfNeeded = async (file: File): Promise<File> => {
    if (!file.type.match(/^image\/(jpeg|jpg|png|webp)$/i)) {
      return file
    }
    // Arquivos pequenos (< 800KB) não precisam de compressão
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
  }

  /**
   * Realiza upload de mídia com fallback resiliente:
   * 1. Comprime imagem se necessário
   * 2. Tenta Route Handler dedicado /api/chat/upload
   * 3. Se falhar, tenta Server Action uploadChatMediaAction
   * 4. Retorna sempre objeto seguro { success: boolean, url?: string, error?: string } sem quebrar a execução
   */
  const uploadMediaFile = async (rawFile: File): Promise<UploadMediaResult> => {
    let fileToUpload = rawFile
    try {
      fileToUpload = await compressImageIfNeeded(rawFile)
    } catch (optErr) {
      console.warn("[Upload] Fallback para arquivo original:", optErr)
    }

    const formData = new FormData()
    formData.append("file", fileToUpload)

    // 1ª Tentativa: Route Handler dedicado /api/chat/upload
    try {
      const response = await fetch("/api/chat/upload", {
        method: "POST",
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

    // 2ª Tentativa: Server Action uploadChatMediaAction
    try {
      const actionRes = await uploadChatMediaAction(formData)
      if (actionRes?.success && actionRes?.url) {
        return actionRes
      }
      return {
        success: false,
        error: actionRes?.error || "Não foi possível carregar o arquivo no servidor.",
      }
    } catch (actionErr: any) {
      console.error("[Upload] Server Action falhou:", actionErr)
      return {
        success: false,
        error: actionErr?.message || "Erro de rede ao enviar arquivo.",
      }
    }
  }

  const handleSendAttachedFile = async () => {
    if (!selectedId || !selectedFile || isUploadingMedia) return

    setIsUploadingMedia(true)
    const caption = inputContent.trim()
    const attendantName = (currentUser?.userName || "Atendente").split(/\s+/)[0] || "Atendente"
    const tempId = `temp-media-${Date.now()}`
    const clientMessageId = crypto.randomUUID()

    const mediaType: "image" | "audio" | "document" = selectedFile.type.startsWith("image/")
      ? "image"
      : selectedFile.type.startsWith("audio/")
      ? "audio"
      : "document"

    const optimisticMsg: MessageData = {
      id: tempId,
      conversation_id: selectedId,
      sender_type: "agent",
      sender_id: currentUser?.userId || null,
      content: caption
        ? `*Atendente ${attendantName}:*\n${caption}`
        : `*Atendente ${attendantName}:*\n[${mediaType === "image" ? "Imagem" : mediaType === "audio" ? "Mensagem de Voz" : "Documento"}]`,
      message_type: mediaType,
      metadata: {
        delivery_status: "pending",
        client_message_id: clientMessageId,
        operator_name: attendantName,
        media_url: filePreviewUrl || undefined,
        file_name: selectedFile.name,
        media_type: mediaType,
      },
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, optimisticMsg])
    const fileToSend = selectedFile
    handleClearSelectedFile()
    setInputContent("")
    scrollToBottom(true)

    try {
      const uploadRes = await uploadMediaFile(fileToSend)

      if (!uploadRes?.success || !uploadRes?.url) {
        throw new Error(uploadRes?.error || "Falha no upload do arquivo.")
      }

      const sendRes = await sendMediaMessageAction({
        conversationId: selectedId,
        mediaUrl: uploadRes.url,
        mediaType,
        fileName: fileToSend.name,
        caption: caption || undefined,
        clientMessageId,
      })

      if (sendRes?.success) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: sendRes.messageId || m.id,
                  metadata: {
                    ...m.metadata,
                    delivery_status: "sent",
                    media_url: uploadRes.url,
                  },
                }
              : m
          )
        )
      } else {
        toast.error("Falha no Envio", sendRes?.error || "Não foi possível enviar a mídia.")
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? { ...m, metadata: { ...m.metadata, delivery_status: "failed" } }
              : m
          )
        )
      }
    } catch (err: any) {
      console.error("[Chat] Falha no envio de mídia:", err)
      toast.error("Erro no Envio", err?.message || "Erro ao processar arquivo.")
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? { ...m, metadata: { ...m.metadata, delivery_status: "failed" } }
            : m
        )
      )
    } finally {
      setIsUploadingMedia(false)
      textareaRef.current?.focus()
    }
  }

  // =========================================================================
  // MELHORIA 4: GRAVAÇÃO E ENVIO DE ÁUDIO NO NAVEGADOR
  // =========================================================================
  const handleStartRecording = async () => {
    if (isRecording || isUploadingAudio || !selectedId) return

    if (!navigator?.mediaDevices?.getUserMedia) {
      toast.error("Microfone não suportado", "Seu navegador não possui suporte para gravação de áudio.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      let mimeType = "audio/webm;codecs=opus"
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
          mimeType = "audio/ogg;codecs=opus"
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4"
        } else {
          mimeType = ""
        }
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.start(200)
      setIsRecording(true)
      setRecordingSeconds(0)

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1)
      }, 1000)
    } catch (err: any) {
      console.error("[AudioRecord] Erro ao acessar microfone:", err)
      toast.error("Permissão de Microfone", "Não foi possível acessar seu microfone. Verifique as permissões.")
    }
  }

  const handleCancelRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop()
      } catch {}
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    audioChunksRef.current = []
    setIsRecording(false)
    setRecordingSeconds(0)
  }

  const handleStopAndSendRecording = async () => {
    if (!mediaRecorderRef.current || !selectedId || isUploadingAudio) return

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }

    const recorder = mediaRecorderRef.current
    const stream = mediaStreamRef.current
    setIsRecording(false)
    setIsUploadingAudio(true)

    const stopPromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm"
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        resolve(audioBlob)
      }
    })

    if (recorder.state !== "inactive") {
      recorder.stop()
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    try {
      const audioBlob = await stopPromise
      if (audioBlob.size < 400) {
        toast.info("Áudio muito curto", "Gravação descartada por ter duração insuficiente.")
        setIsUploadingAudio(false)
        setRecordingSeconds(0)
        return
      }

      const extension = recorder.mimeType.includes("ogg") ? "ogg" : recorder.mimeType.includes("mp4") ? "m4a" : "webm"
      const audioFileName = `audio-${Date.now()}.${extension}`
      const audioFile = new File([audioBlob], audioFileName, { type: audioBlob.type || "audio/webm" })

      const attendantName = (currentUser?.userName || "Atendente").split(/\s+/)[0] || "Atendente"
      const tempId = `temp-audio-${Date.now()}`
      const clientMessageId = crypto.randomUUID()
      const localAudioUrl = URL.createObjectURL(audioBlob)

      const optimisticMsg: MessageData = {
        id: tempId,
        conversation_id: selectedId,
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

      setMessages((prev) => [...prev, optimisticMsg])
      scrollToBottom(true)

      const uploadRes = await uploadMediaFile(audioFile)

      if (!uploadRes?.success || !uploadRes?.url) {
        throw new Error(uploadRes?.error || "Falha ao fazer upload da gravação de áudio.")
      }

      const sendRes = await sendMediaMessageAction({
        conversationId: selectedId,
        mediaUrl: uploadRes.url,
        mediaType: "audio",
        fileName: audioFileName,
        clientMessageId,
      })

      if (sendRes?.success) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: sendRes.messageId || m.id,
                  metadata: {
                    ...m.metadata,
                    delivery_status: "sent",
                    media_url: uploadRes.url,
                  },
                }
              : m
          )
        )
      } else {
        toast.error("Falha no Envio de Áudio", sendRes?.error || "Não foi possível enviar o áudio.")
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? { ...m, metadata: { ...m.metadata, delivery_status: "failed" } }
              : m
          )
        )
      }
    } catch (err: any) {
      console.error("[AudioRecord] Erro ao processar gravação:", err)
      toast.error("Erro no Áudio", err?.message || "Falha ao gravar ou enviar áudio.")
    } finally {
      setIsUploadingAudio(false)
      setRecordingSeconds(0)
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

      if (res?.success && res?.message) {
        setMessages((prev) => [...prev, res.message!])
        if (customContent !== undefined) {
          setQuickNoteContent("")
        } else {
          setInputContent("")
        }
        scrollToBottom(true)
        toast.success("Nota Salva", "A anotação interna foi registrada na conversa.")
      } else {
        toast.error("Erro ao salvar nota", res?.error || "Falha ao registrar nota.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err?.message || "Falha ao registrar nota.")
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

      if (res?.success) {
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
        toast.error("Erro ao salvar", res?.error || "Não foi possível atualizar o perfil.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err?.message || "Falha ao salvar dados do cliente.")
    } finally {
      setIsSavingCustomer(false)
    }
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedFile) {
      handleSendAttachedFile()
    } else if (sendMode === "note") {
      handleCreateInternalNote()
    } else if (inputContent.trim()) {
      handleSendMessage(e)
    } else if (isRecording) {
      handleStopAndSendRecording()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Expansão instantânea de atalho de mensagem rápida (/pix, /horario, etc)
      if (inputContent.startsWith("/")) {
        const query = inputContent.slice(1).trim().toLowerCase()
        const matched = quickReplies.find(
          (q) => q.isActive && q.shortcut && q.shortcut.toLowerCase() === query
        )
        if (matched) {
          e.preventDefault()
          setInputContent(matched.content)
          return
        }
      }

      e.preventDefault()
      if (selectedFile) {
        handleSendAttachedFile()
      } else if (sendMode === "note") {
        handleCreateInternalNote()
      } else if (inputContent.trim()) {
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

      if (result?.success) {
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
        toast.error("Erro ao assumir conversa", result?.error || "Falha na transferência.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err?.message || "Falha ao assumir atendimento.")
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

      if (result?.success) {
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
        toast.error("Erro ao devolver para IA", result?.error || "Falha na operação.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err?.message || "Falha ao devolver para IA.")
    } finally {
      setIsReturningToAI(false)
    }
  }

  // =========================================================================
  // CICLO DE VIDA: 3. ENCERRAR ATENDIMENTO (FINALIZAR TICKET)
  // =========================================================================
  const handleCloseConversation = async (reasonIdParam?: string, notesParam?: string) => {
    if (!selectedId || isClosing) return

    const targetReasonId = reasonIdParam !== undefined ? reasonIdParam : selectedReasonId
    const reasonObj = closeReasons.find((r) => r.id === targetReasonId)
    const reasonTitle = reasonObj?.title || null
    const notes = notesParam !== undefined ? notesParam : closeNotes

    if (companyRequireCloseReason && !targetReasonId && !reasonTitle) {
      toast.error("Motivo Obrigatório", "Por favor, selecione um motivo para finalizar este atendimento.")
      return
    }

    setIsClosing(true)
    try {
      const result = await closeConversationAction(selectedId, {
        reasonId: targetReasonId || null,
        reasonText: reasonTitle,
        closedNotes: notes || null,
      })

      if (result?.success) {
        toast.success(
          "Atendimento Encerrado",
          reasonTitle
            ? `Conversa finalizada • Motivo: "${reasonTitle}".`
            : "A conversa foi finalizada com sucesso e movida para Finalizados."
        )

        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId
              ? { ...c, status: "closed", closed_at: new Date().toISOString() }
              : c
          )
        )

        const reasonSuffix = reasonTitle ? ` • Motivo: ${reasonTitle}` : ""
        const notesSuffix = notes ? ` (${notes})` : ""

        const closeEventMsg: MessageData = {
          id: `temp-close-${Date.now()}`,
          conversation_id: selectedId,
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
      } else {
        toast.error("Erro ao encerrar", result?.error || "Falha ao finalizar conversa.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err?.message || "Falha ao encerrar conversa.")
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

      if (result?.success) {
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
  // CICLO DE VIDA: 5. INICIAR NOVA CONVERSA ATIVA (DO PAINEL PARA O WHATSAPP)
  // =========================================================================
  const handleStartNewChat = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newChatPhone.trim() || isStartingNewChat) return

    setIsStartingNewChat(true)
    try {
      const res = await startNewConversationAction({
        phone: newChatPhone.trim(),
        name: newChatName.trim() || undefined,
        initialMessage: newChatMessage.trim() || undefined,
      })

      if (res?.success && res?.conversationId) {
        toast.success("Conversa Iniciada!", "Atendimento aberto com sucesso.")
        setIsNewChatModalOpen(false)
        setNewChatPhone("")
        setNewChatName("")
        setNewChatMessage("")

        const updatedList = await getConversationsList()
        if (updatedList && updatedList.length > 0) {
          setConversations(updatedList)
        }
        setSelectedId(res.conversationId)
      } else {
        toast.error("Erro ao iniciar conversa", res?.error || "Não foi possível abrir o atendimento.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err?.message || "Falha ao iniciar conversa.")
    } finally {
      setIsStartingNewChat(false)
    }
  }

  // =========================================================================
  // FASE 1 — NAVEGACAO MOBILE EM PILHA (Padrao WhatsApp Web)
  // Abaixo de `lg` o painel funciona como app de celular: uma tela por vez.
  // Sem selecao -> so a lista; com selecao -> so a conversa. O botao de voltar
  // do cabecalho limpa a selecao e retorna para a lista.
  // =========================================================================
  const hasSelection = Boolean(selectedId)
  const handleBackToList = () => {
    setSelectedId(null)
    setConfirmClose(false)
    setIsProfileOpen(false)
    setLoadingMessages(false)
    setMessages([])
  }

  // =========================================================================
  // FASE 3 — TEXTAREA QUE CRESCE COM O CONTEUDO (sem quebrar o layout)
  // O campo volta ao tamanho padrao quando o texto e esvaziado.
  // =========================================================================
  const handleInputContentChange = (value: string) => {
    setInputContent(value)
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }

  // =========================================================================
  // FASE 4 — Confirmação em dois passos: o primeiro clique arma a confirmação
  // (rótulo vira "Confirmar encerramento"), o segundo executa. O estado arma
  // expira sozinho para não deixar o atendente em dúvida.
  // =========================================================================
  const requestClose = () => {
    // Se a organização exige motivo OU se existem motivos cadastrados, abre o diálogo de seleção
    if (companyRequireCloseReason || closeReasons.length > 0) {
      setSelectedReasonId(null)
      setCloseNotes("")
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

  // =========================================================================
  // FASE 3 — DESTAQUE DA ETAPA DO FUNIL
  // A etapa do funil (workflow_stage) é o eixo de trabalho do Kanban. Na Lista
  // ela aparecia como um texto solto, sem cor e sem relação com o status do
  // atendimento. Aqui a etapa ganha um ponto colorido (usando a cor definida
  // pela empresa, quando existir) e passa a aparecer também no cabeçalho da
  // conversa ativa, que antes não mostrava em que etapa o atendimento estava.
  // =========================================================================
  const stageColorOf = (conv: any): string => {
    const raw =
      conv?.workflow_stage_color ??
      conv?.stage_color ??
      conv?.workflow_stages?.color ??
      null
    if (typeof raw === "string" && /^#[0-9a-fA-F]{3,8}$/.test(raw.trim())) {
      return raw.trim()
    }
    return "#64748b"
  }

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
          <span title="Pendente na fila da Outbox" className="text-ellevee-ink-muted/70">
            <Clock className="h-3 w-3 animate-spin" />
          </span>
        )
      case "sent":
        return (
          <span title="Enviado ao WhatsApp (Gateway)" className="text-ellevee-ink-muted">
            <CheckCheck className="h-3 w-3 stroke-[2.5]" />
          </span>
        )
      case "delivered":
        return (
          <span title="Despacho aceito pelo gateway" className="text-ellevee-ink-muted">
            <CheckCheck className="h-3 w-3 stroke-[2.5]" />
          </span>
        )
      case "read":
        return (
          <span title="Lido pelo cliente" className="text-ellevee-info">
            <CheckCheck className="h-3 w-3 stroke-[2.5]" />
          </span>
        )
      case "failed":
        return (
          <span title="Falha no despacho do gateway" className="text-ellevee-danger">
            <AlertCircle className="h-3 w-3" />
          </span>
        )
      default:
        return (
          <span className="text-ellevee-ink-muted">
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
    <div
      className="flex flex-1 min-h-0 w-full bg-[#efeae2] text-ellevee-ink overflow-hidden font-sans relative"
    >
      {/* =====================================================================
          SIDEBAR: LISTA DE CONVERSAS (Quiet Luxury / Deep Ink)
          Mobile (Stack Navigation): a lista ocupa a tela inteira enquanto
          nenhuma conversa esta selecionada.
      ====================================================================== */}
      <aside
        className={`${hasSelection ? "hidden lg:flex" : "flex"} w-full lg:w-80 xl:w-96 border-r border-[#e9ecef] bg-white flex-col shrink-0 h-full z-40 lg:static`}
      >
        {/* Cabeçalho de Busca e Ações Estilo WhatsApp / CRM */}
        <div className="p-2.5 px-3 border-b border-[#e9ecef] space-y-2 bg-white">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsNewChatModalOpen(true)}
              className="p-1.5 text-[#54656f] hover:text-[#005d4b] hover:bg-[#005d4b]/10 rounded-md transition-colors"
              title="Nova conversa / contato"
            >
              <SquarePen className="h-4 w-4" />
            </button>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8696a0]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar contato"
                aria-label="Buscar contato"
                className="w-full pl-8 pr-3 py-1.5 bg-[#f0f2f5] rounded-lg text-xs sm:text-sm text-[#111827] placeholder:text-[#8696a0] focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#005d4b]"
              />
            </div>
            <button
              type="button"
              className="p-1.5 text-[#54656f] hover:text-[#111827] hover:bg-[#f0f2f5] rounded-md transition-colors"
              title="Alternar visualização"
            >
              <Eye className="h-4 w-4" />
            </button>
            <Link
              href="/conversations/kanban"
              className="p-1.5 text-[#54656f] hover:text-[#111827] hover:bg-[#f0f2f5] rounded-md transition-colors"
              title="Abrir Funil Kanban"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Link>
          </div>

          {/* Abas Superiores de Fila por Ícones com Contagem Numérica */}
          <div className="flex items-center justify-between border-t border-[#f0f2f5] pt-1.5 px-1 sm:px-2">
            {/* 1. Todas as conversas */}
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              className={`p-2 rounded-lg flex items-center justify-center transition-colors relative ${
                activeTab === "all" ? "text-[#005d4b] bg-[#f0f2f5]" : "text-[#8696a0] hover:text-[#54656f]"
              }`}
              title={`Todas as conversas (${counts.all})`}
              aria-label={`Todas as conversas: ${counts.all}`}
            >
              <ListFilter className="h-4 w-4" />
              {counts.all > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 bg-slate-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs">
                  {counts.all}
                </span>
              )}
            </button>

            {/* 2. Aguardando na Fila (com badge numérico verde WhatsApp) */}
            <button
              type="button"
              onClick={() => setActiveTab("waiting")}
              className={`p-2 rounded-lg flex items-center justify-center transition-colors relative ${
                activeTab === "waiting" ? "text-[#005d4b] bg-[#f0f2f5]" : "text-[#8696a0] hover:text-[#54656f]"
              }`}
              title={`Aguardando atendimento (${counts.waiting})`}
              aria-label={`Aguardando atendimento: ${counts.waiting}`}
            >
              <Hourglass className="h-4 w-4" />
              {counts.waiting > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 bg-[#25d366] text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs animate-pulse">
                  {counts.waiting}
                </span>
              )}
            </button>

            {/* 3. Em atendimento humano (com badge azul) */}
            <button
              type="button"
              onClick={() => setActiveTab("in_progress")}
              className={`p-2 rounded-lg flex items-center justify-center transition-colors relative ${
                activeTab === "in_progress" ? "text-[#005d4b] bg-[#f0f2f5]" : "text-[#8696a0] hover:text-[#54656f]"
              }`}
              title={`Em atendimento humano (${counts.inProgress})`}
              aria-label={`Em atendimento humano: ${counts.inProgress}`}
            >
              <MessageSquare className="h-4 w-4" />
              {counts.inProgress > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs">
                  {counts.inProgress}
                </span>
              )}
            </button>

            {/* 4. Atendimento com IA (com badge índigo) */}
            <button
              type="button"
              onClick={() => setActiveTab("ai")}
              className={`p-2 rounded-lg flex items-center justify-center transition-colors relative ${
                activeTab === "ai" ? "text-[#005d4b] bg-[#f0f2f5]" : "text-[#8696a0] hover:text-[#54656f]"
              }`}
              title={`Atendimento IA ativa (${counts.ai})`}
              aria-label={`Atendimento IA ativa: ${counts.ai}`}
            >
              <Bot className="h-4 w-4" />
              {counts.ai > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 bg-indigo-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs">
                  {counts.ai}
                </span>
              )}
            </button>

            {/* 5. Finalizadas (com badge cinza) */}
            <button
              type="button"
              onClick={() => setActiveTab("closed")}
              className={`p-2 rounded-lg flex items-center justify-center transition-colors relative ${
                activeTab === "closed" ? "text-[#005d4b] bg-[#f0f2f5]" : "text-[#8696a0] hover:text-[#54656f]"
              }`}
              title={`Finalizadas (${counts.closed})`}
              aria-label={`Conversas finalizadas: ${counts.closed}`}
            >
              <CheckCircle2 className="h-4 w-4" />
              {counts.closed > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 bg-gray-400 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs">
                  {counts.closed}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Lista de Itens */}
        <div className="flex-1 overflow-y-auto scroll-slim p-2 space-y-1" aria-label="Lista de conversas">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-ellevee-ink-muted p-6 text-center space-y-2">
              <div className="h-12 w-12 rounded-full bg-ellevee-ivory flex items-center justify-center">
                <MessageSquare className="h-5 w-5 stroke-1 text-ellevee-ink-muted/70" />
              </div>
              <p className="text-sm font-medium text-ellevee-ink">
                {conversations.length === 0
                  ? "Nenhuma conversa por aqui"
                  : "Nenhuma conversa encontrada"}
              </p>
              <p className="text-sm text-ellevee-ink-muted max-w-[240px] leading-relaxed">
                {conversations.length === 0
                  ? "Quando um contato chegar pelo WhatsApp, a conversa aparece aqui."
                  : "Ajuste a busca ou troque a aba de status para ver outros atendimentos."}
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
              // No mobile o WhatsApp Web faz a lista em duas linhas compactas:
              // nome + hora na primeira e prévia + contador na segunda.
              // Etapa e status ficam em uma linha terciária de apoio.

              return (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  aria-current={isSelected ? "true" : undefined}
                  className={`conv-item focus-ring w-full text-left flex items-start gap-3 px-3 py-2.5 sm:p-3 rounded-lg transition-all relative cursor-pointer ${
                    isSelected
                      ? "bg-ellevee-stone-subtle border border-ellevee-stone shadow-2xs ring-1 ring-ellevee-ink/10"
                      : "hover:bg-ellevee-stone-subtle border border-transparent"
                  } ${isPulsing ? "ring-2 ring-ellevee-success/60 bg-ellevee-success/10 animate-pulse" : ""} ${
                    isWaiting ? "border-l-4 border-l-ellevee-warning" : ""
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
                          ? "bg-ellevee-warning/10 text-ellevee-warning-strong border border-ellevee-warning/40"
                          : "bg-ellevee-ivory text-ellevee-ink border border-ellevee-stone"
                      }`}
                    >
                      {initials}
                    </div>
                    {/* Selo verde do WhatsApp estilo ChatPro */}
                    <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-ellevee-success text-white flex items-center justify-center shadow-xs ring-1 ring-white">
                      <WhatsAppIcon className="h-2 w-2" />
                    </div>
                  </div>

                  {/* Informações da Conversa */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="font-semibold text-sm text-ellevee-ink truncate">
                        {customerName}
                      </span>
                      <span className="text-meta text-ellevee-ink-muted shrink-0 font-mono">
                        {timeAgo(conv.last_message_at || conv.created_at)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-ellevee-ink-muted truncate leading-relaxed min-w-0">
                        {conv.last_message_preview || "Nenhuma mensagem recente"}
                      </p>

                      {conv.unread_count > 0 && (
                        <span className="min-w-[18px] h-4 px-1 rounded-full bg-ellevee-success text-white text-meta font-bold flex items-center justify-center font-mono shrink-0">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>

                    {/* Etapa do funil (mesma informação do Kanban) */}
                    {conv.workflow_stage_name ? (
                      <div className="mt-1 flex items-center">
                        <span
                          title={`Etapa no funil: ${conv.workflow_stage_name}`}
                          className="inline-flex items-center gap-1.5 rounded bg-ellevee-stone-subtle px-2 py-0.5 text-meta text-ellevee-ink border border-ellevee-stone font-medium max-w-full shadow-2xs"
                        >
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: stageColorOf(conv) }}
                          />
                          <span className="truncate max-w-[150px]">{conv.workflow_stage_name}</span>
                        </span>
                      </div>
                    ) : null}

                    {/* FASE 3: selo de status compacto */}
                    <div className="mt-1 text-meta leading-relaxed flex items-center gap-1.5 min-w-0">
                      <StatusChip
                        view={resolveStatusView(conv.status, !!conv.assigned_to)}
                        detail={
                          isWaiting
                            ? `esperando há ${formatWaitTime(
                                conv.last_message_at || conv.updated_at || conv.created_at
                              )}`
                            : conv.status === "human"
                            ? conv.assigned_to === currentUser?.userId
                              ? "com você"
                              : "em atendimento"
                            : conv.status === "open"
                            ? conv.agent_name || "IA ativa"
                            : undefined
                        }
                      />
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
      <main
        className={`flex-1 flex flex-row min-h-0 w-full bg-ellevee-ivory overflow-hidden ${
          hasSelection ? "flex" : "hidden lg:flex"
        }`}
      >
        {activeConversation ? (
          <>
            {/* Coluna Central do Chat */}
            <div className="flex-1 basis-0 flex flex-col min-h-0 w-full overflow-hidden min-w-0">
            {/* Header do Chat (Harmonização Didática Estilo ChatPro / WhatsApp Web) */}
            <header className="h-14 sm:h-16 border-b border-ellevee-stone px-3 sm:px-6 flex items-center justify-between bg-white shrink-0 gap-2 sm:gap-4 shadow-[0_1px_2px_0_rgba(0,0,0,0.03)] z-10">
              {/* Lado Esquerdo: Avatar + Nome com Selo WhatsApp + Metadados */}
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                {/* Botão voltar para a lista (mobile) — padrão de navegação
                    em pilha: uma tela por vez. */}
                <button
                  type="button"
                  onClick={handleBackToList}
                  className="lg:hidden inline-flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 -ml-1 sm:-ml-2 rounded-full text-ellevee-ink hover:bg-slate-100 focus-ring shrink-0"
                  title="Voltar para a lista de conversas"
                  aria-label="Voltar para a lista de conversas"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                {/* Avatar com Foto Real ou Iniciais + Selo WhatsApp (Clicável para abrir perfil) */}
                <div
                  className="relative shrink-0 cursor-pointer group"
                  onClick={() => setIsProfileOpen(true)}
                  title="Abrir detalhes do cliente"
                >
                  {activeConversation.customers?.avatar_url ? (
                    <img
                      src={activeConversation.customers.avatar_url}
                      alt={activeConversation.customers?.name || "Cliente"}
                      referrerPolicy="no-referrer"
                      className="h-9 w-9 sm:h-11 sm:w-11 rounded-full object-cover border border-slate-200 shadow-2xs group-hover:ring-2 group-hover:ring-emerald-500/30 transition-all"
                      onError={(e) => {
                        e.currentTarget.style.display = "none"
                        if (e.currentTarget.nextElementSibling) {
                          (e.currentTarget.nextElementSibling as HTMLElement).style.display = "flex"
                        }
                      }}
                    />
                  ) : null}
                  <div
                    className={`h-9 w-9 sm:h-11 sm:w-11 rounded-full bg-slate-900 text-white font-bold text-xs sm:text-sm flex items-center justify-center shrink-0 shadow-2xs group-hover:ring-2 group-hover:ring-emerald-500/30 transition-all ${
                      activeConversation.customers?.avatar_url ? "hidden" : ""
                    }`}
                  >
                    {(activeConversation.customers?.name || "C").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 sm:h-4 sm:w-4 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow-xs ring-2 ring-white">
                    <WhatsAppIcon className="h-2 w-2 sm:h-2.5 sm:w-2.5" />
                  </div>
                </div>

                {/* Nome e Metadados do Atendimento */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <h2
                      className="font-semibold text-sm sm:text-base text-gray-900 truncate hover:text-emerald-700 cursor-pointer transition-colors max-w-[130px] xs:max-w-[200px] sm:max-w-none"
                      onClick={() => setIsProfileOpen(true)}
                      title={activeConversation.customers?.name || "Cliente Desconhecido"}
                    >
                      {activeConversation.customers?.name || "Cliente Desconhecido"}
                    </h2>

                    {/* Etapa do Funil no Desktop */}
                    {activeConversation.workflow_stage_name ? (
                      <span
                        title={`Etapa no funil: ${activeConversation.workflow_stage_name}`}
                        className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-slate-100/90 border border-slate-200 px-2.5 py-0.5 text-xs text-slate-700 font-medium whitespace-nowrap shadow-2xs shrink-0"
                      >
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 rounded-full shrink-0 shadow-2xs"
                          style={{ backgroundColor: stageColorOf(activeConversation) }}
                        />
                        <span className="max-w-[120px] sm:max-w-[180px] truncate">
                          {activeConversation.workflow_stage_name}
                        </span>
                      </span>
                    ) : null}
                  </div>

                  {/* Linha inferior de status */}
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5 truncate">
                    {/* Indicador de Status com ponto colorido */}
                    {activeConversation.status === "human" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 truncate">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <span>
                          {activeConversation.assigned_to === currentUser?.userId
                            ? "Com você"
                            : "Humano"}
                        </span>
                      </span>
                    ) : activeConversation.status === "closed" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 truncate">
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-400 shrink-0" />
                        <span>Finalizado</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 truncate">
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                        <span>{activeConversation.agent_name || "Ellevee IA"}</span>
                      </span>
                    )}

                    {/* Etapa do funil no mobile */}
                    {activeConversation.workflow_stage_name && (
                      <>
                        <span className="text-gray-300">•</span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-600 truncate">
                          <span
                            className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: stageColorOf(activeConversation) }}
                          />
                          <span className="truncate max-w-[90px] sm:max-w-[120px]">
                            {activeConversation.workflow_stage_name}
                          </span>
                        </span>
                      </>
                    )}

                    {/* Telefone no Desktop */}
                    {activeConversation.customers?.phone && (
                      <>
                        <span className="hidden sm:inline text-gray-300">•</span>
                        <span className="hidden sm:flex items-center gap-1 font-mono text-gray-500">
                          <Phone className="h-3 w-3 text-gray-400 shrink-0" />
                          <span>{formatPhoneNumber(activeConversation.customers.phone)}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Lado Direito: Ações Rápidas com Acabamento Arredondado */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* 1. Botão Dinâmico Principal: "Assumir" / "Devolver" (Visível em Mobile e Desktop) */}
                {activeConversation.status === "human" ? (
                  <button
                    type="button"
                    onClick={handleReturnToAI}
                    disabled={isReturningToAI}
                    className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/80 transition-all shadow-2xs active:scale-95 disabled:opacity-50 shrink-0"
                    title={`Devolver atendimento para ${activeConversation.agent_name || "a IA"}`}
                  >
                    {isReturningToAI ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 text-indigo-600" />
                    )}
                    <span className="sm:hidden">Devolver</span>
                    <span className="hidden sm:inline">Devolver para {activeConversation.agent_name || "IA"}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleTakeover}
                    disabled={isTakingOver || activeConversation.status === "closed"}
                    className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 shadow-2xs transition-all disabled:opacity-50 shrink-0"
                    title="Assumir conversa (pausar a IA e atender manualmente)"
                  >
                    {isTakingOver ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UserCheck className="h-3.5 w-3.5" />
                    )}
                    <span>Assumir</span>
                  </button>
                )}

                {/* 2. Botão Agendar (Desktop) */}
                <button
                  type="button"
                  onClick={() => setIsProfileOpen((v) => !v)}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-gray-700 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200/80 transition-all shadow-2xs active:scale-95 shrink-0"
                  title="Agendar follow-up, notas ou ver tarefas"
                >
                  <Calendar className="h-3.5 w-3.5 text-gray-500" />
                  <span>Agendar</span>
                </button>

                {/* 3. Botão Finalizar / Reabrir (Desktop) */}
                {activeConversation.status === "closed" ? (
                  <button
                    type="button"
                    onClick={handleReopenConversation}
                    disabled={isReopening}
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-all shadow-2xs active:scale-95 shrink-0"
                    title="Reabrir conversa"
                  >
                    {isReopening ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    <span>Reabrir</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={requestClose}
                    disabled={isClosing}
                    className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all shadow-2xs active:scale-95 shrink-0 ${
                      confirmClose
                        ? "bg-rose-600 text-white hover:bg-rose-700 border border-rose-600 shadow-sm"
                        : "text-gray-700 hover:text-rose-600 bg-gray-50 hover:bg-rose-50 border border-gray-200/80 hover:border-rose-200"
                    }`}
                    title={confirmClose ? "Clique novamente para confirmar encerramento" : "Finalizar atendimento"}
                  >
                    {isClosing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : confirmClose ? (
                      <AlertCircle className="h-3.5 w-3.5 text-white" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-gray-400 group-hover:text-rose-600" />
                    )}
                    <span>{confirmClose ? "Confirmar?" : "Finalizar"}</span>
                  </button>
                )}

                <div className="h-5 w-px bg-gray-200 mx-0.5 hidden sm:block" />

                {/* 4. Menu Suspenso Mais Opções (⋮) — Acesso a Agendar, Perfil e Finalizar em Mobile e Desktop */}
                <DropdownMenu
                  align="right"
                  trigger={
                    <button
                      type="button"
                      className="h-8 w-8 rounded-full flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 border border-gray-200/70 transition-all shadow-2xs shrink-0 cursor-pointer"
                      title="Mais opções da conversa"
                      aria-label="Mais opções da conversa"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  }
                >
                  <DropdownMenuLabel>Ações da Conversa</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setIsProfileOpen(true)}>
                    <Calendar className="h-4 w-4 mr-2 text-gray-500" />
                    <span>Agendar / Notas</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsProfileOpen(true)}>
                    <Tag className="h-4 w-4 mr-2 text-gray-500" />
                    <span>Etiquetas e Funil</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsProfileOpen(true)}>
                    <User className="h-4 w-4 mr-2 text-gray-500" />
                    <span>Ver Perfil do Cliente</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {activeConversation.status === "closed" ? (
                    <DropdownMenuItem onClick={handleReopenConversation}>
                      <RotateCcw className="h-4 w-4 mr-2 text-emerald-600" />
                      <span>Reabrir Atendimento</span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={requestClose}
                      className={confirmClose ? "text-red-600 font-semibold" : "text-red-500"}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2 text-red-500" />
                      <span>{confirmClose ? "Confirmar Encerramento?" : "Finalizar Atendimento"}</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenu>
              </div>
            </header>

            {/* Histórico de Mensagens: Fundo Warm Ivory (#F3F2ED) */}
            <section
              role="log"
              aria-live="polite"
              aria-label="Histórico da conversa"
              className="flex-1 basis-0 min-h-0 overflow-y-auto overscroll-contain scroll-slim p-3 sm:p-5 bg-ellevee-ivory space-y-3"
            >
              <div className="max-w-3xl mx-auto space-y-3">
                {loadingMessages ? (
                  <div className="flex flex-col items-center justify-center p-8 text-ellevee-ink-muted space-y-3">
                    <Loader2 className="h-6 w-6 animate-spin text-ellevee-ink" />
                    <p className="text-meta">Carregando histórico…</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center space-y-2">
                    <div className="h-12 w-12 rounded-full bg-white border border-ellevee-stone flex items-center justify-center">
                      <MessageSquare className="h-5 w-5 stroke-1 text-ellevee-ink-muted" />
                    </div>
                    <p className="text-sm font-medium text-ellevee-ink">Nenhuma mensagem registrada</p>
                    <p className="text-meta text-ellevee-ink-muted max-w-[280px] leading-relaxed">
                      Esta conversa ainda não possui histórico. Envie a primeira mensagem para começar.
                    </p>
                  </div>
                ) : (
                  messageFeed.map((msg) => {
                    // Separador de dia (Hoje / Ontem / data completa)
                    if ((msg as any).sender_type === "__divider__") {
                      return (
                        <div key={msg.id} className="flex justify-center py-1">
                          <span className="text-meta font-mono uppercase tracking-[0.12em] text-ellevee-ink-muted bg-white border border-ellevee-stone rounded-full px-2.5 py-0.5 shadow-2xs">
                            {msg.content}
                          </span>
                        </div>
                      )
                    }

                    const isCustomer = msg.sender_type === "customer"
                    const isSystem = msg.sender_type === "system" || msg.message_type === "event"
                    const isInternalNote = msg.message_type === "internal_note" || msg.metadata?.is_internal
                    const isHuman = msg.sender_type === "human" || Boolean(msg.sender_id)
                    const isIA = !isHuman && (msg.sender_type === "agent" || msg.sender_type === "ia" || msg.sender_type === "bot" || Boolean(msg.metadata?.agent_id))

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
                          <span className="text-meta text-ellevee-ink-muted px-1 font-mono">
                            {activeConversation.customers?.name || "Cliente"}
                          </span>
                          <div className={`max-w-[85%] sm:max-w-md msg-bubble msg-bubble-in rounded-tl-sm transition-shadow duration-200 hover:shadow-md ${
                            msg.message_type === "audio" || msg.metadata?.media_type === "audio" ? "min-w-[270px]" : ""
                          }`}>
                            <MessageMedia
                              msg={msg}
                              isCustomer={true}
                              onOpenPreview={(url, name) => setPreviewImage({ url, fileName: name })}
                            />
                            {getDisplayContent(msg) && (
                              <p className="whitespace-pre-wrap leading-relaxed">{getDisplayContent(msg)}</p>
                            )}
                            <div className="flex justify-end items-center gap-1 mt-1 text-meta text-ellevee-ink-muted font-mono opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                              <span>{formatTime(msg.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    }

                    // Mensagens de Saída: IA (Deep Ink com acento) ou Atendente Humano (Emerald suave)
                    return (
                      <div key={msg.id} className="group flex flex-col items-end space-y-1">
                        <span className="text-meta text-ellevee-ink-muted px-1 font-mono flex items-center gap-1">
                          {isHuman ? (
                            <>
                              <User className="h-2.5 w-2.5 text-ellevee-success-strong" />
                              <span className="text-ellevee-success-strong font-semibold">Atendente Humano</span>
                            </>
                          ) : (
                            <>
                              <Bot className="h-2.5 w-2.5 text-ellevee-info" />
                              <span className="text-ellevee-info font-semibold">
                                {activeConversation.agent_name || "Ellevee IA"}
                              </span>
                            </>
                          )}
                        </span>

                        <div
                          className={`max-w-[85%] sm:max-w-md msg-bubble rounded-tr-sm transition-shadow duration-200 hover:shadow-md ${
                            msg.message_type === "audio" || msg.metadata?.media_type === "audio" ? "min-w-[270px]" : ""
                          } ${
                            isHuman
                              ? "msg-bubble-in border-ellevee-success/40 ring-1 ring-ellevee-success/20"
                              : "msg-bubble-out"
                          }`}
                        >
                          <MessageMedia
                            msg={msg}
                            isCustomer={false}
                            onOpenPreview={(url, name) => setPreviewImage({ url, fileName: name })}
                          />
                          {getDisplayContent(msg) && (
                            <p className="whitespace-pre-wrap leading-relaxed">{getDisplayContent(msg)}</p>
                          )}
                          <div
                            className={`flex justify-end items-center gap-1.5 mt-1 text-meta font-mono ${
                              isHuman ? "text-ellevee-ink-muted" : "text-white/70"
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
              <footer className="border-t border-ellevee-stone px-4 sm:px-6 py-3 sm:py-4 bg-white shrink-0 z-20 flex items-center justify-between pb-[max(0.6rem,env(safe-area-inset-bottom))]">
                <div className="flex items-center gap-2 text-ellevee-ink-muted">
                  <CheckCircle2 className="h-4 w-4 text-ellevee-ink-muted shrink-0" />
                  <span className="text-meta font-semibold text-ellevee-ink">
                    Este atendimento foi finalizado.
                  </span>
                  <span className="text-meta text-ellevee-ink-muted hidden sm:inline">
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
              <footer className="p-2 sm:p-2.5 px-3 sm:px-4 bg-[#f0f2f5] border-t border-[#e9ecef] shrink-0 z-20 pb-[max(0.6rem,env(safe-area-inset-bottom))]">
                  <div className="max-w-4xl mx-auto space-y-1.5">
                    {/* Modo: Mensagem WhatsApp vs Nota Interna */}
                    <div className="flex items-center gap-2 px-1">
                      <button
                        type="button"
                        onClick={() => setSendMode("whatsapp")}
                        className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full transition-colors ${
                          sendMode === "whatsapp"
                            ? "bg-[#005d4b] text-white"
                            : "bg-white text-[#54656f] hover:text-[#111827] border border-[#e9ecef]"
                        }`}
                      >
                        Mensagem WhatsApp
                      </button>
                      <button
                        type="button"
                        onClick={() => setSendMode("note")}
                        className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full transition-colors ${
                          sendMode === "note"
                            ? "bg-amber-600 text-white"
                            : "bg-white text-[#54656f] hover:text-[#111827] border border-[#e9ecef]"
                        }`}
                      >
                        Nota Interna
                      </button>
                    </div>

                    {/* Input Oculto de Arquivo */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept="image/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                      onChange={handleFileSelect}
                    />

                    {/* Barra de Pré-visualização de Anexo Selecionado */}
                    {selectedFile && (
                      <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-[#e9ecef] shadow-2xs">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {filePreviewUrl ? (
                            <img
                              src={filePreviewUrl}
                              alt="Pré-visualização"
                              className="h-10 w-10 object-cover rounded-md border border-gray-200 shrink-0"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-md bg-[#005d4b]/10 text-[#005d4b] flex items-center justify-center shrink-0">
                              <Paperclip className="h-5 w-5" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#111827] truncate max-w-xs">{selectedFile.name}</p>
                            <p className="text-[10px] text-[#54656f] font-mono">{(selectedFile.size / 1024).toFixed(0)} KB</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleClearSelectedFile}
                          className="p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded-full transition-colors"
                          title="Remover anexo"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}

                    {/* Modo de Gravação de Áudio Ativo */}
                    {isRecording ? (
                      <div className="flex items-center justify-between gap-3 w-full bg-white px-4 py-2 rounded-lg border border-red-200 shadow-2xs">
                        <div className="flex items-center gap-2.5">
                          <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-xs font-semibold text-red-600 font-mono">{formatRecordingTime(recordingSeconds)}</span>
                          <span className="text-xs text-[#54656f] italic hidden sm:inline">Gravando mensagem de voz...</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleCancelRecording}
                            className="p-2 text-red-500 hover:bg-red-50 rounded-full transition-colors"
                            title="Descartar gravação"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                          <button
                            type="button"
                            onClick={handleStopAndSendRecording}
                            disabled={isUploadingAudio}
                            className="h-9 w-9 rounded-full bg-[#005d4b] hover:bg-[#004738] text-white flex items-center justify-center shadow-xs transition-transform active:scale-95 disabled:opacity-50"
                            title="Enviar áudio gravado"
                          >
                            {isUploadingAudio ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handleFormSubmit} className="flex items-center gap-2">
                        {/* Botão Emoji */}
                        <button
                          type="button"
                          className="p-2 text-[#54656f] hover:text-[#111827] hover:bg-black/5 rounded-full transition-colors shrink-0"
                          title="Inserir emoji"
                        >
                          <Smile className="h-5 w-5" />
                        </button>

                        {/* Botão Anexo */}
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isSending || isSendingInternalNote || isUploadingMedia || isUploadingAudio}
                          className="p-2 text-[#54656f] hover:text-[#111827] hover:bg-black/5 rounded-full transition-colors shrink-0 disabled:opacity-40"
                          title="Anexar arquivo ou imagem"
                        >
                          <Paperclip className="h-5 w-5" />
                        </button>

                        {/* Botão Mensagens Rápidas */}
                        <button
                          type="button"
                          onClick={() => setIsQuickRepliesOpen(true)}
                          disabled={isSending || isSendingInternalNote || isUploadingMedia || isUploadingAudio}
                          className="p-2 text-[#54656f] hover:text-ellevee-purple hover:bg-purple-50 rounded-full transition-colors shrink-0 disabled:opacity-40"
                          title="Mensagens rápidas (respostas prontas) ou digite /"
                        >
                          <Zap className="h-5 w-5" />
                        </button>

                        {/* Input de Mensagem */}
                        <div className="flex-1 relative">
                          {/* Sugestões de Atalhos Flutuantes ao digitar / */}
                          {inputContent.startsWith("/") && (
                            <div className="absolute bottom-full left-0 mb-2 w-full max-w-sm bg-white rounded-xl border border-ellevee-border shadow-xl z-30 p-2 space-y-1">
                              <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                                <span>Mensagens Rápidas</span>
                                <span>Enter para inserir</span>
                              </div>
                              <div className="max-h-40 overflow-y-auto scroll-slim space-y-0.5">
                                {quickReplies
                                  .filter(
                                    (q) =>
                                      q.isActive &&
                                      (!inputContent.slice(1).trim() ||
                                        (q.shortcut &&
                                          q.shortcut
                                            .toLowerCase()
                                            .includes(inputContent.slice(1).toLowerCase())) ||
                                        q.title
                                          .toLowerCase()
                                          .includes(inputContent.slice(1).toLowerCase()))
                                  )
                                  .slice(0, 5)
                                  .map((qr) => (
                                    <button
                                      key={qr.id}
                                      type="button"
                                      onClick={() => {
                                        setInputContent(qr.content)
                                        textareaRef.current?.focus()
                                      }}
                                      className="w-full text-left p-1.5 rounded-lg hover:bg-purple-50 transition-colors flex items-center justify-between gap-2"
                                    >
                                      <div className="min-w-0">
                                        <span className="text-xs font-semibold text-ellevee-deep-ink block truncate">
                                          {qr.title}
                                        </span>
                                        <span className="text-[11px] text-slate-500 block truncate">
                                          {qr.content}
                                        </span>
                                      </div>
                                      {qr.shortcut && (
                                        <span className="text-[10px] font-mono font-semibold bg-purple-50 text-purple-700 border border-purple-200 px-1 py-0.2 rounded shrink-0">
                                          /{qr.shortcut}
                                        </span>
                                      )}
                                    </button>
                                  ))}
                              </div>
                            </div>
                          )}
                          <textarea
                            ref={textareaRef}
                            rows={1}
                            value={inputContent}
                            onChange={(e) => handleInputContentChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isSending || isSendingInternalNote || isUploadingMedia || isUploadingAudio}
                            placeholder={
                              selectedFile
                                ? "Adicionar legenda (opcional)..."
                                : sendMode === "note"
                                ? "Escreva uma nota interna privada..."
                                : "Mensagem"
                            }
                            aria-label={sendMode === "note" ? "Escrever nota interna" : "Escrever mensagem para o cliente"}
                            className={`w-full resize-none bg-white rounded-lg px-4 py-2 text-sm text-[#111827] placeholder:text-[#8696a0] focus:outline-none min-h-[38px] max-h-[100px] disabled:opacity-50 overflow-y-auto scroll-slim shadow-2xs transition-all ${
                              sendMode === "note" ? "border border-amber-300 bg-amber-50/50" : "border-none"
                            }`}
                          />
                        </div>

                        {/* Botão Envio / Gravação Circular Verde Teal */}
                        {selectedFile || inputContent.trim() ? (
                          <button
                            type="submit"
                            disabled={isSending || isSendingInternalNote || isUploadingMedia || isUploadingAudio}
                            className={`h-10 w-10 rounded-full flex items-center justify-center text-white shadow-xs transition-transform active:scale-95 shrink-0 ${
                              sendMode === "note" ? "bg-amber-600 hover:bg-amber-700" : "bg-[#005d4b] hover:bg-[#004738]"
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                            title={selectedFile ? "Enviar anexo" : "Enviar mensagem"}
                          >
                            {isSending || isSendingInternalNote || isUploadingMedia || isUploadingAudio ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleStartRecording}
                            disabled={isSending || isSendingInternalNote || isUploadingMedia || isUploadingAudio}
                            className="h-10 w-10 rounded-full flex items-center justify-center text-white bg-[#005d4b] hover:bg-[#004738] shadow-xs transition-transform active:scale-95 shrink-0 disabled:opacity-40"
                            title="Gravar mensagem de voz"
                          >
                            {isUploadingAudio ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <Mic className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </form>
                    )}
                  </div>
                </footer>
            )}
          </div>

          {/* PAINEL LATERAL RETRÁTIL: PERFIL DO CLIENTE (Fase 2) */}
          {isProfileOpen && (
            <aside
              id="painel-perfil-cliente"
              className="w-full lg:w-96 border-l border-ellevee-stone bg-white h-full flex flex-col shrink-0 overflow-y-auto scroll-slim z-40 fixed lg:static inset-0 lg:inset-y-0 lg:right-0 shadow-2xl lg:shadow-none"
            >
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
                  className="p-1.5 rounded-md text-ellevee-ink-muted hover:text-ellevee-ink hover:bg-ellevee-stone transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ellevee-ink/40"
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
                    <p className="text-meta text-ellevee-ink-muted font-mono truncate">
                      {customerForm.phone || activeConversation.external_id || "Sem telefone"}
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-meta text-ellevee-success-strong bg-ellevee-success/10 px-1.5 py-0.5 rounded border border-ellevee-success/30 font-medium mt-1">
                      <WhatsAppIcon className="h-2.5 w-2.5 text-ellevee-ink-muted" />
                      WhatsApp
                    </span>
                  </div>
                </div>

                {/* Formulário de Edição de Dados */}
                <form onSubmit={handleSaveCustomer} className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-meta font-semibold uppercase tracking-wider text-ellevee-ink-muted">
                      Dados Cadastrais
                    </span>
                    {isLoadingCustomer && (
                      <Loader2 className="h-3 w-3 animate-spin text-ellevee-ink-muted" />
                    )}
                  </div>

                  {/* Nome */}
                  <div className="space-y-1">
                    <label className="text-meta font-medium text-ellevee-ink flex items-center gap-1">
                      <User className="h-3 w-3 text-ellevee-ink-muted" />
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
                        <Phone className="h-3 w-3 text-ellevee-ink-muted" />
                        WhatsApp / Telefone
                      </label>
                      {customerForm.phone && (
                        <a
                          href={`https://wa.me/${customerForm.phone.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-meta text-ellevee-success-strong hover:underline"
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
                      <Mail className="h-3 w-3 text-ellevee-ink-muted" />
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
                      <MapPin className="h-3 w-3 text-ellevee-ink-muted" />
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
                      <FileText className="h-3 w-3 text-ellevee-ink-muted" />
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
                  <div className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wider text-ellevee-ink-muted">
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
                  <div className="space-y-2 pt-1">
                    {internalNotes.length === 0 ? (
                      <p className="text-meta text-ellevee-ink-muted italic text-center py-2">
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
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-ellevee-ink-muted space-y-3">
            <MessageSquare className="h-10 w-10 stroke-1 text-ellevee-ink-muted/50" />
            <h3 className="font-display font-semibold text-sm text-ellevee-ink">Nenhuma conversa selecionada</h3>
            <p className="text-meta max-w-xs text-ellevee-ink-muted">
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

      {/* Lightbox Modal para Visualização de Imagem em Tela Cheia (Estilo WhatsApp Web) */}
      {previewImage && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col animate-in fade-in duration-200"
          onClick={() => setPreviewImage(null)}
        >
          {/* Top Bar de Controles */}
          <div
            className="flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent text-white shrink-0 select-none z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-medium text-white/90 truncate max-w-xs md:max-w-md">
                {previewImage.fileName || "Imagem"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={previewImage.url}
                download={previewImage.fileName || "imagem"}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                title="Baixar imagem"
              >
                <Download className="h-5 w-5" />
              </a>
              <a
                href={previewImage.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                title="Abrir imagem em nova aba"
              >
                <ExternalLink className="h-5 w-5" />
              </a>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="p-2.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors ml-2"
                title="Fechar (Esc)"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
          </div>

          {/* Área Central com Imagem */}
          <div
            className="flex-1 flex items-center justify-center p-4 sm:p-8 min-h-0 overflow-auto"
            onClick={() => setPreviewImage(null)}
          >
            <img
              src={previewImage.url}
              alt={previewImage.fileName || "Visualização ampliada"}
              className="max-h-[85vh] max-w-[92vw] object-contain rounded-lg shadow-2xl transition-transform"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* Modal: Iniciar Nova Conversa Ativa */}
      {isNewChatModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => !isStartingNewChat && setIsNewChatModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-100 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabeçalho do Modal */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-[#005d4b] text-white">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-full bg-white/10 text-white">
                  <SquarePen className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Nova Conversa</h3>
                  <p className="text-xs text-white/80">Envie uma mensagem pelo WhatsApp</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isStartingNewChat && setIsNewChatModalOpen(false)}
                className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                title="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Formulário */}
            <form onSubmit={handleStartNewChat} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Telefone WhatsApp <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="tel"
                    required
                    value={newChatPhone}
                    onChange={(e) => setNewChatPhone(e.target.value)}
                    placeholder="Ex: 51 99999-9999 ou 5551999999999"
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#005d4b]/20 focus:border-[#005d4b]"
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  DDI +55 (Brasil) será aplicado automaticamente caso não informado.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Nome do Contato <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={newChatName}
                    onChange={(e) => setNewChatName(e.target.value)}
                    placeholder="Ex: Maria Silva"
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#005d4b]/20 focus:border-[#005d4b]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Primeira Mensagem <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <textarea
                  rows={3}
                  value={newChatMessage}
                  onChange={(e) => setNewChatMessage(e.target.value)}
                  placeholder="Olá! Como posso ajudar você hoje?"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#005d4b]/20 focus:border-[#005d4b] resize-none"
                />
              </div>

              <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-lg text-xs text-emerald-800 flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  O atendimento será iniciado como <strong>Em Atendimento (Com você)</strong>, garantindo que você converse diretamente sem interferência da IA.
                </span>
              </div>

              {/* Botões de Ação */}
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={isStartingNewChat}
                  onClick={() => setIsNewChatModalOpen(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isStartingNewChat || !newChatPhone.trim()}
                  className="px-5 py-2 text-sm bg-[#005d4b] hover:bg-[#004738] text-white rounded-lg transition-colors font-medium flex items-center gap-2 shadow-xs disabled:opacity-50"
                >
                  {isStartingNewChat ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Iniciando...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Iniciar Conversa
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: MOTIVO DE FINALIZAÇÃO DE ATENDIMENTO                                */}
      {/* ========================================================================= */}
      {isCloseReasonModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-ellevee-border space-y-4">
            <div className="flex items-start justify-between border-b border-ellevee-border pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <h3 className="text-base font-bold text-ellevee-deep-ink">
                    Finalizar Atendimento
                  </h3>
                  {companyRequireCloseReason ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full">
                      Obrigatório
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                      Opcional
                    </span>
                  )}
                </div>
                <p className="text-xs text-ellevee-text-secondary mt-1">
                  Selecione o motivo de conclusão para enriquecer as métricas operacionais e histórico do cliente.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCloseReasonModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-ellevee-deep-ink hover:bg-slate-100 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Lista de Motivos Disponíveis */}
            <div className="space-y-2 max-h-60 overflow-y-auto scroll-slim pr-1">
              <label className="block text-xs font-semibold text-ellevee-deep-ink">
                Motivo do Encerramento {companyRequireCloseReason && <span className="text-rose-500">*</span>}
              </label>

              {closeReasons.filter((r) => r.isActive).length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-500">
                  Nenhum motivo cadastrado pela administração.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {closeReasons
                    .filter((r) => r.isActive)
                    .map((r) => {
                      const isSelected = selectedReasonId === r.id
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setSelectedReasonId(r.id)}
                          className={`w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 ${
                            isSelected
                              ? "border-emerald-600 bg-emerald-50/50 shadow-2xs"
                              : "border-ellevee-border hover:bg-slate-50"
                          }`}
                        >
                          <span
                            className={`h-3 w-3 rounded-full mt-0.5 shrink-0 ${
                              r.color === "emerald"
                                ? "bg-emerald-500"
                                : r.color === "blue"
                                ? "bg-blue-500"
                                : r.color === "violet"
                                ? "bg-purple-500"
                                : r.color === "amber"
                                ? "bg-amber-500"
                                : r.color === "rose"
                                ? "bg-rose-500"
                                : r.color === "cyan"
                                ? "bg-cyan-500"
                                : "bg-slate-500"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-semibold text-ellevee-deep-ink block">
                              {r.title}
                            </span>
                            {r.description && (
                              <span className="text-[11px] text-ellevee-text-secondary line-clamp-1 mt-0.5">
                                {r.description}
                              </span>
                            )}
                          </div>
                          {isSelected && (
                            <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                          )}
                        </button>
                      )
                    })}
                </div>
              )}
            </div>

            {/* Observações Opcionais */}
            <div>
              <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1">
                Observações de Encerramento <span className="text-slate-400 font-normal">(opcional)</span>
              </label>
              <textarea
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                rows={2}
                placeholder="Ex: Cliente fechou pedido de R$ 500, comprovante recebido..."
                className="w-full text-xs p-2.5 rounded-xl border border-ellevee-border bg-slate-50/50 text-ellevee-deep-ink focus:outline-none focus:bg-white focus:ring-1 focus:ring-emerald-600 resize-none"
              />
            </div>

            {/* Rodapé de Ações */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-ellevee-border">
              <button
                type="button"
                onClick={() => setIsCloseReasonModalOpen(false)}
                disabled={isClosing}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-ellevee-deep-ink hover:bg-slate-100 rounded-lg transition-colors"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => handleCloseConversation()}
                disabled={isClosing || (companyRequireCloseReason && !selectedReasonId)}
                className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all flex items-center gap-1.5 shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isClosing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Finalizando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Confirmar Encerramento
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: MENSAGENS RÁPIDAS (RESPOSTAS PRONTAS)                              */}
      {/* ========================================================================= */}
      {isQuickRepliesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-ellevee-border space-y-4">
            <div className="flex items-start justify-between border-b border-ellevee-border pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-ellevee-purple" />
                  <h3 className="text-base font-bold text-ellevee-deep-ink">
                    Mensagens Rápidas
                  </h3>
                </div>
                <p className="text-xs text-ellevee-text-secondary mt-1">
                  Selecione uma resposta rápida para inserir instantaneamente no campo de mensagem.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsQuickRepliesOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-ellevee-deep-ink hover:bg-slate-100 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Busca & Filtro de Categorias */}
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={quickReplySearch}
                  onChange={(e) => setQuickReplySearch(e.target.value)}
                  placeholder="Pesquisar por título, atalho (/pix) ou texto..."
                  className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-ellevee-border rounded-lg text-xs text-ellevee-deep-ink placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-ellevee-purple"
                  autoFocus
                />
              </div>

              {/* Categorias */}
              <div className="flex items-center gap-1.5 overflow-x-auto scroll-slim pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedQuickCategory("TODAS")}
                  className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors shrink-0 ${
                    selectedQuickCategory === "TODAS"
                      ? "bg-ellevee-deep-ink text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  Todas
                </button>
                {Array.from(new Set(quickReplies.map((q) => q.category))).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedQuickCategory(cat)}
                    className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors shrink-0 ${
                      selectedQuickCategory.toLowerCase() === cat.toLowerCase()
                        ? "bg-ellevee-purple text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Lista de Respostas */}
            <div className="max-h-72 overflow-y-auto scroll-slim space-y-2 pr-1">
              {quickReplies
                .filter((q) => {
                  if (!q.isActive) return false
                  const matchSearch =
                    q.title.toLowerCase().includes(quickReplySearch.toLowerCase()) ||
                    q.content.toLowerCase().includes(quickReplySearch.toLowerCase()) ||
                    (q.shortcut && q.shortcut.toLowerCase().includes(quickReplySearch.toLowerCase()))
                  const matchCat =
                    selectedQuickCategory === "TODAS" ||
                    q.category.toLowerCase() === selectedQuickCategory.toLowerCase()
                  return matchSearch && matchCat
                })
                .map((qr) => (
                  <div
                    key={qr.id}
                    onClick={() => {
                      setInputContent((prev) => (prev ? `${prev}\n${qr.content}` : qr.content))
                      setIsQuickRepliesOpen(false)
                      setTimeout(() => textareaRef.current?.focus(), 100)
                    }}
                    className="p-3 rounded-xl border border-ellevee-border hover:border-ellevee-purple/60 hover:bg-purple-50/30 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-ellevee-deep-ink group-hover:text-ellevee-purple transition-colors">
                          {qr.title}
                        </span>
                        {qr.shortcut && (
                          <span className="text-[10px] font-mono font-semibold bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.2 rounded">
                            /{qr.shortcut}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {qr.category}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 font-sans whitespace-pre-wrap line-clamp-2 mt-1 leading-relaxed">
                      {qr.content}
                    </p>
                  </div>
                ))}

              {quickReplies.filter((q) => q.isActive).length === 0 && (
                <div className="p-8 text-center text-xs text-slate-400">
                  Nenhuma mensagem rápida ativa disponível.
                </div>
              )}
            </div>

            {/* Dica de Atalho */}
            <div className="pt-2 border-t border-ellevee-border flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5 text-purple-600" />
                Dica: Digite <kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[10px] border border-slate-200">/atalho</kbd> no chat para inserir instantaneamente.
              </span>
              <button
                type="button"
                onClick={() => setIsQuickRepliesOpen(false)}
                className="px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-100 font-medium"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

"use client"

import React, { useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Bot,
  Calendar,
  CheckCheck,
  ChevronRight,
  Copy,
  FileText,
  Hourglass,
  Info,
  Lock,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  Mic,
  Monitor,
  MoreVertical,
  PackageCheck,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Phone,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  SquarePen,
  StickyNote,
  Tag,
  User,
  UserCheck,
  Users,
  X,
  Zap,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { ElleveeLogo } from "@/components/ui/ellevee-logo"
import { Input } from "@/components/ui/input"
import { COMPOSER_MAX_HEIGHT_PX } from "@/lib/ui/conversations-viewport"

type PrototypeRole = "customer" | "ai" | "human" | "internal_note" | "system"
type PrototypeConvStatus = "waiting" | "ai" | "human" | "closed"
type FilterTab = "all" | "waiting" | "human" | "ai" | "closed"
type InspectorTab = "profile" | "notes" | "ai_summary"
type PreviewStageMode = "gallery" | "desktop" | "mobile_list" | "mobile_chat" | "mobile_sheet"

interface PrototypeQuoteBreakdown {
  quoteCode: string
  version: number
  items: {
    sku: string
    name: string
    requestedLabel: string
    convertedUnits: number
    unitPrice: string
    subtotal: string
  }[]
  total: string
}

interface PrototypeMessage {
  id: string
  role: PrototypeRole
  authorName: string
  content: string
  timestamp: string
  deliveryStatus?: "sent" | "delivered" | "read"
  quoteBreakdown?: PrototypeQuoteBreakdown
}

interface PrototypeConversation {
  id: string
  customerName: string
  initials: string
  phone: string
  email: string
  address: string
  customerNotes: string
  status: PrototypeConvStatus
  assignedOperator?: string
  agentName: string
  stageName: string
  stageColor: string
  unreadCount: number
  lastTime: string
  preview: string
  aiIntent: string
  messages: PrototypeMessage[]
}

const WORKFLOW_STAGES = [
  { id: "st-1", name: "Qualificação", color: "#087BEA" },
  { id: "st-2", name: "Orçamento Enviado", color: "#7028D9" },
  { id: "st-3", name: "Aguardando Fechamento", color: "#B45309" },
  { id: "st-4", name: "Pedido Confirmado", color: "#15803D" },
]

const INITIAL_CONVERSATIONS: PrototypeConversation[] = [
  {
    id: "conv-1",
    customerName: "Mariana Ferreira · Mercado Bom Preço",
    initials: "MF",
    phone: "+55 (51) 99812-4410",
    email: "compras@mercadobompreco.com.br",
    address: "Av. Bento Gonçalves, 2410 — Porto Alegre, RS",
    customerNotes: "Compra quinzenal no atacado. Prefere entrega pela manhã e boleto 14 dias.",
    status: "ai",
    agentName: "Sofia IA",
    stageName: "Orçamento Enviado",
    stageColor: "#7028D9",
    unreadCount: 2,
    lastTime: "14:32",
    preview: "São 2 caixas (54 un.), R$ 313,20 no atacado.",
    aiIntent: "Cotação atacado + geração de orçamento v2",
    messages: [
      {
        id: "m-1",
        role: "system",
        authorName: "Sistema",
        content: "Atendimento iniciado via WhatsApp Business · Roteado para Sofia IA",
        timestamp: "14:18",
      },
      {
        id: "m-2",
        role: "customer",
        authorName: "Mariana Ferreira",
        content: "Boa tarde! Preciso de 2 caixas de leite condensado Tirol 395g e 5 unidades de chocolate em pó Melken 50% 1kg.",
        timestamp: "14:21",
      },
      {
        id: "m-3",
        role: "ai",
        authorName: "Sofia IA",
        content: "Boa tarde, Mariana! Conferi os valores atualizados no catálogo para o seu pedido em atacado:",
        timestamp: "14:22",
        deliveryStatus: "read",
        quoteBreakdown: {
          quoteCode: "ORC-2026-0148",
          version: 2,
          items: [
            {
              sku: "SYNTH-AC046-01",
              name: "Leite Condensado Tirol 395g (Cx c/ 27)",
              requestedLabel: "2 caixas",
              convertedUnits: 54,
              unitPrice: "R$ 5,80",
              subtotal: "R$ 313,20",
            },
            {
              sku: "SYNTH-AC046-04",
              name: "Chocolate em Pó Melken 50% 1kg",
              requestedLabel: "5 unidades",
              convertedUnits: 5,
              unitPrice: "R$ 38,00",
              subtotal: "R$ 190,00",
            },
          ],
          total: "R$ 503,20",
        },
      },
      {
        id: "m-4",
        role: "internal_note",
        authorName: "Ana Paula (Supervisão)",
        content: "Cliente possui limite aprovado para faturamento 14d caso solicite fechamento com humano.",
        timestamp: "14:27",
      },
      {
        id: "m-5",
        role: "customer",
        authorName: "Mariana Ferreira",
        content: "Perfeito! Se eu quiser fechar agora no CNPJ com boleto 14 dias, consigo falar com o financeiro?",
        timestamp: "14:30",
      },
      {
        id: "m-6",
        role: "human",
        authorName: "Ana Paula · Você",
        content: "Oi Mariana! Já assumi por aqui para agilizar o seu boleto 14 dias. Pode confirmar o CNPJ de faturamento?",
        timestamp: "14:32",
        deliveryStatus: "delivered",
      },
    ],
  },
  {
    id: "conv-2",
    customerName: "Carlos Eduardo · Padaria Central",
    initials: "CE",
    phone: "+55 (11) 98441-2209",
    email: "carlos@padariacentral.com.br",
    address: "Rua Augusta, 980 — São Paulo, SP",
    customerNotes: "Solicitou validação de entrega refrigerada.",
    status: "waiting",
    agentName: "Sofia IA",
    stageName: "Aguardando Fechamento",
    stageColor: "#B45309",
    unreadCount: 1,
    lastTime: "14:19",
    preview: "Aguardando operador: cliente pediu condição especial.",
    aiIntent: "Transbordo comercial para condição de frete",
    messages: [
      {
        id: "m-21",
        role: "customer",
        authorName: "Carlos Eduardo",
        content: "Quero fechar 3 caixas do leite condensado Tirol + 1 fardo de leite UHT, mas preciso confirmar horário de descarga.",
        timestamp: "14:18",
      },
      {
        id: "m-22",
        role: "system",
        authorName: "Sistema",
        content: "Sofia IA transferiu para fila humana · Motivo: janela logística",
        timestamp: "14:19",
      },
    ],
  },
  {
    id: "conv-3",
    customerName: "Juliana Costa · Confeitaria Doce Lar",
    initials: "JC",
    phone: "+55 (41) 99105-7741",
    email: "juliana@docelar.art.br",
    address: "Rua XV de Novembro, 412 — Curitiba, PR",
    customerNotes: "Cliente recorrente de insumos para confeitaria.",
    status: "human",
    assignedOperator: "Ana Paula",
    agentName: "Sofia IA",
    stageName: "Pedido Confirmado",
    stageColor: "#15803D",
    unreadCount: 0,
    lastTime: "13:54",
    preview: "Comprovante recebido e pedido liberado para separação.",
    aiIntent: "Atendimento humano ativo",
    messages: [
      {
        id: "m-31",
        role: "customer",
        authorName: "Juliana Costa",
        content: "Acabei de enviar o comprovante do PIX referente ao orçamento #141.",
        timestamp: "13:50",
      },
      {
        id: "m-32",
        role: "human",
        authorName: "Ana Paula · Você",
        content: "Recebido, Juliana! Já confirmei o pagamento aqui e liberei a nota fiscal.",
        timestamp: "13:54",
        deliveryStatus: "read",
      },
    ],
  },
  {
    id: "conv-4",
    customerName: "Roberto Almeida · Empório Sul",
    initials: "RA",
    phone: "+55 (51) 99603-8820",
    email: "contato@emporiosul.com.br",
    address: "Av. Ipiranga, 1500 — Porto Alegre, RS",
    customerNotes: "Consulta eventual de tabela varejo vs atacado.",
    status: "closed",
    agentName: "Sofia IA",
    stageName: "Pedido Confirmado",
    stageColor: "#15803D",
    unreadCount: 0,
    lastTime: "Ontem",
    preview: "Atendimento finalizado · Orçamento aprovado.",
    aiIntent: "Encerrado",
    messages: [
      {
        id: "m-41",
        role: "ai",
        authorName: "Sofia IA",
        content: "Leite UHT Integral 1L: R$ 4,80 no varejo (1 a 11 un.) e R$ 4,20 no atacado a partir de 12 unidades (fardo c/ 12 sai por R$ 50,40).",
        timestamp: "Ontem",
        deliveryStatus: "read",
      },
    ],
  },
]

function getStatusPill(status: PrototypeConvStatus, agentName: string) {
  switch (status) {
    case "waiting":
      return {
        label: "Aguardando",
        badgeClass: "bg-ellevee-warning/10 text-ellevee-warning-strong border-ellevee-warning/30",
        dotClass: "bg-ellevee-warning",
        Icon: Hourglass,
      }
    case "human":
      return {
        label: "Com você",
        badgeClass: "bg-ellevee-success/10 text-ellevee-success-strong border-ellevee-success/30",
        dotClass: "bg-ellevee-success",
        Icon: UserCheck,
      }
    case "closed":
      return {
        label: "Finalizado",
        badgeClass: "bg-ellevee-stone-subtle text-ellevee-text-secondary border-ellevee-border",
        dotClass: "bg-ellevee-text-secondary",
        Icon: PackageCheck,
      }
    default:
      return {
        label: agentName,
        badgeClass: "bg-[#F3EEFE] text-[#5F1EC2] border-[#7028D9]/25",
        dotClass: "bg-ellevee-purple",
        Icon: Sparkles,
      }
  }
}

function MessageCard({ msg }: { msg: PrototypeMessage }) {
  const [copied, setCopied] = useState(false)

  if (msg.role === "system") {
    return (
      <div className="flex justify-center py-1">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-ellevee-border bg-white px-3 py-1 text-[11px] font-medium text-ellevee-text-secondary shadow-2xs">
          <Sparkles className="h-3 w-3 text-ellevee-blue shrink-0" />
          <span>{msg.content}</span>
        </div>
      </div>
    )
  }

  if (msg.role === "internal_note") {
    return (
      <div className="group relative mx-auto max-w-xl rounded-card border border-note-border-strong bg-note-bg px-4 py-3 text-note-text shadow-2xs">
        <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-note-strong">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-note-accent shrink-0" />
            <span>Nota Interna · {msg.authorName}</span>
          </span>
          <span className="font-mono text-note-accent">{msg.timestamp}</span>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-note-text">{msg.content}</p>
        <span className="mt-1.5 inline-block text-[10px] font-medium text-note-accent">
          Visível apenas para operadores internos
        </span>
      </div>
    )
  }

  const isCustomer = msg.role === "customer"
  const isAI = msg.role === "ai"
  const isHuman = msg.role === "human"

  const bubbleClasses = isCustomer
    ? "bg-white border border-ellevee-border text-ellevee-deep-ink rounded-2xl rounded-tl-sm shadow-2xs"
    : isAI
    ? "bg-[#F5F7FF] border border-ellevee-blue/25 text-ellevee-deep-ink rounded-2xl rounded-tr-sm shadow-2xs"
    : "bg-ellevee-deep-ink border border-ellevee-deep-ink text-white rounded-2xl rounded-tr-sm shadow-card"

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(msg.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }
  }

  return (
    <div className={`group flex flex-col ${isCustomer ? "items-start" : "items-end"}`}>
      <div className={`relative max-w-[88%] sm:max-w-[78%] px-3.5 py-2.5 transition-shadow ${bubbleClasses}`}>
        {/* Ação contextual discreta estilo Teams no hover/focus */}
        <div
          className={`absolute -top-3 ${
            isCustomer ? "right-2" : "left-2"
          } hidden group-hover:flex group-focus-within:flex items-center gap-0.5 rounded-lg border border-ellevee-border bg-white p-0.5 text-ellevee-deep-ink shadow-elevated z-10`}
        >
          <button
            type="button"
            onClick={handleCopy}
            className="h-7 px-2 rounded-md text-[11px] font-medium hover:bg-ellevee-stone-subtle inline-flex items-center gap-1 cursor-pointer"
            title="Copiar texto"
            aria-label="Copiar texto da mensagem"
          >
            <Copy className="h-3 w-3" />
            <span>{copied ? "Copiado" : "Copiar"}</span>
          </button>
        </div>

        {/* Cabeçalho nominal por papel (Cliente / Sofia IA / Atendente Humano) */}
        <div className="mb-1 flex items-center justify-between gap-3">
          {isCustomer && (
            <span className="text-[11px] font-semibold text-ellevee-text-secondary">
              {msg.authorName} · Cliente
            </span>
          )}
          {isAI && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#5F1EC2]">
              <Sparkles className="h-3 w-3 text-ellevee-purple" />
              <span>{msg.authorName} · Automação Comercial</span>
            </span>
          )}
          {isHuman && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ellevee-cyan">
              <UserCheck className="h-3 w-3" />
              <span>{msg.authorName}</span>
            </span>
          )}
        </div>

        <p className={`text-[13.5px] leading-relaxed whitespace-pre-wrap ${isHuman ? "text-white/95" : "text-ellevee-deep-ink"}`}>
          {msg.content}
        </p>

        {/* Cartão estruturado de orçamento dentro da resposta da Sofia IA */}
        {msg.quoteBreakdown && (
          <div className="mt-2.5 rounded-xl border border-ellevee-blue/20 bg-white p-3 text-ellevee-deep-ink shadow-2xs space-y-2">
            <div className="flex items-center justify-between gap-2 border-b border-ellevee-border pb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ellevee-blue">
                {msg.quoteBreakdown.quoteCode} · v{msg.quoteBreakdown.version}
              </span>
              <span className="text-[11px] font-mono text-ellevee-text-secondary">
                Cálculo backend auditado
              </span>
            </div>
            <div className="space-y-1.5">
              {msg.quoteBreakdown.items.map((item) => (
                <div key={item.sku} className="flex items-start justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-ellevee-deep-ink truncate">{item.name}</p>
                    <p className="text-[11px] text-ellevee-text-secondary font-mono">
                      {item.requestedLabel} ({item.convertedUnits} un.) × {item.unitPrice}/un
                    </p>
                  </div>
                  <span className="font-mono font-semibold text-ellevee-deep-ink shrink-0">
                    {item.subtotal}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-ellevee-border pt-1.5 text-xs font-bold">
              <span>Total do Orçamento</span>
              <span className="font-mono text-sm text-ellevee-blue">{msg.quoteBreakdown.total}</span>
            </div>
          </div>
        )}

        <div
          className={`mt-1.5 flex items-center justify-end gap-1 font-mono text-[10px] ${
            isHuman ? "text-white/70" : "text-ellevee-text-secondary"
          }`}
        >
          <span>{msg.timestamp}</span>
          {!isCustomer && <CheckCheck className={`h-3 w-3 ${msg.deliveryStatus === "read" ? "text-ellevee-cyan" : ""}`} />}
        </div>
      </div>
    </div>
  )
}

function DesktopWorkspacePreview({
  conversations,
  selectedId,
  onSelectConversation,
  activeFilter,
  onChangeFilter,
  searchQuery,
  onChangeSearch,
  inspectorOpen,
  onToggleInspector,
  inspectorTab,
  onChangeInspectorTab,
  composerMode,
  onChangeComposerMode,
  composerText,
  onChangeComposerText,
  onSendMessage,
  onToggleOwnership,
  onChangeStage,
  noteDraft,
  onChangeNoteDraft,
  onAddQuickNote,
  fullHeight = false,
}: {
  conversations: PrototypeConversation[]
  selectedId: string
  onSelectConversation: (id: string) => void
  activeFilter: FilterTab
  onChangeFilter: (tab: FilterTab) => void
  searchQuery: string
  onChangeSearch: (value: string) => void
  inspectorOpen: boolean
  onToggleInspector: () => void
  inspectorTab: InspectorTab
  onChangeInspectorTab: (tab: InspectorTab) => void
  composerMode: "whatsapp" | "note"
  onChangeComposerMode: (mode: "whatsapp" | "note") => void
  composerText: string
  onChangeComposerText: (value: string) => void
  onSendMessage: () => void
  onToggleOwnership: () => void
  onChangeStage: (stageName: string, stageColor: string) => void
  noteDraft: string
  onChangeNoteDraft: (value: string) => void
  onAddQuickNote: () => void
  fullHeight?: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const activeConv = conversations.find((c) => c.id === selectedId) || conversations[0]

  const filteredList = useMemo(() => {
    return conversations.filter((c) => {
      const matchesTab = activeFilter === "all" || c.status === activeFilter
      const q = searchQuery.trim().toLowerCase()
      const matchesSearch =
        !q ||
        c.customerName.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q) ||
        c.stageName.toLowerCase().includes(q)
      return matchesTab && matchesSearch
    })
  }, [conversations, activeFilter, searchQuery])

  const counts = useMemo(
    () => ({
      all: conversations.length,
      waiting: conversations.filter((c) => c.status === "waiting").length,
      human: conversations.filter((c) => c.status === "human").length,
      ai: conversations.filter((c) => c.status === "ai").length,
      closed: conversations.filter((c) => c.status === "closed").length,
    }),
    [conversations]
  )

  const internalNotes = activeConv.messages.filter((m) => m.role === "internal_note")
  const activeStatus = getStatusPill(activeConv.status, activeConv.agentName)

  const handleTextareaChange = (val: string) => {
    onChangeComposerText(val)
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    if (val) {
      el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`
    }
  }

  return (
    <div
      data-testid="prototype-desktop-workspace"
      className={`flex ${fullHeight ? "h-full" : "h-[740px]"} w-full overflow-hidden rounded-card border border-ellevee-border bg-ellevee-warm-ivory text-ellevee-deep-ink shadow-modal`}
    >
      {/* 1. RAIL CORPORATIVO COMPACTO (Fluent App Bar em Deep Ink) */}
      <aside
        aria-label="Navegação corporativa do protótipo"
        className="flex w-14 shrink-0 flex-col items-center justify-between border-r border-white/10 bg-ellevee-deep-ink py-3 text-white/75"
      >
        <div className="flex flex-col items-center gap-2.5 w-full">
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 border border-white/10">
            <ElleveeLogo variant="icon" size="xs" />
          </div>

          <button
            type="button"
            className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/12 text-white shadow-2xs focus-ring"
            title="Conversas & Chat"
            aria-label="Conversas e Chat"
          >
            <span className="absolute -left-2 h-5 w-[3px] rounded-full bg-ellevee-gradient" />
            <MessageSquare className="h-5 w-5" />
          </button>

          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/10 hover:text-white transition-colors"
            title="Clientes"
            aria-label="Clientes"
          >
            <Users className="h-5 w-5" />
          </button>

          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/10 hover:text-white transition-colors"
            title="Agentes IA"
            aria-label="Agentes IA"
          >
            <Bot className="h-5 w-5" />
          </button>

          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/10 hover:text-white transition-colors"
            title="Funil Kanban"
            aria-label="Funil Kanban"
          >
            <Calendar className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-2.5 border-t border-white/10 pt-3 w-full">
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/10 hover:text-white transition-colors"
            title="Configurações"
            aria-label="Configurações"
          >
            <Settings className="h-5 w-5" />
          </button>
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ellevee-gradient text-[11px] font-bold text-white shadow-2xs"
            title="Ana Paula (Operadora)"
          >
            AP
          </div>
        </div>
      </aside>

      {/* 2. PANE 1: FILA DE CONVERSAS ESTILO OUTLOOK */}
      <aside
        aria-label="Fila de atendimentos desktop"
        className="flex w-[328px] xl:w-[352px] shrink-0 flex-col border-r border-ellevee-border bg-white"
      >
        <div className="border-b border-ellevee-border px-3.5 py-3 space-y-2.5 bg-white">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-bold tracking-tight text-ellevee-deep-ink">
                Atendimentos
              </h2>
              <p className="text-[11px] text-ellevee-text-secondary">
                Distribuidora Ellevee QA · Canal WhatsApp
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" title="Abrir Funil Kanban" aria-label="Abrir Funil Kanban">
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
              <Button variant="default" size="sm" className="gap-1.5" title="Nova conversa">
                <SquarePen className="h-3.5 w-3.5" />
                <span>Nova</span>
              </Button>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ellevee-text-secondary" />
            <Input
              value={searchQuery}
              onChange={(e) => onChangeSearch(e.target.value)}
              placeholder="Buscar cliente, etapa ou mensagem..."
              aria-label="Buscar conversa no protótipo desktop"
              className="h-9 bg-ellevee-stone-subtle pl-8 text-xs border-ellevee-border focus-visible:bg-white focus-visible:border-ellevee-blue focus-visible:ring-ellevee-blue/25"
            />
          </div>

          {/* Pivot de filtros legível com rótulos e contadores */}
          <div className="flex items-center gap-1 overflow-x-auto scroll-slim pb-0.5" role="tablist" aria-label="Filtros da fila">
            {[
              { id: "all" as const, label: "Todas", count: counts.all },
              { id: "waiting" as const, label: "Fila", count: counts.waiting },
              { id: "human" as const, label: "Você", count: counts.human },
              { id: "ai" as const, label: "Sofia IA", count: counts.ai },
              { id: "closed" as const, label: "Fim", count: counts.closed },
            ].map((tab) => {
              const active = activeFilter === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onChangeFilter(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-btn px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? "bg-ellevee-accent-muted text-ellevee-blue border border-ellevee-blue/25"
                      : "text-ellevee-text-secondary hover:bg-ellevee-stone-subtle hover:text-ellevee-deep-ink border border-transparent"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 font-mono text-[10px] ${
                      active ? "bg-ellevee-blue text-white" : "bg-ellevee-warm-ivory text-ellevee-text-secondary"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Lista de cards */}
        <div className="flex-1 overflow-y-auto scroll-slim p-2 space-y-1 bg-white">
          {filteredList.map((conv) => {
            const isSelected = conv.id === activeConv.id
            const statusPill = getStatusPill(conv.status, conv.agentName)
            const StatusIcon = statusPill.Icon

            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelectConversation(conv.id)}
                aria-current={isSelected ? "true" : undefined}
                className={`group relative flex w-full items-start gap-2.5 rounded-lg p-2.5 text-left transition-all cursor-pointer border ${
                  isSelected
                    ? "bg-[#F4F8FE] border-ellevee-blue/25 shadow-2xs"
                    : "bg-white border-transparent hover:bg-ellevee-stone-subtle hover:border-ellevee-border/70"
                }`}
              >
                {/* Fluent Selection Pill Indicator */}
                {isSelected && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full bg-ellevee-blue"
                  />
                )}

                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    isSelected
                      ? "bg-ellevee-deep-ink text-white"
                      : conv.status === "waiting"
                      ? "bg-ellevee-warning/10 text-ellevee-warning-strong border border-ellevee-warning/30"
                      : "bg-ellevee-warm-ivory text-ellevee-deep-ink border border-ellevee-border"
                  }`}
                >
                  {conv.initials}
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-ellevee-deep-ink">
                      {conv.customerName}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-ellevee-text-secondary">
                      {conv.lastTime}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-ellevee-text-secondary">{conv.preview}</p>
                    {conv.unreadCount > 0 && (
                      <span className="flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full bg-ellevee-blue px-1 font-mono text-[10px] font-bold text-white">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.2 text-[10px] font-semibold ${statusPill.badgeClass}`}
                    >
                      <StatusIcon className="h-2.5 w-2.5" />
                      <span>{statusPill.label}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded border border-ellevee-border bg-ellevee-stone-subtle px-1.5 py-0.2 text-[10px] font-medium text-ellevee-deep-ink">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: conv.stageColor }}
                      />
                      <span className="truncate max-w-[120px]">{conv.stageName}</span>
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* 3. PANE 2: PALCO CENTRAL DE MENSAGENS ESTILO TEAMS */}
      <main className="flex min-w-0 flex-1 flex-col bg-ellevee-stone-subtle">
        {/* Cabeçalho Contextual */}
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-ellevee-border bg-white px-4 shadow-2xs">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ellevee-deep-ink text-xs font-bold text-white">
              {activeConv.initials}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-display text-sm font-bold text-ellevee-deep-ink">
                  {activeConv.customerName}
                </h3>
                <DropdownMenu
                  align="left"
                  trigger={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-full border border-ellevee-border bg-ellevee-stone-subtle px-2.5 py-0.5 text-[11px] font-medium text-ellevee-deep-ink hover:bg-ellevee-warm-ivory cursor-pointer"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: activeConv.stageColor }}
                      />
                      <span>{activeConv.stageName}</span>
                    </button>
                  }
                >
                  <DropdownMenuLabel>Etapa do Funil</DropdownMenuLabel>
                  {WORKFLOW_STAGES.map((st) => (
                    <DropdownMenuItem
                      key={st.id}
                      onClick={() => onChangeStage(st.name, st.color)}
                    >
                      <span
                        className="mr-2 h-2 w-2 rounded-full"
                        style={{ backgroundColor: st.color }}
                      />
                      <span>{st.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
              </div>
              <p className="mt-0.5 flex items-center gap-2 text-[11px] text-ellevee-text-secondary">
                <span className="font-mono">{activeConv.phone}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1 font-medium text-ellevee-deep-ink">
                  <span className={`h-1.5 w-1.5 rounded-full ${activeStatus.dotClass}`} />
                  {activeStatus.label}
                </span>
              </p>
            </div>
          </div>

          {/* Ações contextuais e controle IA / Humano */}
          <div className="flex items-center gap-2 shrink-0">
            {activeConv.status === "human" ? (
              <Button variant="outline" size="sm" onClick={onToggleOwnership} className="gap-1.5">
                <Bot className="h-3.5 w-3.5 text-ellevee-purple" />
                <span>Devolver para Sofia</span>
              </Button>
            ) : activeConv.status === "closed" ? (
              <Button variant="outline" size="sm" onClick={onToggleOwnership} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5 text-ellevee-success" />
                <span>Reabrir</span>
              </Button>
            ) : (
              <Button variant="default" size="sm" onClick={onToggleOwnership} className="gap-1.5">
                <UserCheck className="h-3.5 w-3.5 text-ellevee-cyan" />
                <span>Assumir atendimento</span>
              </Button>
            )}

            <Button
              variant={inspectorOpen ? "secondary" : "outline"}
              size="sm"
              onClick={onToggleInspector}
              className="gap-1.5"
              title={inspectorOpen ? "Recolher inspector" : "Abrir inspector"}
            >
              {inspectorOpen ? (
                <PanelRightClose className="h-3.5 w-3.5" />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5" />
              )}
              <span>Inspector</span>
            </Button>

            <DropdownMenu
              align="right"
              trigger={
                <Button variant="ghost" size="icon" aria-label="Mais ações da conversa desktop">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              }
            >
              <DropdownMenuLabel>Ações rápidas</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onChangeInspectorTab("profile")}>
                <User className="mr-2 h-3.5 w-3.5" />
                <span>Ver Perfil do Cliente</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onChangeInspectorTab("notes")}>
                <StickyNote className="mr-2 h-3.5 w-3.5 text-note-accent" />
                <span>Notas Internas ({internalNotes.length})</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive>
                <span>Finalizar atendimento</span>
              </DropdownMenuItem>
            </DropdownMenu>
          </div>
        </header>

        {/* Stream de mensagens */}
        <section
          role="log"
          aria-label="Histórico do protótipo desktop"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-slim px-5 py-4 space-y-3"
        >
          <div className="mx-auto max-w-3xl space-y-3">
            {activeConv.messages.map((msg) => (
              <MessageCard key={msg.id} msg={msg} />
            ))}
          </div>
        </section>

        {/* Composer Profissional */}
        <footer className="shrink-0 border-t border-ellevee-border bg-white px-4 py-3">
          <div className="mx-auto max-w-3xl space-y-2">
            {/* Faixa de segurança operacional quando a IA ainda está conduzindo */}
            {activeConv.status === "ai" && composerMode === "whatsapp" && (
              <div className="flex items-center justify-between gap-2 rounded-btn border border-[#7028D9]/20 bg-[#F5F2FE] px-3 py-1.5 text-[11px] text-[#4C1D95]">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Info className="h-3.5 w-3.5 shrink-0 text-ellevee-purple" />
                  Sofia IA ativa neste atendimento. Ao responder ou assumir, a condução passa para você.
                </span>
                <button
                  type="button"
                  onClick={onToggleOwnership}
                  className="font-semibold underline underline-offset-2 hover:text-ellevee-deep-ink cursor-pointer shrink-0"
                >
                  Assumir agora
                </button>
              </div>
            )}

            <div
              className={`rounded-card border p-2.5 transition-colors ${
                composerMode === "note"
                  ? "border-note-focus bg-note-bg/45"
                  : "border-ellevee-border bg-ellevee-stone-subtle/70 focus-within:bg-white focus-within:border-ellevee-blue"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="inline-flex rounded-btn border border-ellevee-border bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => onChangeComposerMode("whatsapp")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      composerMode === "whatsapp"
                        ? "bg-ellevee-deep-ink text-white"
                        : "text-ellevee-text-secondary hover:text-ellevee-deep-ink"
                    }`}
                  >
                    Mensagem WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeComposerMode("note")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      composerMode === "note"
                        ? "bg-note-accent text-white"
                        : "text-ellevee-text-secondary hover:text-ellevee-deep-ink"
                    }`}
                  >
                    Nota Interna
                  </button>
                </div>
                <span className="text-[11px] text-ellevee-text-secondary">
                  Digite <kbd className="rounded border border-ellevee-border bg-white px-1 font-mono text-[10px]">/</kbd> para respostas rápidas
                </span>
              </div>

              <textarea
                ref={textareaRef}
                rows={2}
                value={composerText}
                onChange={(e) => handleTextareaChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    onSendMessage()
                  }
                }}
                placeholder={
                  composerMode === "note"
                    ? "Registrar orientação interna para a equipe..."
                    : `Responder para ${activeConv.customerName.split("·")[0].trim()}...`
                }
                aria-label="Campo de mensagem do protótipo desktop"
                className="w-full resize-none bg-transparent text-xs leading-relaxed text-ellevee-deep-ink placeholder:text-ellevee-text-secondary/70 focus:outline-none max-h-[112px] overflow-y-auto scroll-slim"
              />

              <div className="mt-2 flex items-center justify-between border-t border-ellevee-border/70 pt-2">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" title="Anexar arquivo" aria-label="Anexar arquivo">
                    <Paperclip className="h-4 w-4 text-ellevee-text-secondary" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Respostas rápidas" aria-label="Respostas rápidas">
                    <Zap className="h-4 w-4 text-ellevee-purple" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Gravar áudio" aria-label="Gravar áudio">
                    <Mic className="h-4 w-4 text-ellevee-text-secondary" />
                  </Button>
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={onSendMessage}
                  disabled={!composerText.trim()}
                  className={`gap-1.5 ${
                    composerMode === "note"
                      ? "bg-note-accent hover:bg-note-strong text-white"
                      : "bg-ellevee-blue hover:bg-ellevee-info-strong text-white"
                  }`}
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{composerMode === "note" ? "Salvar Nota" : "Enviar"}</span>
                </Button>
              </div>
            </div>
          </div>
        </footer>
      </main>

      {/* 4. PANE 3: INSPECTOR LATERAL RECOLHÍVEL */}
      {inspectorOpen && (
        <aside
          data-testid="prototype-desktop-inspector"
          aria-label="Inspector lateral do cliente"
          className="flex w-[336px] shrink-0 flex-col border-l border-ellevee-border bg-white"
        >
          <div className="flex items-center justify-between border-b border-ellevee-border px-3.5 py-2.5 bg-ellevee-stone-subtle">
            <div className="flex items-center gap-1 rounded-btn border border-ellevee-border bg-white p-0.5">
              {[
                { id: "profile" as const, label: "Perfil" },
                { id: "notes" as const, label: `Notas (${internalNotes.length})` },
                { id: "ai_summary" as const, label: "IA" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChangeInspectorTab(t.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    inspectorTab === t.id
                      ? "bg-ellevee-deep-ink text-white"
                      : "text-ellevee-text-secondary hover:text-ellevee-deep-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleInspector}
              aria-label="Fechar inspector desktop"
              title="Recolher inspector"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto scroll-slim p-4 space-y-4">
            {inspectorTab === "profile" && (
              <>
                <div className="rounded-card border border-ellevee-border bg-ellevee-stone-subtle p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ellevee-deep-ink text-xs font-bold text-white shrink-0">
                      {activeConv.initials}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-ellevee-deep-ink">
                        {activeConv.customerName}
                      </p>
                      <p className="font-mono text-[11px] text-ellevee-text-secondary">
                        {activeConv.phone}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ellevee-deep-ink">
                    <Tag className="h-3.5 w-3.5 text-ellevee-purple" />
                    <span>Etapa do Funil</span>
                  </label>
                  <select
                    value={activeConv.stageName}
                    onChange={(e) => {
                      const found = WORKFLOW_STAGES.find((s) => s.name === e.target.value)
                      if (found) onChangeStage(found.name, found.color)
                    }}
                    className="h-9 w-full rounded-btn border border-ellevee-border bg-white px-2.5 text-xs font-medium text-ellevee-deep-ink focus:outline-none focus:border-ellevee-blue"
                  >
                    {WORKFLOW_STAGES.map((st) => (
                      <option key={st.id} value={st.name}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-3 border-t border-ellevee-border pt-3 text-xs">
                  <div>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-ellevee-text-secondary">
                      <Phone className="h-3 w-3" /> Telefone
                    </span>
                    <p className="mt-0.5 font-mono text-ellevee-deep-ink">{activeConv.phone}</p>
                  </div>
                  <div>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-ellevee-text-secondary">
                      <Mail className="h-3 w-3" /> E-mail
                    </span>
                    <p className="mt-0.5 truncate text-ellevee-deep-ink">{activeConv.email}</p>
                  </div>
                  <div>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-ellevee-text-secondary">
                      <MapPin className="h-3 w-3" /> Endereço
                    </span>
                    <p className="mt-0.5 text-ellevee-deep-ink leading-relaxed">{activeConv.address}</p>
                  </div>
                  <div>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-ellevee-text-secondary">
                      <FileText className="h-3 w-3" /> Observações Comerciais
                    </span>
                    <p className="mt-1 rounded-btn border border-ellevee-border bg-ellevee-stone-subtle p-2.5 text-[11px] leading-relaxed text-ellevee-deep-ink">
                      {activeConv.customerNotes}
                    </p>
                  </div>
                  <Button variant="default" className="w-full gap-1.5">
                    <Save className="h-3.5 w-3.5" />
                    <span>Salvar alterações (Protótipo)</span>
                  </Button>
                </div>
              </>
            )}

            {inspectorTab === "notes" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <textarea
                    rows={3}
                    value={noteDraft}
                    onChange={(e) => onChangeNoteDraft(e.target.value)}
                    placeholder="Escrever nota interna rápida..."
                    className="w-full rounded-btn border border-note-border-strong bg-note-bg p-2.5 text-xs text-note-text placeholder:text-note-accent/70 focus:outline-none focus:border-note-focus resize-none"
                  />
                  <Button
                    type="button"
                    onClick={onAddQuickNote}
                    disabled={!noteDraft.trim()}
                    className="w-full gap-1.5 bg-note-accent hover:bg-note-strong text-white"
                  >
                    <StickyNote className="h-3.5 w-3.5" />
                    <span>Adicionar Nota Interna</span>
                  </Button>
                </div>

                <div className="space-y-2 border-t border-ellevee-border pt-3">
                  {internalNotes.length === 0 ? (
                    <p className="text-center text-xs text-ellevee-text-secondary py-4">
                      Nenhuma nota registrada neste atendimento.
                    </p>
                  ) : (
                    internalNotes.map((n) => (
                      <div
                        key={n.id}
                        className="rounded-btn border border-note-border bg-note-bg p-2.5 text-xs text-note-text space-y-1"
                      >
                        <div className="flex items-center justify-between text-[10px] font-semibold text-note-accent">
                          <span>{n.authorName}</span>
                          <span className="font-mono">{n.timestamp}</span>
                        </div>
                        <p className="leading-relaxed">{n.content}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {inspectorTab === "ai_summary" && (
              <div className="space-y-3 text-xs">
                <div className="rounded-card border border-ellevee-blue/25 bg-[#F5F7FF] p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-[#5F1EC2]">
                    <Sparkles className="h-3.5 w-3.5 text-ellevee-purple" />
                    <span>Contexto Operacional ({activeConv.agentName})</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-ellevee-deep-ink">
                    <strong>Intenção atual:</strong> {activeConv.aiIntent}
                  </p>
                </div>
                <div className="rounded-card border border-ellevee-border bg-ellevee-stone-subtle p-3 space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ellevee-text-secondary">
                    Transparência de UI-02
                  </span>
                  <p className="text-[11px] leading-relaxed text-ellevee-text-secondary">
                    Esta aba ilustra a visibilidade futura de contexto comercial (orçamento/carrinho) na Fase 4 sem modificar Server Actions ou Agent Engine agora.
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}

function MobileFrame({
  title,
  subtitle,
  children,
  viewportHeight = 760,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  viewportHeight?: number
}) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="text-center">
        <p className="font-display text-xs font-bold text-ellevee-deep-ink">{title}</p>
        <p className="text-[11px] text-ellevee-text-secondary">{subtitle}</p>
      </div>
      <div
        style={{ height: viewportHeight }}
        className="relative flex w-[360px] max-w-full flex-col overflow-hidden rounded-[24px] border-[3px] border-ellevee-deep-ink bg-ellevee-warm-ivory shadow-modal"
      >
        {children}
      </div>
    </div>
  )
}

function MobileListScreen({
  conversations,
  activeFilter,
  onChangeFilter,
  onSelectConversation,
}: {
  conversations: PrototypeConversation[]
  activeFilter: FilterTab
  onChangeFilter: (tab: FilterTab) => void
  onSelectConversation: (id: string) => void
}) {
  const [mobileSearch, setMobileSearch] = useState("")
  const filtered = conversations.filter((c) => {
    const okTab = activeFilter === "all" || c.status === activeFilter
    const q = mobileSearch.trim().toLowerCase()
    const okSearch = !q || c.customerName.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)
    return okTab && okSearch
  })

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Topbar Mobile Corporativa */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-ellevee-border bg-white px-2.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-btn text-ellevee-deep-ink hover:bg-ellevee-stone-subtle cursor-pointer"
            aria-label="Abrir menu lateral mobile"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div>
            <h4 className="font-display text-sm font-bold text-ellevee-deep-ink leading-tight">
              Conversas
            </h4>
            <span className="text-[10px] font-medium text-ellevee-text-secondary">
              Ellevee QA · WhatsApp
            </span>
          </div>
        </div>
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-btn bg-ellevee-deep-ink text-white cursor-pointer"
          aria-label="Iniciar nova conversa mobile"
        >
          <SquarePen className="h-4 w-4" />
        </button>
      </header>

      {/* Busca 16px (previne auto-zoom) + Filtros horizontais com texto legível */}
      <div className="border-b border-ellevee-border bg-white px-3 py-2.5 space-y-2 shrink-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ellevee-text-secondary" />
          <input
            type="text"
            value={mobileSearch}
            onChange={(e) => setMobileSearch(e.target.value)}
            placeholder="Buscar atendimento..."
            aria-label="Buscar atendimento no mobile"
            className="h-11 w-full rounded-btn border border-ellevee-border bg-ellevee-stone-subtle pl-9 pr-3 text-[16px] text-ellevee-deep-ink placeholder:text-ellevee-text-secondary focus:bg-white focus:border-ellevee-blue focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scroll-slim">
          {[
            { id: "all" as const, label: "Todas", count: conversations.length },
            { id: "waiting" as const, label: "Fila", count: conversations.filter((c) => c.status === "waiting").length },
            { id: "ai" as const, label: "Sofia IA", count: conversations.filter((c) => c.status === "ai").length },
            { id: "human" as const, label: "Você", count: conversations.filter((c) => c.status === "human").length },
          ].map((tab) => {
            const active = activeFilter === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeFilter(tab.id)}
                className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? "bg-ellevee-deep-ink text-white"
                    : "border border-ellevee-border bg-ellevee-stone-subtle text-ellevee-text-secondary"
                }`}
              >
                <span>{tab.label}</span>
                <span className="font-mono text-[11px] opacity-80">{tab.count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Lista otimizada para toque com o polegar */}
      <div className="flex-1 overflow-y-auto overscroll-contain scroll-slim divide-y divide-ellevee-border/60">
        {filtered.map((conv) => {
          const status = getStatusPill(conv.status, conv.agentName)
          const Icon = status.Icon
          return (
            <button
              key={conv.id}
              type="button"
              onClick={() => onSelectConversation(conv.id)}
              className="flex w-full items-start gap-3 px-3.5 py-3 text-left hover:bg-ellevee-stone-subtle active:bg-ellevee-warm-ivory cursor-pointer"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ellevee-warm-ivory border border-ellevee-border text-xs font-bold text-ellevee-deep-ink">
                {conv.initials}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-ellevee-deep-ink">
                    {conv.customerName.split("·")[0].trim()}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ellevee-text-secondary">
                    {conv.lastTime}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-ellevee-text-secondary">{conv.preview}</p>
                  {conv.unreadCount > 0 && (
                    <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-ellevee-blue px-1.5 font-mono text-[11px] font-bold text-white">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.2 text-[11px] font-semibold ${status.badgeClass}`}>
                    <Icon className="h-3 w-3" />
                    {status.label}
                  </span>
                  <span className="truncate text-[11px] text-ellevee-text-secondary">
                    · {conv.stageName}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MobileChatScreen({
  conversation,
  onBack,
  onOpenSheet,
  onToggleOwnership,
  simulateKeyboardOpen,
  onToggleSimulatedKeyboard,
  forceSheetOpen = false,
}: {
  conversation: PrototypeConversation
  onBack?: () => void
  onOpenSheet?: () => void
  onToggleOwnership: () => void
  simulateKeyboardOpen: boolean
  onToggleSimulatedKeyboard: () => void
  forceSheetOpen?: boolean
}) {
  const [mobileMode, setMobileMode] = useState<"whatsapp" | "note">("whatsapp")
  const [mobileText, setMobileText] = useState("")
  const [sheetOpenLocal, setSheetOpenLocal] = useState(forceSheetOpen)
  const [sheetTab, setSheetTab] = useState<"profile" | "notes">("profile")

  const isSheetVisible = forceSheetOpen || sheetOpenLocal
  const internalNotes = conversation.messages.filter((m) => m.role === "internal_note")

  return (
    <div className="relative flex h-full flex-col bg-ellevee-stone-subtle">
      {/* Área útil ajustada quando Gboard simulado está aberto */}
      <div
        className="flex flex-1 min-h-0 flex-col transition-all duration-200"
        style={simulateKeyboardOpen ? { maxHeight: "420px" } : undefined}
      >
        {/* Header Compacto Mobile (alvos >= 44x44px) */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-1 border-b border-ellevee-border bg-white px-1.5 shadow-2xs">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              onClick={onBack}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ellevee-deep-ink hover:bg-ellevee-stone-subtle cursor-pointer"
              aria-label="Voltar para lista mobile"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => (onOpenSheet ? onOpenSheet() : setSheetOpenLocal(true))}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-btn px-1 py-1 text-left hover:bg-ellevee-stone-subtle cursor-pointer"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ellevee-deep-ink text-xs font-bold text-white">
                {conversation.initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ellevee-deep-ink">
                  {conversation.customerName.split("·")[0].trim()}
                </p>
                <p className="truncate text-[11px] text-ellevee-text-secondary">
                  {conversation.status === "human" ? "Com você" : conversation.agentName} · {conversation.stageName}
                </p>
              </div>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onToggleOwnership}
              className={`inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 text-xs font-semibold cursor-pointer ${
                conversation.status === "human"
                  ? "border border-[#7028D9]/25 bg-[#F3EEFE] text-[#5F1EC2]"
                  : "bg-ellevee-deep-ink text-white"
              }`}
            >
              {conversation.status === "human" ? (
                <>
                  <Bot className="h-3.5 w-3.5" />
                  <span>IA</span>
                </>
              ) : (
                <>
                  <UserCheck className="h-3.5 w-3.5 text-ellevee-cyan" />
                  <span>Assumir</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => (onOpenSheet ? onOpenSheet() : setSheetOpenLocal(true))}
              className="flex h-11 w-11 items-center justify-center rounded-full text-ellevee-deep-ink hover:bg-ellevee-stone-subtle cursor-pointer"
              aria-label="Abrir perfil e notas mobile"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Histórico limpo */}
        <section className="flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-slim px-3 py-3 space-y-2.5">
          {conversation.messages.slice(-4).map((msg) => (
            <MessageCard key={msg.id} msg={msg} />
          ))}
        </section>

        {/* Composer Ergonômico na Base */}
        <footer className="shrink-0 border-t border-ellevee-border bg-white p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMobileMode("whatsapp")}
                className={`min-h-[34px] rounded-full px-2.5 text-[11px] font-semibold cursor-pointer ${
                  mobileMode === "whatsapp"
                    ? "bg-ellevee-deep-ink text-white"
                    : "border border-ellevee-border bg-ellevee-stone-subtle text-ellevee-text-secondary"
                }`}
              >
                WhatsApp
              </button>
              <button
                type="button"
                onClick={() => setMobileMode("note")}
                className={`min-h-[34px] rounded-full px-2.5 text-[11px] font-semibold cursor-pointer ${
                  mobileMode === "note"
                    ? "bg-note-accent text-white"
                    : "border border-ellevee-border bg-ellevee-stone-subtle text-ellevee-text-secondary"
                }`}
              >
                Nota Interna
              </button>
            </div>
            <button
              type="button"
              onClick={onToggleSimulatedKeyboard}
              className="text-[10px] font-mono font-semibold text-ellevee-blue underline cursor-pointer"
            >
              {simulateKeyboardOpen ? "Fechar Gboard" : "Simular Gboard"}
            </button>
          </div>

          <div className="flex items-end gap-1">
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ellevee-text-secondary hover:bg-ellevee-stone-subtle cursor-pointer"
              aria-label="Anexar no mobile"
            >
              <Paperclip className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ellevee-purple hover:bg-[#F5F2FE] cursor-pointer"
              aria-label="Respostas rápidas no mobile"
            >
              <Zap className="h-5 w-5" />
            </button>
            <textarea
              rows={1}
              value={mobileText}
              onChange={(e) => setMobileText(e.target.value)}
              placeholder={mobileMode === "note" ? "Nota interna..." : "Mensagem"}
              aria-label="Campo de mensagem mobile"
              className={`min-h-[42px] max-h-[112px] flex-1 resize-none rounded-2xl border px-3.5 py-2 text-[16px] text-ellevee-deep-ink focus:outline-none ${
                mobileMode === "note"
                  ? "border-note-border-strong bg-note-bg"
                  : "border-ellevee-border bg-ellevee-stone-subtle focus:bg-white focus:border-ellevee-blue"
              }`}
            />
            <button
              type="button"
              onClick={() => setMobileText("")}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white cursor-pointer ${
                mobileMode === "note" ? "bg-note-accent" : "bg-ellevee-blue"
              }`}
              aria-label={mobileText.trim() ? "Enviar no mobile" : "Gravar áudio no mobile"}
            >
              {mobileText.trim() ? <Send className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          </div>
        </footer>
      </div>

      {/* Teclado Virtual Simulado para comprovar ergonomia visual em 360x420 */}
      {simulateKeyboardOpen && (
        <div className="flex flex-1 flex-col justify-between border-t border-ellevee-border bg-[#E7E9ED] px-3 py-3 text-center text-[11px] font-medium text-ellevee-text-secondary">
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span>Gboard Chrome Android (Simulação 340px)</span>
            <span className="rounded bg-white px-1.5 py-0.5 text-ellevee-deep-ink">--ellevee-vvh: 420px</span>
          </div>
          <div className="grid grid-cols-10 gap-1 opacity-70">
            {"QWERTYUIOP".split("").map((k) => (
              <span key={k} className="rounded bg-white py-2 text-[10px] font-semibold text-ellevee-deep-ink shadow-2xs">
                {k}
              </span>
            ))}
          </div>
          <span className="text-[10px]">Composer e cabeçalho preservados acima do teclado</span>
        </div>
      )}

      {/* Bottom Sheet de Perfil & Notas */}
      {isSheetVisible && (
        <div className="absolute inset-0 z-30 flex items-end bg-black/45 backdrop-blur-[1px]">
          <div className="flex max-h-[82%] w-full flex-col rounded-t-2xl border-t border-ellevee-border bg-white shadow-2xl">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-ellevee-border" />
            <div className="flex items-center justify-between border-b border-ellevee-border px-4 py-2.5">
              <div className="inline-flex rounded-btn border border-ellevee-border bg-ellevee-stone-subtle p-0.5">
                <button
                  type="button"
                  onClick={() => setSheetTab("profile")}
                  className={`min-h-[34px] rounded-md px-3 text-xs font-semibold cursor-pointer ${
                    sheetTab === "profile" ? "bg-white text-ellevee-deep-ink shadow-2xs" : "text-ellevee-text-secondary"
                  }`}
                >
                  Perfil
                </button>
                <button
                  type="button"
                  onClick={() => setSheetTab("notes")}
                  className={`min-h-[34px] rounded-md px-3 text-xs font-semibold cursor-pointer ${
                    sheetTab === "notes" ? "bg-white text-ellevee-deep-ink shadow-2xs" : "text-ellevee-text-secondary"
                  }`}
                >
                  Notas ({internalNotes.length})
                </button>
              </div>
              {!forceSheetOpen && (
                <button
                  type="button"
                  onClick={() => setSheetOpenLocal(false)}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-ellevee-text-secondary hover:bg-ellevee-stone-subtle cursor-pointer"
                  aria-label="Fechar bottom sheet"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto scroll-slim p-4 space-y-3 text-xs">
              {sheetTab === "profile" ? (
                <>
                  <div className="flex items-center gap-3 rounded-card border border-ellevee-border bg-ellevee-stone-subtle p-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ellevee-deep-ink font-bold text-white">
                      {conversation.initials}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-bold text-ellevee-deep-ink">{conversation.customerName}</p>
                      <p className="font-mono text-[11px] text-ellevee-text-secondary">{conversation.phone}</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold text-ellevee-text-secondary">Etapa do Funil</span>
                    <div className="flex items-center justify-between rounded-btn border border-ellevee-border bg-white px-3 py-2.5 font-medium text-ellevee-deep-ink">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: conversation.stageColor }} />
                        {conversation.stageName}
                      </span>
                      <ChevronRight className="h-4 w-4 text-ellevee-text-secondary" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold text-ellevee-text-secondary">Observações</span>
                    <p className="rounded-btn border border-ellevee-border bg-ellevee-stone-subtle p-2.5 leading-relaxed text-ellevee-deep-ink">
                      {conversation.customerNotes}
                    </p>
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  {internalNotes.map((n) => (
                    <div key={n.id} className="rounded-btn border border-note-border bg-note-bg p-3 text-note-text">
                      <div className="flex justify-between text-[10px] font-semibold text-note-accent">
                        <span>{n.authorName}</span>
                        <span>{n.timestamp}</span>
                      </div>
                      <p className="mt-1 leading-relaxed">{n.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function FluentWorkspacePrototype({
  initialMode = "gallery",
}: {
  initialMode?: PreviewStageMode
}) {
  const [stageMode, setStageMode] = useState<PreviewStageMode>(initialMode)
  const [conversations, setConversations] = useState<PrototypeConversation[]>(INITIAL_CONVERSATIONS)
  const [selectedId, setSelectedId] = useState<string>("conv-1")
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("profile")
  const [composerMode, setComposerMode] = useState<"whatsapp" | "note">("whatsapp")
  const [composerText, setComposerText] = useState("")
  const [noteDraft, setNoteDraft] = useState("")
  const [simulateKeyboardOpen, setSimulateKeyboardOpen] = useState(false)

  const activeConv = conversations.find((c) => c.id === selectedId) || conversations[0]

  const appendMessage = (role: PrototypeRole, authorName: string, content: string) => {
    const nowLabel = "Agora"
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              lastTime: nowLabel,
              preview: role === "internal_note" ? c.preview : content,
              messages: [
                ...c.messages,
                {
                  id: `proto-${Date.now()}`,
                  role,
                  authorName,
                  content,
                  timestamp: nowLabel,
                  deliveryStatus: "delivered",
                },
              ],
            }
          : c
      )
    )
  }

  const handleSendMessage = () => {
    const trimmed = composerText.trim()
    if (!trimmed) return
    if (composerMode === "note") {
      appendMessage("internal_note", "Ana Paula (Você)", trimmed)
    } else {
      appendMessage("human", "Ana Paula · Você", trimmed)
    }
    setComposerText("")
  }

  const handleAddQuickNote = () => {
    const trimmed = noteDraft.trim()
    if (!trimmed) return
    appendMessage("internal_note", "Ana Paula (Você)", trimmed)
    setNoteDraft("")
  }

  const handleToggleOwnership = () => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== selectedId) return c
        if (c.status === "human") {
          return { ...c, status: "ai", assignedOperator: undefined }
        }
        return { ...c, status: "human", assignedOperator: "Ana Paula" }
      })
    )
  }

  const handleChangeStage = (stageName: string, stageColor: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, stageName, stageColor } : c))
    )
  }

  // Modos isolados em tela cheia (úteis para inspeção/captura direta)
  if (stageMode === "desktop") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-ellevee-warm-ivory p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              PROTÓTIPO ISOLADO · UI-02
            </Badge>
            <span className="text-xs font-semibold text-ellevee-deep-ink">
              Ellevee Workspace — Fluent Inspired (Desktop)
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setStageMode("gallery")}>
            Voltar para Galeria
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <DesktopWorkspacePreview
            conversations={conversations}
            selectedId={selectedId}
            onSelectConversation={setSelectedId}
            activeFilter={activeFilter}
            onChangeFilter={setActiveFilter}
            searchQuery={searchQuery}
            onChangeSearch={setSearchQuery}
            inspectorOpen={inspectorOpen}
            onToggleInspector={() => setInspectorOpen((v) => !v)}
            inspectorTab={inspectorTab}
            onChangeInspectorTab={setInspectorTab}
            composerMode={composerMode}
            onChangeComposerMode={setComposerMode}
            composerText={composerText}
            onChangeComposerText={setComposerText}
            onSendMessage={handleSendMessage}
            onToggleOwnership={handleToggleOwnership}
            onChangeStage={handleChangeStage}
            noteDraft={noteDraft}
            onChangeNoteDraft={setNoteDraft}
            onAddQuickNote={handleAddQuickNote}
            fullHeight
          />
        </div>
      </div>
    )
  }

  if (stageMode === "mobile_list" || stageMode === "mobile_chat" || stageMode === "mobile_sheet") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ellevee-warm-ivory p-2">
        <div className="mb-2 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setStageMode("mobile_list")}>
            Lista
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStageMode("mobile_chat")}>
            Chat
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStageMode("mobile_sheet")}>
            Bottom Sheet
          </Button>
          <Button variant="default" size="sm" onClick={() => setStageMode("gallery")}>
            Galeria
          </Button>
        </div>
        <div className="h-[min(740px,calc(100dvh-4.5rem))] w-[360px] max-w-full overflow-hidden rounded-[24px] border-[3px] border-ellevee-deep-ink bg-white shadow-modal">
          {stageMode === "mobile_list" ? (
            <MobileListScreen
              conversations={conversations}
              activeFilter={activeFilter}
              onChangeFilter={setActiveFilter}
              onSelectConversation={(id) => {
                setSelectedId(id)
                setStageMode("mobile_chat")
              }}
            />
          ) : (
            <MobileChatScreen
              conversation={activeConv}
              onBack={() => setStageMode("mobile_list")}
              onToggleOwnership={handleToggleOwnership}
              simulateKeyboardOpen={simulateKeyboardOpen}
              onToggleSimulatedKeyboard={() => setSimulateKeyboardOpen((v) => !v)}
              forceSheetOpen={stageMode === "mobile_sheet"}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-8 pb-12">
      {/* Cabeçalho da Galeria de Aprovação Visual */}
      <div className="flex flex-col gap-4 rounded-card border border-ellevee-border bg-white p-5 shadow-card lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-ellevee-purple/30 bg-[#F5F2FE] text-[#5F1EC2] font-mono text-[10px]">
              UI-02 · PROTÓTIPO ISOLADO PARA APROVAÇÃO
            </Badge>
            <Badge variant="success" className="font-mono text-[10px]">
              /conversations original preservado
            </Badge>
          </div>
          <h1 className="font-display text-xl font-bold tracking-tight text-ellevee-deep-ink">
            Ellevee Workspace — Fluent Inspired
          </h1>
          <p className="max-w-3xl text-xs leading-relaxed text-ellevee-text-secondary">
            Protótipo interativo combinando organização Outlook, fluidez conversacional Teams e tokens corporativos Ellevee IA (Tailwind + shadcn/ui + Lucide), sem instalação de Fluent UI e sem mutações em backend.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setStageMode("desktop")} className="gap-1.5">
            <Monitor className="h-3.5 w-3.5" />
            <span>Expandir Desktop</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStageMode("mobile_chat")} className="gap-1.5">
            <Smartphone className="h-3.5 w-3.5" />
            <span>Simular Smartphone</span>
          </Button>
          <Link href="/conversations">
            <Button variant="default" size="sm">
              Voltar ao /conversations atual
            </Button>
          </Link>
        </div>
      </div>

      {/* Seção 1: Protótipo Desktop Interativo */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-ellevee-deep-ink">
              1. Protótipo Desktop (Rail + Fila Outlook + Chat Teams + Inspector)
            </h2>
            <p className="text-xs text-ellevee-text-secondary">
              Teste alternar atendimentos, filtros legíveis, Assumir/Devolver para Sofia, enviar Mensagem ou Nota Interna e recolher o Inspector.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInspectorOpen((v) => !v)}
            className="gap-1.5"
          >
            {inspectorOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            <span>{inspectorOpen ? "Visualizar sem Inspector" : "Visualizar com Inspector"}</span>
          </Button>
        </div>

        <DesktopWorkspacePreview
          conversations={conversations}
          selectedId={selectedId}
          onSelectConversation={setSelectedId}
          activeFilter={activeFilter}
          onChangeFilter={setActiveFilter}
          searchQuery={searchQuery}
          onChangeSearch={setSearchQuery}
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((v) => !v)}
          inspectorTab={inspectorTab}
          onChangeInspectorTab={setInspectorTab}
          composerMode={composerMode}
          onChangeComposerMode={setComposerMode}
          composerText={composerText}
          onChangeComposerText={setComposerText}
          onSendMessage={handleSendMessage}
          onToggleOwnership={handleToggleOwnership}
          onChangeStage={handleChangeStage}
          noteDraft={noteDraft}
          onChangeNoteDraft={setNoteDraft}
          onAddQuickNote={handleAddQuickNote}
        />
      </section>

      {/* Seção 2: Protótipo Smartphone Chrome Android-First */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-base font-bold text-ellevee-deep-ink">
            2. Protótipo Smartphone Chrome Android-First (360 × 760)
          </h2>
          <p className="text-xs text-ellevee-text-secondary">
            Interface projetada nativamente para polegar, alvos ≥ 44×44 px, Bottom Sheet de Perfil/Notas e controle visual de teclado (`--ellevee-vvh`).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3 justify-items-center">
          <MobileFrame
            title="Tela 1 · Lista em Tela Cheia"
            subtitle="Busca 16px + Filtros com rótulo + Cards táteis"
          >
            <MobileListScreen
              conversations={conversations}
              activeFilter={activeFilter}
              onChangeFilter={setActiveFilter}
              onSelectConversation={setSelectedId}
            />
          </MobileFrame>

          <MobileFrame
            title="Tela 2 · Chat Dedicado + Composer"
            subtitle="Controle Sofia/Assumir compacto + Simulador Gboard"
          >
            <MobileChatScreen
              conversation={activeConv}
              onToggleOwnership={handleToggleOwnership}
              simulateKeyboardOpen={simulateKeyboardOpen}
              onToggleSimulatedKeyboard={() => setSimulateKeyboardOpen((v) => !v)}
            />
          </MobileFrame>

          <MobileFrame
            title="Tela 3 · Bottom Sheet (Perfil & Notas)"
            subtitle="Acesso confortável com o polegar sem perder contexto"
          >
            <MobileChatScreen
              conversation={activeConv}
              onToggleOwnership={handleToggleOwnership}
              simulateKeyboardOpen={false}
              onToggleSimulatedKeyboard={() => undefined}
              forceSheetOpen
            />
          </MobileFrame>
        </div>
      </section>

      {/* Seção 3: Legenda dos 4 Papéis de Mensagem & Tokens */}
      <section className="rounded-card border border-ellevee-border bg-white p-5 shadow-card space-y-4">
        <h2 className="font-display text-base font-bold text-ellevee-deep-ink">
          3. Hierarquia Visual de Mensagens e Tokens Oficiais Aplicados
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-card border border-ellevee-border bg-white p-3 space-y-1">
            <span className="text-xs font-bold text-ellevee-deep-ink">Cliente</span>
            <p className="font-mono text-[11px] text-ellevee-text-secondary">
              bg-ellevee-white · border-ellevee-border
            </p>
            <p className="text-xs text-ellevee-text-secondary">
              Leitura neutra à esquerda com borda hairline corporativa.
            </p>
          </div>
          <div className="rounded-card border border-ellevee-blue/25 bg-[#F5F7FF] p-3 space-y-1">
            <span className="inline-flex items-center gap-1 text-xs font-bold text-[#5F1EC2]">
              <Sparkles className="h-3.5 w-3.5 text-ellevee-purple" /> Sofia IA
            </span>
            <p className="font-mono text-[11px] text-ellevee-text-secondary">
              bg-[#F5F7FF] · border-ellevee-blue/25
            </p>
            <p className="text-xs text-ellevee-text-secondary">
              Superfície fria sutil + badge nominal e cartão auditável de orçamento.
            </p>
          </div>
          <div className="rounded-card border border-ellevee-deep-ink bg-ellevee-deep-ink p-3 text-white space-y-1">
            <span className="inline-flex items-center gap-1 text-xs font-bold text-ellevee-cyan">
              <UserCheck className="h-3.5 w-3.5" /> Atendente Humano
            </span>
            <p className="font-mono text-[11px] text-white/75">
              bg-ellevee-deep-ink · text-white
            </p>
            <p className="text-xs text-white/85">
              Contraste imediato frente à IA e ao cliente, eliminando ambiguidade.
            </p>
          </div>
          <div className="rounded-card border border-note-border-strong bg-note-bg p-3 text-note-text space-y-1">
            <span className="inline-flex items-center gap-1 text-xs font-bold text-note-strong">
              <Lock className="h-3.5 w-3.5 text-note-accent" /> Nota Interna
            </span>
            <p className="font-mono text-[11px] text-note-accent">
              bg-note-bg · border-note-border-strong
            </p>
            <p className="text-xs text-note-text">
              Paleta âmbar semântica exclusiva da equipe interna.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

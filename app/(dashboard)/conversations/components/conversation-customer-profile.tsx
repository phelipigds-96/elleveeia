"use client"

import React, { useEffect, useRef, useState } from "react"
import {
  FileText,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Save,
  Tag,
  User,
} from "lucide-react"
import type { CustomerData, WorkflowStageOption } from "../actions"
import {
  type CustomerProfileDraft,
  buildInitialCustomerDraft,
  isStaleCustomerProfileLoad,
  mergeLoadedCustomerDetails,
  sanitizeWhatsAppDigits,
} from "@/lib/ui/conversations-inspector"

function InspectorWhatsAppIcon({ className = "h-2.5 w-2.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 00-3.48-8.413Z" />
    </svg>
  )
}

export interface ConversationCustomerProfileProps {
  conversationId: string
  customerId: string
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  customerAddress?: string | null
  customerNotes?: string | null
  customerAvatarUrl?: string | null
  externalId?: string | null
  workflowStageId?: string | null
  workflowStages: WorkflowStageOption[]
  isChangingStage: boolean
  isSavingCustomer: boolean
  onChangeStage: (stageId: string) => void
  onLoadCustomerDetails: (
    customerId: string
  ) => Promise<{ success: boolean; customer?: CustomerData; error?: string }>
  onSaveCustomer: (params: {
    conversationId: string
    customerId: string
    draft: CustomerProfileDraft
  }) => Promise<boolean>
}

function ConversationCustomerProfileComponent({
  conversationId,
  customerId,
  customerName,
  customerPhone,
  customerEmail,
  customerAddress,
  customerNotes,
  customerAvatarUrl,
  externalId,
  workflowStageId,
  workflowStages,
  isChangingStage,
  isSavingCustomer,
  onChangeStage,
  onLoadCustomerDetails,
  onSaveCustomer,
}: ConversationCustomerProfileProps) {
  const [draft, setDraft] = useState<CustomerProfileDraft>(() =>
    buildInitialCustomerDraft({
      customerId,
      customer: {
        id: customerId,
        name: customerName,
        phone: customerPhone,
        email: customerEmail,
        address: customerAddress,
        notes: customerNotes,
        avatar_url: customerAvatarUrl,
      },
      externalId,
    })
  )
  const [isLoadingDetails, setIsLoadingDetails] = useState(() => Boolean(customerId))

  const activeConvRef = useRef(conversationId)
  const activeCustRef = useRef(customerId)
  const loadSeqRef = useRef(0)
  const savingGuardRef = useRef(false)
  const dirtyFieldsRef = useRef<Set<keyof CustomerProfileDraft>>(new Set())

  const updateField = (field: keyof CustomerProfileDraft, value: string) => {
    dirtyFieldsRef.current.add(field)
    setDraft((prev) => ({ ...prev, [field]: value }))
  }

  useEffect(() => {
    activeConvRef.current = conversationId
    activeCustRef.current = customerId
  }, [conversationId, customerId])

  useEffect(() => {
    if (!customerId) return
    let cancelled = false
    const reqSeq = ++loadSeqRef.current
    const reqConvId = conversationId
    const reqCustId = customerId

    onLoadCustomerDetails(reqCustId)
      .then((res) => {
        if (
          cancelled ||
          isStaleCustomerProfileLoad({
            activeConversationId: activeConvRef.current,
            requestConversationId: reqConvId,
            activeCustomerId: activeCustRef.current,
            requestCustomerId: reqCustId,
            activeSeq: loadSeqRef.current,
            requestSeq: reqSeq,
          })
        ) {
          return
        }
        if (res?.success && res?.customer) {
          setDraft((prev) =>
            mergeLoadedCustomerDetails(prev, res.customer, reqCustId, dirtyFieldsRef.current)
          )
        }
      })
      .catch(() => {
        // Silencioso: mantém dados base já exibidos
      })
      .finally(() => {
        if (!cancelled && loadSeqRef.current === reqSeq) {
          setIsLoadingDetails(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [conversationId, customerId, onLoadCustomerDetails])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSavingCustomer || savingGuardRef.current) return
    savingGuardRef.current = true
    // Invalida qualquer carregamento inicial em voo para nunca sobrescrever dados salvos
    loadSeqRef.current += 1
    setIsLoadingDetails(false)
    try {
      const ok = await onSaveCustomer({
        conversationId,
        customerId: draft.id || customerId,
        draft,
      })
      if (ok) {
        dirtyFieldsRef.current.clear()
      }
    } finally {
      savingGuardRef.current = false
    }
  }

  const resolvedAvatar = draft.avatar_url || customerAvatarUrl || ""
  const whatsappDigits = sanitizeWhatsAppDigits(draft.phone)

  return (
    <>
      {/* Card de Identificação */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-ellevee-stone-subtle border border-ellevee-border">
        {resolvedAvatar ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={resolvedAvatar}
            alt={draft.name || "Cliente"}
            referrerPolicy="no-referrer"
            className="h-11 w-11 rounded-full object-cover border border-ellevee-border shrink-0"
          />
        ) : (
          <div className="h-11 w-11 rounded-full bg-ellevee-deep-ink text-white flex items-center justify-center font-bold text-sm shrink-0">
            {(draft.name || "C").slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm text-ellevee-deep-ink truncate">
            {draft.name || "Cliente Sem Nome"}
          </h4>
          <p className="text-xs text-ellevee-text-secondary font-mono truncate">
            {draft.phone || externalId || "Sem telefone"}
          </p>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 font-medium mt-1">
            <InspectorWhatsAppIcon className="h-2.5 w-2.5" />
            WhatsApp
          </span>
        </div>
      </div>

      {/* Etiqueta / Etapa do Funil */}
      <div className="p-3 rounded-xl bg-ellevee-stone-subtle border border-ellevee-border space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ellevee-text-secondary flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5 text-ellevee-purple" />
            Etiqueta / Funil
          </span>
          {isChangingStage && <Loader2 className="h-3 w-3 animate-spin text-ellevee-text-muted" />}
        </div>
        <div className="relative">
          <select
            aria-label="Selecionar etapa do funil"
            value={workflowStageId || ""}
            onChange={(e) => {
              if (e.target.value) onChangeStage(e.target.value)
            }}
            disabled={isChangingStage}
            className="w-full min-h-[44px] lg:min-h-[34px] text-[16px] lg:text-xs font-medium px-3 py-2 rounded-lg border border-ellevee-border bg-white text-ellevee-deep-ink focus:outline-none focus:border-ellevee-blue focus:ring-1 focus:ring-ellevee-blue cursor-pointer"
          >
            <option value="" disabled>
              Selecione uma etapa...
            </option>
            {workflowStages.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name} {st.stage_type === "final" ? "✓ (Final)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Formulário de Edição de Dados */}
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ellevee-text-secondary">
            Dados Cadastrais
          </span>
          {isLoadingDetails && (
            <Loader2 className="h-3 w-3 animate-spin text-ellevee-text-muted" />
          )}
        </div>

        {/* Nome */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-ellevee-deep-ink flex items-center gap-1">
            <User className="h-3 w-3 text-ellevee-text-muted" />
            Nome Completo
          </label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="Nome do cliente"
            className="w-full text-[16px] sm:text-sm px-3 py-2 rounded-lg border border-ellevee-border bg-ellevee-stone-subtle focus:bg-white focus:outline-none focus:border-ellevee-blue focus:ring-1 focus:ring-ellevee-blue text-ellevee-deep-ink"
          />
        </div>

        {/* Telefone / WhatsApp */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-ellevee-deep-ink flex items-center gap-1">
              <Phone className="h-3 w-3 text-ellevee-text-muted" />
              WhatsApp / Telefone
            </label>
            {whatsappDigits && (
              <a
                href={`https://wa.me/${whatsappDigits}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-ellevee-blue hover:underline font-medium"
              >
                Abrir no WhatsApp
              </a>
            )}
          </div>
          <input
            type="text"
            value={draft.phone}
            onChange={(e) => updateField("phone", e.target.value)}
            placeholder="Ex: 5511999999999"
            className="w-full text-[16px] sm:text-sm px-3 py-2 rounded-lg border border-ellevee-border bg-ellevee-stone-subtle focus:bg-white focus:outline-none focus:border-ellevee-blue focus:ring-1 focus:ring-ellevee-blue text-ellevee-deep-ink font-mono"
          />
        </div>

        {/* Email */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-ellevee-deep-ink flex items-center gap-1">
            <Mail className="h-3 w-3 text-ellevee-text-muted" />
            E-mail
          </label>
          <input
            type="email"
            value={draft.email}
            onChange={(e) => updateField("email", e.target.value)}
            placeholder="cliente@email.com"
            className="w-full text-[16px] sm:text-sm px-3 py-2 rounded-lg border border-ellevee-border bg-ellevee-stone-subtle focus:bg-white focus:outline-none focus:border-ellevee-blue focus:ring-1 focus:ring-ellevee-blue text-ellevee-deep-ink"
          />
        </div>

        {/* Endereço */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-ellevee-deep-ink flex items-center gap-1">
            <MapPin className="h-3 w-3 text-ellevee-text-muted" />
            Endereço Completo
          </label>
          <textarea
            rows={2}
            value={draft.address}
            onChange={(e) => updateField("address", e.target.value)}
            placeholder="Rua, Número, Complemento, Bairro, Cidade - UF"
            className="w-full text-[16px] sm:text-sm px-3 py-2 rounded-lg border border-ellevee-border bg-ellevee-stone-subtle focus:bg-white focus:outline-none focus:border-ellevee-blue focus:ring-1 focus:ring-ellevee-blue text-ellevee-deep-ink resize-none"
          />
        </div>

        {/* Observações Gerais */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-ellevee-deep-ink flex items-center gap-1">
            <FileText className="h-3 w-3 text-ellevee-text-muted" />
            Observações do Cliente
          </label>
          <textarea
            rows={3}
            value={draft.notes}
            onChange={(e) => updateField("notes", e.target.value)}
            placeholder="Preferências, histórico de compras, observações cadastrais..."
            className="w-full text-[16px] sm:text-sm px-3 py-2 rounded-lg border border-ellevee-border bg-ellevee-stone-subtle focus:bg-white focus:outline-none focus:border-ellevee-blue focus:ring-1 focus:ring-ellevee-blue text-ellevee-deep-ink resize-none"
          />
        </div>

        {/* Botão Salvar Perfil (>= 44px em mobile e tablet 768px) */}
        <button
          type="submit"
          disabled={isSavingCustomer}
          className="w-full min-h-[44px] lg:min-h-[38px] rounded-lg bg-ellevee-deep-ink hover:bg-black text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-50 focus-ring"
        >
          {isSavingCustomer ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-ellevee-cyan" />
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
    </>
  )
}

export const ConversationCustomerProfile = React.memo(ConversationCustomerProfileComponent)
ConversationCustomerProfile.displayName = "ConversationCustomerProfile"

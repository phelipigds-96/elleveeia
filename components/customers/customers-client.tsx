'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import type { CustomerListItem } from '@/lib/services/customers'
import { formatCustomerPhone } from '@/lib/services/customer-name'
import { deleteCustomerAction, saveCustomerAction } from '@/app/(dashboard)/customers/actions'
import { toast } from '@/components/ui/toast'

interface CustomersClientProps {
  initialCustomers: CustomerListItem[]
  migrationPending?: boolean
}

type StatusFilter = 'all' | 'human' | 'open' | 'closed' | 'none' | 'unconfirmed'

function formatDateTimePtBr(iso?: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getConversationStatusBadge(status: CustomerListItem['latest_status']) {
  switch (status) {
    case 'human':
      return {
        label: 'Atendimento Humano',
        className: 'bg-amber-50 text-amber-800 border-amber-200',
      }
    case 'open':
      return {
        label: 'Com Agente IA',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      }
    case 'closed':
      return {
        label: 'Encerrado',
        className: 'bg-slate-100 text-slate-600 border-slate-200',
      }
    default:
      return {
        label: 'Sem conversa',
        className: 'bg-slate-50 text-slate-500 border-slate-200',
      }
  }
}

export function CustomersClient({
  initialCustomers,
  migrationPending = false,
}: CustomersClientProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Estado do modal de criação/edição
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<CustomerListItem | null>(null)
  const [formName, setFormName] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const metrics = useMemo(() => {
    const total = initialCustomers.length
    const confirmed = initialCustomers.filter((c) => c.name_confirmed).length
    const unconfirmed = total - confirmed
    const activeChats = initialCustomers.filter(
      (c) => c.latest_status === 'open' || c.latest_status === 'human'
    ).length
    return { total, confirmed, unconfirmed, activeChats }
  }, [initialCustomers])

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase()
    const digitsQuery = search.replace(/\D/g, '')

    return initialCustomers.filter((c) => {
      if (statusFilter === 'human' && c.latest_status !== 'human') return false
      if (statusFilter === 'open' && c.latest_status !== 'open') return false
      if (statusFilter === 'closed' && c.latest_status !== 'closed') return false
      if (statusFilter === 'none' && c.latest_status !== null) return false
      if (statusFilter === 'unconfirmed' && c.name_confirmed) return false

      if (!q) return true

      const haystacks = [
        c.name,
        c.whatsapp_name || '',
        c.email || '',
        c.address || '',
        c.notes || '',
        c.phone || '',
      ]
        .join(' ')
        .toLowerCase()

      if (haystacks.includes(q)) return true
      if (digitsQuery && (c.phone || '').replace(/\D/g, '').includes(digitsQuery)) return true
      return false
    })
  }, [initialCustomers, search, statusFilter])

  const openCreateModal = () => {
    setEditingCustomer(null)
    setFormName('')
    setFormPhone('')
    setFormEmail('')
    setFormAddress('')
    setFormNotes('')
    setDialogOpen(true)
  }

  const openEditModal = (customer: CustomerListItem) => {
    setEditingCustomer(customer)
    setFormName(customer.name || '')
    setFormPhone(customer.phone || '')
    setFormEmail(customer.email || '')
    setFormAddress(customer.address || '')
    setFormNotes(customer.notes || '')
    setDialogOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await saveCustomerAction({
        customerId: editingCustomer?.id,
        name: formName,
        phone: formPhone,
        email: formEmail,
        address: formAddress,
        notes: formNotes,
      })
      if (!res.success) {
        toast.error('Não foi possível salvar', res.error)
        return
      }
      toast.success(
        editingCustomer ? 'Cliente atualizado com sucesso!' : 'Cliente cadastrado com sucesso!'
      )
      setDialogOpen(false)
      router.refresh()
    } catch (err: any) {
      toast.error('Erro inesperado ao salvar', err?.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (customer: CustomerListItem) => {
    const confirmed = window.confirm(
      `Deseja remover "${customer.name}" da lista de clientes?\nO histórico de mensagens existente continuará preservado.`
    )
    if (!confirmed) return

    setDeletingId(customer.id)
    try {
      const res = await deleteCustomerAction(customer.id)
      if (!res.success) {
        toast.error('Não foi possível excluir', res.error)
        return
      }
      toast.success('Cliente removido.')
      router.refresh()
    } catch (err: any) {
      toast.error('Erro ao excluir cliente', err?.message)
    } finally {
      setDeletingId(null)
    }
  }

  const filterButtons: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: `Todos (${metrics.total})` },
    { key: 'human', label: 'Humano' },
    { key: 'open', label: 'IA' },
    { key: 'closed', label: 'Encerrados' },
    { key: 'unconfirmed', label: `A confirmar (${metrics.unconfirmed})` },
  ]

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ellevee-deep-ink">
            Clientes
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Contatos sincronizados automaticamente do omnichannel WhatsApp e cadastros manuais.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="h-10 px-4 rounded-xl bg-ellevee-deep-ink hover:bg-ellevee-deep-ink/90 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs shrink-0"
        >
          <Plus className="h-4 w-4" />
          Novo Cliente
        </button>
      </div>

      {/* Aviso discreto se a migration 2026111102 ainda não foi aplicada */}
      {migrationPending && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Migração de banco pendente:</span> aplique{' '}
            <code className="font-mono">2026111102_customers_name_confirmation.sql</code> no
            Supabase para habilitar o espelhamento completo do nome do WhatsApp e o status de nome confirmado.
          </div>
        </div>
      )}

      {/* Cards de Resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total de Clientes</span>
            <Users className="h-4 w-4 text-ellevee-blue" />
          </div>
          <p className="text-2xl font-bold text-ellevee-deep-ink mt-1">{metrics.total}</p>
        </div>

        <div className="rounded-xl border bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Nomes Identificados</span>
            <UserCheck className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{metrics.confirmed}</p>
        </div>

        <div className="rounded-xl border bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Em Atendimento</span>
            <Bot className="h-4 w-4 text-teal-600" />
          </div>
          <p className="text-2xl font-bold text-ellevee-deep-ink mt-1">{metrics.activeChats}</p>
        </div>

        <div className="rounded-xl border bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Nomes a Confirmar</span>
            <Sparkles className="h-4 w-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-amber-700 mt-1">{metrics.unconfirmed}</p>
        </div>
      </div>

      {/* Card Principal: Busca + Filtros + Tabela / Cards Mobile */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, telefone, WhatsApp ou e-mail..."
                className="flex h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {filterButtons.map((btn) => {
                const active = statusFilter === btn.key
                return (
                  <button
                    key={btn.key}
                    type="button"
                    onClick={() => setStatusFilter(btn.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-ellevee-deep-ink text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {btn.label}
                  </button>
                )
              })}
            </div>
          </div>

          {filteredCustomers.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 px-4 text-center text-sm text-muted-foreground">
              {initialCustomers.length === 0
                ? 'Nenhum cliente registrado ainda. Assim que um cliente enviar mensagem no WhatsApp ou você cadastrar manualmente, ele aparecerá aqui.'
                : 'Nenhum cliente corresponde à busca ou ao filtro selecionado.'}
            </div>
          ) : (
            <>
              {/* Desktop: Tabela */}
              <div className="hidden md:block rounded-lg border overflow-hidden">
                <div className="w-full overflow-x-auto">
                  <table className="w-full caption-bottom text-sm">
                    <thead className="bg-slate-50/80 border-b">
                      <tr>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground">
                          Cliente
                        </th>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground">
                          Telefone
                        </th>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground">
                          Última Interação
                        </th>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground">
                          Status
                        </th>
                        <th className="h-11 px-4 text-right font-medium text-muted-foreground">
                          Ações
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredCustomers.map((customer) => {
                        const badge = getConversationStatusBadge(customer.latest_status)
                        const showWhatsAppMirror =
                          customer.whatsapp_name &&
                          customer.whatsapp_name.trim().toLowerCase() !==
                            customer.name.trim().toLowerCase()

                        return (
                          <tr
                            key={customer.id}
                            className="hover:bg-slate-50/70 transition-colors"
                          >
                            <td className="p-4 align-middle">
                              <div className="flex items-center gap-3 min-w-0">
                                {customer.avatar_url ? (
                                  <img
                                    src={customer.avatar_url}
                                    alt={customer.name}
                                    className="h-9 w-9 rounded-full object-cover border border-slate-200 shrink-0"
                                  />
                                ) : (
                                  <div className="h-9 w-9 rounded-full bg-teal-50 text-teal-800 border border-teal-200 flex items-center justify-center text-xs font-bold shrink-0">
                                    {(customer.name || 'C').slice(0, 2).toUpperCase()}
                                  </div>
                                )}

                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-slate-900 truncate max-w-[240px]">
                                      {customer.name}
                                    </span>
                                    {customer.name_confirmed ? (
                                      <span
                                        title="Nome confirmado para atendimento"
                                        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full"
                                      >
                                        <CheckCircle2 className="h-2.5 w-2.5" /> Identificado
                                      </span>
                                    ) : (
                                      <span
                                        title="IA solicitará confirmação do nome no próximo atendimento"
                                        className="inline-flex items-center text-[10px] font-medium text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full"
                                      >
                                        Nome a confirmar
                                      </span>
                                    )}
                                  </div>

                                  {showWhatsAppMirror && (
                                    <p className="text-[11px] text-muted-foreground truncate max-w-[260px]">
                                      WhatsApp: {customer.whatsapp_name}
                                    </p>
                                  )}

                                  {customer.email && (
                                    <p className="text-[11px] text-muted-foreground truncate max-w-[260px]">
                                      {customer.email}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>

                            <td className="p-4 align-middle whitespace-nowrap text-slate-700 font-mono text-xs">
                              {formatCustomerPhone(customer.phone)}
                            </td>

                            <td className="p-4 align-middle whitespace-nowrap text-xs text-slate-600">
                              <div>{formatDateTimePtBr(customer.last_interaction_at)}</div>
                              {customer.latest_channel && (
                                <div className="text-[11px] text-muted-foreground capitalize">
                                  via {customer.latest_channel}
                                  {customer.conversations_count > 1
                                    ? ` · ${customer.conversations_count} conversas`
                                    : ''}
                                </div>
                              )}
                            </td>

                            <td className="p-4 align-middle whitespace-nowrap">
                              <span
                                className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium border ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            </td>

                            <td className="p-4 align-middle text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                {customer.latest_conversation_id && (
                                  <Link
                                    href={`/conversations?id=${encodeURIComponent(
                                      customer.latest_conversation_id
                                    )}`}
                                    className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-teal-50 hover:text-teal-800 hover:border-teal-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                                    title="Abrir conversa no chat"
                                  >
                                    <MessageSquare className="h-3.5 w-3.5" />
                                    Chat
                                  </Link>
                                )}

                                <button
                                  type="button"
                                  onClick={() => openEditModal(customer)}
                                  className="h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 inline-flex items-center justify-center transition-colors cursor-pointer"
                                  title="Editar dados do cliente"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>

                                <button
                                  type="button"
                                  disabled={deletingId === customer.id}
                                  onClick={() => handleDelete(customer)}
                                  className="h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 text-slate-500 inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
                                  title="Excluir cliente"
                                >
                                  {deletingId === customer.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile: Cards Responsivos */}
              <div className="md:hidden space-y-3">
                {filteredCustomers.map((customer) => {
                  const badge = getConversationStatusBadge(customer.latest_status)
                  const showWhatsAppMirror =
                    customer.whatsapp_name &&
                    customer.whatsapp_name.trim().toLowerCase() !==
                      customer.name.trim().toLowerCase()

                  return (
                    <div
                      key={customer.id}
                      className="rounded-xl border bg-slate-50/40 p-3.5 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {customer.avatar_url ? (
                            <img
                              src={customer.avatar_url}
                              alt={customer.name}
                              className="h-10 w-10 rounded-full object-cover border border-slate-200 shrink-0"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-full bg-teal-50 text-teal-800 border border-teal-200 flex items-center justify-center text-xs font-bold shrink-0">
                              {(customer.name || 'C').slice(0, 2).toUpperCase()}
                            </div>
                          )}

                          <div className="min-w-0">
                            <p className="font-semibold text-sm text-slate-900 truncate">
                              {customer.name}
                            </p>
                            <p className="text-xs text-slate-600 font-mono">
                              {formatCustomerPhone(customer.phone)}
                            </p>
                            {showWhatsAppMirror && (
                              <p className="text-[11px] text-muted-foreground truncate">
                                WhatsApp: {customer.whatsapp_name}
                              </p>
                            )}
                          </div>
                        </div>

                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-slate-200/70">
                        <span>
                          Última interação: {formatDateTimePtBr(customer.last_interaction_at)}
                        </span>
                        {!customer.name_confirmed && (
                          <span className="text-amber-700 font-medium">A confirmar</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        {customer.latest_conversation_id && (
                          <Link
                            href={`/conversations?id=${encodeURIComponent(
                              customer.latest_conversation_id
                            )}`}
                            className="flex-1 h-9 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            Abrir chat
                          </Link>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditModal(customer)}
                          className="h-9 px-3 rounded-lg border bg-white text-xs font-medium text-slate-700 inline-flex items-center justify-center gap-1.5"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal Criar / Editar Cliente */}
      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white border shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {editingCustomer ? 'Editar Cliente' : 'Novo Cliente'}
                </h2>
                {editingCustomer?.whatsapp_name && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Nome original no WhatsApp: {editingCustomer.whatsapp_name}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome do Cliente *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Maria Silva"
                  className="w-full h-10 rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Telefone / WhatsApp
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="Ex: 51999999999"
                    className="w-full h-10 rounded-lg border pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  E-mail
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="cliente@email.com"
                    className="w-full h-10 rounded-lg border pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Endereço
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                    placeholder="Rua, número, bairro..."
                    className="w-full h-10 rounded-lg border pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Observações CRM
                </label>
                <textarea
                  rows={3}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Preferências do cliente, CNPJ, histórico..."
                  className="w-full rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="h-9 px-4 rounded-lg border text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-9 px-4 rounded-lg bg-ellevee-deep-ink hover:bg-ellevee-deep-ink/90 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {editingCustomer ? 'Salvar Alterações' : 'Cadastrar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

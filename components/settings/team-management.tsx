"use client"

import React, { useState } from "react"
import { 
  Users, 
  UserPlus, 
  ShieldCheck, 
  MessageSquare, 
  Trash2, 
  Copy, 
  Check, 
  KeyRound, 
  Mail, 
  User, 
  Sparkles,
  AlertCircle,
  Loader2,
  X
} from "lucide-react"
import { 
  CompanyMember, 
  createCompanyUserAction, 
  deleteCompanyUserAction 
} from "@/app/(dashboard)/settings/actions"

interface TeamManagementProps {
  initialMembers: CompanyMember[]
  currentUserId: string
}

export function TeamManagement({ initialMembers, currentUserId }: TeamManagementProps) {
  const [members, setMembers] = useState<CompanyMember[]>(initialMembers)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Estados do formulário
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"attendant" | "admin">("attendant")

  // Estado de credenciais criadas para exibição e cópia
  const [createdCredentials, setCreatedCredentials] = useState<{
    fullName: string
    email: string
    password: string
    role: string
  } | null>(null)
  const [copied, setCopied] = useState(false)

  const handleGeneratePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    let generated = "@Atend"
    for (let i = 0; i < 4; i++) {
      generated += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setPassword(generated)
  }

  const handleOpenModal = () => {
    setFullName("")
    setEmail("")
    setPassword("")
    setRole("attendant")
    setError(null)
    setCreatedCredentials(null)
    setCopied(false)
    handleGeneratePassword()
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setCreatedCredentials(null)
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const res = await createCompanyUserAction({
        fullName,
        email,
        password,
        role,
      })

      if (!res.success || !res.data) {
        setError(res.error || "Falha ao cadastrar atendente.")
        setIsSubmitting(false)
        return
      }

      // Adiciona o novo membro na listagem local
      const newMember: CompanyMember = {
        id: res.data.id,
        fullName: res.data.fullName,
        email: res.data.email,
        role: res.data.role,
        createdAt: new Date().toISOString().split("T")[0],
      }
      setMembers((prev) => [...prev, newMember])

      // Exibe credenciais geradas
      setCreatedCredentials({
        fullName: res.data.fullName,
        email: res.data.email,
        password: res.data.password,
        role: res.data.role,
      })
    } catch (err: any) {
      setError(err?.message || "Erro inesperado ao cadastrar usuário.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (memberId: string, memberName: string) => {
    if (!window.confirm(`Tem certeza que deseja revogar o acesso de "${memberName}"?`)) {
      return
    }

    setDeletingId(memberId)
    try {
      const res = await deleteCompanyUserAction(memberId)
      if (res.success) {
        setMembers((prev) => prev.filter((m) => m.id !== memberId))
      } else {
        alert(res.error || "Erro ao remover usuário.")
      }
    } catch (err: any) {
      alert("Falha ao comunicar com o servidor: " + err?.message)
    } finally {
      setDeletingId(null)
    }
  }

  const handleCopyCredentials = () => {
    if (!createdCredentials) return
    const text = `*Acesso Ellevee IA - Atendimento Sumel*\n\n` +
      `👤 *Nome:* ${createdCredentials.fullName}\n` +
      `📧 *E-mail:* ${createdCredentials.email}\n` +
      `🔑 *Senha:* ${createdCredentials.password}\n` +
      `💼 *Função:* ${createdCredentials.role === "admin" ? "Administrador" : "Atendente (Chat)"}\n` +
      `🌐 *Link de Acesso:* ${window.location.origin}/login`

    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
      {/* Header do Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 border-b">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-lg leading-none tracking-tight text-ellevee-ink">
              Equipe e Atendentes
            </h3>
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full font-mono text-muted-foreground font-semibold">
              {members.length} {members.length === 1 ? "membro" : "membros"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie operadores de chat e administradores com permissões RBAC isoladas.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenModal}
          className="inline-flex items-center justify-center gap-2 rounded-lg text-xs font-semibold px-4 py-2 bg-ellevee-ink text-white hover:bg-black transition-colors shadow-2xs cursor-pointer shrink-0"
        >
          <UserPlus className="h-3.5 w-3.5 text-ellevee-accent" />
          <span>Novo Atendente</span>
        </button>
      </div>

      {/* Tabela de Membros */}
      <div className="p-0 overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <th className="py-3 px-6">Membro</th>
              <th className="py-3 px-4">Função / Acesso</th>
              <th className="py-3 px-4">Cadastrado em</th>
              <th className="py-3 px-6 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {members.map((member) => {
              const isCurrentUser = member.id === currentUserId
              const isOwner = member.role === "owner"
              const isAdmin = member.role === "admin"
              const isAttendant = member.role === "attendant" || member.role === "user"
              const monogram = member.fullName.slice(0, 1).toUpperCase() || "U"

              return (
                <tr key={member.id} className="hover:bg-muted/30 transition-colors">
                  {/* Nome e E-mail */}
                  <td className="py-3.5 px-6">
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center font-display font-bold text-xs shrink-0 ${
                        isAdmin || isOwner
                          ? "bg-ellevee-ink text-white"
                          : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      }`}>
                        {monogram}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-ellevee-ink text-sm truncate">
                            {member.fullName}
                          </span>
                          {isCurrentUser && (
                            <span className="text-[10px] bg-muted px-1.5 py-0.2 rounded text-muted-foreground font-medium">
                              Você
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground truncate">
                          {member.email}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Função / Role */}
                  <td className="py-3.5 px-4">
                    {isAttendant ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <MessageSquare className="h-3 w-3 text-emerald-600" />
                        Atendente (Apenas Chat)
                      </span>
                    ) : isOwner ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 border border-slate-300">
                        <ShieldCheck className="h-3 w-3 text-slate-700" />
                        Proprietário
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                        <ShieldCheck className="h-3 w-3 text-blue-600" />
                        Administrador
                      </span>
                    )}
                  </td>

                  {/* Data */}
                  <td className="py-3.5 px-4 text-xs text-muted-foreground font-mono">
                    {member.createdAt || "Hoje"}
                  </td>

                  {/* Ações */}
                  <td className="py-3.5 px-6 text-right">
                    {!isCurrentUser && (
                      <button
                        type="button"
                        disabled={deletingId === member.id}
                        onClick={() => handleDelete(member.id, member.fullName)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-rose-600 p-1.5 rounded-md hover:bg-rose-50 transition-colors disabled:opacity-50 cursor-pointer"
                        title="Revogar acesso deste usuário"
                      >
                        {deletingId === member.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal de Criação de Atendente / Usuário */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl border border-ellevee-stone space-y-5">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b pb-4">
              <div>
                <h3 className="font-display font-bold text-lg text-ellevee-ink">
                  {createdCredentials ? "Atendente Criado com Sucesso!" : "Novo Acesso de Atendimento"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {createdCredentials
                    ? "Copie os dados abaixo e envie para o operador."
                    : "Crie a conta de acesso para um atendente da sua equipe."}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="text-muted-foreground hover:text-ellevee-ink p-1 rounded-md hover:bg-muted transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Caso de Sucesso: Exibe as credenciais prontas para copiar */}
            {createdCredentials ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-emerald-50/80 border border-emerald-200 text-emerald-900 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                    <Check className="h-4 w-4 text-emerald-600" />
                    Conta configurada e ativada imediatamente!
                  </div>

                  <div className="bg-white/90 p-3.5 rounded-md border border-emerald-200/80 space-y-2 text-xs font-mono">
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-muted-foreground">Nome:</span>
                      <span className="font-semibold text-ellevee-ink font-sans">
                        {createdCredentials.fullName}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-muted-foreground">E-mail:</span>
                      <span className="font-semibold text-ellevee-ink">
                        {createdCredentials.email}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-muted-foreground">Senha:</span>
                      <span className="font-bold text-emerald-800 bg-emerald-100/70 px-2 py-0.5 rounded">
                        {createdCredentials.password}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-muted-foreground">Permissão:</span>
                      <span className="font-semibold text-ellevee-ink font-sans">
                        {createdCredentials.role === "admin" ? "Administrador" : "Atendente (Apenas Chat)"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCopyCredentials}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg text-xs font-semibold py-2.5 bg-ellevee-ink text-white hover:bg-black transition-colors cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-ellevee-accent" />
                        <span>Copiado para Área de Transferência!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-ellevee-accent" />
                        <span>Copiar Dados de Acesso</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2.5 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors cursor-pointer"
                  >
                    Concluir
                  </button>
                </div>
              </div>
            ) : (
              /* Formulário de Criação */
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Nome Completo */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-ellevee-ink flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    Nome Completo do Operador
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Maria Santos"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ellevee-accent"
                  />
                </div>

                {/* E-mail */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-ellevee-ink flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    E-mail de Login
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="maria@sumel.com.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ellevee-accent"
                  />
                </div>

                {/* Senha com Gerador */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-ellevee-ink flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                      Senha Inicial
                    </label>
                    <button
                      type="button"
                      onClick={handleGeneratePassword}
                      className="text-[11px] text-ellevee-sage hover:text-ellevee-ink flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Sparkles className="h-3 w-3 text-ellevee-accent" />
                      <span>Gerar nova senha</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ellevee-accent"
                  />
                </div>

                {/* Seletor de Perfil / Nível de Acesso */}
                <div className="space-y-2 pt-1">
                  <label className="text-xs font-semibold text-ellevee-ink">
                    Nível de Acesso (RBAC)
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    {/* Opção 1: Atendente */}
                    <div
                      onClick={() => setRole("attendant")}
                      className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                        role === "attendant"
                          ? "border-emerald-500 bg-emerald-50/50 shadow-2xs"
                          : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                        <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Atendente</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                        Acesso <strong>exclusivo ao Chat</strong> e mensagens aos clientes. Bloqueado em relatórios, catálogo e configurações.
                      </p>
                    </div>

                    {/* Opção 2: Administrador */}
                    <div
                      onClick={() => setRole("admin")}
                      className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                        role === "admin"
                          ? "border-slate-800 bg-slate-50 shadow-2xs"
                          : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                        <ShieldCheck className="h-3.5 w-3.5 text-slate-800" />
                        <span>Administrador</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                        Acesso total a configurações, funis de atendimento, catálogo e gestão de operadores.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Botões de Ação */}
                <div className="flex justify-end gap-2 pt-3 border-t">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-ellevee-ink text-white hover:bg-black transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Criando acesso...</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-3.5 w-3.5 text-ellevee-accent" />
                        <span>Criar Atendente</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

"use client"

import React, { useState, useEffect } from "react"
import { 
  Dialog, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  Loader2 
} from "lucide-react"
import { CompanyMock } from "./mock-companies"
import { 
  getCompanyUsersAction, 
  createCompanyAttendantAction, 
  deleteCompanyAttendantAction,
  AdminCompanyUser
} from "@/app/(admin)/companies/actions"
import { toast } from "@/components/ui/toast"

interface CompanyUsersDialogProps {
  company: CompanyMock | null
  open: boolean
  onClose: () => void
}

export default function CompanyUsersDialog({
  company,
  open,
  onClose,
}: CompanyUsersDialogProps) {
  const [users, setUsers] = useState<AdminCompanyUser[]>([])
  const [loading, setLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Form
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"attendant" | "admin">("attendant")

  // Credenciais geradas
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

  // Carrega lista ao abrir
  useEffect(() => {
    if (open && company) {
      setLoading(true)
      setIsCreating(false)
      setCreatedCredentials(null)
      setError(null)
      getCompanyUsersAction(company.id)
        .then((data) => setUsers(data))
        .catch((err) => console.error(err))
        .finally(() => setLoading(false))
    }
  }, [open, company])

  if (!company) return null

  const handleStartCreate = () => {
    setFullName("")
    setEmail("")
    setPassword("")
    setRole("attendant")
    setError(null)
    setCreatedCredentials(null)
    setCopied(false)
    handleGeneratePassword()
    setIsCreating(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const res = await createCompanyAttendantAction({
        companyId: company.id,
        fullName,
        email,
        password,
        role,
      })

      if (!res.success || !res.data) {
        setError(res.error || "Falha ao criar usuário.")
        setIsSubmitting(false)
        return
      }

      setCreatedCredentials({
        fullName: res.data.fullName,
        email: res.data.email,
        password: res.data.password,
        role: res.data.role,
      })

      // Recarrega lista
      const updated = await getCompanyUsersAction(company.id)
      setUsers(updated)
      toast.success("Usuário criado!", `${res.data.fullName} cadastrado com sucesso.`)
    } catch (err: any) {
      setError(err?.message || "Erro inesperado.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (userId: string, userName: string) => {
    if (!window.confirm(`Deseja revogar o acesso de "${userName}"?`)) return
    setDeletingId(userId)
    try {
      const res = await deleteCompanyAttendantAction(company.id, userId)
      if (res.success) {
        setUsers((prev) => prev.filter((u) => u.id !== userId))
        toast.info("Acesso removido", `Usuário ${userName} foi excluído.`)
      } else {
        alert(res.error || "Falha ao deletar.")
      }
    } catch (err: any) {
      alert("Erro ao remover: " + err?.message)
    } finally {
      setDeletingId(null)
    }
  }

  const handleCopyCredentials = () => {
    if (!createdCredentials) return
    const text = `*Acesso Ellevee IA - ${company.name}*\n\n` +
      `👤 *Nome:* ${createdCredentials.fullName}\n` +
      `📧 *E-mail:* ${createdCredentials.email}\n` +
      `🔑 *Senha:* ${createdCredentials.password}\n` +
      `💼 *Função:* ${createdCredentials.role === "admin" ? "Administrador" : "Atendente (Apenas Chat)"}\n` +
      `🌐 *Link de Acesso:* ${window.location.origin}/login`

    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="w-full max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-ellevee-purple" />
            <DialogTitle className="font-display text-base font-bold text-ellevee-deep-ink">Equipe e Atendentes</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-ellevee-text-secondary">
            Gerencie os operadores e administradores de <strong>{company.name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Header da lista com botão Novo */}
          {!isCreating && (
            <div className="flex items-center justify-between pb-2 border-b border-ellevee-border">
              <span className="text-xs font-semibold text-ellevee-text-secondary">
                {users.length} {users.length === 1 ? "usuário cadastrado" : "usuários cadastrados"}
              </span>
              <Button
                type="button"
                size="sm"
                onClick={handleStartCreate}
                className="gap-1.5 h-8 text-xs bg-ellevee-gradient hover:opacity-95 text-white font-semibold rounded-lg shadow-sm"
              >
                <UserPlus className="h-3.5 w-3.5 text-white" />
                <span>Novo Atendente</span>
              </Button>
            </div>
          )}

          {/* Estado de Carregando */}
          {loading ? (
            <div className="h-36 flex items-center justify-center text-xs text-ellevee-text-secondary gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-ellevee-purple" />
              <span>Carregando membros...</span>
            </div>
          ) : isCreating ? (
            /* Formulário de Criação ou Confirmação */
            createdCredentials ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                    <Check className="h-4 w-4 text-emerald-600" />
                    Atendente criado e credenciais ativadas!
                  </div>

                  <div className="bg-white/90 p-3 rounded-lg border border-emerald-200 text-xs font-mono space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-ellevee-text-secondary">Nome:</span>
                      <span className="font-semibold text-ellevee-deep-ink font-sans">{createdCredentials.fullName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ellevee-text-secondary">E-mail:</span>
                      <span className="font-semibold text-ellevee-deep-ink">{createdCredentials.email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ellevee-text-secondary">Senha:</span>
                      <span className="font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">
                        {createdCredentials.password}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ellevee-text-secondary">Perfil:</span>
                      <span className="font-semibold text-ellevee-deep-ink font-sans">
                        {createdCredentials.role === "admin" ? "Administrador" : "Atendente (Apenas Chat)"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={handleCopyCredentials}
                    className="flex-1 gap-2 bg-ellevee-gradient hover:opacity-95 text-white font-semibold rounded-lg shadow-sm text-xs"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-white" />
                        <span>Copiado com sucesso!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-white" />
                        <span>Copiar Dados de Acesso</span>
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsCreating(false)
                      setCreatedCredentials(null)
                    }}
                    className="text-xs border-ellevee-border text-ellevee-deep-ink"
                  >
                    Voltar à Lista
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3.5 border border-ellevee-border rounded-xl p-4 bg-[#F8F8F6]">
                <div className="flex items-center justify-between pb-2 border-b border-ellevee-border">
                  <span className="text-xs font-bold text-ellevee-deep-ink font-display">Cadastrar Novo Acesso</span>
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="text-xs text-ellevee-text-secondary hover:text-black"
                  >
                    Cancelar
                  </button>
                </div>

                {error && (
                  <div className="flex items-center gap-1.5 p-2 rounded-lg bg-rose-50 text-rose-800 text-xs border border-rose-200">
                    <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-ellevee-deep-ink block mb-1">Nome Completo</label>
                  <Input
                    required
                    placeholder="Ex: João Silva"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="h-8.5 text-xs bg-white border-ellevee-border text-ellevee-deep-ink"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-ellevee-deep-ink block mb-1">E-mail</label>
                  <Input
                    type="email"
                    required
                    placeholder="joao@sumel.com.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-8.5 text-xs bg-white border-ellevee-border text-ellevee-deep-ink"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-ellevee-deep-ink">Senha de Acesso</label>
                    <button
                      type="button"
                      onClick={handleGeneratePassword}
                      className="text-[11px] text-ellevee-text-secondary hover:text-black flex items-center gap-1"
                    >
                      <Sparkles className="h-3 w-3 text-ellevee-purple" />
                      <span>Gerar nova</span>
                    </button>
                  </div>
                  <Input
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-8.5 text-xs font-mono bg-white border-ellevee-border text-ellevee-deep-ink"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-ellevee-deep-ink block mb-1.5">Permissão (RBAC)</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div
                      onClick={() => setRole("attendant")}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                        role === "attendant"
                          ? "border-emerald-600 bg-emerald-50/70"
                          : "border-ellevee-border bg-white hover:bg-ellevee-warm-ivory/50"
                      }`}
                    >
                      <span className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                        <MessageSquare className="h-3 w-3 text-emerald-600" />
                        Atendente
                      </span>
                      <p className="text-[10px] text-ellevee-text-secondary mt-0.5">
                        Acesso <strong>somente ao Chat</strong> de mensagens.
                      </p>
                    </div>

                    <div
                      onClick={() => setRole("admin")}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                        role === "admin"
                          ? "border-ellevee-deep-ink bg-white shadow-2xs"
                          : "border-ellevee-border bg-white hover:bg-ellevee-warm-ivory/50"
                      }`}
                    >
                      <span className="text-xs font-bold text-ellevee-deep-ink flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3 text-ellevee-deep-ink" />
                        Administrador
                      </span>
                      <p className="text-[10px] text-ellevee-text-secondary mt-0.5">
                        Acesso total à empresa.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsCreating(false)}
                    className="text-xs h-8 border-ellevee-border text-ellevee-deep-ink"
                  >
                    Voltar
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    size="sm"
                    className="text-xs h-8 bg-ellevee-gradient hover:opacity-95 text-white font-semibold rounded-lg shadow-sm gap-1.5"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Cadastrando...</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-3 w-3 text-white" />
                        <span>Cadastrar Operador</span>
                      </>
                    )}
                  </Button>
                </div>
              </form>
            )
          ) : (
            /* Lista de Usuários */
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {users.length === 0 ? (
                <div className="text-center py-6 text-xs text-ellevee-text-secondary">
                  Nenhum usuário cadastrado nesta empresa.
                </div>
              ) : (
                users.map((u) => {
                  const isAttendant = u.role === "attendant" || u.role === "user"
                  const isOwner = u.role === "owner"
                  const monogram = u.fullName.slice(0, 1).toUpperCase() || "U"

                  return (
                    <div
                      key={u.id}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-ellevee-border bg-white hover:bg-ellevee-warm-ivory/40 transition-colors shadow-2xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`h-7 w-7 rounded-full flex items-center justify-center font-display font-bold text-xs shrink-0 ${
                            isAttendant
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              : "bg-ellevee-deep-ink text-white"
                          }`}
                        >
                          {monogram}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-semibold text-xs text-ellevee-deep-ink truncate font-display">
                            {u.fullName}
                          </span>
                          <span className="text-[11px] text-ellevee-text-secondary truncate font-mono">
                            {u.email}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isAttendant ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <MessageSquare className="h-2.5 w-2.5 text-emerald-600" />
                            Atendente
                          </span>
                        ) : isOwner ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-300">
                            <ShieldCheck className="h-2.5 w-2.5 text-slate-700" />
                            Proprietário
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                            <ShieldCheck className="h-2.5 w-2.5 text-blue-600" />
                            Admin
                          </span>
                        )}

                        {!isOwner && (
                          <button
                            type="button"
                            disabled={deletingId === u.id}
                            onClick={() => handleDelete(u.id, u.fullName)}
                            className="p-1 text-ellevee-text-secondary hover:text-rose-600 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Remover acesso"
                          >
                            {deletingId === u.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-500" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            Fechar
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}

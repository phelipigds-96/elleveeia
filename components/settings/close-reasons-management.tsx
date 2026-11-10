"use client"

import React, { useState } from "react"
import { Plus, Edit2, Trash2, CheckCircle2, AlertCircle, ShieldAlert, Sparkles, HelpCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import {
  CloseReason,
  saveCloseReasonAction,
  deleteCloseReasonAction,
  toggleCloseReasonAction,
} from "@/app/(dashboard)/settings/actions"

interface CloseReasonsManagementProps {
  initialReasons: CloseReason[]
  requireCloseReason: boolean
}

const COLOR_OPTIONS = [
  { key: "emerald", label: "Verde (Sucesso)", bg: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  { key: "blue", label: "Azul (Informação)", bg: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  { key: "violet", label: "Roxo (Proposta)", bg: "bg-purple-50 text-purple-700 border-purple-200", dot: "bg-purple-500" },
  { key: "amber", label: "Âmbar (Atenção)", bg: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  { key: "rose", label: "Vermelho (Desistência)", bg: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" },
  { key: "cyan", label: "Ciano (Comercial)", bg: "bg-cyan-50 text-cyan-700 border-cyan-200", dot: "bg-cyan-500" },
  { key: "slate", label: "Cinza (Neutro)", bg: "bg-slate-50 text-slate-700 border-slate-200", dot: "bg-slate-500" },
]

export function CloseReasonsManagement({
  initialReasons,
  requireCloseReason,
}: CloseReasonsManagementProps) {
  const [reasons, setReasons] = useState<CloseReason[]>(initialReasons)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingReason, setEditingReason] = useState<CloseReason | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [color, setColor] = useState("emerald")
  const [isActive, setIsActive] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleOpenCreate = () => {
    setEditingReason(null)
    setTitle("")
    setDescription("")
    setColor("emerald")
    setIsActive(true)
    setIsDialogOpen(true)
  }

  const handleOpenEdit = (reason: CloseReason) => {
    setEditingReason(reason)
    setTitle(reason.title)
    setDescription(reason.description || "")
    setColor(reason.color || "slate")
    setIsActive(reason.isActive)
    setIsDialogOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setIsSaving(true)
    try {
      const res = await saveCloseReasonAction({
        id: editingReason?.id,
        title: title.trim(),
        description: description.trim() || undefined,
        color,
        isActive,
      })

      if (res.success && res.data) {
        toast.success(
          editingReason ? "Motivo atualizado" : "Motivo cadastrado",
          `O motivo "${res.data.title}" foi salvo com sucesso.`
        )

        if (editingReason) {
          setReasons((prev) =>
            prev.map((r) => (r.id === editingReason.id ? res.data! : r))
          )
        } else {
          setReasons((prev) => [...prev, res.data!])
        }

        setIsDialogOpen(false)
      } else {
        toast.error("Falha ao salvar", res.error || "Não foi possível registrar o motivo.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err?.message || "Erro na comunicação.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string, reasonTitle: string) => {
    if (!confirm(`Deseja realmente remover o motivo "${reasonTitle}"?`)) return

    setDeletingId(id)
    try {
      const res = await deleteCloseReasonAction(id)
      if (res.success) {
        toast.success("Motivo removido", `"${reasonTitle}" foi excluído.`)
        setReasons((prev) => prev.filter((r) => r.id !== id))
      } else {
        toast.error("Erro ao excluir", res.error || "Falha ao remover o motivo.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err?.message || "Falha na comunicação.")
    } finally {
      setDeletingId(null)
    }
  }

  const handleToggle = async (reason: CloseReason) => {
    const nextState = !reason.isActive
    // Optimistic update
    setReasons((prev) =>
      prev.map((r) => (r.id === reason.id ? { ...r, isActive: nextState } : r))
    )

    try {
      const res = await toggleCloseReasonAction(reason.id, nextState)
      if (!res.success) {
        // Rollback
        setReasons((prev) =>
          prev.map((r) => (r.id === reason.id ? { ...r, isActive: reason.isActive } : r))
        )
        toast.error("Erro", res.error || "Falha ao alternar status do motivo.")
      } else {
        toast.success(
          nextState ? "Motivo ativado" : "Motivo desativado",
          `"${reason.title}" ${nextState ? "já aparece no chat." : "não será exibido no chat."}`
        )
      }
    } catch {
      // Rollback
      setReasons((prev) =>
        prev.map((r) => (r.id === reason.id ? { ...r, isActive: reason.isActive } : r))
      )
    }
  }

  const getColorConfig = (c: string) => {
    return COLOR_OPTIONS.find((item) => item.key === c) || COLOR_OPTIONS[6]
  }

  return (
    <div className="space-y-6">
      {/* Header com Status da Exigência pelo SuperAdmin */}
      <div className="rounded-xl border border-ellevee-border bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-bold text-ellevee-deep-ink">
                Motivos de Finalização de Atendimento
              </h2>
              {requireCloseReason ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                  <CheckCircle2 className="h-3 w-3 text-purple-600" />
                  Obrigatório na Empresa
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-50 text-slate-600 border border-slate-200">
                  Opcional
                </span>
              )}
            </div>
            <p className="text-xs text-ellevee-text-secondary mt-1">
              Cadastre e gerencie os motivos que seus atendentes selecionarão ao encerrar conversas no painel de chat.
            </p>
          </div>

          <Button
            onClick={handleOpenCreate}
            className="bg-ellevee-deep-ink text-white hover:bg-black gap-1.5 text-xs font-semibold shrink-0"
          >
            <Plus className="h-4 w-4" />
            Novo Motivo
          </Button>
        </div>

        {/* Notificação informativa */}
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-start gap-2.5 ${
            requireCloseReason
              ? "bg-purple-50/60 border-purple-200 text-purple-900"
              : "bg-[#F8F8F6] border-ellevee-border text-ellevee-text-secondary"
          }`}
        >
          {requireCloseReason ? (
            <ShieldAlert className="h-4 w-4 text-purple-600 shrink-0 mt-0.5" />
          ) : (
            <HelpCircle className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
          )}
          <div className="leading-relaxed">
            {requireCloseReason ? (
              <span>
                <strong>Exigência Habilitada:</strong> O administrador da plataforma configurou que todo encerramento
                nesta empresa requer a seleção de um motivo. Mantenha os motivos abaixo atualizados para sua equipe.
              </span>
            ) : (
              <span>
                <strong>Modo Livre:</strong> A seleção de motivo é opcional ao encerrar atendimentos. Se preferir que
                seus atendentes sejam obrigados a escolher um motivo, solicite a ativação ao suporte da Ellevee IA.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Lista de Motivos Cadastrados */}
      <div className="rounded-xl border border-ellevee-border bg-white shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-ellevee-border bg-[#F8F8F6] flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-ellevee-deep-ink">
            Motivos Ativos & Inativos ({reasons.length})
          </span>
          <span className="text-xs text-ellevee-text-secondary">
            {reasons.filter((r) => r.isActive).length} disponíveis para os atendentes
          </span>
        </div>

        {reasons.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <AlertCircle className="h-8 w-8 text-slate-300 mx-auto" />
            <p className="text-xs text-ellevee-text-secondary">
              Nenhum motivo de finalização cadastrado ainda.
            </p>
            <Button
              variant="outline"
              onClick={handleOpenCreate}
              className="text-xs border-ellevee-border text-ellevee-deep-ink"
            >
              Criar o primeiro motivo
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-ellevee-border">
            {reasons.map((reason) => {
              const colorCfg = getColorConfig(reason.color)
              return (
                <div
                  key={reason.id}
                  className={`p-4 flex items-center justify-between gap-4 transition-colors ${
                    reason.isActive ? "hover:bg-ellevee-warm-ivory/30" : "bg-slate-50/50 opacity-60"
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className={`h-2.5 w-2.5 rounded-full mt-1.5 shrink-0 ${colorCfg.dot}`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-ellevee-deep-ink">
                          {reason.title}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${colorCfg.bg}`}
                        >
                          {colorCfg.label.split(" ")[0]}
                        </span>
                        {!reason.isActive && (
                          <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            Inativo
                          </span>
                        )}
                      </div>
                      {reason.description && (
                        <p className="text-xs text-ellevee-text-secondary mt-0.5 line-clamp-1">
                          {reason.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Switch Ativo/Inativo */}
                    <button
                      type="button"
                      onClick={() => handleToggle(reason)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        reason.isActive ? "bg-emerald-600" : "bg-slate-300"
                      }`}
                      title={reason.isActive ? "Desativar motivo" : "Ativar motivo"}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          reason.isActive ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>

                    {/* Editar */}
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(reason)}
                      className="p-1.5 text-slate-400 hover:text-ellevee-deep-ink hover:bg-slate-100 rounded-lg transition-colors"
                      title="Editar motivo"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>

                    {/* Deletar */}
                    <button
                      type="button"
                      onClick={() => handleDelete(reason.id, reason.title)}
                      disabled={deletingId === reason.id}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-40"
                      title="Excluir motivo"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Diálogo de Criação/Edição */}
      <Dialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)} className="max-w-md">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-ellevee-deep-ink">
              {editingReason ? "Editar Motivo de Finalização" : "Novo Motivo de Finalização"}
            </DialogTitle>
            <DialogDescription className="text-xs text-ellevee-text-secondary">
              Defina o nome e categoria visual do motivo para os atendentes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1.5">
                Título do Motivo <span className="text-rose-500">*</span>
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Venda Concluída, Dúvida Sanada, Cliente Desistiu..."
                className="bg-white border-ellevee-border text-xs text-ellevee-deep-ink"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1.5">
                Descrição ou Instrução para o Atendente <span className="text-slate-400 font-normal">(opcional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Ex: Usar quando o cliente fechar pedido formal ou pagar via Pix..."
                className="w-full text-xs p-2.5 rounded-lg border border-ellevee-border bg-white text-ellevee-deep-ink focus:outline-none focus:ring-1 focus:ring-ellevee-purple resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ellevee-deep-ink mb-2">
                Cor do Identificador
              </label>
              <div className="grid grid-cols-2 gap-2">
                {COLOR_OPTIONS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setColor(item.key)}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-left text-xs transition-all ${
                      color === item.key
                        ? "border-ellevee-purple bg-purple-50/50 font-bold text-ellevee-deep-ink shadow-2xs"
                        : "border-ellevee-border hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${item.dot}`} />
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border border-ellevee-border bg-[#F8F8F6]">
              <div>
                <span className="text-xs font-semibold text-ellevee-deep-ink block">
                  Motivo Ativo
                </span>
                <span className="text-[11px] text-ellevee-text-secondary">
                  Se desativado, não aparecerá na lista de escolha do chat.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isActive ? "bg-emerald-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    isActive ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSaving}
              className="border-ellevee-border text-ellevee-deep-ink text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !title.trim()}
              className="bg-ellevee-deep-ink text-white hover:bg-black text-xs font-semibold"
            >
              {isSaving ? "Salvando..." : editingReason ? "Salvar Alterações" : "Criar Motivo"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  )
}

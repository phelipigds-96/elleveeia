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
  Kanban, 
  Plus, 
  Bot, 
  User, 
  Clock, 
  Trash2, 
  Copy, 
  Sparkles, 
  AlertCircle, 
  Loader2, 
  Check, 
  Edit3, 
  Layers, 
  ArrowUp, 
  ArrowDown,
  ShieldCheck
} from "lucide-react"
import { 
  WorkflowTemplate, 
  StageTemplate 
} from "@/lib/services/workflows/template-catalog"
import { 
  getPlatformWorkflowTemplatesList, 
  savePlatformWorkflowTemplateAction, 
  deletePlatformWorkflowTemplateAction 
} from "@/lib/services/workflows/templates-service"
import { toast } from "@/components/ui/toast"

interface PlatformTemplatesDialogProps {
  open: boolean
  onClose: () => void
  onTemplatesUpdated?: () => void
}

const COLOR_PRESETS = [
  "#eab308", // Amarelo
  "#f97316", // Laranja
  "#3b82f6", // Azul
  "#06b6d4", // Ciano
  "#a855f7", // Roxo
  "#22c55e", // Verde
  "#ef4444", // Vermelho
  "#64748b", // Cinza / Ardósia
]

export default function PlatformTemplatesDialog({
  open,
  onClose,
  onTemplatesUpdated,
}: PlatformTemplatesDialogProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Form State
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const [key, setKey] = useState("")
  const [label, setLabel] = useState("")
  const [segment, setSegment] = useState("")
  const [description, setDescription] = useState("")
  const [badgeText, setBadgeText] = useState("")
  const [stages, setStages] = useState<StageTemplate[]>([])

  const loadTemplates = async () => {
    setLoading(true)
    try {
      const data = await getPlatformWorkflowTemplatesList()
      setTemplates(data)
    } catch (err: any) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setIsEditing(false)
      setError(null)
      loadTemplates()
    }
  }, [open])

  const handleStartCreate = () => {
    setEditingId(undefined)
    setKey("")
    setLabel("")
    setSegment("Serviços Digitais & Recorrência")
    setDescription("")
    setBadgeText("Modelo Personalizado")
    setStages([
      { name: "Novo Contato", description: "Primeira interação", stage_type: "initial", handled_by: "ai", color: "#eab308" },
      { name: "Em Atendimento", description: "Negociação em andamento", stage_type: "in_progress", handled_by: "human", color: "#3b82f6" },
      { name: "Concluído", description: "Atendimento ou venda finalizada", stage_type: "final", handled_by: "human", color: "#22c55e" }
    ])
    setError(null)
    setIsEditing(true)
  }

  const handleStartEdit = (tmpl: WorkflowTemplate) => {
    setEditingId(tmpl.id)
    setKey(tmpl.key)
    setLabel(tmpl.label)
    setSegment(tmpl.segment)
    setDescription(tmpl.description)
    setBadgeText(tmpl.badgeText || "")
    setStages(JSON.parse(JSON.stringify(tmpl.stages)))
    setError(null)
    setIsEditing(true)
  }

  const handleDuplicate = (tmpl: WorkflowTemplate) => {
    setEditingId(undefined)
    setKey(`${tmpl.key}_copy_${Math.floor(100 + Math.random() * 900)}`)
    setLabel(`Cópia de ${tmpl.label}`)
    setSegment(tmpl.segment)
    setDescription(tmpl.description)
    setBadgeText(`${tmpl.badgeText || tmpl.segment} (Cópia)`)
    setStages(JSON.parse(JSON.stringify(tmpl.stages)))
    setError(null)
    setIsEditing(true)
  }

  const handleAddStage = () => {
    setStages((prev) => [
      ...prev,
      {
        name: `Nova Etapa ${prev.length + 1}`,
        description: "",
        stage_type: "in_progress",
        handled_by: "human",
        color: COLOR_PRESETS[prev.length % COLOR_PRESETS.length],
      },
    ])
  }

  const handleRemoveStage = (index: number) => {
    if (stages.length <= 2) {
      alert("O funil deve manter pelo menos 2 etapas (uma inicial e uma final).")
      return
    }
    setStages((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleMoveStage = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= stages.length) return
    setStages((prev) => {
      const next = [...prev]
      const temp = next[index]
      next[index] = next[targetIndex]
      next[targetIndex] = temp
      return next
    })
  }

  const handleUpdateStage = (index: number, patch: Partial<StageTemplate>) => {
    setStages((prev) =>
      prev.map((s, idx) => (idx === index ? { ...s, ...patch } : s))
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const res = await savePlatformWorkflowTemplateAction({
        id: editingId,
        key,
        label,
        segment,
        description,
        badgeText,
        stages,
      })

      if (!res.success || !res.data) {
        setError(res.error || "Falha ao salvar modelo.")
        setIsSubmitting(false)
        return
      }

      toast.success("Modelo Salvo!", `O modelo "${label}" está pronto para uso.`)
      setIsEditing(false)
      await loadTemplates()
      if (onTemplatesUpdated) onTemplatesUpdated()
    } catch (err: any) {
      setError(err?.message || "Erro inesperado ao salvar modelo.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (tmpl: WorkflowTemplate) => {
    if (tmpl.isSystem) {
      alert("Modelos nativos do sistema não podem ser excluídos.")
      return
    }
    if (!window.confirm(`Tem certeza que deseja excluir o modelo "${tmpl.label}"?`)) {
      return
    }

    setDeletingKey(tmpl.key)
    try {
      const res = await deletePlatformWorkflowTemplateAction(tmpl.id || tmpl.key)
      if (res.success) {
        toast.info("Modelo Excluído", `O modelo "${tmpl.label}" foi removido.`)
        await loadTemplates()
        if (onTemplatesUpdated) onTemplatesUpdated()
      } else {
        alert(res.error || "Falha ao excluir modelo.")
      }
    } catch (err: any) {
      alert("Erro ao excluir: " + err?.message)
    } finally {
      setDeletingKey(null)
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Kanban className="h-5 w-5 text-ellevee-purple" />
            <DialogTitle className="font-display text-base font-bold text-ellevee-deep-ink">Biblioteca de Modelos de Funil (Kanban)</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-ellevee-text-secondary">
            Crie, edite e personalize blueprints reutilizáveis de atendimento por nicho e segmento de mercado.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Header com botão Criar quando na lista */}
          {!isEditing && (
            <div className="flex items-center justify-between pb-3 border-b border-ellevee-border">
              <div className="flex items-center gap-2 text-xs font-semibold text-ellevee-text-secondary">
                <Layers className="h-4 w-4 text-ellevee-deep-ink" />
                <span>{templates.length} modelos disponíveis na plataforma</span>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={handleStartCreate}
                className="gap-1.5 h-8 text-xs bg-ellevee-gradient hover:opacity-95 text-white font-semibold rounded-lg shadow-sm"
              >
                <Plus className="h-3.5 w-3.5 text-white" />
                <span>Novo Modelo de Funil</span>
              </Button>
            </div>
          )}

          {/* Estado de Carregamento */}
          {loading ? (
            <div className="h-48 flex items-center justify-center text-xs text-ellevee-text-secondary gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-ellevee-purple" />
              <span>Carregando biblioteca de modelos...</span>
            </div>
          ) : isEditing ? (
            /* Formulário de Criação / Edição do Modelo */
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-ellevee-border">
                <span className="font-bold text-sm text-ellevee-deep-ink font-display">
                  {editingId ? `Editar Modelo: ${label}` : "Novo Modelo de Funil"}
                </span>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="text-xs text-ellevee-text-secondary hover:text-ellevee-deep-ink transition-colors"
                >
                  Voltar para lista
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="text-xs font-semibold text-ellevee-deep-ink block mb-1">
                    Nome do Modelo
                  </label>
                  <Input
                    required
                    placeholder="Ex: Streaming & Assinaturas Digitais"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="h-9 text-xs bg-white"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-ellevee-deep-ink block mb-1">
                    Segmento de Mercado
                  </label>
                  <Input
                    required
                    placeholder="Ex: Serviços Digitais & Recorrência"
                    value={segment}
                    onChange={(e) => setSegment(e.target.value)}
                    className="h-9 text-xs bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-ellevee-deep-ink block mb-1">
                  Descrição do Funil
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Funil focado em teste grátis, envio de credenciais, pagamento via Pix e renovações periódicas."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-lg border border-ellevee-border bg-white p-2.5 text-xs placeholder:text-ellevee-text-secondary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ellevee-blue text-ellevee-deep-ink"
                />
              </div>

              {/* Editor de Etapas */}
              <div className="space-y-2 pt-2 border-t border-ellevee-border">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-ellevee-deep-ink font-display">
                      Etapas do Kanban ({stages.length})
                    </span>
                    <p className="text-[11px] text-ellevee-text-secondary">
                      Configure o fluxo progressivo e defina quem atende cada fase.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleAddStage}
                    className="h-7 text-[11px] gap-1 border-ellevee-border text-ellevee-deep-ink"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Adicionar Etapa</span>
                  </Button>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {stages.map((st, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border bg-white shadow-2xs space-y-2 border-ellevee-border"
                    >
                      <div className="flex items-center gap-2">
                        {/* Indicador de Posição & Botões de Ordem */}
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="h-6 w-6 rounded bg-[#F8F8F6] border border-ellevee-border text-[11px] font-mono font-bold flex items-center justify-center text-ellevee-deep-ink">
                            {idx + 1}
                          </span>
                          <div className="flex flex-col">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveStage(idx, "up")}
                              className="text-ellevee-text-secondary hover:text-ellevee-deep-ink disabled:opacity-30"
                              title="Subir etapa"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === stages.length - 1}
                              onClick={() => handleMoveStage(idx, "down")}
                              className="text-ellevee-text-secondary hover:text-ellevee-deep-ink disabled:opacity-30"
                              title="Descer etapa"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </button>
                          </div>
                        </div>

                        {/* Nome da Etapa */}
                        <Input
                          required
                          value={st.name}
                          onChange={(e) => handleUpdateStage(idx, { name: e.target.value })}
                          placeholder="Nome da etapa"
                          className="h-8 text-xs font-semibold flex-1"
                        />

                        {/* Cor da Etapa */}
                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className="h-6 w-6 rounded-md border border-black/10 shrink-0"
                            style={{ backgroundColor: st.color }}
                          />
                          <select
                            value={st.color}
                            onChange={(e) => handleUpdateStage(idx, { color: e.target.value })}
                            className="h-8 text-[11px] rounded border border-ellevee-border bg-white px-1.5 font-mono text-ellevee-deep-ink"
                          >
                            {COLOR_PRESETS.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Botão Remover */}
                        <button
                          type="button"
                          onClick={() => handleRemoveStage(idx)}
                          className="p-1.5 text-ellevee-text-secondary hover:text-rose-600 rounded hover:bg-rose-50 transition-colors"
                          title="Remover etapa"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-dashed border-ellevee-border">
                        {/* Quem atende? */}
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-ellevee-text-secondary uppercase tracking-wider">
                            Atendimento:
                          </span>
                          <select
                            value={st.handled_by}
                            onChange={(e) =>
                              handleUpdateStage(idx, { handled_by: e.target.value as any })
                            }
                            className="h-7 text-xs rounded border border-ellevee-border bg-white px-2 text-ellevee-deep-ink"
                          >
                            <option value="ai">🤖 IA Autônoma</option>
                            <option value="human">👤 Operador Humano</option>
                            <option value="waiting">⏳ Aguardando Cliente</option>
                          </select>
                        </div>

                        {/* Tipo de Etapa */}
                        <div className="flex items-center gap-2 sm:justify-end">
                          <span className="text-[10px] font-semibold text-ellevee-text-secondary uppercase tracking-wider">
                            Fase:
                          </span>
                          <select
                            value={st.stage_type}
                            onChange={(e) =>
                              handleUpdateStage(idx, { stage_type: e.target.value as any })
                            }
                            className="h-7 text-xs rounded border border-ellevee-border bg-white px-2 text-ellevee-deep-ink"
                          >
                            <option value="initial">Entrada (Inicial)</option>
                            <option value="in_progress">Em Andamento</option>
                            <option value="final">Finalizada (Concluído/Perdido)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ações do Formulário */}
              <div className="flex justify-end gap-2 pt-3 border-t border-ellevee-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(false)}
                  className="text-xs h-8 border-ellevee-border text-ellevee-deep-ink"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  size="sm"
                  className="text-xs h-8 bg-ellevee-gradient hover:opacity-95 text-white font-semibold rounded-lg shadow-sm gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Salvando modelo...</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5 text-white" />
                      <span>Salvar Modelo de Funil</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          ) : (
            /* Lista de Modelos Existentes */
            <div className="space-y-3">
              {templates.map((tmpl) => (
                <div
                  key={tmpl.key}
                  className="p-4 rounded-xl border bg-white hover:border-ellevee-purple/40 transition-all space-y-3 border-ellevee-border shadow-card"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display font-bold text-sm text-ellevee-deep-ink">
                          {tmpl.label}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {tmpl.segment}
                        </span>
                        {tmpl.isSystem ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                            <ShieldCheck className="h-2.5 w-2.5 text-slate-600" />
                            Blueprint Nativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200">
                            <Sparkles className="h-2.5 w-2.5 text-ellevee-purple" />
                            Modelo Personalizado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ellevee-text-secondary mt-1 leading-snug">
                        {tmpl.description}
                      </p>
                    </div>

                    {/* Botões de Ação do Modelo */}
                    <div className="flex items-center gap-1.5 shrink-0 self-start">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleDuplicate(tmpl)}
                        className="h-7 text-[11px] gap-1 px-2 text-ellevee-deep-ink border-ellevee-border hover:bg-ellevee-warm-ivory/60"
                        title="Duplicar este modelo"
                      >
                        <Copy className="h-3 w-3 text-ellevee-text-secondary" />
                        <span>Clonar</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartEdit(tmpl)}
                        className="h-7 text-[11px] gap-1 px-2 text-ellevee-deep-ink border-ellevee-border hover:bg-ellevee-warm-ivory/60"
                      >
                        <Edit3 className="h-3 w-3 text-ellevee-text-secondary" />
                        <span>Editar</span>
                      </Button>
                      {!tmpl.isSystem && (
                        <button
                          type="button"
                          disabled={deletingKey === tmpl.key}
                          onClick={() => handleDelete(tmpl)}
                          className="p-1.5 text-ellevee-text-secondary hover:text-rose-600 rounded hover:bg-rose-50 transition-colors"
                          title="Excluir modelo"
                        >
                          {deletingKey === tmpl.key ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-500" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Visualizador das Etapas (Mini Colunas do Kanban) */}
                  <div className="pt-2 border-t border-ellevee-border">
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
                      {tmpl.stages.map((st, sIdx) => {
                        const isAi = st.handled_by === "ai"
                        const isWaiting = st.handled_by === "waiting"

                        return (
                          <div
                            key={sIdx}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md border bg-[#F8F8F6] shrink-0 border-ellevee-border"
                          >
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: st.color }}
                            />
                            <span className="font-semibold text-ellevee-deep-ink text-xs whitespace-nowrap">
                              {st.name}
                            </span>
                            <span className="text-[10px] text-ellevee-text-secondary ml-1">
                              {isAi ? "🤖" : isWaiting ? "⏳" : "👤"}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ))}
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

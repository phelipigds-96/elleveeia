"use client"

import React, { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Kanban,
  Bot,
  User,
  Clock,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Store,
  PartyPopper,
  Stethoscope,
  Briefcase,
  Loader2,
  Check,
  Tv,
  BookmarkPlus,
} from "lucide-react"
import { CompanyMock } from "./mock-companies"
import {
  getCompanyWorkflowAction,
  saveCompanyWorkflowAction,
  applyCompanyWorkflowTemplateAction,
} from "@/app/(admin)/companies/actions"
import { toast } from "@/components/ui/toast"
import { WORKFLOW_TEMPLATES, WorkflowTemplate } from "@/lib/services/workflows/template-catalog"
import { getPlatformWorkflowTemplatesList, saveCompanyWorkflowAsTemplateAction } from "@/lib/services/workflows/templates-service"

interface CompanyWorkflowDialogProps {
  company: CompanyMock | null
  open: boolean
  onClose: () => void
}

interface EditableStage {
  id?: string
  name: string
  description?: string
  stage_type: "initial" | "in_progress" | "final"
  handled_by: "ai" | "human" | "waiting"
  color: string
}

const COLOR_PRESETS = [
  { label: "Amarelo", hex: "#eab308" },
  { label: "Laranja", hex: "#f97316" },
  { label: "Roxo", hex: "#a855f7" },
  { label: "Azul", hex: "#3b82f6" },
  { label: "Ciano", hex: "#06b6d4" },
  { label: "Verde", hex: "#22c55e" },
  { label: "Vermelho", hex: "#ef4444" },
  { label: "Grafite", hex: "#64748b" },
]

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  retail_food: <Store className="h-4 w-4 text-amber-500" />,
  events_party: <PartyPopper className="h-4 w-4 text-purple-500" />,
  dental_clinic: <Stethoscope className="h-4 w-4 text-cyan-500" />,
  general_services: <Briefcase className="h-4 w-4 text-blue-500" />,
  streaming_subscriptions: <Tv className="h-4 w-4 text-emerald-500" />,
}

export default function CompanyWorkflowDialog({
  company,
  open,
  onClose,
}: CompanyWorkflowDialogProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const [stages, setStages] = useState<EditableStage[]>([])
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(null)
  const [activeColorPickerIdx, setActiveColorPickerIdx] = useState<number | null>(null)
  const [dynamicTemplates, setDynamicTemplates] = useState<WorkflowTemplate[]>([])
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false)
  const [templateNameInput, setTemplateNameInput] = useState("")
  const [isSavingAsTemplate, setIsSavingAsTemplate] = useState(false)

  // Carrega workflow da empresa ao abrir o modal
  useEffect(() => {
    if (!open || !company) return

    let isMounted = true
    setLoading(true)
    setSelectedTemplateKey(null)
    setActiveColorPickerIdx(null)

    getPlatformWorkflowTemplatesList()
      .then((list) => {
        if (isMounted && list && list.length > 0) setDynamicTemplates(list)
      })
      .catch(() => {})

    getCompanyWorkflowAction(company.id)
      .then((res) => {
        if (!isMounted) return
        if (res.success && res.data?.workflow) {
          const wf = res.data.workflow
          setWorkflowId(wf.id)
          const loadedStages: EditableStage[] = (wf.workflow_stages || []).map((st: any) => ({
            id: st.id,
            name: st.name,
            description: st.description || "",
            stage_type: st.stage_type || "in_progress",
            handled_by: st.handled_by || "human",
            color: st.color || "#64748b",
          }))
          setStages(loadedStages)
        } else {
          toast.error("Erro ao carregar funil", res.error || "Não foi possível carregar as etapas.")
        }
      })
      .catch((err) => {
        if (!isMounted) return
        toast.error("Erro ao carregar funil", err.message)
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [open, company])

  if (!company) return null

  const handleApplyTemplate = (templateKey: string) => {
    const tmpl = dynamicTemplates.find((t) => t.key === templateKey) || WORKFLOW_TEMPLATES[templateKey]
    if (!tmpl) return

    setSelectedTemplateKey(templateKey)
    setStages(
      tmpl.stages.map((st) => ({
        name: st.name,
        description: st.description || "",
        stage_type: st.stage_type,
        handled_by: st.handled_by,
        color: st.color,
      }))
    )
    toast.info("Template selecionado", `Etapas de "${tmpl.label}" pré-carregadas para visualização.`)
  }

  const handleSaveAsTemplate = async () => {
    if (!company || !templateNameInput.trim()) return
    setIsSavingAsTemplate(true)
    try {
      const res = await saveCompanyWorkflowAsTemplateAction(company.id, {
        label: templateNameInput.trim(),
        segment: company.name,
        description: `Modelo gerado a partir do funil da empresa ${company.name}.`,
      })
      if (res.success) {
        toast.success("Modelo Salvo!", `O funil foi salvo na biblioteca de modelos com sucesso.`)
        setShowSaveTemplateModal(false)
        const updated = await getPlatformWorkflowTemplatesList()
        setDynamicTemplates(updated)
      } else {
        alert(res.error || "Falha ao salvar modelo.")
      }
    } catch (err: any) {
      alert("Erro ao salvar: " + err?.message)
    } finally {
      setIsSavingAsTemplate(false)
    }
  }

  const handleUpdateStage = (index: number, updates: Partial<EditableStage>) => {
    setSelectedTemplateKey(null) // Customizado manualmente
    setStages((prev) => {
      const copy = [...prev]
      copy[index] = { ...copy[index], ...updates }
      return copy
    })
  }

  const handleAddStage = () => {
    setSelectedTemplateKey(null)
    const newStage: EditableStage = {
      name: `Nova Etapa ${stages.length + 1}`,
      description: "",
      stage_type: "in_progress",
      handled_by: "human",
      color: "#3b82f6",
    }
    setStages((prev) => [...prev, newStage])
  }

  const handleRemoveStage = (index: number) => {
    if (stages.length <= 1) {
      toast.error("Operação bloqueada", "O funil deve conter pelo menos uma etapa.")
      return
    }
    setSelectedTemplateKey(null)
    setStages((prev) => prev.filter((_, i) => i !== index))
  }

  const handleMoveStage = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return
    if (direction === "down" && index === stages.length - 1) return

    setSelectedTemplateKey(null)
    setStages((prev) => {
      const copy = [...prev]
      const targetIndex = direction === "up" ? index - 1 : index + 1
      const temp = copy[index]
      copy[index] = copy[targetIndex]
      copy[targetIndex] = temp
      return copy
    })
  }

  const handleSave = async () => {
    if (stages.length === 0) {
      toast.error("Erro de validação", "O funil deve conter ao menos 1 etapa.")
      return
    }

    const emptyName = stages.some((s) => !s.name.trim())
    if (emptyName) {
      toast.error("Erro de validação", "Todas as etapas devem ter um nome preenchido.")
      return
    }

    setIsSaving(true)
    try {
      const res = await saveCompanyWorkflowAction({
        companyId: company.id,
        workflowId: workflowId || undefined,
        stages: stages.map((s) => ({
          name: s.name.trim(),
          description: s.description?.trim() || null,
          stage_type: s.stage_type,
          handled_by: s.handled_by,
          color: s.color,
        })),
      })

      if (res.success) {
        toast.success(
          "Funil salvo com sucesso!",
          `As ${stages.length} etapas de ${company.name} foram configuradas com sucesso.`
        )
        router.refresh()
        onClose()
      } else {
        toast.error("Falha ao salvar", res.error || "Ocorreu um erro no servidor.")
      }
    } catch (err: any) {
      toast.error("Erro de conexão", err.message || "Falha na requisição.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-4xl max-h-[92vh] flex flex-col p-6 overflow-hidden">
      {/* Header */}
      <DialogHeader>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-ellevee-ink text-white flex items-center justify-center">
            <Kanban className="h-4 w-4 text-ellevee-accent" />
          </div>
          <div>
            <DialogTitle className="text-base font-semibold text-ellevee-ink">
              Configurar Funil de Atendimento (Kanban)
            </DialogTitle>
            <DialogDescription className="text-xs text-ellevee-sage">
              Personalize as etapas operacionais, cores e responsabilidade da IA para{" "}
              <strong className="text-ellevee-ink">{company.name}</strong> (@{company.slug})
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      {/* Conteúdo rolável */}
      <div className="flex-1 overflow-y-auto pr-1 py-4 space-y-6">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-ellevee-sage">
            <Loader2 className="h-6 w-6 animate-spin text-ellevee-ink" />
            <span className="text-xs font-mono">Carregando etapas do banco de dados...</span>
          </div>
        ) : (
          <>
            {/* Bloco 1: Templates Rápidos por Nicho */}
            <div className="rounded-lg border border-ellevee-stone bg-[#FBFBFA] p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ellevee-ink flex items-center gap-1.5 uppercase tracking-wider">
                  <Sparkles className="h-3.5 w-3.5 text-ellevee-accent" />
                  Templates Recomendados por Segmento (1-Clique)
                </span>
                <span className="text-[11px] text-ellevee-sage">
                  Substitui a grade abaixo pelo funil do nicho
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
                {(dynamicTemplates.length > 0 ? dynamicTemplates : Object.values(WORKFLOW_TEMPLATES)).map((tmpl) => {
                  const isSelected = selectedTemplateKey === tmpl.key
                  return (
                    <button
                      key={tmpl.key}
                      type="button"
                      onClick={() => handleApplyTemplate(tmpl.key)}
                      className={`text-left p-2.5 rounded-lg border transition-all text-xs flex flex-col justify-between gap-1.5 ${
                        isSelected
                          ? "border-ellevee-ink bg-white shadow-sm ring-2 ring-ellevee-ink/10"
                          : "border-ellevee-stone bg-white hover:border-ellevee-sage hover:bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-1.5 font-medium text-ellevee-ink truncate">
                          {TEMPLATE_ICONS[tmpl.key] || <Kanban className="h-3.5 w-3.5" />}
                          <span className="truncate">{tmpl.label.split(" (")[0]}</span>
                        </div>
                        {isSelected && <Check className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />}
                      </div>
                      <span className="text-[10px] text-ellevee-sage line-clamp-2 leading-relaxed">
                        {tmpl.description}
                      </span>
                      <div className="flex items-center justify-between pt-1 border-t border-ellevee-stone/50 text-[10px] text-ellevee-ink-muted">
                        <span className="font-mono">{tmpl.stages.length} etapas</span>
                        <span className="text-[9px] text-ellevee-sage font-medium">{tmpl.badgeText}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Bloco 2: Lista de Etapas Editáveis */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-ellevee-ink uppercase tracking-wider">
                    Grade de Etapas do Kanban ({stages.length})
                  </h3>
                  <p className="text-[11px] text-ellevee-sage">
                    Defina o nome, a cor visual do cabeçalho da coluna e quem atua na etapa.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => {
                      setTemplateNameInput(company?.name ? `Modelo ${company.name}` : "")
                      setShowSaveTemplateModal(true)
                    }}
                    className="h-7 text-xs border-ellevee-stone hover:border-ellevee-ink gap-1"
                    title="Salvar esta configuração como um novo modelo reutilizável"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5 text-ellevee-ink" />
                    <span>Salvar como Modelo</span>
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddStage}
                    className="h-7 text-xs border-dashed border-ellevee-stone hover:border-ellevee-ink"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Adicionar Etapa
                  </Button>
                </div>
              </div>

              {/* Modal Inline: Salvar Funil como Novo Modelo */}
              {showSaveTemplateModal && (
                <div className="p-3.5 rounded-lg border border-ellevee-ink bg-emerald-50/60 space-y-2.5 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-ellevee-ink flex items-center gap-1.5">
                      <BookmarkPlus className="h-4 w-4 text-emerald-700" />
                      Salvar este Funil como Novo Modelo Global
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowSaveTemplateModal(false)}
                      className="text-xs text-ellevee-sage hover:text-ellevee-ink"
                    >
                      Cancelar
                    </button>
                  </div>
                  <p className="text-[11px] text-ellevee-sage">
                    O funil configurado acima ficará disponível como blueprint para ser selecionado em novos clientes.
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Nome do Modelo (ex: Varejo Especial, Streaming IPTV)"
                      value={templateNameInput}
                      onChange={(e) => setTemplateNameInput(e.target.value)}
                      className="h-8 text-xs bg-white flex-1"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={isSavingAsTemplate || !templateNameInput.trim()}
                      onClick={handleSaveAsTemplate}
                      className="h-8 text-xs bg-ellevee-ink text-white hover:bg-black shrink-0"
                    >
                      {isSavingAsTemplate ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          <span>Salvando...</span>
                        </>
                      ) : (
                        <span>Confirmar e Salvar</span>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Lista interativa */}
              <div className="space-y-2">
                {stages.map((stage, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row sm:items-center gap-2.5 p-3 rounded-lg border border-ellevee-stone bg-white shadow-xs hover:border-ellevee-sage transition-colors"
                  >
                    {/* Botões Reordenar */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveStage(idx, "up")}
                        className="h-6 w-6 rounded border border-ellevee-stone hover:bg-ellevee-ivory disabled:opacity-30 flex items-center justify-center text-ellevee-sage hover:text-ellevee-ink transition-colors"
                        title="Subir etapa"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === stages.length - 1}
                        onClick={() => handleMoveStage(idx, "down")}
                        className="h-6 w-6 rounded border border-ellevee-stone hover:bg-ellevee-ivory disabled:opacity-30 flex items-center justify-center text-ellevee-sage hover:text-ellevee-ink transition-colors"
                        title="Descer etapa"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Cor da Etapa com seletor popover simples */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveColorPickerIdx(activeColorPickerIdx === idx ? null : idx)
                        }
                        className="h-7 w-7 rounded-full border-2 border-white shadow-sm flex items-center justify-center transition-transform hover:scale-110"
                        style={{ backgroundColor: stage.color || "#64748b" }}
                        title="Alterar cor da etapa"
                      />
                      {activeColorPickerIdx === idx && (
                        <div className="absolute left-0 top-9 z-30 p-2 bg-white rounded-lg border border-ellevee-stone shadow-lg flex gap-1.5 animate-in fade-in zoom-in-95">
                          {COLOR_PRESETS.map((c) => (
                            <button
                              key={c.hex}
                              type="button"
                              onClick={() => {
                                handleUpdateStage(idx, { color: c.hex })
                                setActiveColorPickerIdx(null)
                              }}
                              className="h-5 w-5 rounded-full border hover:scale-125 transition-transform"
                              style={{ backgroundColor: c.hex }}
                              title={c.label}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Nome da Etapa */}
                    <div className="flex-1 min-w-[180px]">
                      <Input
                        value={stage.name}
                        onChange={(e) => handleUpdateStage(idx, { name: e.target.value })}
                        placeholder="Nome da etapa..."
                        className="h-8 text-xs font-medium"
                      />
                    </div>

                    {/* Descrição Opcional */}
                    <div className="flex-1 min-w-[160px] hidden md:block">
                      <Input
                        value={stage.description || ""}
                        onChange={(e) => handleUpdateStage(idx, { description: e.target.value })}
                        placeholder="Descrição (ex: Envio de Pix)..."
                        className="h-8 text-xs text-ellevee-sage"
                      />
                    </div>

                    {/* Quem atende nesta etapa (handled_by) */}
                    <div className="flex items-center gap-1">
                      <select
                        value={stage.handled_by}
                        onChange={(e) =>
                          handleUpdateStage(idx, {
                            handled_by: e.target.value as "ai" | "human" | "waiting",
                          })
                        }
                        className="h-8 rounded-md border border-ellevee-stone bg-[#FBFBFA] px-2 text-xs font-medium text-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink"
                      >
                        <option value="ai">🤖 IA Responde</option>
                        <option value="human">👤 Humano Atende</option>
                        <option value="waiting">⏳ Aguardando Cliente</option>
                      </select>
                    </div>

                    {/* Tipo Semântico (stage_type) */}
                    <div>
                      <select
                        value={stage.stage_type}
                        onChange={(e) =>
                          handleUpdateStage(idx, {
                            stage_type: e.target.value as "initial" | "in_progress" | "final",
                          })
                        }
                        className="h-8 rounded-md border border-ellevee-stone bg-[#FBFBFA] px-2 text-xs text-ellevee-sage focus:outline-none"
                      >
                        <option value="initial">Entrada (Inicial)</option>
                        <option value="in_progress">Em Andamento</option>
                        <option value="final">Finalizado (Concluído)</option>
                      </select>
                    </div>

                    {/* Excluir Etapa */}
                    <button
                      type="button"
                      onClick={() => handleRemoveStage(idx)}
                      disabled={stages.length <= 1}
                      className="h-8 w-8 rounded text-ellevee-sage hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 flex items-center justify-center transition-colors"
                      title="Remover etapa"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Bloco 3: Mini Prévia Visual do Funil Kanban */}
            <div className="rounded-lg border border-ellevee-stone bg-[#F8F8F5] p-3 space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-ellevee-sage font-semibold">
                Pré-Visualização do Quadro Kanban
              </span>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {stages.map((st, i) => (
                  <div
                    key={i}
                    className="min-w-[140px] flex-1 rounded-lg border border-ellevee-stone bg-white p-2.5 flex flex-col justify-between shadow-2xs"
                    style={{ borderTopColor: st.color, borderTopWidth: 3 }}
                  >
                    <div>
                      <div className="flex items-center justify-between text-[11px] font-semibold text-ellevee-ink">
                        <span className="truncate">{st.name || "Sem nome"}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[10px]">
                        {st.handled_by === "ai" && (
                          <span className="inline-flex items-center gap-0.5 text-amber-600 bg-amber-50 px-1 py-0.2 rounded font-medium">
                            <Bot className="h-2.5 w-2.5" /> IA
                          </span>
                        )}
                        {st.handled_by === "human" && (
                          <span className="inline-flex items-center gap-0.5 text-blue-600 bg-blue-50 px-1 py-0.2 rounded font-medium">
                            <User className="h-2.5 w-2.5" /> Humano
                          </span>
                        )}
                        {st.handled_by === "waiting" && (
                          <span className="inline-flex items-center gap-0.5 text-purple-600 bg-purple-50 px-1 py-0.2 rounded font-medium">
                            <Clock className="h-2.5 w-2.5" /> Espera
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-[9px] text-ellevee-sage mt-2 font-mono">
                      {st.stage_type === "initial"
                        ? "Entrada"
                        : st.stage_type === "final"
                        ? "Concluído"
                        : "Andamento"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <DialogFooter className="border-t border-ellevee-stone pt-4">
        <Button variant="outline" onClick={onClose} disabled={isSaving} className="text-xs">
          Cancelar
        </Button>
        <Button
          onClick={handleSave}
          disabled={loading || isSaving || stages.length === 0}
          className="text-xs bg-ellevee-ink text-white hover:bg-black"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Salvando Funil...
            </>
          ) : (
            <>
              <Kanban className="h-3.5 w-3.5 mr-1.5" />
              Salvar Funil Personalizado
            </>
          )}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

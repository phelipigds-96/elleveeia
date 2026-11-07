'use client'

import { useState, useTransition } from 'react'
import { Plus, GripVertical, Settings2, Trash2, Loader2, LayoutTemplate } from 'lucide-react'
import { createDefaultWorkflowAction, createWorkflowStageAction, updateWorkflowStageAction, deleteWorkflowStageAction, applyWorkflowTemplateAction } from '../actions'
import { WORKFLOW_TEMPLATES } from '@/lib/services/workflows/templates'
import { useRouter } from 'next/navigation'

const HANDLED_BY_LABEL: Record<string, string> = {
  ai: 'IA',
  human: 'Humano',
  waiting: 'Aguardando',
}

export function WorkflowSettingsClient({ initialWorkflows, companyId }: { initialWorkflows: any[], companyId: string }) {
  const router = useRouter()
  const [workflows, setWorkflows] = useState(initialWorkflows)
  const [isPending, startTransition] = useTransition()
  const [templateKey, setTemplateKey] = useState<string>('retail_food')
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [templateApplied, setTemplateApplied] = useState<string | null>(null)

  const handleApplyTemplate = () => {
    setTemplateError(null)
    setTemplateApplied(null)
    startTransition(async () => {
      try {
        const result = await applyWorkflowTemplateAction(templateKey)
        setTemplateApplied(
          `Funil "${result.workflowName}" configurado: ${result.created} etapa(s) criada(s), ${result.updated} atualizada(s), ${result.removed} desativada(s).`
        )
        router.refresh()
      } catch (error: any) {
        setTemplateError(error?.message || 'Não foi possível aplicar o template de funil.')
      }
    })
  }

  const handleCreateDefault = () => {
    startTransition(async () => {
      try {
        await createDefaultWorkflowAction()
        window.location.reload()
      } catch (error) {
        console.error("Failed to create workflow", error)
      }
    })
  }

  const handleAddStage = (workflowId: string) => {
    startTransition(async () => {
      try {
        await createWorkflowStageAction(workflowId, 'Nova Etapa')
        router.refresh()
      } catch (error) {
        console.error(error)
      }
    })
  }

  const handleUpdateStage = (stageId: string, field: string, value: string) => {
    startTransition(async () => {
      try {
        await updateWorkflowStageAction(stageId, { [field]: value })
        router.refresh()
      } catch (error) {
        console.error(error)
      }
    })
  }

  const handleDeleteStage = (stageId: string) => {
    if (confirm("Tem certeza que deseja excluir esta etapa?")) {
      startTransition(async () => {
        try {
          await deleteWorkflowStageAction(stageId)
          router.refresh()
        } catch (error) {
          console.error(error)
        }
      })
    }
  }

  if (workflows.length === 0) {
    return (
      <div className="border border-dashed rounded-xl p-12 text-center flex flex-col items-center justify-center bg-muted/10">
        <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
          <Settings2 className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-medium text-foreground">Nenhum workflow configurado</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm mb-6">
          Crie o seu primeiro workflow para organizar as conversas no formato Kanban.
        </p>
        <button 
          onClick={handleCreateDefault}
          disabled={isPending}
          className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md text-sm font-medium shadow-sm flex items-center disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
          Criar Workflow Padrão
        </button>
      </div>
    )
  }

  const activeWorkflow = workflows[0] // Simplify for now

  return (
    <div className={`space-y-6 ${isPending ? 'opacity-70 pointer-events-none' : ''}`}>
      <div className="border rounded-xl p-4 bg-muted/10 space-y-3">
        <div className="flex items-center gap-2">
          <LayoutTemplate className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Modelo de funil por segmento</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Aplica um modelo pronto de etapas ao funil padrão da sua empresa. Etapas que saem do modelo são desativadas
          e as conversas nelas voltam para a etapa inicial. Nada é alterado em outras empresas.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value)}
            aria-label="Modelo de funil por segmento"
            className="text-xs rounded-md border border-input bg-background px-2 py-1.5 shadow-sm focus:outline-none"
          >
            {Object.values(WORKFLOW_TEMPLATES).map((tpl) => (
              <option key={tpl.key} value={tpl.key}>
                {tpl.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleApplyTemplate}
            disabled={isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 rounded-md text-xs font-medium shadow-sm flex items-center disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <LayoutTemplate className="h-3.5 w-3.5 mr-2" />}
            Aplicar modelo
          </button>
        </div>
        {templateError ? (
          <p role="alert" className="text-xs text-destructive">{templateError}</p>
        ) : null}
        {templateApplied ? (
          <p className="text-xs text-muted-foreground">{templateApplied}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-start gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-medium">{activeWorkflow.name}</h3>
              {activeWorkflow.is_default && (
                <span className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase tracking-wide">Padrão</span>
              )}
              {!activeWorkflow.is_active && (
                <span className="text-[10px] font-semibold bg-muted text-muted-foreground px-2 py-0.5 rounded-full uppercase tracking-wide">Inativo</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{activeWorkflow.description || 'Workflow de atendimento'}</p>
          </div>
        </div>
        <button 
          onClick={() => handleAddStage(activeWorkflow.id)}
          className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md text-sm font-medium shadow-sm flex items-center"
        >
          <Plus className="h-4 w-4 mr-2" />
          Adicionar Etapa
        </button>
      </div>

      <div className="space-y-3">
        {activeWorkflow.workflow_stages?.map((stage: any, index: number) => (
          <div key={stage.id} className="flex items-center gap-4 bg-background border rounded-lg p-4 shadow-sm group">
            <div className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground transition-colors">
              <GripVertical className="h-5 w-5" />
            </div>
            
            <div className="flex-1 grid grid-cols-12 gap-4 items-center">
              <div className="col-span-3">
                <input 
                  type="text" 
                  defaultValue={stage.name}
                  onBlur={(e) => {
                    if (e.target.value !== stage.name) handleUpdateStage(stage.id, 'name', e.target.value)
                  }}
                  className="bg-transparent border-0 font-medium text-sm focus:ring-0 p-0 w-full"
                />
              </div>
              <div className="col-span-4">
                <input 
                  type="text" 
                  placeholder="Descrição opcional..."
                  defaultValue={stage.description || ''}
                  onBlur={(e) => {
                    if (e.target.value !== (stage.description || '')) handleUpdateStage(stage.id, 'description', e.target.value)
                  }}
                  className="bg-transparent border-0 text-sm text-muted-foreground focus:ring-0 p-0 w-full"
                />
              </div>
              <div className="col-span-2">
                <select 
                  defaultValue={stage.handled_by || 'human'}
                  onChange={(e) => handleUpdateStage(stage.id, 'handled_by', e.target.value)}
                  aria-label="Responsável pela etapa"
                  className="text-xs rounded-md border border-input bg-transparent px-2 py-1.5 shadow-sm focus:outline-none w-full"
                >
                  <option value="ai">{HANDLED_BY_LABEL.ai}</option>
                  <option value="human">{HANDLED_BY_LABEL.human}</option>
                  <option value="waiting">{HANDLED_BY_LABEL.waiting}</option>
                </select>
              </div>
              <div className="col-span-2">
                <input
                  type="color"
                  defaultValue={stage.color || '#64748b'}
                  onBlur={(e) => {
                    const value = e.target.value.toLowerCase()
                    if (value !== (stage.color || '#64748b')) handleUpdateStage(stage.id, 'color', value)
                  }}
                  aria-label="Cor da etapa"
                  className="h-8 w-10 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                />
              </div>
              <div className="col-span-1">
                <select 
                  defaultValue={stage.stage_type}
                  onChange={(e) => handleUpdateStage(stage.id, 'stage_type', e.target.value)}
                  className="text-xs rounded-md border border-input bg-transparent px-2 py-1.5 shadow-sm focus:outline-none w-full"
                >
                  <option value="initial">Entrada (Inicial)</option>
                  <option value="in_progress">Em Andamento</option>
                  <option value="final">Concluído (Final)</option>
                </select>
              </div>
            </div>

            <button 
              onClick={() => handleDeleteStage(stage.id)}
              className="text-muted-foreground/50 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}

        {(!activeWorkflow.workflow_stages || activeWorkflow.workflow_stages.length === 0) && (
          <div className="text-center py-8 border border-dashed rounded-lg text-muted-foreground text-sm">
            Nenhuma etapa configurada neste workflow.
          </div>
        )}
      </div>
      
      <div className="pt-4 flex justify-end">
        <p className="text-xs text-muted-foreground">As alterações são salvas automaticamente ao clicar fora dos campos.</p>
      </div>
    </div>
  )
}

'use client'

import React from 'react'
import { Kanban, ShieldCheck, Bot, User, Clock, Layers } from 'lucide-react'

export function WorkflowSettingsClient({
  initialWorkflows,
  companyId,
}: {
  initialWorkflows: any[]
  companyId: string
}) {
  const activeWorkflow = initialWorkflows[0]

  if (!activeWorkflow || !activeWorkflow.workflow_stages || activeWorkflow.workflow_stages.length === 0) {
    return (
      <div className="border border-dashed rounded-xl p-12 text-center flex flex-col items-center justify-center bg-muted/10">
        <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
          <Layers className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-medium text-foreground">Funil em fase de provisionamento</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-md">
          O funil personalizado da sua organização está sendo configurado pelo Super Admin durante o processo de implantação. Em breve as etapas estarão visíveis aqui e no seu quadro Kanban.
        </p>
      </div>
    )
  }

  const stages = [...activeWorkflow.workflow_stages].sort((a: any, b: any) => a.position - b.position)

  return (
    <div className="space-y-6">
      {/* Banner Informativo de Bloqueio do Cliente */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 flex items-start gap-3.5">
        <div className="h-8 w-8 rounded-lg bg-blue-600 text-white flex items-center justify-center flex-shrink-0 mt-0.5">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-blue-950">
            Funil Gerenciado Centralmente (Implantação Sob Medida)
          </h4>
          <p className="text-xs text-blue-800 leading-relaxed">
            As etapas operacionais e automações do seu quadro Kanban são provisionadas e calibradas com exclusividade pela equipe de implantação da plataforma. Para solicitar a adição, alteração de cores ou novas regras em qualquer etapa, contate o administrador da plataforma.
          </p>
        </div>
      </div>

      {/* Header do Workflow Ativo */}
      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-start gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-medium">{activeWorkflow.name}</h3>
              {activeWorkflow.is_default && (
                <span className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase tracking-wide">
                  Padrão Ativo
                </span>
              )}
              {!activeWorkflow.is_active && (
                <span className="text-[10px] font-semibold bg-muted text-muted-foreground px-2 py-0.5 rounded-full uppercase tracking-wide">
                  Inativo
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {activeWorkflow.description || 'Workflow operacional de atendimento e vendas'}
            </p>
          </div>
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          {stages.length} etapa(s) ativas
        </div>
      </div>

      {/* Grade de Etapas em Modo Somente Leitura Operacional */}
      <div className="space-y-2.5">
        {stages.map((stage: any, index: number) => {
          const stageColor = stage.color || '#64748b'
          return (
            <div
              key={stage.id}
              className="flex items-center justify-between gap-4 bg-background border rounded-lg p-3.5 shadow-xs hover:border-border transition-colors"
              style={{ borderLeft: `4px solid ${stageColor}` }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="h-6 w-6 rounded-md bg-muted/60 text-muted-foreground font-mono text-xs flex items-center justify-center font-medium">
                  {index + 1}
                </span>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: stageColor }}
                    />
                    <span className="text-sm font-semibold text-foreground truncate">
                      {stage.name}
                    </span>
                  </div>
                  {stage.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {stage.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Quem atende */}
                {stage.handled_by === 'ai' && (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
                    <Bot className="h-3 w-3" /> IA Responde
                  </span>
                )}
                {stage.handled_by === 'waiting' && (
                  <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 border border-purple-200">
                    <Clock className="h-3 w-3" /> Aguardando
                  </span>
                )}
                {stage.handled_by === 'human' && (
                  <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 border border-blue-200">
                    <User className="h-3 w-3" /> Humano Atende
                  </span>
                )}

                {/* Tipo de etapa */}
                <span className="text-[11px] font-mono text-muted-foreground bg-muted/40 px-2 py-0.5 rounded">
                  {stage.stage_type === 'initial'
                    ? 'Entrada'
                    : stage.stage_type === 'final'
                    ? 'Concluído'
                    : 'Em Andamento'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

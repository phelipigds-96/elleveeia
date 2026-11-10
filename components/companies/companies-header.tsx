"use client"

import React from "react"
import { Building2, Plus, ArrowRight, Kanban } from "lucide-react"
import { Button } from "@/components/ui/button"

interface CompaniesHeaderProps {
  onCreate: () => void
  onOpenTemplates?: () => void
  totalCount?: number
  activeCount?: number
  trialCount?: number
  suspendedCount?: number
}

export default function CompaniesHeader({ 
  onCreate, 
  onOpenTemplates,
  totalCount = 6,
  activeCount = 5,
  trialCount = 1,
  suspendedCount = 1,
}: CompaniesHeaderProps) {
  return (
    <div className="space-y-4 pb-4 border-b border-ellevee-border">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-deep-ink">
            Empresas
          </h1>
          <p className="text-xs text-ellevee-text-secondary mt-1 font-sans">
            Gerencie organizações, planos, consumo e configurações da plataforma.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {onOpenTemplates && (
            <Button 
              onClick={onOpenTemplates} 
              variant="outline" 
              size="sm" 
              className="gap-1.5 font-display border-ellevee-border bg-white text-ellevee-deep-ink hover:bg-ellevee-warm-ivory/50 rounded-lg shadow-2xs"
            >
              <Kanban className="h-4 w-4 text-ellevee-deep-ink" />
              <span>Modelos de Funil</span>
            </Button>
          )}

          <Button onClick={onCreate} variant="primary" size="sm" className="gap-1.5 font-display shadow-sm rounded-lg">
            <Plus className="h-4 w-4" />
            <span>Nova empresa</span>
          </Button>
        </div>
      </div>

      {/* Indicadores Compactos de Status (Quiet Technology) */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white border border-ellevee-border text-xs shadow-2xs">
          <span className="text-ellevee-text-secondary font-medium">Total:</span>
          <span className="font-mono font-bold text-ellevee-deep-ink">{totalCount}</span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white border border-ellevee-border text-xs shadow-2xs">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-ellevee-text-secondary font-medium">Ativas:</span>
          <span className="font-mono font-bold text-ellevee-deep-ink">{activeCount}</span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white border border-ellevee-border text-xs shadow-2xs">
          <span className="h-2 w-2 rounded-full bg-[#087BEA]" />
          <span className="text-ellevee-text-secondary font-medium">Trial:</span>
          <span className="font-mono font-bold text-ellevee-deep-ink">{trialCount}</span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white border border-ellevee-border text-xs shadow-2xs">
          <span className="h-2 w-2 rounded-full bg-rose-500" />
          <span className="text-ellevee-text-secondary font-medium">Suspensas:</span>
          <span className="font-mono font-bold text-ellevee-deep-ink">{suspendedCount}</span>
        </div>
      </div>
    </div>
  )
}

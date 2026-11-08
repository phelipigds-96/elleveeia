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
    <div className="space-y-4 pb-4 border-b border-ellevee-stone">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-ink">
            Empresas
          </h1>
          <p className="text-xs text-ellevee-sage mt-1 font-sans">
            Gerencie organizações, planos, consumo e configurações da plataforma.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {onOpenTemplates && (
            <Button 
              onClick={onOpenTemplates} 
              variant="outline" 
              size="sm" 
              className="gap-1.5 font-display border-ellevee-stone bg-white text-ellevee-ink hover:bg-[#F8F8F5]"
            >
              <Kanban className="h-4 w-4 text-ellevee-ink" />
              <span>Modelos de Funil</span>
            </Button>
          )}

          <Button onClick={onCreate} variant="default" size="sm" className="gap-1.5 font-display">
            <Plus className="h-4 w-4 text-ellevee-accent" />
            <span>Nova empresa</span>
          </Button>
        </div>
      </div>

      {/* Indicadores Compactos de Status (Quiet Technology) */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-white border border-ellevee-stone text-xs">
          <span className="text-ellevee-sage font-medium">Total:</span>
          <span className="font-mono font-bold text-ellevee-ink">{totalCount}</span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-white border border-ellevee-stone text-xs">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-ellevee-sage font-medium">Ativas:</span>
          <span className="font-mono font-bold text-ellevee-ink">{activeCount}</span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-white border border-ellevee-stone text-xs">
          <span className="h-2 w-2 rounded-full bg-ellevee-accent ring-1 ring-ellevee-ink/10" />
          <span className="text-ellevee-sage font-medium">Trial:</span>
          <span className="font-mono font-bold text-ellevee-ink">{trialCount}</span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-white border border-ellevee-stone text-xs">
          <span className="h-2 w-2 rounded-full bg-rose-400" />
          <span className="text-ellevee-sage font-medium">Suspensas:</span>
          <span className="font-mono font-bold text-ellevee-ink">{suspendedCount}</span>
        </div>
      </div>
    </div>
  )
}

"use client"

import React from "react"
import { Building2, Plus, Users, Zap, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"

interface CompaniesHeaderProps {
  onCreate: () => void
  totalCount?: number
}

export default function CompaniesHeader({ onCreate, totalCount = 6 }: CompaniesHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-slate-200/80">
      <div>
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-sm">
            <Building2 className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Empresas & Tenants</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Gestão da infraestrutura multi-tenant, alocação de planos e limites do motor de IA.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={onCreate} variant="primary" className="shadow-sm">
          <Plus className="h-4 w-4 mr-1.5" />
          Nova Empresa
        </Button>
      </div>
    </div>
  )
}

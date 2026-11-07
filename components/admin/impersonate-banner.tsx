"use client"

import React, { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Eye, ShieldAlert, LogOut, ArrowLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { stopImpersonateAction } from "@/app/(admin)/companies/actions"
import { toast } from "@/components/ui/toast"

interface ImpersonateBannerProps {
  companyName: string
  companySlug: string
}

export function ImpersonateBanner({ companyName, companySlug }: ImpersonateBannerProps) {
  const router = useRouter()
  const [isEnding, setIsEnding] = useState(false)

  const handleStop = async () => {
    try {
      setIsEnding(true)
      const res = await stopImpersonateAction()
      if (res.success) {
        toast.info("Sessão Encerrada", "Perfil do SuperAdmin restaurado com sucesso.")
        router.push(res.data?.redirectUrl || "/companies")
        router.refresh()
      } else {
        toast.error("Erro ao encerrar", res.error || "Falha ao restaurar sessão.")
        setIsEnding(false)
      }
    } catch (err: any) {
      toast.error("Erro", err.message || "Erro inesperado ao encerrar impersonação.")
      setIsEnding(false)
    }
  }

  return (
    <div className="bg-[#FFFBEB] border-b border-[#FDE68A] text-[#92400E] px-4 py-2 flex items-center justify-between text-xs shrink-0 shadow-xs z-50">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#F59E0B] text-white shrink-0">
          <Eye className="h-3 w-3" />
          Impersonate Ativo
        </span>
        <div className="flex items-center gap-1.5 truncate">
          <span className="text-[#B45309] font-medium hidden sm:inline">Visualizando como:</span>
          <span className="font-bold text-[#78350F] truncate">{companyName}</span>
          <span className="font-mono text-[11px] text-[#B45309]/80 truncate">(@{companySlug})</span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Link href="/companies">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] border-[#FCD34D] bg-white hover:bg-[#FEF3C7] text-[#92400E] gap-1 font-medium"
          >
            <ArrowLeft className="h-3 w-3" />
            <span className="hidden sm:inline">Painel</span> SuperAdmin
          </Button>
        </Link>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleStop}
          disabled={isEnding}
          className="h-7 text-[11px] bg-[#DC2626] hover:bg-[#B91C1C] text-white gap-1 font-semibold"
        >
          {isEnding ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Saindo...
            </>
          ) : (
            <>
              <LogOut className="h-3 w-3" />
              Encerrar Impersonate
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

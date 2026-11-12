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
import { Badge } from "@/components/ui/badge"
import {
  PackagePlus,
  ReceiptText,
  Trash2,
  CheckCircle2,
  Info,
} from "lucide-react"
import {
  COMPANY_ADDON_PACKAGE_SIZES,
  CompanyAddonPackageSize,
  CompanyAddonRecord,
  CompanyMock,
} from "./mock-companies"
import {
  addCompanyAddonPackageAction,
  cancelCompanyAddonPackageAction,
} from "@/app/(admin)/companies/actions"
import { toast } from "@/components/ui/toast"

interface CompanyAddonsDialogProps {
  company: CompanyMock | null
  open: boolean
  onClose: () => void
  onUpdated?: (updated: CompanyMock) => void
}

function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function CompanyAddonsDialog({
  company,
  open,
  onClose,
  onUpdated,
}: CompanyAddonsDialogProps) {
  const router = useRouter()
  const [selectedPackage, setSelectedPackage] = useState<CompanyAddonPackageSize>(1000)
  const [notes, setNotes] = useState("")
  const [isAdding, setIsAdding] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [activeAddons, setActiveAddons] = useState<CompanyAddonRecord[]>([])

  useEffect(() => {
    if (company) {
      setActiveAddons(company.activeAddons || [])
      setSelectedPackage(1000)
      setNotes("")
    }
  }, [company])

  if (!company) return null

  const billingMonth =
    company.billingMonth || new Date().toISOString().slice(0, 7)
  const sentMessages = company.sentMessagesUsed ?? company.messagesUsed ?? 0
  const totalMessages = company.totalMessagesUsed ?? sentMessages
  const baseQuota = company.messagesLimit || 0
  const isTrialPlan = company.plan.toLowerCase() === "trial"
  const addonUnitPrice =
    company.addonUnitPriceBrl !== undefined
      ? company.addonUnitPriceBrl
      : isTrialPlan
      ? 0
      : 0.04
  const overageUnitPrice =
    company.overageUnitPriceBrl !== undefined
      ? company.overageUnitPriceBrl
      : isTrialPlan
      ? 0
      : 0.07

  const addonMessagesPurchased = activeAddons
    .filter((a) => a.status === "active")
    .reduce((acc, a) => acc + (Number(a.packageMessages) || 0), 0)
  const addonsTotalBrl = activeAddons
    .filter((a) => a.status === "active")
    .reduce((acc, a) => acc + (Number(a.totalPriceBrl) || 0), 0)

  const effectiveLimit = baseQuota + addonMessagesPurchased
  const overageMessages = Math.max(0, sentMessages - effectiveLimit)
  const overageTotalBrl = Number((overageMessages * overageUnitPrice).toFixed(2))
  const extraInvoiceTotalBrl = Number((addonsTotalBrl + overageTotalBrl).toFixed(2))

  const recomputeCompanyState = (nextAddons: CompanyAddonRecord[]): CompanyMock => {
    const nextAddonMsgs = nextAddons
      .filter((a) => a.status === "active")
      .reduce((acc, a) => acc + a.packageMessages, 0)
    const nextAddonsBrl = nextAddons
      .filter((a) => a.status === "active")
      .reduce((acc, a) => acc + a.totalPriceBrl, 0)
    const nextEffectiveLimit = baseQuota + nextAddonMsgs
    const nextOverageMsgs = Math.max(0, sentMessages - nextEffectiveLimit)
    const nextOverageBrl = Number((nextOverageMsgs * overageUnitPrice).toFixed(2))
    const nextExtraTotal = Number((nextAddonsBrl + nextOverageBrl).toFixed(2))

    return {
      ...company,
      addonMessages: nextAddonMsgs,
      effectiveMessagesLimit: nextEffectiveLimit,
      overageMessages: nextOverageMsgs,
      addonsTotalBrl: Number(nextAddonsBrl.toFixed(2)),
      overageTotalBrl: nextOverageBrl,
      extraInvoiceBrl: nextExtraTotal,
      activeAddons: nextAddons,
    }
  }

  const handleAddPackage = async (pkgSize: CompanyAddonPackageSize = selectedPackage) => {
    setIsAdding(true)
    try {
      const res = await addCompanyAddonPackageAction(company.id, pkgSize, notes)
      if (!res.success || !res.data) {
        toast.error(
          "Não foi possível adicionar pacote",
          res.error || "Erro ao registrar pacote adicional."
        )
        return
      }

      const nextAddons = [res.data, ...activeAddons]
      setActiveAddons(nextAddons)
      setNotes("")
      toast.success(
        "Pacote extra adicionado",
        `+${pkgSize.toLocaleString("pt-BR")} mensagens enviadas aplicadas ao mês ${billingMonth}.`
      )
      if (onUpdated) {
        onUpdated(recomputeCompanyState(nextAddons))
      }
      router.refresh()
    } catch (err: any) {
      toast.error("Erro inesperado", err?.message || "Falha ao adicionar pacote.")
    } finally {
      setIsAdding(false)
    }
  }

  const handleCancelAddon = async (addonId: string) => {
    setCancellingId(addonId)
    try {
      const res = await cancelCompanyAddonPackageAction(company.id, addonId)
      if (!res.success) {
        toast.error(
          "Erro ao cancelar pacote",
          res.error || "Não foi possível cancelar este pacote."
        )
        return
      }

      const nextAddons = activeAddons.filter((a) => a.id !== addonId)
      setActiveAddons(nextAddons)
      toast.success("Pacote extra cancelado", "A franquia adicional foi estornada deste mês.")
      if (onUpdated) {
        onUpdated(recomputeCompanyState(nextAddons))
      }
      router.refresh()
    } catch (err: any) {
      toast.error("Erro inesperado", err?.message || "Falha ao cancelar pacote.")
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-ellevee-warm-ivory border border-ellevee-border text-ellevee-deep-ink flex items-center justify-center">
            <PackagePlus className="h-4 w-4 text-ellevee-purple" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <DialogTitle className="font-display text-base font-bold text-ellevee-deep-ink">
                Pacotes Extras & Fatura Excedente
              </DialogTitle>
              <Badge variant="outline" className="text-[10px] font-mono border-ellevee-border">
                {billingMonth}
              </Badge>
            </div>
            <DialogDescription className="text-xs text-ellevee-text-secondary">
              <span className="font-semibold text-ellevee-deep-ink">{company.name}</span> · Plano{" "}
              {company.plan} · Contagem justa apenas de mensagens enviadas (IA + Humano)
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-4 py-3">
        {/* Resumo em 3 Camadas */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-ellevee-border bg-[#F8F8F6] p-3">
            <div className="text-[11px] font-medium text-ellevee-text-secondary">
              Enviadas no Mês (IA + Humano)
            </div>
            <div className="text-lg font-bold font-mono text-ellevee-deep-ink mt-0.5">
              {sentMessages.toLocaleString("pt-BR")}
            </div>
            <div className="text-[10px] text-ellevee-text-secondary mt-0.5">
              {totalMessages.toLocaleString("pt-BR")} msgs totais (clientes não descontam)
            </div>
          </div>

          <div className="rounded-xl border border-ellevee-border bg-[#F8F8F6] p-3">
            <div className="text-[11px] font-medium text-ellevee-text-secondary">
              Cota Efetiva (Franquia + Pacotes)
            </div>
            <div className="text-lg font-bold font-mono text-ellevee-deep-ink mt-0.5">
              {effectiveLimit.toLocaleString("pt-BR")}
            </div>
            <div className="text-[10px] text-ellevee-text-secondary mt-0.5">
              Base {baseQuota.toLocaleString("pt-BR")} + {addonMessagesPurchased.toLocaleString("pt-BR")} extra
            </div>
          </div>

          <div className="rounded-xl border border-ellevee-border bg-white p-3">
            <div className="flex items-center justify-between text-[11px] font-medium text-ellevee-text-secondary">
              <span>Prévia Fatura Extra</span>
              <ReceiptText className="h-3.5 w-3.5 text-ellevee-purple" />
            </div>
            <div className="text-lg font-bold font-mono text-ellevee-deep-ink mt-0.5">
              {formatBrl(extraInvoiceTotalBrl)}
            </div>
            <div className="text-[10px] text-ellevee-text-secondary mt-0.5">
              Pacotes {formatBrl(addonsTotalBrl)} · Avulso ({overageMessages.toLocaleString("pt-BR")}x) {formatBrl(overageTotalBrl)}
            </div>
          </div>
        </div>

        {/* Nota de Soft-Alert / Não Pausa */}
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-[11px] text-blue-900">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            O WhatsApp do cliente nunca é pausado ao atingir 100% da cota. Consumo acima da
            franquia abate primeiro os pacotes extras ({formatBrl(addonUnitPrice)}/msg) e depois
            contabiliza excedente avulso ({formatBrl(overageUnitPrice)}/msg) na fatura do mês.
          </div>
        </div>

        {/* Seleção Rápida de Blocos Extras */}
        <div className="rounded-xl border border-ellevee-border bg-[#F8F8F6] p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-ellevee-deep-ink uppercase tracking-wider font-display">
              Contratar Bloco Adicional ({formatBrl(addonUnitPrice)}/msg enviada)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {COMPANY_ADDON_PACKAGE_SIZES.map((size) => {
              const isSelected = selectedPackage === size
              const pkgTotal = Number((size * addonUnitPrice).toFixed(2))
              return (
                <button
                  key={size}
                  type="button"
                  disabled={isAdding}
                  onClick={() => setSelectedPackage(size)}
                  className={`rounded-lg border p-2.5 text-left transition-all cursor-pointer ${
                    isSelected
                      ? "border-ellevee-purple bg-white ring-1 ring-ellevee-purple shadow-2xs"
                      : "border-ellevee-border bg-white/70 hover:bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-ellevee-deep-ink">
                      +{size.toLocaleString("pt-BR")}
                    </span>
                    {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-ellevee-purple" />}
                  </div>
                  <div className="text-[10px] text-ellevee-text-secondary">msgs enviadas</div>
                  <div className="mt-1.5 font-mono text-xs font-semibold text-ellevee-deep-ink">
                    {formatBrl(pkgTotal)}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              type="text"
              placeholder="Observação comercial opcional (ex: Campanha Dia das Mães)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isAdding}
              className="bg-white text-xs h-9 border-ellevee-border"
            />
            <Button
              type="button"
              variant="primary"
              disabled={isAdding}
              onClick={() => handleAddPackage(selectedPackage)}
              className="shrink-0 h-9 text-xs"
            >
              <PackagePlus className="h-3.5 w-3.5 mr-1.5" />
              {isAdding
                ? "Aplicando..."
                : `Adicionar +${selectedPackage.toLocaleString("pt-BR")} (${formatBrl(
                    selectedPackage * addonUnitPrice
                  )})`}
            </Button>
          </div>
        </div>

        {/* Lista de Pacotes Ativos no Mês */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ellevee-deep-ink">
              Pacotes Ativos em {billingMonth} ({activeAddons.length})
            </span>
            {overageMessages > 0 && (
              <span className="text-[11px] font-medium text-rose-700">
                Excedente avulso atual: {overageMessages.toLocaleString("pt-BR")} msgs ·{" "}
                {formatBrl(overageTotalBrl)}
              </span>
            )}
          </div>

          {activeAddons.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ellevee-border p-4 text-center text-xs text-ellevee-text-secondary">
              Nenhum pacote extra contratado para este mês até o momento.
            </div>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
              {activeAddons.map((addon) => (
                <div
                  key={addon.id}
                  className="flex items-center justify-between rounded-lg border border-ellevee-border bg-white px-3 py-2 text-xs"
                >
                  <div>
                    <div className="font-semibold text-ellevee-deep-ink">
                      +{addon.packageMessages.toLocaleString("pt-BR")} msgs enviadas ·{" "}
                      <span className="font-mono">{formatBrl(addon.totalPriceBrl)}</span>
                    </div>
                    <div className="text-[10px] text-ellevee-text-secondary">
                      Tarifa {formatBrl(addon.unitPriceBrl)}/msg
                      {addon.notes ? ` · ${addon.notes}` : ""}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={cancellingId === addon.id}
                    onClick={() => handleCancelAddon(addon.id)}
                    className="h-7 px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {cancellingId === addon.id ? "..." : "Estornar"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={onClose}
          className="border-ellevee-border text-ellevee-deep-ink"
        >
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

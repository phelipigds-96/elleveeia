"use client"

import * as React from "react"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Loader2, DollarSign, Tag, FileText, CheckCircle2, AlertCircle } from "lucide-react"
import { createProductAction, updateProductAction, ProductInput } from "@/app/(dashboard)/catalog/actions"

export interface CatalogItem {
  id: string
  name: string
  description: string | null
  sku: string | null
  barcode?: string | null
  unit: string | null
  active: boolean
  price: number | null
  created_at?: string
  updated_at?: string
}

interface ProductDialogProps {
  open: boolean
  onClose: () => void
  product?: CatalogItem | null
  onSuccess: (savedProduct?: any) => void
}

const UNIT_SUGGESTIONS = [
  { label: "Mês (Assinatura)", value: "mês" },
  { label: "Ano (Assinatura)", value: "ano" },
  { label: "Serviço", value: "serviço" },
  { label: "Sessão", value: "sessão" },
  { label: "Hora", value: "hora" },
  { label: "Unidade", value: "un" }
]

export function ProductDialog({ open, onClose, product, onSuccess }: ProductDialogProps) {
  const isEditing = Boolean(product?.id)

  const [name, setName] = React.useState("")
  const [price, setPrice] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [sku, setSku] = React.useState("")
  const [unit, setUnit] = React.useState("mês")
  const [active, setActive] = React.useState(true)
  const [loading, setLoading] = React.useState(false)
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (product) {
      setName(product.name || "")
      setPrice(product.price != null ? String(product.price).replace(".", ",") : "")
      setDescription(product.description || "")
      setSku(product.sku || "")
      setUnit(product.unit || "un")
      setActive(product.active !== false)
    } else {
      setName("")
      setPrice("")
      setDescription("")
      setSku("")
      setUnit("mês")
      setActive(true)
    }
    setErrorMsg(null)
  }, [product, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName || trimmedName.length < 2) {
      setErrorMsg("O nome do item ou serviço deve ter pelo menos 2 caracteres.")
      return
    }

    const cleanPriceStr = price.replace(/[^\d.,]/g, "").replace(",", ".")
    const parsedPrice = parseFloat(cleanPriceStr)
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      setErrorMsg("Informe um preço válido (maior ou igual a R$ 0,00).")
      return
    }

    setLoading(true)
    setErrorMsg(null)

    const payload: ProductInput = {
      name: trimmedName,
      price: parsedPrice,
      description: description.trim() || null,
      sku: sku.trim() || null,
      unit: unit.trim() || "un",
      active
    }

    try {
      if (isEditing && product?.id) {
        const res = await updateProductAction(product.id, payload)
        if (!res.success) {
          setErrorMsg(res.error || "Erro ao atualizar produto.")
        } else {
          onSuccess({ ...product, ...payload, price: parsedPrice })
          onClose()
        }
      } else {
        const res = await createProductAction(payload)
        if (!res.success) {
          setErrorMsg(res.error || "Erro ao criar produto.")
        } else {
          onSuccess(res.data)
          onClose()
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Erro inesperado ao salvar.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      <DialogHeader>
        <DialogTitle className="text-xl">
          {isEditing ? "Editar Produto ou Serviço" : "Novo Produto ou Serviço"}
        </DialogTitle>
        <DialogDescription>
          {isEditing
            ? "Atualize os dados, preço ou disponibilidade deste item no catálogo."
            : "Cadastre planos, assinaturas, cortes, tratamentos ou produtos para o catálogo oficial da sua empresa."}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        {errorMsg && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{errorMsg}</p>
          </div>
        )}

        {/* Nome do Item */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ellevee-ink uppercase tracking-wider">
            Nome do Item / Serviço <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Plano Mensal Streaming, Corte Degradê, Assinatura VIP..."
            className="w-full rounded-lg border border-ellevee-stone bg-white px-3 py-2 text-sm text-ellevee-ink placeholder:text-ellevee-sage/60 focus:border-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink"
          />
        </div>

        {/* Preço e Unidade */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ellevee-ink uppercase tracking-wider flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5 text-emerald-600" /> Preço Oficial (R$) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-sm font-semibold text-ellevee-sage">R$</span>
              <input
                type="text"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="34,90"
                className="w-full rounded-lg border border-ellevee-stone bg-white pl-10 pr-3 py-2 text-sm font-semibold text-ellevee-ink placeholder:text-ellevee-sage/60 focus:border-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink"
              />
            </div>
            <p className="text-[11px] text-ellevee-sage">Valor base utilizado pelo Agente de IA e atendentes.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-ellevee-ink uppercase tracking-wider flex items-center gap-1">
              <Tag className="h-3.5 w-3.5 text-ellevee-sage" /> Cobrança / Unidade
            </label>
            <input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="mês, ano, serviço, un..."
              className="w-full rounded-lg border border-ellevee-stone bg-white px-3 py-2 text-sm text-ellevee-ink placeholder:text-ellevee-sage/60 focus:border-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink"
            />
            {/* Quick Chips */}
            <div className="flex flex-wrap gap-1 pt-1">
              {UNIT_SUGGESTIONS.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  onClick={() => setUnit(item.value)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    unit === item.value
                      ? "bg-ellevee-ink text-white"
                      : "bg-ellevee-ivory text-ellevee-sage hover:bg-ellevee-stone/50 hover:text-ellevee-ink"
                  }`}
                >
                  {item.value}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Descrição / Detalhes */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ellevee-ink uppercase tracking-wider flex items-center gap-1">
            <FileText className="h-3.5 w-3.5 text-ellevee-sage" /> Descrição / Detalhes do Plano ou Serviço
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Acesso a todos os canais em 2 telas simultâneas, filmes e séries em Full HD / 4K. Válido por 30 dias."
            className="w-full rounded-lg border border-ellevee-stone bg-white px-3 py-2 text-sm text-ellevee-ink placeholder:text-ellevee-sage/60 focus:border-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink resize-none"
          />
          <p className="text-[11px] text-ellevee-sage">
            Essa descrição é lida pelo Agente de IA para responder dúvidas do cliente com precisão.
          </p>
        </div>

        {/* Código / SKU e Status Ativo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-ellevee-stone/50">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ellevee-ink uppercase tracking-wider">
              Código / SKU (Opcional)
            </label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Ex: PLAN-STREAM-01"
              className="w-full rounded-lg border border-ellevee-stone bg-white px-3 py-2 text-sm text-ellevee-ink placeholder:text-ellevee-sage/60 focus:border-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink font-mono text-xs"
            />
          </div>

          <div className="space-y-1 flex flex-col justify-end">
            <label className="text-xs font-semibold text-ellevee-ink uppercase tracking-wider mb-2">
              Disponibilidade
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 rounded border-ellevee-stone text-ellevee-ink focus:ring-ellevee-ink"
              />
              <span className="text-sm font-medium text-ellevee-ink">
                Item Ativo {active ? "(visível para clientes e IA)" : "(pausado / indisponível)"}
              </span>
            </label>
          </div>
        </div>

        <DialogFooter className="mt-4 pt-3 border-t border-ellevee-stone/70">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-ellevee-sage hover:text-ellevee-ink hover:bg-ellevee-ivory rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-ellevee-ink hover:bg-ellevee-ink/90 rounded-lg shadow-sm transition-colors disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                {isEditing ? "Salvar Alterações" : "Cadastrar Item"}
              </>
            )}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

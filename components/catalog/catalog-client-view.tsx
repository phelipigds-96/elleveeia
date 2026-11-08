"use client"

import * as React from "react"
import Link from "next/link"
import {
  Plus,
  Search,
  Upload,
  Edit2,
  Trash2,
  Package,
  Layers,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Tag
} from "lucide-react"
import { ProductDialog, CatalogItem } from "./product-dialog"
import { deleteProductAction } from "@/app/(dashboard)/catalog/actions"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"

interface CatalogClientViewProps {
  initialProducts: CatalogItem[]
}

export function CatalogClientView({ initialProducts }: CatalogClientViewProps) {
  const [products, setProducts] = React.useState<CatalogItem[]>(initialProducts)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<"all" | "active" | "inactive">("all")

  // Modal dialog states
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingProduct, setEditingProduct] = React.useState<CatalogItem | null>(null)

  // Delete modal state
  const [productToDelete, setProductToDelete] = React.useState<CatalogItem | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)

  // Notification toast/banner
  const [notification, setNotification] = React.useState<{ type: "success" | "error"; message: string } | null>(null)

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message })
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr))
    }, 4000)
  }

  // Sincronizar caso `initialProducts` mude via SSR / revalidatePath
  React.useEffect(() => {
    setProducts(initialProducts)
  }, [initialProducts])

  // Filtragem
  const filteredProducts = React.useMemo(() => {
    return products.filter((item) => {
      if (statusFilter === "active" && !item.active) return false
      if (statusFilter === "inactive" && item.active) return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchName = item.name.toLowerCase().includes(q)
        const matchSku = item.sku?.toLowerCase().includes(q)
        const matchDesc = item.description?.toLowerCase().includes(q)
        return matchName || matchSku || matchDesc
      }

      return true
    })
  }, [products, searchQuery, statusFilter])

  const handleOpenCreate = () => {
    setEditingProduct(null)
    setDialogOpen(true)
  }

  const handleOpenEdit = (item: CatalogItem) => {
    setEditingProduct(item)
    setDialogOpen(true)
  }

  const handleSuccessSave = (savedItem: any) => {
    if (editingProduct) {
      setProducts((prev) =>
        prev.map((p) => (p.id === editingProduct.id ? { ...p, ...savedItem } : p))
      )
      showNotification("success", "Item atualizado com sucesso no catálogo!")
    } else {
      setProducts((prev) => [savedItem, ...prev])
      showNotification("success", "Item cadastrado com sucesso no catálogo!")
    }
  }

  const handleConfirmDelete = async () => {
    if (!productToDelete) return

    setIsDeleting(true)
    try {
      const res = await deleteProductAction(productToDelete.id)
      if (!res.success) {
        showNotification("error", res.error || "Não foi possível excluir o item.")
      } else {
        setProducts((prev) => prev.filter((p) => p.id !== productToDelete.id))
        showNotification("success", `"${productToDelete.name}" foi removido do catálogo.`)
        setProductToDelete(null)
      }
    } catch (err: any) {
      showNotification("error", err.message || "Erro ao excluir o produto.")
    } finally {
      setIsDeleting(false)
    }
  }

  const formatCurrency = (val: number | null | undefined) => {
    if (val == null) return "Sob consulta"
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(val)
  }

  return (
    <div className="space-y-6">
      {/* Notificação Temporária */}
      {notification && (
        <div
          className={`flex items-center justify-between p-3.5 rounded-xl border text-sm transition-all animate-in fade-in slide-in-from-top-2 ${
            notification.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-xs font-semibold uppercase hover:underline opacity-70 ml-4"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Cabeçalho da Página */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-ellevee-ink">
            Catálogo de Produtos e Serviços
          </h2>
          <p className="text-sm text-ellevee-sage mt-1">
            Cadastre planos, assinaturas, produtos ou serviços que o Agente de IA e a sua equipe utilizarão no atendimento.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link href="/catalog/import">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-ellevee-ink bg-white border border-ellevee-stone rounded-lg hover:bg-ellevee-ivory transition-colors shadow-sm"
            >
              <Upload className="h-4 w-4 text-ellevee-sage" />
              Importar CSV
            </button>
          </Link>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-ellevee-ink hover:bg-ellevee-ink/90 rounded-lg shadow-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            Novo Item
          </button>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-ellevee-stone shadow-sm">
        {/* Input de Busca */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-ellevee-sage" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nome, plano, descrição ou SKU..."
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-ellevee-stone bg-ellevee-ivory/40 text-ellevee-ink placeholder:text-ellevee-sage/60 focus:bg-white focus:border-ellevee-ink focus:outline-none"
          />
        </div>

        {/* Filtros de Status */}
        <div className="flex items-center gap-1 bg-ellevee-ivory p-1 rounded-lg border border-ellevee-stone/50 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              statusFilter === "all"
                ? "bg-white text-ellevee-ink shadow-sm"
                : "text-ellevee-sage hover:text-ellevee-ink"
            }`}
          >
            Todos ({products.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("active")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              statusFilter === "active"
                ? "bg-white text-ellevee-ink shadow-sm"
                : "text-ellevee-sage hover:text-ellevee-ink"
            }`}
          >
            Ativos ({products.filter((p) => p.active).length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("inactive")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              statusFilter === "inactive"
                ? "bg-white text-ellevee-ink shadow-sm"
                : "text-ellevee-sage hover:text-ellevee-ink"
            }`}
          >
            Inativos ({products.filter((p) => !p.active).length})
          </button>
        </div>
      </div>

      {/* Conteúdo Principal: Tabela ou Estado Vazio */}
      {products.length === 0 ? (
        <div className="border border-dashed border-ellevee-stone rounded-2xl p-12 text-center flex flex-col items-center justify-center bg-white shadow-sm">
          <div className="h-14 w-14 rounded-2xl bg-ellevee-ivory text-ellevee-ink flex items-center justify-center mb-4 border border-ellevee-stone/70">
            <Sparkles className="h-7 w-7 text-emerald-600" />
          </div>
          <h3 className="text-lg font-bold text-ellevee-ink">Seu catálogo está vazio</h3>
          <p className="text-sm text-ellevee-sage mt-1.5 max-w-md">
            Cadastre seus serviços (corte de cabelo, barba, consultoria) ou planos de assinatura (streaming, mensalidades) para que o Agente de IA informe os preços oficiais com exatidão aos clientes.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-ellevee-ink hover:bg-ellevee-ink/90 rounded-xl shadow transition-colors"
            >
              <Plus className="h-4 w-4" />
              Cadastrar Primeiro Item
            </button>
            <Link href="/catalog/import">
              <button className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-ellevee-ink bg-ellevee-ivory hover:bg-ellevee-stone/40 border border-ellevee-stone rounded-xl transition-colors">
                <Upload className="h-4 w-4 text-ellevee-sage" />
                Importar via Planilha CSV
              </button>
            </Link>
          </div>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="border border-dashed border-ellevee-stone rounded-2xl p-10 text-center bg-white">
          <Package className="h-10 w-10 text-ellevee-sage/60 mx-auto mb-2" />
          <p className="text-base font-semibold text-ellevee-ink">Nenhum item encontrado</p>
          <p className="text-xs text-ellevee-sage mt-1">
            Não há produtos ou serviços que correspondam aos filtros de busca aplicados.
          </p>
          <button
            onClick={() => {
              setSearchQuery("")
              setStatusFilter("all")
            }}
            className="mt-4 px-3.5 py-1.5 text-xs font-semibold text-ellevee-ink border border-ellevee-stone rounded-lg hover:bg-ellevee-ivory transition-colors"
          >
            Limpar Filtros
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-ellevee-stone bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="border-b border-ellevee-stone bg-ellevee-ivory/50 text-xs uppercase font-semibold text-ellevee-sage tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Item / Serviço</th>
                  <th className="px-5 py-3.5">Preço Oficial</th>
                  <th className="px-5 py-3.5">Cobrança / Unidade</th>
                  <th className="px-5 py-3.5">Código / SKU</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ellevee-stone/50">
                {filteredProducts.map((product) => (
                  <tr
                    key={product.id}
                    className="hover:bg-ellevee-ivory/30 transition-colors group"
                  >
                    {/* Item e Descrição */}
                    <td className="px-5 py-3.5 max-w-sm">
                      <div className="font-semibold text-ellevee-ink group-hover:text-black">
                        {product.name}
                      </div>
                      {product.description && (
                        <div className="text-xs text-ellevee-sage line-clamp-1 mt-0.5">
                          {product.description}
                        </div>
                      )}
                    </td>

                    {/* Preço */}
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100 text-sm">
                        {formatCurrency(product.price)}
                      </span>
                    </td>

                    {/* Unidade */}
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-xs text-ellevee-ink bg-ellevee-ivory px-2 py-0.5 rounded border border-ellevee-stone/70">
                        <Tag className="h-3 w-3 text-ellevee-sage" />
                        {product.unit || "un"}
                      </span>
                    </td>

                    {/* SKU */}
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="font-mono text-xs text-ellevee-sage bg-gray-50 px-2 py-0.5 rounded border border-gray-200">
                        {product.sku || product.barcode || "-"}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          product.active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {product.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>

                    {/* Ações */}
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(product)}
                          title="Editar Item"
                          className="p-1.5 rounded-md text-ellevee-sage hover:text-ellevee-ink hover:bg-ellevee-ivory transition-colors"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setProductToDelete(product)}
                          title="Excluir Item"
                          className="p-1.5 rounded-md text-ellevee-sage hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-ellevee-stone/50 bg-ellevee-ivory/20 flex items-center justify-between text-xs text-ellevee-sage">
            <span>
              Mostrando {filteredProducts.length} de {products.length} itens cadastrados
            </span>
            <span>Preços aplicados automaticamente pelo Agente de IA</span>
          </div>
        </div>
      )}

      {/* Modal de Criação / Edição de Produto */}
      <ProductDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false)
          setEditingProduct(null)
        }}
        product={editingProduct}
        onSuccess={handleSuccessSave}
      />

      {/* Modal de Confirmação de Exclusão */}
      <Dialog
        open={Boolean(productToDelete)}
        onClose={() => !isDeleting && setProductToDelete(null)}
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="text-red-600 flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Excluir do Catálogo
          </DialogTitle>
          <DialogDescription>
            Tem certeza de que deseja excluir o item{" "}
            <strong className="text-ellevee-ink font-semibold">
              &quot;{productToDelete?.name}&quot;
            </strong>
            ? Esta ação removerá o preço e impedirá o Agente de IA de ofertá-lo.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-4 pt-3 border-t border-ellevee-stone/70">
          <button
            type="button"
            onClick={() => setProductToDelete(null)}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium text-ellevee-sage hover:text-ellevee-ink hover:bg-ellevee-ivory rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm transition-colors disabled:opacity-50"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Excluindo...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Excluir Definitivamente
              </>
            )}
          </button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

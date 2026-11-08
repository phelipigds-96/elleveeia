import { createClient } from "@/lib/supabase/server"
import { getCompanyId } from "@/lib/services/conversations"
import { requireCompanyAdmin } from "@/lib/services/auth/guard"
import { CatalogClientView } from "@/components/catalog/catalog-client-view"
import type { CatalogItem } from "@/components/catalog/product-dialog"

export default async function CatalogPage() {
  const currentProfile = await requireCompanyAdmin()
  const supabase = createClient()
  const companyId = currentProfile.company_id || (await getCompanyId())

  if (!companyId) {
    return (
      <div className="p-8 text-center text-ellevee-sage border border-dashed rounded-xl bg-white">
        Você precisa estar autenticado e vinculado a uma organização ativa para gerenciar o catálogo.
      </div>
    )
  }

  // Busca os produtos com seus respectivos preços oficiais
  const { data: rawProducts, error } = await supabase
    .from("products")
    .select(`
      id,
      name,
      description,
      sku,
      barcode,
      unit,
      active,
      created_at,
      updated_at,
      product_prices (
        id,
        price,
        price_type,
        active
      )
    `)
    .eq("company_id", companyId)
    .order("name", { ascending: true })

  if (error) {
    console.error("[CatalogPage] Erro ao carregar produtos:", error)
  }

  const products: CatalogItem[] = (rawProducts || []).map((p: any) => {
    // Busca o preço varejo ativo preferencialmente
    const activeRetailPrice =
      p.product_prices?.find((pr: any) => pr.price_type === "retail" && pr.active) ||
      p.product_prices?.find((pr: any) => pr.active) ||
      p.product_prices?.[0]

    return {
      id: p.id,
      name: p.name,
      description: p.description || null,
      sku: p.sku || null,
      barcode: p.barcode || null,
      unit: p.unit || null,
      active: p.active !== false,
      price: activeRetailPrice?.price != null ? Number(activeRetailPrice.price) : null,
      created_at: p.created_at,
      updated_at: p.updated_at
    }
  })

  return <CatalogClientView initialProducts={products} />
}

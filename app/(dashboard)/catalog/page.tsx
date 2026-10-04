import { createClient } from '@/lib/supabase/server'
import { getCompanyId } from '@/lib/services/conversations'
import Link from 'next/link'

export default async function CatalogPage() {
  const supabase = createClient()
  const companyId = await getCompanyId()

  if (!companyId) {
    return <div>Você precisa estar autenticado e vinculado a uma empresa.</div>
  }

  // Busca os produtos
  const { data: products, error } = await supabase
    .from('products')
    .select(`
      id,
      name,
      sku,
      barcode,
      active,
      product_brands ( name ),
      product_categories ( name )
    `)
    .eq('company_id', companyId)
    .order('name', { ascending: true })
    .limit(50)

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Catálogo de Produtos</h2>
          <p className="text-muted-foreground">
            Gerencie os produtos da sua empresa que o Agente utilizará para responder os clientes.
          </p>
        </div>
        <Link href="/catalog/import">
          <button className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md text-sm font-medium">Importar CSV</button>
        </Link>
      </div>

      <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6">
          <h3 className="font-semibold leading-none tracking-tight">Produtos Ativos</h3>
          <p className="text-sm text-muted-foreground">
            {products?.length || 0} produtos encontrados (limitado a 50 nesta visualização).
          </p>
        </div>
        <div className="p-6 pt-0">
          {error ? (
            <div className="text-destructive">Erro ao carregar catálogo: {error.message}</div>
          ) : !products || products.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground border border-dashed rounded-lg">
              Nenhum produto cadastrado no catálogo.
            </div>
          ) : (
            <div className="rounded-md border">
              <table className="w-full text-sm text-left">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 font-medium">Nome</th>
                    <th className="px-4 py-3 font-medium">SKU / Código</th>
                    <th className="px-4 py-3 font-medium">Marca</th>
                    <th className="px-4 py-3 font-medium">Categoria</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product: any) => (
                    <tr key={product.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{product.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {product.sku || product.barcode || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {Array.isArray(product.product_brands) 
                          ? product.product_brands[0]?.name 
                          : product.product_brands?.name || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {Array.isArray(product.product_categories) 
                          ? product.product_categories[0]?.name 
                          : product.product_categories?.name || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${product.active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                          {product.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

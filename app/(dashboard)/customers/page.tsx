import { requireCompanyAdmin } from '@/lib/services/auth/guard'
import { listCompanyCustomers } from '@/lib/services/customers'
import { CustomersClient } from '@/components/customers/customers-client'

export const dynamic = 'force-dynamic'

export default async function CustomersPage() {
  const currentProfile = await requireCompanyAdmin()
  const companyId = currentProfile.company_id

  if (!companyId) {
    return (
      <div className="p-8 text-center text-muted-foreground border border-dashed rounded-xl bg-white">
        Você precisa estar vinculado a uma empresa ativa para gerenciar clientes.
      </div>
    )
  }

  const { customers, migrationPending } = await listCompanyCustomers(companyId)

  return (
    <CustomersClient
      initialCustomers={customers}
      migrationPending={migrationPending}
    />
  )
}

'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export function PeriodSelector() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentPeriod = searchParams.get('period') || '7days'

  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    router.push(`/dashboard?period=${value}`)
  }

  return (
    <select
      value={currentPeriod}
      onChange={handlePeriodChange}
      className="flex h-9 w-40 items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      <option value="today">Hoje</option>
      <option value="7days">Últimos 7 dias</option>
      <option value="30days">Últimos 30 dias</option>
    </select>
  )
}

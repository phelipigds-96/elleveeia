import { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  title: string
  value: number | string
  description: string
  Icon: LucideIcon
}

export function MetricCard({ title, value, description, Icon }: MetricCardProps) {
  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm flex flex-col">
      <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
        <h3 className="tracking-tight text-sm font-medium">{title}</h3>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="p-6 pt-0">
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  )
}

export function MetricCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm flex flex-col animate-pulse">
      <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="h-4 w-1/2 bg-muted rounded"></div>
        <div className="h-4 w-4 bg-muted rounded"></div>
      </div>
      <div className="p-6 pt-0">
        <div className="h-8 w-1/3 bg-muted rounded mb-2"></div>
        <div className="h-3 w-2/3 bg-muted rounded"></div>
      </div>
    </div>
  )
}

import { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  title: string
  value: number | string
  description: string
  Icon: LucideIcon
}

export function MetricCard({ title, value, description, Icon }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-ellevee-stone bg-white text-ellevee-ink shadow-2xs flex flex-col p-4 sm:p-5">
      <div className="flex items-center justify-between pb-3">
        <h3 className="text-xs font-semibold text-ellevee-sage tracking-tight font-sans">{title}</h3>
        <div className="h-7 w-7 rounded-md bg-[#F3F2ED] border border-ellevee-stone text-ellevee-ink flex items-center justify-center shrink-0">
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold font-display tracking-tight text-ellevee-ink">{value}</div>
        <p className="text-[11px] text-ellevee-sage font-mono mt-1">{description}</p>
      </div>
    </div>
  )
}

export function MetricCardSkeleton() {
  return (
    <div className="rounded-lg border border-ellevee-stone bg-white text-ellevee-ink shadow-2xs flex flex-col p-4 sm:p-5 animate-pulse">
      <div className="flex items-center justify-between pb-3">
        <div className="h-3.5 w-1/2 bg-stone-100 rounded"></div>
        <div className="h-7 w-7 bg-stone-100 rounded-md"></div>
      </div>
      <div>
        <div className="h-7 w-1/3 bg-stone-100 rounded mb-2"></div>
        <div className="h-3 w-2/3 bg-stone-100 rounded"></div>
      </div>
    </div>
  )
}

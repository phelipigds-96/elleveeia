import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-ellevee-ink",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-ellevee-ink text-ellevee-white hover:bg-black/90",
        secondary:
          "border-ellevee-stone bg-ellevee-stone/40 text-ellevee-ink",
        outline:
          "border-ellevee-stone bg-white text-ellevee-ink",
        accent:
          "border-[#B7D957]/70 bg-[#F4F9E4] text-ellevee-ink font-semibold",
        sage:
          "border-ellevee-sage/20 bg-ellevee-sage-light text-ellevee-ink",
        success:
          "border-emerald-200 bg-emerald-50/80 text-emerald-800",
        warning:
          "border-amber-200 bg-amber-50/80 text-amber-800",
        destructive:
          "border-rose-200 bg-rose-50/80 text-rose-800",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ellevee-ink disabled:pointer-events-none disabled:opacity-40 select-none",
  {
    variants: {
      variant: {
        default:
          "bg-ellevee-ink text-ellevee-white hover:bg-black active:bg-black shadow-[0_1px_2px_rgba(32,37,32,0.1)]",
        primary:
          "bg-ellevee-ink text-ellevee-white hover:bg-black active:bg-black shadow-[0_1px_2px_rgba(32,37,32,0.1)]",
        accent:
          "bg-ellevee-accent text-ellevee-ink hover:bg-[#a8cb46] font-semibold shadow-[0_1px_2px_rgba(183,217,87,0.3)]",
        outline:
          "border border-ellevee-stone bg-white text-ellevee-ink hover:bg-ellevee-ivory/60 active:bg-ellevee-stone/40 shadow-[0_1px_1px_rgba(32,37,32,0.03)]",
        secondary:
          "bg-ellevee-stone/50 text-ellevee-ink hover:bg-ellevee-stone active:bg-ellevee-stone/80",
        ghost:
          "text-ellevee-ink hover:bg-ellevee-stone/40 active:bg-ellevee-stone/60",
        destructive:
          "bg-rose-700 text-white hover:bg-rose-800 active:bg-rose-900 shadow-sm",
        link:
          "text-ellevee-ink underline-offset-4 hover:underline p-0 h-auto font-normal",
      },
      size: {
        default: "h-9 px-3.5 py-1.5",
        sm: "h-8 px-2.5 text-[11px]",
        lg: "h-10 px-5 text-sm",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

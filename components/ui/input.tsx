import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border border-ellevee-stone bg-white px-3 py-1.5 text-xs text-ellevee-ink shadow-[0_1px_1px_rgba(32,37,32,0.02)] transition-colors placeholder:text-ellevee-sage/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ellevee-ink focus-visible:border-ellevee-ink disabled:cursor-not-allowed disabled:opacity-40",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }

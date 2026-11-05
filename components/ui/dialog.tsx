"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
}

export function Dialog({ open, onClose, children, className }: DialogProps) {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    if (open) {
      document.body.style.overflow = "hidden"
      window.addEventListener("keydown", handleKeyDown)
    } else {
      document.body.style.overflow = "unset"
    }
    return () => {
      document.body.style.overflow = "unset"
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ellevee-ink/50 backdrop-blur-[2px] transition-opacity animate-in fade-in"
        onClick={onClose}
      />
      {/* Modal Surface */}
      <div
        className={cn(
          "relative z-50 w-full max-w-lg rounded-xl border border-ellevee-stone bg-white p-6 shadow-xl transition-all animate-in zoom-in-95",
          className
        )}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-ellevee-sage hover:bg-ellevee-ivory hover:text-ellevee-ink transition-colors focus:outline-none"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  )
}

export function DialogHeader({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1 pb-4 border-b border-ellevee-stone/70", className)}>{children}</div>
}

export function DialogTitle({ className, children }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("font-display text-base font-bold text-ellevee-ink tracking-tight", className)}>{children}</h2>
}

export function DialogDescription({ className, children }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-ellevee-sage leading-relaxed", className)}>{children}</p>
}

export function DialogFooter({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center justify-end space-x-2 pt-4 border-t border-ellevee-stone/70 mt-6", className)}>
      {children}
    </div>
  )
}

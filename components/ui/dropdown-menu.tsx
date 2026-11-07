"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface DropdownMenuProps {
  trigger: React.ReactNode
  children: React.ReactNode
  align?: "left" | "right"
}

export function DropdownMenu({ trigger, children, align = "right" }: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false)
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open])

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <div onClick={() => setOpen((prev) => !prev)} className="cursor-pointer">
        {trigger}
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className={cn(
            "absolute z-50 mt-1.5 min-w-[12rem] overflow-hidden rounded-lg border border-ellevee-stone bg-white p-1 text-ellevee-ink shadow-lg shadow-ellevee-ink/5 animate-in fade-in-80 zoom-in-95",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function DropdownMenuItem({
  className,
  children,
  onClick,
  destructive = false,
  disabled = false,
}: {
  className?: string
  children: React.ReactNode
  onClick?: () => void
  destructive?: boolean
  disabled?: boolean
}) {
  return (
    <div
      onClick={(e) => {
        if (!disabled && onClick) {
          onClick()
        }
      }}
      className={cn(
        "relative flex select-none items-center rounded-md px-2.5 py-1.5 text-xs font-medium outline-none transition-colors",
        disabled
          ? "opacity-50 cursor-not-allowed text-ellevee-sage pointer-events-none"
          : "cursor-pointer",
        !disabled && destructive && "text-rose-600 hover:bg-rose-50/80",
        !disabled && !destructive && "text-ellevee-ink hover:bg-[#F8F8F5] hover:text-black",
        className
      )}
    >
      {children}
    </div>
  )
}

export function DropdownMenuSeparator() {
  return <div className="my-1 h-px bg-ellevee-stone/80" />
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ellevee-sage">{children}</div>
}

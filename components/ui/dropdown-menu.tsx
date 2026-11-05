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
            "absolute z-50 mt-1.5 min-w-[12rem] overflow-hidden rounded-xl border border-slate-200 bg-white p-1 text-slate-800 shadow-xl animate-in fade-in-80 zoom-in-95",
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
}: {
  className?: string
  children: React.ReactNode
  onClick?: () => void
  destructive?: boolean
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none transition-colors",
        destructive
          ? "text-rose-600 hover:bg-rose-50"
          : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
        className
      )}
    >
      {children}
    </div>
  )
}

export function DropdownMenuSeparator() {
  return <div className="my-1 h-px bg-slate-100" />
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{children}</div>
}

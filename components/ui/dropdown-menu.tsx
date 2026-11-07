"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

interface DropdownMenuProps {
  trigger: React.ReactNode
  children: React.ReactNode
  align?: "left" | "right"
}

export function DropdownMenu({ trigger, children, align = "right" }: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLDivElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [coords, setCoords] = React.useState<{ top: number; left?: number; right?: number } | null>(null)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const updatePosition = React.useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const estimatedHeight = 240

    let top = rect.bottom + 4
    if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
      top = rect.top - estimatedHeight - 4
    }

    if (align === "right") {
      setCoords({
        top,
        right: Math.max(8, window.innerWidth - rect.right),
      })
    } else {
      setCoords({
        top,
        left: Math.max(8, rect.left),
      })
    }
  }, [align])

  React.useEffect(() => {
    if (open) {
      updatePosition()
    }
  }, [open, updatePosition])

  React.useEffect(() => {
    if (!open) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current && triggerRef.current.contains(target)) {
        return
      }
      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpen(false)
      }
    }

    const handleScrollOrResize = () => {
      setOpen(false)
    }

    document.addEventListener("mousedown", handleClickOutside)
    window.addEventListener("scroll", handleScrollOrResize, true)
    window.addEventListener("resize", handleScrollOrResize)

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      window.removeEventListener("scroll", handleScrollOrResize, true)
      window.removeEventListener("resize", handleScrollOrResize)
    }
  }, [open])

  return (
    <div className="relative inline-block text-left">
      <div
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className="cursor-pointer"
      >
        {trigger}
      </div>

      {open && coords && mounted && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            top: coords.top,
            ...(coords.right !== undefined ? { right: coords.right } : { left: coords.left }),
          }}
          className={cn(
            "z-[9999] min-w-[13rem] overflow-hidden rounded-xl border border-ellevee-stone/90 bg-white p-1.5 text-ellevee-ink shadow-xl shadow-black/10 animate-in fade-in-80 zoom-in-95"
          )}
        >
          {children}
        </div>,
        document.body
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
        "relative flex select-none items-center rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none transition-colors",
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
  return (
    <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ellevee-sage font-mono">
      {children}
    </div>
  )
}

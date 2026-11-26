"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { computeDropdownPosition, type ComputedDropdownCoords } from "@/lib/ui/conversations-viewport"

interface DropdownMenuProps {
  trigger: React.ReactNode
  children: React.ReactNode
  align?: "left" | "right"
}

export function DropdownMenu({ trigger, children, align = "right" }: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLDivElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [coords, setCoords] = React.useState<ComputedDropdownCoords | null>(null)
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  const updatePosition = React.useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const vv = window.visualViewport
    const viewportWidth = vv?.width ?? window.innerWidth
    const viewportHeight = vv?.height ?? window.innerHeight
    const offsetTop = vv?.offsetTop ?? 0
    const offsetLeft = vv?.offsetLeft ?? 0

    const measuredRect = menuRef.current?.getBoundingClientRect()
    const menuWidth = measuredRect?.width && measuredRect.width > 0 ? measuredRect.width : 208
    const menuHeight = measuredRect?.height && measuredRect.height > 0 ? measuredRect.height : 240

    setCoords(
      computeDropdownPosition({
        triggerRect: rect,
        menuWidth,
        menuHeight,
        viewportWidth,
        viewportHeight,
        offsetTop,
        offsetLeft,
        align,
      })
    )
  }, [align])

  React.useLayoutEffect(() => {
    if (open) {
      updatePosition()
    }
  }, [open, updatePosition])

  React.useEffect(() => {
    if (!open) return

    const rafId = window.requestAnimationFrame(() => {
      updatePosition()
    })

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current && triggerRef.current.contains(target)) {
        return
      }
      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }

    const handleScrollOrResize = () => {
      updatePosition()
    }

    const vv = window.visualViewport
    document.addEventListener("mousedown", handleClickOutside)
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("scroll", handleScrollOrResize, true)
    window.addEventListener("resize", handleScrollOrResize)
    vv?.addEventListener("resize", handleScrollOrResize)
    vv?.addEventListener("scroll", handleScrollOrResize)

    return () => {
      window.cancelAnimationFrame(rafId)
      document.removeEventListener("mousedown", handleClickOutside)
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("scroll", handleScrollOrResize, true)
      window.removeEventListener("resize", handleScrollOrResize)
      vv?.removeEventListener("resize", handleScrollOrResize)
      vv?.removeEventListener("scroll", handleScrollOrResize)
    }
  }, [open, updatePosition])

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
          role="menu"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            top: coords.top,
            maxHeight: coords.maxHeight,
            ...(coords.right !== undefined ? { right: coords.right } : { left: coords.left }),
          }}
          className={cn(
            "z-[9999] min-w-[13rem] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain scroll-slim rounded-xl border border-ellevee-stone/90 bg-white p-1.5 text-ellevee-ink shadow-xl shadow-black/10 animate-in fade-in-80 zoom-in-95"
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
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled && onClick) {
          onClick()
        }
      }}
      onKeyDown={(e) => {
        if (!disabled && onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onClick()
        }
      }}
      className={cn(
        "relative flex select-none items-center rounded-lg px-2.5 min-h-[44px] sm:min-h-0 py-2 sm:py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ellevee-ink/40",
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

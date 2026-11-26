"use client"

import { useEffect, useRef, useState } from "react"
import {
  computeVisualViewportMetrics,
  type VisualViewportMetrics,
} from "./conversations-viewport"

const DEFAULT_METRICS: VisualViewportMetrics = {
  effectiveHeight: 800,
  offsetTop: 0,
  isKeyboardOpen: false,
  quickReplyListMaxHeight: 160,
}

/**
 * Monitora `window.visualViewport` para adaptar altura e popovers no Chrome Android
 * quando o teclado virtual (Gboard) abre ou fecha, sem causar divergence SSR/hidratação.
 */
export function useVisualViewport(): VisualViewportMetrics {
  const [metrics, setMetrics] = useState<VisualViewportMetrics>(DEFAULT_METRICS)
  const baselineHeightRef = useRef<number | null>(null)
  const lastWidthRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return

    const syncViewport = () => {
      const vv = window.visualViewport
      const layoutWidth = window.innerWidth
      const windowHeight = window.innerHeight
      const visualHeight = vv?.height ?? windowHeight
      const offsetTop = vv?.offsetTop ?? 0

      // Recalibra altura base quando muda a largura (rotação ou resize real)
      // ou quando a altura visível expande (teclado fechou ou barra recolheu).
      if (
        lastWidthRef.current === null ||
        Math.abs(lastWidthRef.current - layoutWidth) > 20 ||
        baselineHeightRef.current === null ||
        visualHeight > baselineHeightRef.current
      ) {
        baselineHeightRef.current = Math.max(windowHeight, visualHeight)
        lastWidthRef.current = layoutWidth
      }

      const layoutHeight = Math.max(windowHeight, baselineHeightRef.current || windowHeight)

      const next = computeVisualViewportMetrics({
        layoutWidth,
        layoutHeight,
        visualHeight,
        offsetTop,
      })

      setMetrics((prev) => {
        if (
          prev.effectiveHeight === next.effectiveHeight &&
          prev.offsetTop === next.offsetTop &&
          prev.isKeyboardOpen === next.isKeyboardOpen &&
          prev.quickReplyListMaxHeight === next.quickReplyListMaxHeight
        ) {
          return prev
        }
        return next
      })

      const rootEl = document.documentElement
      if (next.isKeyboardOpen && next.effectiveHeight > 0) {
        rootEl.style.setProperty("--ellevee-vvh", `${next.effectiveHeight}px`)
      } else {
        rootEl.style.removeProperty("--ellevee-vvh")
      }
    }

    syncViewport()

    const vv = window.visualViewport
    vv?.addEventListener("resize", syncViewport)
    vv?.addEventListener("scroll", syncViewport)
    window.addEventListener("resize", syncViewport)
    window.addEventListener("orientationchange", syncViewport)

    return () => {
      vv?.removeEventListener("resize", syncViewport)
      vv?.removeEventListener("scroll", syncViewport)
      window.removeEventListener("resize", syncViewport)
      window.removeEventListener("orientationchange", syncViewport)
      document.documentElement.style.removeProperty("--ellevee-vvh")
    }
  }, [])

  return metrics
}

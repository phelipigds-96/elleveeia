export const CONVERSATIONS_DESKTOP_BREAKPOINT_PX = 1024
export const COMPOSER_MAX_HEIGHT_PX = 112
export const FEED_PIN_TO_BOTTOM_THRESHOLD_PX = 96

export interface VisualViewportInput {
  layoutWidth: number
  layoutHeight: number
  visualHeight: number
  offsetTop?: number
  desktopBreakpointPx?: number
}

export interface VisualViewportMetrics {
  effectiveHeight: number
  offsetTop: number
  isKeyboardOpen: boolean
  quickReplyListMaxHeight: number
}

/**
 * Calcula altura útil e estado do teclado virtual para Chrome Android / mobile.
 * Preserva comportamento nativo em desktop (>= 1024px) e evita corte de popovers.
 */
export function computeVisualViewportMetrics({
  layoutWidth,
  layoutHeight,
  visualHeight,
  offsetTop = 0,
  desktopBreakpointPx = CONVERSATIONS_DESKTOP_BREAKPOINT_PX,
}: VisualViewportInput): VisualViewportMetrics {
  const safeVisualHeight = Number.isFinite(visualHeight) && visualHeight > 0
    ? Math.round(visualHeight)
    : Math.max(0, Math.round(layoutHeight))

  const safeLayoutHeight = Number.isFinite(layoutHeight) && layoutHeight > 0
    ? Math.round(layoutHeight)
    : safeVisualHeight

  const heightDelta = safeLayoutHeight - safeVisualHeight
  const isSmallViewport = layoutWidth > 0 && layoutWidth < desktopBreakpointPx
  const isKeyboardOpen = isSmallViewport && heightDelta > 110

  // Reserva espaço aproximado para header (56px), composer (~96px), cabeçalho do popover (~36px) e folga (24px)
  const availableForList = safeVisualHeight - 212
  const quickReplyListMaxHeight = Math.max(88, Math.min(200, availableForList))

  return {
    effectiveHeight: safeVisualHeight,
    offsetTop: Math.max(0, Math.round(offsetTop || 0)),
    isKeyboardOpen,
    quickReplyListMaxHeight,
  }
}

export interface FeedScrollMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
  thresholdPx?: number
}

/**
 * Determina se o usuário está próximo do final do histórico de mensagens.
 * Evita puxar a rolagem à força enquanto lê mensagens antigas.
 */
export function isFeedNearBottom({
  scrollTop,
  clientHeight,
  scrollHeight,
  thresholdPx = FEED_PIN_TO_BOTTOM_THRESHOLD_PX,
}: FeedScrollMetrics): boolean {
  if (scrollHeight <= clientHeight) return true
  const distanceFromBottom = scrollHeight - (scrollTop + clientHeight)
  return distanceFromBottom <= thresholdPx
}

export interface MobileShellVisibilityInput {
  hasSelection: boolean
  hasExplicitSelection: boolean
  mobileInitialized: boolean
}

/**
 * Controla a exibição da tela de chat em viewports < lg sem divergência de hidratação SSR.
 * Durante SSR e primeira passagem de hidratação (`mobileInitialized === false`), exibe o chat
 * em mobile apenas quando `?id=` foi explicitamente solicitado na URL.
 */
export function resolveMobileChatVisibility({
  hasSelection,
  hasExplicitSelection,
  mobileInitialized,
}: MobileShellVisibilityInput): boolean {
  if (!hasSelection) return false
  return mobileInitialized ? true : hasExplicitSelection
}

export interface DropdownRectInput {
  top: number
  bottom: number
  left: number
  right: number
}

export interface DropdownPositionInput {
  triggerRect: DropdownRectInput
  menuWidth: number
  menuHeight: number
  viewportWidth: number
  viewportHeight: number
  offsetTop?: number
  offsetLeft?: number
  align?: "left" | "right"
  margin?: number
}

export interface ComputedDropdownCoords {
  top: number
  left?: number
  right?: number
  maxHeight: number
  placement: "bottom" | "top"
}

/**
 * Posiciona dropdowns dentro dos limites reais do visualViewport, garantindo que
 * nunca extravasem topo, base ou laterais mesmo com teclado virtual aberto.
 */
export function computeDropdownPosition({
  triggerRect,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  offsetTop = 0,
  offsetLeft = 0,
  align = "right",
  margin = 8,
}: DropdownPositionInput): ComputedDropdownCoords {
  const safeOffsetTop = Math.max(0, offsetTop)
  const safeOffsetLeft = Math.max(0, offsetLeft)
  const visibleTop = safeOffsetTop + margin
  const visibleBottom = safeOffsetTop + viewportHeight - margin
  const gap = 4

  const spaceBelow = Math.max(0, visibleBottom - (triggerRect.bottom + gap))
  const spaceAbove = Math.max(0, (triggerRect.top - gap) - visibleTop)
  const targetHeight = Math.max(96, menuHeight)

  const openAbove = spaceBelow < targetHeight && spaceAbove > spaceBelow
  const placement: "bottom" | "top" = openAbove ? "top" : "bottom"

  const availableSpace = openAbove ? spaceAbove : spaceBelow
  const maxHeight = Math.max(96, Math.min(viewportHeight - margin * 2, availableSpace))
  const effectiveHeight = Math.min(targetHeight, maxHeight)

  let top = openAbove
    ? triggerRect.top - gap - effectiveHeight
    : triggerRect.bottom + gap

  const maxAllowedTop = Math.max(visibleTop, visibleBottom - effectiveHeight)
  top = Math.min(Math.max(visibleTop, top), maxAllowedTop)

  const clampedWidth = Math.min(menuWidth, Math.max(160, viewportWidth - margin * 2))

  if (align === "right") {
    const rightLimit = safeOffsetLeft + viewportWidth
    const rawRight = rightLimit - triggerRect.right
    const maxRight = Math.max(margin, viewportWidth - clampedWidth - margin)
    const right = Math.min(Math.max(margin, rawRight), maxRight)
    return { top: Math.round(top), right: Math.round(right), maxHeight: Math.round(maxHeight), placement }
  }

  const minLeft = safeOffsetLeft + margin
  const maxLeft = Math.max(minLeft, safeOffsetLeft + viewportWidth - clampedWidth - margin)
  const left = Math.min(Math.max(minLeft, triggerRect.left), maxLeft)
  return { top: Math.round(top), left: Math.round(left), maxHeight: Math.round(maxHeight), placement }
}

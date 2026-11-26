import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  COMPOSER_MAX_HEIGHT_PX,
  CONVERSATIONS_DESKTOP_BREAKPOINT_PX,
  computeDropdownPosition,
  computeVisualViewportMetrics,
  isFeedNearBottom,
  resolveMobileChatVisibility,
} from '@/lib/ui/conversations-viewport'

const ROOT = process.cwd()

test('UI-01: computeVisualViewportMetrics detecta abertura/fechamento de teclado no Chrome Android sem afetar desktop', () => {
  // 360x800 com teclado fechado
  const closedMobile = computeVisualViewportMetrics({
    layoutWidth: 360,
    layoutHeight: 800,
    visualHeight: 800,
    offsetTop: 0,
  })
  assert.equal(closedMobile.isKeyboardOpen, false)
  assert.equal(closedMobile.effectiveHeight, 800)

  // 360x800 com Gboard aberto (~420px livres)
  const openGboard360 = computeVisualViewportMetrics({
    layoutWidth: 360,
    layoutHeight: 800,
    visualHeight: 420,
    offsetTop: 0,
  })
  assert.equal(openGboard360.isKeyboardOpen, true)
  assert.equal(openGboard360.effectiveHeight, 420)
  assert.ok(openGboard360.quickReplyListMaxHeight >= 88 && openGboard360.quickReplyListMaxHeight <= 200)

  // 390x844 com viewport muito reduzido (~310px livres) mantém popover mínimo legível
  const crampedMobile = computeVisualViewportMetrics({
    layoutWidth: 390,
    layoutHeight: 844,
    visualHeight: 310,
  })
  assert.equal(crampedMobile.isKeyboardOpen, true)
  assert.equal(crampedMobile.quickReplyListMaxHeight, 98)

  // Desktop 1280x720 e 1440x900 nunca disparam heurística de teclado virtual
  const desktop = computeVisualViewportMetrics({
    layoutWidth: 1280,
    layoutHeight: 900,
    visualHeight: 650,
  })
  assert.equal(desktop.isKeyboardOpen, false)
  assert.equal(CONVERSATIONS_DESKTOP_BREAKPOINT_PX, 1024)
})

test('UI-01: isFeedNearBottom preserva posição do leitor ao consultar mensagens antigas', () => {
  assert.equal(
    isFeedNearBottom({ scrollTop: 1120, clientHeight: 480, scrollHeight: 1620 }),
    true
  )
  assert.equal(
    isFeedNearBottom({ scrollTop: 300, clientHeight: 480, scrollHeight: 1620 }),
    false
  )
  assert.equal(
    isFeedNearBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 }),
    true
  )
})

test('UI-01: resolveMobileChatVisibility evita flash e divergência de hidratação no carregamento mobile', () => {
  // SSR / primeiro render cliente sem ?id=: mesmo com initialSelectedId preenchido,
  // mobile não renderiza chat antes da montagem, mantendo SSR === hidratação.
  assert.equal(
    resolveMobileChatVisibility({
      hasSelection: true,
      hasExplicitSelection: false,
      mobileInitialized: false,
    }),
    false
  )

  // Com ?id= explícito na URL, abre direto no chat desde o SSR
  assert.equal(
    resolveMobileChatVisibility({
      hasSelection: true,
      hasExplicitSelection: true,
      mobileInitialized: false,
    }),
    true
  )

  // Após clicar em uma conversa no mobile e após voltar para a lista
  assert.equal(
    resolveMobileChatVisibility({
      hasSelection: true,
      hasExplicitSelection: false,
      mobileInitialized: true,
    }),
    true
  )
  assert.equal(
    resolveMobileChatVisibility({
      hasSelection: false,
      hasExplicitSelection: false,
      mobileInitialized: true,
    }),
    false
  )
})

test('UI-01: computeDropdownPosition mantém menus dentro da viewport em 360px e com teclado aberto', () => {
  // Trigger próximo à borda inferior em 360x420 (teclado aberto) -> vira para cima e limita altura
  const flipped = computeDropdownPosition({
    triggerRect: { top: 350, bottom: 394, left: 300, right: 344 },
    menuWidth: 208,
    menuHeight: 240,
    viewportWidth: 360,
    viewportHeight: 420,
    align: 'right',
  })
  assert.equal(flipped.placement, 'top')
  assert.ok(flipped.top >= 8)
  assert.ok(flipped.maxHeight <= 338)
  assert.ok((flipped.right ?? 0) >= 8)

  // Trigger próximo ao topo em 768x1024 -> abre para baixo sem vazar à esquerda
  const below = computeDropdownPosition({
    triggerRect: { top: 16, bottom: 52, left: 4, right: 120 },
    menuWidth: 208,
    menuHeight: 180,
    viewportWidth: 768,
    viewportHeight: 1024,
    align: 'left',
  })
  assert.equal(below.placement, 'bottom')
  assert.ok((below.left ?? 0) >= 8)
  assert.ok(below.top + Math.min(180, below.maxHeight) <= 1016)
})

test('UI-01: contratos estruturais em layout, shell e painel-client estão aplicados', () => {
  const rootLayout = readFileSync(resolve(ROOT, 'app/layout.tsx'), 'utf8')
  const dashLayout = readFileSync(resolve(ROOT, 'app/(dashboard)/layout.tsx'), 'utf8')
  const shell = readFileSync(resolve(ROOT, 'components/layout/dashboard-shell.tsx'), 'utf8')
  const componentsDir = resolve(ROOT, 'app/(dashboard)/conversations/components')
  const painel = readdirSync(componentsDir)
    .filter((f) => f.endsWith('.tsx'))
    .sort()
    .map((f) => readFileSync(resolve(componentsDir, f), 'utf8'))
    .join('\n')

  // 1. maximumScale: 1 removido; interactiveWidget preservado
  assert.doesNotMatch(rootLayout, /maximumScale\s*:\s*1/)
  assert.match(rootLayout, /interactiveWidget:\s*['"]resizes-content['"]/)

  // 2. Altura dinâmica com fallback 100dvh
  assert.match(dashLayout, /--ellevee-vvh,100dvh/)

  // 3. Breakpoints unificados em lg no DashboardShell e sem alert/controles inertes
  assert.match(shell, /isConversationsChat \? "lg:hidden" : "md:hidden"/)
  assert.match(shell, /hidden lg:flex flex-col items-center justify-between/)
  assert.doesNotMatch(shell, /alert\("Central de Ajuda/)
  assert.doesNotMatch(shell, /title="Alternar tema"/)

  // 4. PainelClient: sem scrollIntoView, sem controles mortos, altura máxima unificada e alvos >= 44px
  assert.doesNotMatch(painel, /scrollIntoView/)
  assert.doesNotMatch(painel, /title="Alternar visualização"/)
  assert.doesNotMatch(painel, /title="Inserir emoji"/)
  assert.doesNotMatch(painel, /max-w-\[130px\]/)
  assert.doesNotMatch(painel, /flex-1 flex flex-row min-h-0 w-full/)
  assert.match(painel, /COMPOSER_MAX_HEIGHT_PX/)
  assert.match(painel, new RegExp(`max-h-\\[${COMPOSER_MAX_HEIGHT_PX}px\\]`))
  assert.match(painel, /h-11 w-11/)
  assert.match(painel, /min-h-\[44px\]/)
})

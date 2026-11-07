# Plano de ação — Melhoria visual de `/conversations`

Auditoria visual da área de conversas (Lista + Funil/Kanban) do Ellevee IA, com base em leitura estática do código. Nenhuma medição em navegador foi feita: observações de layout dinâmico (quebras de linha, scroll) são inferências do código.

## Diagnóstico resumido

A tela tinha uma base visual coerente (paleta Ivory/Ink/Sage, `font-display` em títulos, bubbles de mensagem, `scroll-slim`, `focus-ring`, `prefers-reduced-motion` respeitado), mas a hierarquia e a densidade eram o problema: Lista, chat e painel do cliente disputavam atenção com o mesmo peso, e as duas vistas do mesmo domínio (Lista e Kanban) falavam línguas visuais diferentes — o Kanban tinha cor por etapa, a Lista não tinha cor nenhuma.

---

## Fase 0 — Base compartilhada (executada)

Criado `components/conversations/conversation-status.tsx` como fonte única da linguagem visual de status:

- `resolveStatusView(status, assigned)` — normaliza o par `conversations.status` + `assigned_to` em rótulo, tom e ícone:
  - `human` sem responsável → "Aguardando atendimento" (warning)
  - `human` com responsável → "Em atendimento" (success)
  - `open` → "Em aberto / IA" (info)
  - `closed` → "Finalizado" (neutro)
- `StatusChip` — componente único que renderiza ícone + rótulo + detalhe opcional, usando os tokens semânticos já existentes na paleta.

Objetivo: eliminar a duplicação de mapas de rótulo que existia entre os dois componentes.

## Fase 1 — Tela de Lista de conversas (executada)

`app/(dashboard)/conversations/components/painel-client.tsx`:

- A barra de filtros deixou de ser uma grade de só ícones (que escondia o contexto atual) e virou uma faixa de chips rotulados com contador e ponto de estado: "Todas", "Aguardando", "Em atendimento", "IA", "Finalizados". O filtro ativo mantém `aria-pressed`.
- O item da lista passou a exibir o `StatusChip` unificado, em vez do texto solto "Fila / Atendente / Espera", incluindo o tempo de espera quando a conversa está na fila.
- O cabeçalho da conversa ativa deixou de ter ramificações de texto ("Finalizado" / "Aguardando Atendente" / "Com Você" / "Com Operador" / "IA: …") e usa o mesmo `StatusChip`, com detalhe "com você" / "em atendimento".

`app/(dashboard)/conversations/components/kanban-panel-client.tsx`: o cartão do funil passou a mostrar o mesmo `StatusChip` (o mapa local `STATUS_LABEL`, duplicado, foi removido).

## Fase 2 — Painel do cliente retrátil (executada)

- O painel do cliente passou a ser um *drawer* retrátil, com estado `isProfileOpen`, botão "Perfil" no cabeçalho do chat e fecho explícito.

## Fase 3 — Destaque da etapa do funil (executada)

- Na Lista, a etiqueta da etapa do funil deixou de ser um texto monoespaçado solto e passou a ter um ponto colorido com a cor da etapa (validada por regex hexadecimal) e rótulo truncado.
- A etapa do funil passou também a aparecer no cabeçalho da conversa ativa, que antes não mostrava em que etapa o atendimento estava — o usuário não precisava voltar à Lista para saber onde estava.
- No Kanban, a cor da coluna foi centralizada em `stageColor` e o tipo da etapa virou rótulo acessível (`Etapa inicial` / `Etapa em andamento` / `Etapa final`) no `aria-label` da coluna, com a contagem de conversas.

## Fase 4 — Confirmação, estados e acessibilidade (executada)

- **Ação destrutiva:** encerrar atendimento passou a exigir dois cliques — o primeiro arma a confirmação (rótulo vira "Confirmar", botão ganha o tom `danger`), o segundo executa. O estado arma expira sozinho em 5 s para não deixar o atendente em dúvida.
- **Estado vazio contextual:** a lista diferencia "nenhuma conversa por aqui" (não há conversas no tenant) de "nenhuma conversa encontrada" (há conversas, mas o filtro/busca não casou), com textos e ações diferentes.
- **Anúncio de mudanças (Kanban):** mover um cartão só é percebido visualmente; foi adicionada uma região `role="status" aria-live="polite"` que anuncia o destino da conversa e, em caso de falha, a restauração da posição anterior.
- **Semântica de lista:** o item selecionado da lista recebeu `aria-current`, e a região da lista recebeu rótulo acessível.
- **Botão Perfil:** recebeu `aria-expanded` e `aria-controls` apontando para o `id` do drawer.

---

## Lacunas conhecidas

- Nenhuma verificação foi executada em navegador: o comportamento real de scroll, quebra de linha e contraste em telas pequenas precisa de validação manual.
- A cor da etapa usada na Lista depende de a consulta de conversas devolver `color`; o helper `stageColorOf` usa fallback `#64748b` quando o dado não chega, mas o *select* da consulta não foi alterado — isso é escopo do backend.
- Não houve alteração em Server Actions, rotas ou banco de dados.

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemPrompt, formatWorkingMemoryPrompt } from '@/lib/services/agent/context-builder'
import type { WorkingMemory } from '@/lib/services/agent/working-memory'

// Mock base de agente comercial
const mockAgent = {
  name: 'Sofia Consultora',
  segment: 'Confeitaria e Doceria',
  personality: 'Empática, profissional, focada em ajudar confeiteiras a escolher os melhores insumos.',
  instructions: 'Atue como consultora especializada da loja de confeitaria.'
}

test('AC-03 Comportamento 1: Transparência sobre identidade de IA quando questionada', () => {
  const prompt = buildSystemPrompt({
    agent: mockAgent,
    hasConfirmedCustomerName: true,
    customerRow: { name: 'Mariana Lima', phone: '11999999999' },
    hasCatalogProducts: true
  })

  // 1. Deve conter seção explícita sobre transparência de IA
  assert.ok(prompt.includes('TRANSPARÊNCIA SOBRE IDENTIDADE DE IA (SE QUESTIONADO)'))

  // 2. Deve orientar confirmação sincera e natural logo na primeira frase
  assert.ok(prompt.includes('Responda com total transparência, sinceridade, simpatia e naturalidade logo na PRIMEIRA frase'))
  assert.ok(prompt.includes('Sou sim! Sou o assistente virtual da loja'))

  // 3. Proíbe expressamente negar que é IA ou inventar ações humanas físicas
  assert.ok(prompt.includes('NUNCA negue sua natureza de inteligência artificial'))
  assert.ok(prompt.includes('NUNCA invente uma identidade humana'))
  assert.ok(prompt.includes('vou até a prateleira checar'))

  // 4. Proíbe repetições não solicitadas em turnos seguintes
  assert.ok(prompt.includes('NUNCA declare de forma robótica ou espontânea que você é uma IA em turnos seguintes'))

  // 5. Orienta transferência humana se solicitado explicitamente
  assert.ok(prompt.includes('transferir_para_humano'))
  assert.ok(prompt.includes('Solicitação expressa de atendente humano'))
})

test('AC-03 Comportamento 2: "Uma pergunta por vez" (Regra de Ouro / Anti-interrogatório)', () => {
  const prompt = buildSystemPrompt({
    agent: mockAgent,
    hasConfirmedCustomerName: false,
    customerRow: { whatsapp_name: 'Cliente' },
    hasCatalogProducts: true
  })

  // 1. Deve conter a Regra de Ouro destacada
  assert.ok(prompt.includes('REGRA DE OURO: UMA ÚNICA PERGUNTA POR VEZ (PROIBIDO INTERROGATÓRIO)'))

  // 2. Deve limitar expressamente a no máximo uma pergunta direcionada por turno
  assert.ok(prompt.includes('faça NO MÁXIMO UMA única pergunta direcionada por turno'))

  // 3. Proíbe acúmulo de perguntas simultâneas (marca + peso + aplicação + orçamento)
  assert.ok(prompt.includes('É ESTRITAMENTE PROIBIDO fazer interrogatórios acumulados'))
  assert.ok(prompt.includes('Qual marca você prefere? E de quantos quilos? Vai usar para casquinha ou recheio?'))

  // 4. Orienta priorização da informação que mais destrava a busca
  assert.ok(prompt.includes('Escolha a informação prioritária que mais destrava a busca no catálogo no momento'))
})

test('AC-03 Comportamento 3: Prevenção de perguntas redundantes (não perguntar o que já foi informado)', () => {
  const prompt = buildSystemPrompt({
    agent: mockAgent,
    hasConfirmedCustomerName: true,
    customerRow: { name: 'Fernanda' },
    hasCatalogProducts: true
  })

  // 1. Diretriz clara de verificação de histórico e memória ativa
  assert.ok(prompt.includes('NÃO PERGUNTE O QUE JÁ FOI INFORMADO'))
  assert.ok(prompt.includes('Verifique com rigor o histórico e a [WORKING MEMORY]'))

  // 2. Proíbe re-perguntar dados já fornecidos
  assert.ok(prompt.includes('Se o cliente já informou marca, tamanho, peso, sabor, quantidade ou finalidade em qualquer mensagem anterior, NUNCA pergunte novamente'))
  assert.ok(prompt.includes('Utilize o dado já informado e avance diretamente'))
})

test('AC-03 Comportamento 4: Densidade proporcional e concisão para mensagens simples', () => {
  const prompt = buildSystemPrompt({
    agent: mockAgent,
    hasConfirmedCustomerName: true,
    customerRow: { name: 'Paula' },
    hasCatalogProducts: true
  })

  // 1. Presença da regra de densidade proporcional
  assert.ok(prompt.includes('REGRA DE DENSIDADE PROPORCIONAL E OBJETIVIDADE DE RESPOSTA'))

  // 2. Mensagens curtas devem ter respostas curtas e objetivas (1 a 2 frases)
  assert.ok(prompt.includes('Mensagens curtas, diretas ou perguntas simples'))
  assert.ok(prompt.includes('responda em 1 a 2 frases curtas e objetivas'))

  // 3. Responda primeiro a pergunta direta antes de qualquer pergunta consultiva
  assert.ok(prompt.includes('Responda PRIMEIRO à pergunta direta'))
  assert.ok(prompt.includes('NUNCA envie um bloco longo de texto para quem fez uma pergunta de poucas palavras'))

  // 4. Moderação de saudações e emojis
  assert.ok(prompt.includes('Evite saudações repetitivas a cada turno'))
  assert.ok(prompt.includes('Moderação de emojis: use no máximo 1 ou 2 emojis sutis por mensagem'))
})

test('AC-03 Comportamento 5: Profundidade técnica e autoridade preservadas para dúvidas conceituais', () => {
  const prompt = buildSystemPrompt({
    agent: mockAgent,
    hasConfirmedCustomerName: true,
    customerRow: { name: 'Chef Lucas' },
    hasCatalogProducts: true
  })

  // 1. Preserva distinção detalhada entre Cobertura Fracionada e Chocolate Nobre
  assert.ok(prompt.includes('ORIENTAÇÃO TÉCNICA E APLICAÇÃO DE PRODUTOS (EX: NOBRE vs COBERTURA FRACIONADA)'))
  assert.ok(prompt.includes('Cobertura Fracionada (ex: Sicao Mais, Harald Top/Melken Cobertura)'))
  assert.ok(prompt.includes('Dispensa têmpera / choque térmico!'))
  assert.ok(prompt.includes('Chocolate Nobre (puro cacau / manteiga de cacau)'))
  assert.ok(prompt.includes('Exige têmpera (pré-cristalização)'))

  // 2. Preserva cálculo de rendimento de confeitaria (25-30 brigadeiros por lata)
  assert.ok(prompt.includes('RENDIMENTO DE RECEITAS E FESTAS (PEÇAS vs PESO DE EMBALAGEM)'))
  assert.ok(prompt.includes('1 lata de leite condensado tradicional (395g) rende em média 25 a 30 brigadeiros tradicionais'))

  // 3. Instrução para dúvidas técnicas fornecerem explicação detalhada
  assert.ok(prompt.includes('Quando o cliente pedir explicação técnica ou conceitual'))
  assert.ok(prompt.includes('forneça a orientação técnica completa, precisa e rica em valor'))
})

test('AC-03 Comportamento 6: Variabilidade de fechamento e eliminação de jargões robóticos repetitivos', () => {
  const prompt = buildSystemPrompt({
    agent: mockAgent,
    hasConfirmedCustomerName: true,
    customerRow: { name: 'Carla' },
    hasCatalogProducts: true
  })

  // 1. Proibição de repetição do mesmo jargão
  assert.ok(prompt.includes('ESTIMULO DE CONTINUIDADE E CROSS-SELL (NATURALIDADE E VARIABILIDADE ANTI-ROBÓTICA)'))
  assert.ok(prompt.includes('NUNCA repita o mesmo encerramento ou a mesma frase clichê em turnos consecutivos'))
  assert.ok(prompt.includes('é terminantemente proibido repetir "Posso te ajudar com mais algum produto ou ingrediente para as suas receitas?"'))

  // 2. Oferece repertório diversificado de fechamento natural
  assert.ok(prompt.includes('Quer aproveitar e ver mais algum item para a sua receita?'))
  assert.ok(prompt.includes('Precisa de mais alguma coisa hoje ou já quer que eu veja o resumo?'))
  assert.ok(prompt.includes('Falta mais algum ingrediente para a sua produção?'))
})

test('AC-03 Comportamento 7: Respeito imediato à recusa ou desinteresse comercial', () => {
  const prompt = buildSystemPrompt({
    agent: mockAgent,
    hasConfirmedCustomerName: true,
    customerRow: { name: 'Roberto' },
    hasCatalogProducts: true
  })

  // 1. Presença da regra de respeito imediato à recusa
  assert.ok(prompt.includes('RESPEITO IMEDIATO À RECUSA OU DESINTERESSE COMERCIAL (NÃO INSISTIR)'))

  // 2. Reconhecimento de respostas de recusa ("não", "só isso", "não quero mais nada")
  assert.ok(prompt.includes('Se o cliente responder negativamente a uma sugestão de cross-sell ou oferta adicional'))
  assert.ok(prompt.includes('não precisa", "só isso", "não quero mais nada", "por hoje é só"'))

  // 3. Proíbe insistência ou ofertas adicionais no mesmo turno
  assert.ok(prompt.includes('RESPEITE IMEDIATAMENTE a resposta do cliente com simpatia e elegância'))
  assert.ok(prompt.includes('NUNCA insista, NUNCA empurre outro produto e NUNCA repita ofertas comerciais nesse turno'))

  // 4. Transição fluida para fechamento se houver itens no carrinho
  assert.ok(prompt.includes('avance para a confirmação do pedido'))
  assert.ok(prompt.includes('Combinado! Vamos finalizar o seu pedido então?'))
})

test('AC-03 Comportamento 8: Não-regressão de catálogo, cálculo determinístico (R$/kg) e working memory', () => {
  const workingMemory: WorkingMemory = {
    activeProduct: { id: 'prod-sicao-1', name: 'Barra Sicao Mais 1.01kg' },
    activePrice: { unitPrice: 38.5, priceType: 'varejo' },
    activeQuantity: 2,
    activeCart: [
      {
        productId: 'prod-sicao-1',
        name: 'Barra Sicao Mais 1.01kg',
        quantity: 2,
        unitPrice: 38.5,
        subtotal: 77.0,
        isPriceConfirmed: true,
        priceType: 'varejo'
      }
    ],
    discoveredProducts: [
      { id: 'prod-sicao-1', name: 'Barra Sicao Mais 1.01kg', unitPrice: 38.5 },
      { id: 'prod-sicao-2', name: 'Barra Sicao Mais 2.05kg', unitPrice: 79.9 }
    ]
  }

  const prompt = buildSystemPrompt({
    agent: mockAgent,
    hasConfirmedCustomerName: true,
    customerRow: { name: 'Juliana' },
    workingMemory,
    hasCatalogProducts: true
  })

  // 1. Working memory formatada com fidelidade
  assert.ok(prompt.includes('[WORKING MEMORY]'))
  assert.ok(prompt.includes('Produto em Foco: Barra Sicao Mais 1.01kg'))
  assert.ok(prompt.includes('Total Parcial Confirmado: R$ 77.00'))
  assert.ok(prompt.includes('Opção 1: Barra Sicao Mais 1.01kg'))
  assert.ok(prompt.includes('Opção 2: Barra Sicao Mais 2.05kg'))

  // 2. Regras de custo-benefício determinístico (R$/kg) preservadas
  assert.ok(prompt.includes('COMPARAÇÃO DE CUSTO-BENEFÍCIO (QUAL COMPENSA MAIS?)'))
  assert.ok(prompt.includes('compare o valor proporcional por quilo (R$/kg)'))

  // 3. Regras de anti-alucinação de catálogo e substituição de marca preservadas
  assert.ok(prompt.includes('Não invente produtos, marcas, códigos ou preços'))
  assert.ok(prompt.includes('SUBSTITUIÇÃO INTELIGENTE DE MARCA'))

  // 4. Regras de transferência humana para reclamações e encerramento preservadas
  assert.ok(prompt.includes('FECHAMENTO DE ORÇAMENTO E TRANSFERÊNCIA OBRIGATÓRIA PARA ATENDENTE HUMANO'))
  assert.ok(prompt.includes('RECLAMAÇÕES, CLIENTES INSATISFEITOS OU NERVOSOS'))
})

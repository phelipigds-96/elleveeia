import crypto from 'node:crypto'

/**
 * Mock determinístico para a RPC save_enterprise_quote_atomic
 * Emula fielmente as regras de serialização, locks, validações financeiras e unicidade parcial do PostgreSQL.
 */
export function handleSaveEnterpriseQuoteAtomicMock(mockDb, args) {
  const {
    p_company_id,
    p_customer_id,
    p_conversation_id,
    p_existing_quote_id,
    p_expected_version,
    p_status = 'draft',
    p_total = 0,
    p_metadata = {},
    p_items = []
  } = args

  if (!p_company_id) {
    return { data: null, error: { message: 'EMPRESA_OBRIGATORIA: company_id é obrigatório para persistir orçamento.' } }
  }

  if (p_status && !['draft', 'pending_validation', 'ready', 'approved', 'rejected', 'expired'].includes(p_status)) {
    return { data: null, error: { message: `STATUS_INVALIDO: Status ${p_status} não é permitido para orçamentos comerciais.` } }
  }

  if (p_total === null || p_total === undefined || p_total < 0) {
    return { data: null, error: { message: `TOTAL_INVALIDO: Total do orçamento não pode ser negativo ou nulo.` } }
  }

  if (!p_items || !Array.isArray(p_items) || p_items.length === 0) {
    return { data: null, error: { message: 'ITENS_OBRIGATORIOS: O orçamento deve conter pelo menos um item.' } }
  }

  // Validação de conversa obrigatória para novos orçamentos comerciais
  if (!p_existing_quote_id && !p_conversation_id) {
    return {
      data: null,
      error: { message: 'CONVERSATION_ID_REQUIRED: conversation_id é obrigatório para criação de novos orçamentos comerciais.' }
    }
  }

  // Validação consistente de vínculos de cliente e conversa
  if (mockDb.customers && p_customer_id) {
    const cust = mockDb.customers.find(c => c.id === p_customer_id)
    if (cust && cust.company_id !== p_company_id) {
      return {
        data: null,
        error: { message: `ORCAMENTO_CROSS_COMPANY_FORBIDDEN: O cliente ${p_customer_id} pertence a outra empresa.` }
      }
    }
  }

  if (mockDb.conversations && p_conversation_id) {
    const conv = mockDb.conversations.find(c => c.id === p_conversation_id)
    if (conv) {
      if (conv.company_id !== p_company_id) {
        return {
          data: null,
          error: { message: `ORCAMENTO_CROSS_COMPANY_FORBIDDEN: A conversa ${p_conversation_id} pertence a outra empresa.` }
        }
      }
      if (p_customer_id && conv.customer_id && conv.customer_id !== p_customer_id) {
        return {
          data: null,
          error: { message: `ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN: O cliente ${p_customer_id} não corresponde ao cliente vinculado à conversa ${p_conversation_id}.` }
        }
      }
    }
  }

  // Validação financeira de cada item
  let sumSubtotals = 0
  for (const it of p_items) {
    if (!it.product_id) {
      return { data: null, error: { message: 'PRODUTO_INVALIDO: product_id é obrigatório em cada item.' } }
    }
    if (it.quantity === null || it.quantity === undefined || it.quantity <= 0) {
      return { data: null, error: { message: `FINANCEIRO_QUANTIDADE_INVALIDA: Quantidade deve ser maior que zero (recebido: ${it.quantity}).` } }
    }
    if (it.unit_price === null || it.unit_price === undefined || it.unit_price < 0) {
      return { data: null, error: { message: `FINANCEIRO_PRECO_INVALIDO: Preço unitário não pode ser negativo (recebido: ${it.unit_price}).` } }
    }
    if (it.subtotal === null || it.subtotal === undefined || it.subtotal < 0) {
      return { data: null, error: { message: `FINANCEIRO_SUBTOTAL_INVALIDO: Subtotal não pode ser negativo (recebido: ${it.subtotal}).` } }
    }
    const expectedSubtotal = Math.round(it.quantity * it.unit_price * 100) / 100
    if (Math.abs(it.subtotal - expectedSubtotal) > 0.001) {
      return {
        data: null,
        error: { message: `FINANCEIRO_SUBTOTAL_INCONSISTENTE: Subtotal ${it.subtotal} diverge do produto quantidade (${it.quantity}) x preço (${it.unit_price}) = ${expectedSubtotal}.` }
      }
    }
    if (mockDb.products) {
      const prod = mockDb.products.find(p => p.id === it.product_id)
      if (!prod) {
        return { data: null, error: { message: `PRODUTO_NOT_FOUND: Produto ${it.product_id} não localizado no banco de dados.` } }
      }
      if (prod.company_id && prod.company_id !== p_company_id) {
        return { data: null, error: { message: `ORCAMENTO_CROSS_COMPANY_FORBIDDEN: O produto ${it.product_id} pertence a outra empresa.` } }
      }
    }
    sumSubtotals += it.subtotal
  }

  if (Math.abs(sumSubtotals - p_total) > 0.001) {
    return {
      data: null,
      error: { message: `FINANCEIRO_TOTAL_INCONSISTENTE: Total informado (${p_total}) diverge da soma dos itens (${sumSubtotals}).` }
    }
  }

  let targetQuote = null

  if (p_existing_quote_id) {
    if (p_expected_version === null || p_expected_version === undefined) {
      return {
        data: null,
        error: { message: 'ORCAMENTO_VERSION_REQUIRED: Controle de versão (expectedVersion) é obrigatório para atualização de orçamento existente.' }
      }
    }

    targetQuote = mockDb.quotes.find(q => q.id === p_existing_quote_id && q.company_id === p_company_id)
    if (!targetQuote) {
      return {
        data: null,
        error: { message: `ORCAMENTO_NOT_FOUND_OR_FORBIDDEN: Orçamento ${p_existing_quote_id} não localizado ou status não modificável.` }
      }
    }

    if (targetQuote.metadata?.conversation_id) {
      if (!p_conversation_id) {
        return {
          data: null,
          error: { message: `ORCAMENTO_CONVERSATION_REQUIRED: O orçamento ${p_existing_quote_id} pertence a uma conversa e não pode ser atualizado sem conversation_id.` }
        }
      }
      if (p_conversation_id !== targetQuote.metadata.conversation_id) {
        return {
          data: null,
          error: { message: `ORCAMENTO_CROSS_CONVERSATION_FORBIDDEN: Orçamento pertence à conversa ${targetQuote.metadata.conversation_id}.` }
        }
      }
    }

    if (p_customer_id && targetQuote.customer_id && targetQuote.customer_id !== p_customer_id) {
      return {
        data: null,
        error: { message: `ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN: Orçamento pertence a outro cliente.` }
      }
    }

    const currentVer = targetQuote.metadata?.version || 1
    if (currentVer !== p_expected_version) {
      return {
        data: null,
        error: { message: `ORCAMENTO_CONCURRENCY_CONFLICT: Versão esperada ${p_expected_version} difere da versão atual ${currentVer}.` }
      }
    }
  } else if (p_conversation_id) {
    // Busca se já existe orçamento ativo para esta conversa
    const existingActive = mockDb.quotes.find(q =>
      q.company_id === p_company_id &&
      q.metadata?.conversation_id === p_conversation_id &&
      ['draft', 'pending_validation', 'ready'].includes(q.status)
    )

    if (existingActive) {
      if (p_customer_id && existingActive.customer_id && existingActive.customer_id !== p_customer_id) {
        return {
          data: null,
          error: { message: `ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN: Orçamento ativo da conversa pertence a outro cliente.` }
        }
      }

      if (p_expected_version === null || p_expected_version === undefined) {
        return {
          data: null,
          error: {
            message: `ORCAMENTO_ACTIVE_EXISTS: Já existe um orçamento ativo (${existingActive.id}) para a conversa ${p_conversation_id}. Informe existingQuoteId e expectedVersion para atualizar.`
          }
        }
      }

      const currentVer = existingActive.metadata?.version || 1
      if (currentVer !== p_expected_version) {
        return {
          data: null,
          error: { message: `ORCAMENTO_CONCURRENCY_CONFLICT: Versão esperada ${p_expected_version} difere da versão atual ${currentVer}.` }
        }
      }
      targetQuote = existingActive
    }
  }

  const version = targetQuote ? (targetQuote.metadata?.version || 1) + 1 : 1
  const quoteId = targetQuote ? targetQuote.id : crypto.randomUUID()
  const nowIso = new Date().toISOString()

  // Preservação e Sanitização de Metadados
  const cleanMetadata = targetQuote
    ? { ...(targetQuote.metadata || {}), ...p_metadata }
    : { ...p_metadata }

  delete cleanMetadata.version
  delete cleanMetadata.company_id
  delete cleanMetadata.customer_id
  delete cleanMetadata.id
  delete cleanMetadata.created_at
  delete cleanMetadata.updated_at
  delete cleanMetadata.status
  delete cleanMetadata.total

  if (p_conversation_id) {
    cleanMetadata.conversation_id = p_conversation_id
  } else if (targetQuote?.metadata?.conversation_id) {
    cleanMetadata.conversation_id = targetQuote.metadata.conversation_id
  } else {
    delete cleanMetadata.conversation_id
  }
  cleanMetadata.version = version

  if (targetQuote) {
    targetQuote.total = p_total
    targetQuote.status = p_status
    targetQuote.customer_id = p_customer_id || targetQuote.customer_id
    targetQuote.metadata = cleanMetadata
    targetQuote.updated_at = nowIso
    mockDb.quoteItems = mockDb.quoteItems.filter(qi => qi.quote_id !== targetQuote.id)
  } else {
    const newQuote = {
      id: quoteId,
      company_id: p_company_id,
      customer_id: p_customer_id || null,
      status: p_status,
      total: p_total,
      metadata: cleanMetadata,
      created_at: nowIso,
      updated_at: nowIso
    }
    mockDb.quotes.push(newQuote)
  }

  for (const it of p_items) {
    mockDb.quoteItems.push({
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      quote_id: quoteId,
      company_id: p_company_id,
      product_id: it.product_id,
      quantity: it.quantity,
      unit_price: it.unit_price,
      subtotal: it.subtotal,
      metadata: it.metadata || {},
      created_at: nowIso
    })
  }

  return {
    data: {
      id: quoteId,
      company_id: p_company_id,
      customer_id: p_customer_id || null,
      conversation_id: p_conversation_id || null,
      status: p_status,
      version,
      total: p_total,
      item_count: p_items.length
    },
    error: null
  }
}

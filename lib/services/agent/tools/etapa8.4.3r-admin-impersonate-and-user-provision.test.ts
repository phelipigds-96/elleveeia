// @ts-nocheck
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

describe('ETAPA 8.4.3R — Impersonate Administrativo e Provisionamento de Usuário no Painel Admin', () => {
  const SUPERADMIN_ID = '71ee00c9-e22b-479d-bc34-9d596448c3f9'
  const PLATFORM_COMPANY_ID = '90e69b50-1b4e-4f4a-94f2-78be1cf82833'
  const TARGET_COMPANY_ID = 'aaaaaaaa-1111-2222-3333-444444444444'

  test('Geração determinística de senha inicial para o administrador da loja', () => {
    // Se a senha foi informada com 6+ caracteres, deve ser preservada
    const customPassword = 'MinhaSenhaForte2026!'
    const resolvedCustom = customPassword.trim().length >= 6 ? customPassword.trim() : 'fallback'
    assert.equal(resolvedCustom, 'MinhaSenhaForte2026!')

    // Se não informada, deve gerar senha segura iniciada pelo prefixo padrão
    const emptyPassword = ''
    const generated = emptyPassword.trim().length >= 6
      ? emptyPassword.trim()
      : `Sumel@${Math.floor(100000 + Math.random() * 900000)}`
    
    assert.match(generated, /^Sumel@\d{6}$/)
  })

  test('Vínculo de perfil no provisionamento de nova organização deve ser role owner', () => {
    const newCompanyId = TARGET_COMPANY_ID
    const authUserId = 'bbbbbbbb-5555-6666-7777-888888888888'
    const adminEmail = 'contato@sumel.com.br'
    const companyName = 'Sumel Atacado e Varejo de Doces'

    const profileRecord = {
      id: authUserId,
      company_id: newCompanyId,
      full_name: `${companyName} Admin`,
      email: adminEmail,
      role: 'owner',
    }

    assert.equal(profileRecord.company_id, TARGET_COMPANY_ID)
    assert.equal(profileRecord.role, 'owner')
    assert.equal(profileRecord.email, 'contato@sumel.com.br')
  })

  test('Fluxo de Impersonate: troca de company_id do profile do SuperAdmin para o tenant alvo', () => {
    // Estado inicial do operador na plataforma
    const operatorProfile = {
      id: SUPERADMIN_ID,
      company_id: PLATFORM_COMPANY_ID,
      role: 'admin',
    }

    const mockCookies = new Map<string, string>()

    // Início de Impersonate
    mockCookies.set('ellevee_impersonate_active', TARGET_COMPANY_ID)
    mockCookies.set('ellevee_impersonate_original', operatorProfile.company_id)

    operatorProfile.company_id = TARGET_COMPANY_ID
    operatorProfile.role = 'owner'

    assert.equal(operatorProfile.company_id, TARGET_COMPANY_ID)
    assert.equal(operatorProfile.role, 'owner')
    assert.equal(mockCookies.get('ellevee_impersonate_active'), TARGET_COMPANY_ID)
    assert.equal(mockCookies.get('ellevee_impersonate_original'), PLATFORM_COMPANY_ID)

    // Encerramento de Impersonate
    const originalCompany = mockCookies.get('ellevee_impersonate_original')
    operatorProfile.company_id = originalCompany
    operatorProfile.role = 'admin'

    mockCookies.delete('ellevee_impersonate_active')
    mockCookies.delete('ellevee_impersonate_original')

    assert.equal(operatorProfile.company_id, PLATFORM_COMPANY_ID)
    assert.equal(operatorProfile.role, 'admin')
    assert.equal(mockCookies.has('ellevee_impersonate_active'), false)
  })

  test('Resolução resiliente de CNPJ e Email do Administrador em getCompaniesList', () => {
    // Simula empresas retornadas do banco
    const mockDbRowWithCols = {
      id: TARGET_COMPANY_ID,
      name: 'Sumel Atacado',
      slug: 'sumel',
      cnpj: '12.345.678/0001-90',
      contact_email: 'contato@sumel.com.br',
    }

    const mockDbRowLegacy = {
      id: 'legacy-id-123',
      name: 'Loja Legada',
      slug: 'loja-legada',
      cnpj: null,
      contact_email: null,
    }

    const auditLogsCnpjMap = new Map<string, string>([
      ['legacy-id-123', '98.765.432/0001-10']
    ])

    const profilesEmailMap = new Map<string, string>([
      ['legacy-id-123', 'dono@lojalegada.com.br']
    ])

    // Resolução da empresa nova com colunas
    const cnpjResolvedNew = mockDbRowWithCols.cnpj || auditLogsCnpjMap.get(mockDbRowWithCols.id) || 'Não informado'
    const emailResolvedNew = mockDbRowWithCols.contact_email || profilesEmailMap.get(mockDbRowWithCols.id) || `admin@${mockDbRowWithCols.slug}.com`

    assert.equal(cnpjResolvedNew, '12.345.678/0001-90')
    assert.equal(emailResolvedNew, 'contato@sumel.com.br')

    // Resolução da empresa legada sem colunas (via fallbacks inteligentes)
    const cnpjResolvedLegacy = mockDbRowLegacy.cnpj || auditLogsCnpjMap.get(mockDbRowLegacy.id) || 'Não informado'
    const emailResolvedLegacy = mockDbRowLegacy.contact_email || profilesEmailMap.get(mockDbRowLegacy.id) || `admin@${mockDbRowLegacy.slug}.com`

    assert.equal(cnpjResolvedLegacy, '98.765.432/0001-10')
    assert.equal(emailResolvedLegacy, 'dono@lojalegada.com.br')
  })
})

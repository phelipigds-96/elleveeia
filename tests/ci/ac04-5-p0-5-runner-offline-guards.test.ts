/**
 * tests/ci/ac04-5-p0-5-runner-offline-guards.test.ts
 * 
 * ELLEVEE IA — AC-04.5-P0.5 | TESTES OFFLINE DAS GUARDAS DE SEGURANÇA DO RUNNER
 * 
 * Valida cirurgicamente sem qualquer acesso a banco de dados remoto:
 * 1. Rejeição imediata de menção ao identificador de Produção (ipxhkwirzrigttpwzwbl).
 * 2. Rejeição de DATABASE_URL apontando para host não-Staging.
 * 3. Rejeição de STAGING_DB_HOST divergente do endpoint autorizado (db.dkjrpdhymtkgbknocijy.supabase.co).
 * 4. Bloqueio padrão de --keep-fixtures sem autorização explícita de diagnóstico.
 * 5. Rejeição de argumentos desconhecidos.
 * 6. Higienização de senhas e credenciais nas mensagens de erro.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = process.cwd()
const RUNNER_SCRIPT = path.join(ROOT, 'scripts', 'run-real-postgres-atomic-test.mjs')

describe('ELLEVEE IA — AC-04.5-P0.5 | GUARDAS DE SEGURANÇA E CONFIABILIDADE DO RUNNER', () => {

  test('Guarda 1: Aborta imediatamente se variável de ambiente contiver o ID de Produção', () => {
    const res = spawnSync(process.execPath, [RUNNER_SCRIPT], {
      env: {
        ...process.env,
        LEAK_SUSPECT_VAR: 'ipxhkwirzrigttpwzwbl',
      },
      encoding: 'utf8',
    })

    assert.equal(res.status, 1, 'Processo deve sair com código 1')
    assert.match(
      res.stderr + res.stdout,
      /CRITICAL SECURITY GUARD.*PRODUÇÃO.*ipxhkwirzrigttpwzwbl/,
      'Deve emitir alerta crítico de segurança de produção'
    )
  })

  test('Guarda 2: Rejeita connection string apontando para host de terceiros ou local', () => {
    const res = spawnSync(process.execPath, [RUNNER_SCRIPT], {
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://postgres:secretpassword@random-host.amazonaws.com:5432/postgres',
      },
      encoding: 'utf8',
    })

    assert.equal(res.status, 1, 'Processo deve sair com código 1')
    assert.match(
      res.stderr + res.stdout,
      /DESTINATION GUARD.*host não autorizado.*db\.dkjrpdhymtkgbknocijy\.supabase\.co/,
      'Deve rejeitar host não autorizado'
    )
    // Garante que a senha não foi vazada no log
    assert.doesNotMatch(
      res.stderr + res.stdout,
      /secretpassword/,
      'Senha jamais deve aparecer nos logs'
    )
  })

  test('Guarda 3: Rejeita STAGING_DB_HOST divergente de db.dkjrpdhymtkgbknocijy.supabase.co', () => {
    const res = spawnSync(process.execPath, [RUNNER_SCRIPT], {
      env: {
        ...process.env,
        STAGING_DB_HOST: 'fake-host.internal',
      },
      encoding: 'utf8',
    })

    assert.equal(res.status, 1, 'Processo deve sair com código 1')
    assert.match(
      res.stderr + res.stdout,
      /DESTINATION GUARD.*fake-host\.internal.*não corresponde ao endpoint de Staging autorizado/,
      'Deve rejeitar host falsificado'
    )
  })

  test('Guarda 4: Bloqueia --keep-fixtures sem autorização explícita de diagnóstico', () => {
    const res = spawnSync(process.execPath, [RUNNER_SCRIPT, '--keep-fixtures'], {
      env: {
        ...process.env,
        ALLOW_DIAGNOSTIC_FIXTURES: '',
      },
      encoding: 'utf8',
    })

    assert.equal(res.status, 1, 'Processo deve sair com código 1')
    assert.match(
      res.stderr + res.stdout,
      /A opção --keep-fixtures está desabilitada por padrão[\s\S]*--allow-diagnostic-fixtures/,
      'Deve bloquear --keep-fixtures desacompanhado de autorização'
    )
  })

  test('Guarda 5: Rejeita argumentos de linha de comando desconhecidos', () => {
    const res = spawnSync(process.execPath, [RUNNER_SCRIPT, '--opcao-invalida-teste'], {
      env: process.env,
      encoding: 'utf8',
    })

    assert.equal(res.status, 1, 'Processo deve sair com código 1')
    assert.match(
      res.stderr + res.stdout,
      /Argumento não reconhecido: --opcao-invalida-teste/,
      'Deve rejeitar flags desconhecidas'
    )
  })

  test('Guarda 6: Sanitização de senhas ao logar erros de conexão', () => {
    const res = spawnSync(process.execPath, [RUNNER_SCRIPT], {
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://postgres:SuperSecret123Pass@malicious-db.com:5432/postgres',
      },
      encoding: 'utf8',
    })

    const combinedOutput = res.stderr + res.stdout
    assert.doesNotMatch(combinedOutput, /SuperSecret123Pass/, 'Senha deve ser redigida')
    assert.match(combinedOutput, /DESTINATION GUARD/, 'Deve ter disparado a guarda de destino')
  })
})

export const DEFAULT_LLM_TIMEOUT_MS = 20_000

export class LLMTimeoutError extends Error {
  readonly code = 'LLM_TIMEOUT'
  readonly provider: string
  readonly timeoutMs: number

  constructor(provider: string, timeoutMs: number, message?: string) {
    super(message || `Timeout de ${timeoutMs}ms excedido na chamada ao provedor ${provider}.`)
    this.name = 'LLMTimeoutError'
    this.provider = provider
    this.timeoutMs = timeoutMs
  }
}

export async function executeWithLLMTimeout<T>(
  provider: string,
  fn: (signal: AbortSignal) => Promise<T>,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<T> {
  const timeoutMs =
    typeof options?.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_LLM_TIMEOUT_MS

  const controller = new AbortController()
  let timedOut = false

  const onExternalAbort = () => {
    controller.abort(options?.signal?.reason)
  }

  if (options?.signal) {
    if (options.signal.aborted) {
      controller.abort(options.signal.reason)
      throw new LLMTimeoutError(provider, timeoutMs, `Chamada ao provedor ${provider} abortada antes de iniciar.`)
    }
    options.signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      const err = new LLMTimeoutError(provider, timeoutMs)
      controller.abort(err)
      reject(err)
    }, timeoutMs)
  })

  try {
    const callPromise = Promise.resolve().then(() => fn(controller.signal))
    // Prevent UnhandledPromiseRejection if an aborted transport settles slightly after Promise.race rejects.
    callPromise.catch(() => {})
    return await Promise.race([callPromise, timeoutPromise])
  } catch (err: any) {
    if (timedOut || controller.signal.aborted || err?.name === 'AbortError') {
      if (err instanceof LLMTimeoutError) throw err
      throw new LLMTimeoutError(provider, timeoutMs, err?.message)
    }
    throw err
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (options?.signal) {
      options.signal.removeEventListener('abort', onExternalAbort)
    }
  }
}

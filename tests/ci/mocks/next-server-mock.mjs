import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
const nextServer = req('next/server')

export const {
  NextRequest,
  NextResponse,
  ImageResponse,
  userAgentFromString,
  userAgent,
  URLPattern,
  after,
  connection,
} = nextServer

export default nextServer

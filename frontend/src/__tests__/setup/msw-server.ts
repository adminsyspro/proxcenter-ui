import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

// Seed per test with server.use(...). Unhandled requests must error loudly so
// a missing fixture fails the test instead of silently returning empty data.
export const server = setupServer()
export { http, HttpResponse }

import app from './dist/server/server.js'

function toNativeResponse(value) {
  if (value instanceof Response) {
    return new Response(value.body, {
      status: value.status,
      statusText: value.statusText,
      headers: value.headers,
    })
  }

  if (value && typeof value === 'object') {
    const maybe = value
    if (
      typeof maybe.status === 'number' ||
      maybe.body !== undefined ||
      maybe.headers !== undefined
    ) {
      return new Response(maybe.body ?? null, {
        status: maybe.status ?? 200,
        statusText: maybe.statusText,
        headers: maybe.headers,
      })
    }
  }

  return new Response('Internal Server Error', { status: 500 })
}

export default {
  async fetch(request, env, ctx) {
    const handler = app?.fetch
    if (typeof handler !== 'function') {
      return new Response('Server handler is not available', { status: 500 })
    }

    try {
      const result = await handler(request, env, ctx)
      return toNativeResponse(result)
    } catch (error) {
      console.error(error)
      return new Response('Internal Server Error', { status: 500 })
    }
  },
}

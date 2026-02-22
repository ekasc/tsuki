import type { ApiErrorPayload } from '#/lib/contracts'

import { HttpError } from '../errors'

export function jsonResponse<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init)
}

export function noContentResponse(): Response {
  return new Response(null, { status: 204 })
}

export function toApiErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse<ApiErrorPayload>(
      {
        error: error.message,
      },
      { status: error.status },
    )
  }

  const message =
    error instanceof Error ? error.message : 'Internal server error'

  return jsonResponse<ApiErrorPayload>(
    {
      error: message,
    },
    { status: 500 },
  )
}

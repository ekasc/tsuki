import { z } from 'zod'

export const uploadRequestSchema = z.object({
  seriesTitle: z.string().trim().max(120).optional(),
  chapterTitle: z.string().trim().max(120).optional(),
  chapterNumber: z.number().int().min(1).max(10_000).optional(),
})

export const progressPayloadSchema = z.object({
  chapterId: z.string().min(1),
  pageIndex: z.number().int().min(0),
  stepIndex: z.number().int().min(0),
  mode: z.enum(['single', 'double', 'scroll']),
  direction: z.enum(['ltr', 'rtl']),
  zoomPreset: z.enum(['fit-width', 'fit-height', 'actual']),
})

export const pageOverridePayloadSchema = z.object({
  userOverrideSpread: z.boolean().nullable().optional(),
  splitSpread: z.boolean().nullable().optional(),
})

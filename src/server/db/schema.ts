import { relations } from 'drizzle-orm'
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const series = sqliteTable('series', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  source: text('source').notNull(),
  coverPageId: text('cover_page_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const chapters = sqliteTable(
  'chapters',
  {
    id: text('id').primaryKey(),
    seriesId: text('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    chapterNumber: integer('chapter_number').notNull(),
    sortIndex: integer('sort_index').notNull(),
    pageCount: integer('page_count').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('chapters_series_sort_index_idx').on(
      table.seriesId,
      table.sortIndex,
    ),
  ],
)

export const pages = sqliteTable(
  'pages',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    pageIndex: integer('page_index').notNull(),
    imagePath: text('image_path').notNull(),
    thumbnailPath: text('thumbnail_path').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    aspect: real('aspect').notNull(),
    autoIsSpread: integer('auto_is_spread', { mode: 'boolean' })
      .notNull()
      .default(false),
    userOverrideSpread: integer('user_override_spread', {
      mode: 'boolean',
    }),
    splitSpread: integer('split_spread', {
      mode: 'boolean',
    }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('pages_chapter_page_index_idx').on(
      table.chapterId,
      table.pageIndex,
    ),
  ],
)

export const readingProgress = sqliteTable(
  'reading_progress',
  {
    profileId: text('profile_id').notNull().default('local'),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    pageIndex: integer('page_index').notNull().default(0),
    stepIndex: integer('step_index').notNull().default(0),
    mode: text('mode').notNull().default('single'),
    direction: text('direction').notNull().default('rtl'),
    zoomPreset: text('zoom_preset').notNull().default('fit-height'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.chapterId] })],
)

export const seriesRelations = relations(series, ({ many }) => ({
  chapters: many(chapters),
}))

export const chapterRelations = relations(chapters, ({ one, many }) => ({
  series: one(series, {
    fields: [chapters.seriesId],
    references: [series.id],
  }),
  pages: many(pages),
  progress: many(readingProgress),
}))

export const pageRelations = relations(pages, ({ one }) => ({
  chapter: one(chapters, {
    fields: [pages.chapterId],
    references: [chapters.id],
  }),
}))

export const progressRelations = relations(readingProgress, ({ one }) => ({
  chapter: one(chapters, {
    fields: [readingProgress.chapterId],
    references: [chapters.id],
  }),
}))

export type SeriesRow = typeof series.$inferSelect
export type ChapterRow = typeof chapters.$inferSelect
export type PageRow = typeof pages.$inferSelect
export type ReadingProgressRow = typeof readingProgress.$inferSelect

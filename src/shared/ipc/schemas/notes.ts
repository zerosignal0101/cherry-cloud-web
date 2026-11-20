import * as z from 'zod'

import { NOTES_ROOT_PATH } from '@shared/types/note'

import { defineRoute } from '../define'

/**
 * Notes filesystem contract.
 *
 * All paths are logical: `NOTES_ROOT_PATH` or a descendant. The server maps them
 * to `DATA_DIR/notes` and never returns a host path. Backslashes, NUL bytes,
 * empty segments and `..` are rejected before the storage layer sees them.
 */
export const NotesPathSchema = z
  .string()
  .min(1)
  .max(1000)
  .refine((value) => !value.includes('\0') && !value.includes('\\'), {
    message: 'Notes paths must use forward slashes and cannot contain NUL'
  })
  .refine((value) => value === NOTES_ROOT_PATH || value.startsWith(`${NOTES_ROOT_PATH}/`), {
    message: `Notes paths must start with ${NOTES_ROOT_PATH}`
  })
  .refine(
    (value) => {
      const relative = value === NOTES_ROOT_PATH ? '' : value.slice(NOTES_ROOT_PATH.length + 1)
      if (!relative) return true
      const segments = relative.split('/')
      return segments.length <= 32 && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
    },
    {
      message: 'Notes paths cannot contain empty, "." or ".." segments'
    }
  )

export const NotesEntrySchema = z.strictObject({
  path: NotesPathSchema,
  name: z.string().min(1),
  kind: z.enum(['file', 'directory']),
  size: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})

export const NotesSearchMatchSchema = z.strictObject({
  lineNumber: z.number().int().positive(),
  lineContent: z.string(),
  matchStart: z.number().int().nonnegative(),
  matchEnd: z.number().int().nonnegative(),
  context: z.string()
})

export const NotesSearchResultSchema = z.strictObject({
  path: NotesPathSchema,
  name: z.string().min(1),
  treePath: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  matchType: z.enum(['filename', 'content', 'both']),
  matches: z.array(NotesSearchMatchSchema),
  score: z.number()
})

export type NotesEntry = z.infer<typeof NotesEntrySchema>
export type NotesSearchMatch = z.infer<typeof NotesSearchMatchSchema>
export type NotesSearchResult = z.infer<typeof NotesSearchResultSchema>

export const notesRequestSchemas = {
  'notes.validate_directory': defineRoute({
    input: z.strictObject({ path: NotesPathSchema }),
    output: z.boolean()
  }),
  'notes.check_name': defineRoute({
    input: z.strictObject({
      parentPath: NotesPathSchema,
      name: z.string().trim().min(1).max(255),
      isFile: z.boolean()
    }),
    output: z.strictObject({ safeName: z.string().min(1), exists: z.boolean() })
  }),
  'notes.mkdir': defineRoute({
    input: z.strictObject({ path: NotesPathSchema }),
    output: z.void()
  }),
  'notes.write': defineRoute({
    input: z.strictObject({
      path: NotesPathSchema,
      content: z.string().max(8 * 1024 * 1024)
    }),
    output: z.void()
  }),
  'notes.read': defineRoute({
    input: z.strictObject({ path: NotesPathSchema }),
    output: z.strictObject({ content: z.string(), updatedAt: z.number().int().nonnegative() })
  }),
  'notes.delete': defineRoute({
    input: z.strictObject({ path: NotesPathSchema, recursive: z.boolean() }),
    output: z.void()
  }),
  'notes.rename': defineRoute({
    input: z.strictObject({ path: NotesPathSchema, newName: z.string().trim().min(1).max(255) }),
    output: z.strictObject({ path: NotesPathSchema, name: z.string().min(1) })
  }),
  'notes.move': defineRoute({
    input: z.strictObject({ fromPath: NotesPathSchema, toPath: NotesPathSchema }),
    output: z.strictObject({ path: NotesPathSchema })
  }),
  'notes.list': defineRoute({
    input: z.strictObject({ path: NotesPathSchema, recursive: z.boolean().optional() }),
    output: z.strictObject({ entries: z.array(NotesEntrySchema) })
  }),
  'notes.search': defineRoute({
    input: z.strictObject({
      keyword: z.string().min(1).max(500),
      caseSensitive: z.boolean().optional(),
      useRegex: z.boolean().optional(),
      maxResults: z.number().int().positive().max(200).optional(),
      maxFileSize: z
        .number()
        .int()
        .positive()
        .max(10 * 1024 * 1024)
        .optional(),
      maxMatchesPerFile: z.number().int().positive().max(200).optional(),
      contextLength: z.number().int().nonnegative().max(500).optional()
    }),
    output: z.strictObject({ results: z.array(NotesSearchResultSchema) })
  })
} as const

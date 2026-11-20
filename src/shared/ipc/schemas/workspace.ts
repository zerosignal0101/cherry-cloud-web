import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Server-owned workspace filesystem.
 *
 * Every path here is relative to the workspace root: the renderer never sees an
 * absolute host path and cannot ask the server to leave the sandbox. The service
 * additionally rejects `..`, empty segments, backslashes, NUL bytes and symlinked
 * components.
 */
export const WorkspaceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)

export const WorkspaceRelativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !value.includes('\0') && !value.includes('\\'), {
    message: 'Workspace paths must use forward slashes and cannot contain NUL'
  })

export const WorkspaceSummarySchema = z.strictObject({
  id: WorkspaceIdSchema,
  name: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})

export const WorkspaceEntrySchema = z.strictObject({
  /** Path relative to the workspace root, using forward slashes. */
  path: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['file', 'directory']),
  size: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})

export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>
export type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>

export const workspaceRequestSchemas = {
  'workspace.list': defineRoute({
    input: z.strictObject({}),
    output: z.strictObject({ workspaces: z.array(WorkspaceSummarySchema) })
  }),
  'workspace.create': defineRoute({
    input: z.strictObject({ name: z.string().trim().min(1).max(80) }),
    output: WorkspaceSummarySchema
  }),
  'workspace.delete': defineRoute({
    input: z.strictObject({ id: WorkspaceIdSchema }),
    output: z.void()
  }),
  'workspace.list_files': defineRoute({
    input: z.strictObject({
      id: WorkspaceIdSchema,
      path: WorkspaceRelativePathSchema.optional()
    }),
    output: z.strictObject({ entries: z.array(WorkspaceEntrySchema) })
  }),
  'workspace.read_file': defineRoute({
    input: z.strictObject({ id: WorkspaceIdSchema, path: WorkspaceRelativePathSchema }),
    output: z.strictObject({
      content: z.string(),
      size: z.number().int().nonnegative(),
      updatedAt: z.number().int().nonnegative()
    })
  }),
  'workspace.write_file': defineRoute({
    input: z.strictObject({
      id: WorkspaceIdSchema,
      path: WorkspaceRelativePathSchema,
      content: z.string().max(1_000_000)
    }),
    output: z.strictObject({
      size: z.number().int().nonnegative(),
      updatedAt: z.number().int().nonnegative()
    })
  }),
  'workspace.delete_file': defineRoute({
    input: z.strictObject({ id: WorkspaceIdSchema, path: WorkspaceRelativePathSchema }),
    output: z.void()
  })
} as const

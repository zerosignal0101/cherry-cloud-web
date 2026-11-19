/**
 * Type-only stand-ins for desktop-only modules that shared schemas still reference.
 * The selection assistant is removed from the Web build; only its payload type survives here.
 */
declare module 'selection-hook' {
  export type TextSelectionData = any
}

/** Agent runtime is not part of the first Web release; Agents ship in a later milestone. */
declare module '@cherrystudio/agent-runtime' {
  export type ContextCategoryKey = string
  export type ThreadContextUsage = any
  export type OperationResult<T = unknown> = any
  export const runtimeId: string
}

/**
 * Type-only stand-ins for desktop-only modules that shared schemas still reference.
 * The selection assistant is removed from the Web build; only its payload type survives here.
 */
declare module 'selection-hook' {
  export type TextSelectionData = any
}

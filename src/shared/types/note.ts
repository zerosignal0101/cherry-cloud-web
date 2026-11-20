/**
 * Logical notes root exposed to the renderer.
 *
 * The server maps this prefix to `DATA_DIR/notes`; no host path ever crosses the
 * transport. Keeping the constant in the shared type module (which has no zod
 * dependency) lets the renderer and the server agree on the namespace.
 */
export const NOTES_ROOT_PATH = '/notes'

/**
 * @interface
 * @description 笔记树节点接口
 *
 * Cross-process: the main process builds `NotesTreeNode[]` from the filesystem
 * (knowledge directory source) and the renderer renders/manages the tree. This
 * is the UI tree shape — distinct from the DB-backed `Note` entity in
 * `@shared/data/types/note`.
 */
export interface NotesTreeNode {
  id: string
  name: string // 不包含扩展名
  type: 'folder' | 'file' | 'hint'
  treePath: string // 相对路径
  externalPath: string // 绝对路径
  children?: NotesTreeNode[]
  isStarred?: boolean
  expanded?: boolean
  createdAt: string
  updatedAt: string
}

import { mkdirSync } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'

export const SKILLS_ROOT_PATH = '/skills'

export class SkillPathError extends Error {
  override readonly name = 'SkillPathError' as const
}

/**
 * Server-side view of the installed skill library.
 *
 * Skills live under `DATA_DIR/Skills/<folder>`; the renderer addresses the same
 * tree as `/skills/<folder>`. The SkillDetails browser uses the generic
 * `file.tree.*` / `file.edit.*` primitives, so this class is the translation
 * boundary between that logical namespace and the host path.
 */
export class SkillStorage {
  private readonly root: string
  private readonly realRootPromise: Promise<string>

  constructor(root: string) {
    this.root = path.resolve(root)
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    this.realRootPromise = realpath(this.root)
  }

  get logicalRoot(): string {
    return SKILLS_ROOT_PATH
  }

  get physicalRoot(): string {
    return this.root
  }

  isNamespace(value: string): boolean {
    return value === SKILLS_ROOT_PATH || value.startsWith(`${SKILLS_ROOT_PATH}/`)
  }

  physicalPath(logicalPath: string): string {
    const relative = this.normalize(logicalPath)
    const target = path.resolve(this.root, ...(relative ? relative.split('/') : []))
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) {
      throw new SkillPathError('Skill path escapes its root')
    }
    return target
  }

  logicalPath(physicalPath: string): string {
    const relative = path.relative(this.root, physicalPath)
    if (!relative) return SKILLS_ROOT_PATH
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new SkillPathError('Skill path is outside its root')
    }
    return `${SKILLS_ROOT_PATH}/${relative.split(path.sep).join('/')}`
  }

  async assertReadable(logicalPath: string): Promise<void> {
    const target = this.physicalPath(logicalPath)
    const realRoot = await this.realRootPromise
    const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') throw new SkillPathError(`Skill path does not exist: ${logicalPath}`)
      throw error
    })
    if (info.isSymbolicLink()) throw new SkillPathError('Skill path contains a symbolic link')
    const real = await realpath(target)
    if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
      throw new SkillPathError('Skill path resolves outside its root')
    }
  }

  private normalize(value: string): string {
    if (value.includes('\0') || value.includes('\\')) throw new SkillPathError('Invalid skill path')
    const normalized = value.length > 1 ? value.replace(/\/+$/, '') : value
    if (!this.isNamespace(normalized)) {
      throw new SkillPathError(`Skill paths must start with ${SKILLS_ROOT_PATH}`)
    }
    const relative = normalized === SKILLS_ROOT_PATH ? '' : normalized.slice(SKILLS_ROOT_PATH.length + 1)
    for (const segment of relative ? relative.split('/') : []) {
      if (!segment || segment === '.' || segment === '..') throw new SkillPathError('Invalid skill path')
    }
    return relative
  }
}

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

const installFromZip = vi.fn()
const pickBrowserFiles = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc/webFile', () => ({ pickBrowserFiles }))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string | number>) => {
      if (!opts) return key
      if ('name' in opts) return `${key}:${opts.name}`
      if ('count' in opts) return `${key}:${opts.count}`
      if ('success' in opts && 'total' in opts && 'failed' in opts) {
        return `${key}:${opts.success}:${opts.total}:${opts.failed}`
      }
      return key
    }
  })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useSkillInstall: () => ({ installFromZip })
}))

import { toast } from '@renderer/services/toast'

import { ImportSkillDialog } from '../ImportSkillDialog'

const zip = (name: string) => new File(['zip'], name, { type: 'application/zip' })

const createDropData = (files: File[]) => ({
  dataTransfer: {
    files,
    items: files.map((file) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file
    })),
    types: ['Files']
  }
})

const dropSkillFiles = async (files: File[]) => {
  const dropzone = screen.getByText('library.import_skill_dialog.local.drop_hint').closest('button')
  expect(dropzone).toBeInTheDocument()

  await act(async () => {
    fireEvent.drop(dropzone!, createDropData(files))
  })
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  pickBrowserFiles.mockReset()
  pickBrowserFiles.mockResolvedValue([zip('broken.zip')])
})

afterEach(cleanup)

describe('ImportSkillDialog', () => {
  it('closes when clicking the overlay while idle', () => {
    const onOpenChange = vi.fn()

    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.click(overlay!)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the dialog open when clicking the overlay while installing', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    let resolveInstall: (value: unknown) => void = () => {}
    installFromZip.mockReturnValue(new Promise((resolve) => (resolveInstall = resolve)))

    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: 'settings.skills.installFromZip' }))
    await waitFor(() => expect(installFromZip).toHaveBeenCalledWith(expect.objectContaining({ name: 'broken.zip' })))

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.click(overlay!)

    expect(onOpenChange).not.toHaveBeenCalled()

    resolveInstall(undefined)
    await waitFor(() => expect(screen.getByRole('button', { name: 'settings.skills.installFromZip' })).toBeEnabled())
  })

  it('展示服务端返回的本地化 ZIP 原因', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const originalError = '未找到可安装的技能。技能 ZIP 压缩包必须在根目录或某个子目录里包含 SKILL.md。'
    installFromZip.mockRejectedValue(new Error(originalError))

    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: 'settings.skills.installFromZip' }))

    expect(await screen.findByText(`settings.skills.installFailed:broken.zip: ${originalError}`)).toBeInTheDocument()
    expect(screen.getByText(`settings.skills.installFailed:broken.zip: ${originalError}`)).toHaveAttribute(
      'title',
      `settings.skills.installFailed:broken.zip: ${originalError}`
    )
    expect(screen.getByTestId('skill-import-results')).not.toHaveTextContent(
      /skill-install|zip[-_]install[-_]|[\\/]tmp[\\/]|[\\/]Temp[\\/]/
    )
    expect(screen.queryByText('settings.skills.batchInstallPartialFailed:0:1:1')).not.toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closes after a successful install while keeping the marketplace success toast', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    installFromZip.mockResolvedValue({ id: 'agentic-engineering', name: 'agentic-engineering' })

    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: 'settings.skills.installFromZip' }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('settings.skills.installSuccess:agentic-engineering')
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByText('settings.skills.installSuccess:agentic-engineering')).not.toBeInTheDocument()
  })

  it('closes only after every selected ZIP installs successfully', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const one = zip('one.zip')
    const two = zip('two.zip')
    pickBrowserFiles.mockResolvedValue([one, two])
    let resolveSecondInstall: (skill: { id: string; name: string }) => void = () => {}
    installFromZip
      .mockResolvedValueOnce({ id: 'skill-one', name: 'Skill One' })
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecondInstall = resolve)))

    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: 'settings.skills.installFromZip' }))

    await waitFor(() => expect(installFromZip).toHaveBeenCalledTimes(2))
    expect(onOpenChange).not.toHaveBeenCalled()

    resolveSecondInstall({ id: 'skill-two', name: 'Skill Two' })

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(pickBrowserFiles).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }))
    expect(installFromZip).toHaveBeenNthCalledWith(1, one)
    expect(installFromZip).toHaveBeenNthCalledWith(2, two)
    expect(toast.success).toHaveBeenCalledWith('settings.skills.batchInstallComplete:2')
    expect(screen.queryByText('settings.skills.batchInstallComplete:2')).not.toBeInTheDocument()
  })

  it('installs dropped ZIP files through the dropzone', async () => {
    const files = [zip('one.zip'), zip('two.zip')]
    installFromZip
      .mockResolvedValueOnce({ id: 'skill-one', name: 'Skill One' })
      .mockResolvedValueOnce({ id: 'skill-two', name: 'Skill Two' })

    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)

    await dropSkillFiles(files)

    await waitFor(() => expect(installFromZip).toHaveBeenCalledTimes(2))
    expect(installFromZip).toHaveBeenNthCalledWith(1, files[0])
    expect(installFromZip).toHaveBeenNthCalledWith(2, files[1])
    expect(pickBrowserFiles).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('settings.skills.batchInstallComplete:2')
  })

  it('keeps per-file errors for invalid dropped files mixed with ZIPs', async () => {
    const onOpenChange = vi.fn()
    const files = [
      zip('plugin.zip'),
      new File(['readme'], 'readme.txt', { type: 'text/plain' }),
      new File(['dir'], 'skill-dir', { type: '' })
    ]
    installFromZip.mockResolvedValueOnce({ id: 'skill-zip', name: 'Zip Skill' })

    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)

    await dropSkillFiles(files)

    await waitFor(() => expect(installFromZip).toHaveBeenCalledWith(files[0]))
    expect(installFromZip).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('Zip Skill')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('readme.txt')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('skill-dir')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('settings.skills.invalidFormat')
    expect(screen.getByText('settings.skills.batchInstallPartialFailed:1:3:2')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('shows invalid-only dropped files once per item without a duplicate status banner', async () => {
    const files = [
      new File(['one'], 'one.txt', { type: 'text/plain' }),
      new File(['two'], 'two.txt', { type: 'text/plain' }),
      new File(['three'], 'three.txt', { type: 'text/plain' })
    ]

    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)

    await dropSkillFiles(files)

    await waitFor(() => expect(screen.getByTestId('skill-import-results')).toHaveTextContent('one.txt'))
    expect(installFromZip).not.toHaveBeenCalled()
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('two.txt')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('three.txt')
    expect(screen.getAllByText('settings.skills.invalidFormat')).toHaveLength(3)
    expect(screen.queryByText('settings.skills.batchInstallPartialFailed:0:3:3')).not.toBeInTheDocument()
  })
})

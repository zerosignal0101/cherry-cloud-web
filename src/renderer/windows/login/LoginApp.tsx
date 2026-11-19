import { useState } from 'react'

/**
 * Password gate for the single-user deployment.
 *
 * Deliberately independent of the application providers: the request that
 * renders this page has no session, so preference/IPC hooks would trigger a
 * second redirect to `/login` and never settle. The client only needs the two
 * auth endpoints, which are public.
 */

/** Same rule as the server: only a same-origin absolute path may be resumed. */
function nextPath(): string {
  const raw = new URLSearchParams(window.location.search).get('next')
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  if (raw.includes('\n') || raw.includes('\r')) return '/'
  return raw
}

export default function LoginApp(): React.ReactElement {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(undefined)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password })
      })
      if (response.ok) {
        // A full navigation re-runs the bootstrap, which now sees the session.
        window.location.replace(nextPath())
        return
      }
      setError(response.status === 429 ? '尝试次数过多，请稍后再试' : '密码错误')
      setPassword('')
    } catch {
      setError('网络错误，请重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6 py-8 text-foreground">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border-[0.5px] border-border bg-card p-7 shadow-sm">
        <h1 className="m-0 font-semibold text-lg">Cherry Studio</h1>
        <p className="mt-1 mb-5 text-muted-foreground text-sm">请输入访问密码</p>
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-lg bg-error/10 px-3 py-2 text-error text-sm dark:bg-error/20">
            {error}
          </p>
        )}
        <label htmlFor="password" className="mb-1.5 block text-muted-foreground text-sm">
          密码
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-[10px] border-[0.5px] border-border bg-transparent px-3 py-2.5 text-[15px] outline-none focus:border-ring"
        />
        <button
          type="submit"
          disabled={pending}
          className="mt-4 w-full rounded-[10px] bg-primary px-3 py-2.5 font-medium text-[15px] text-primary-foreground disabled:cursor-progress disabled:opacity-60">
          {pending ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}

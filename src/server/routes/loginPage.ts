/**
 * Server-rendered login page.
 *
 * Deliberately outside the React app: authentication has to work before the SPA
 * bundle (and its data layer) is reachable, and M5 replaces this page with the
 * real login view once routing exists. Inline CSS/JS keeps it to one request.
 */

export interface LoginPageOptions {
  /** Post-login path; only same-origin absolute paths are honoured. */
  next: string
  error?: string
}

/** `next` may only point inside this app: a single leading slash, never a protocol-relative URL. */
export function sanitizeNext(raw: string | undefined): string {
  if (!raw) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  if (raw.includes('\n') || raw.includes('\r')) return '/'
  return raw
}

export function renderLoginPage({ next, error }: LoginPageOptions): string {
  const nextValue = escapeHtml(next)
  const errorBlock = error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Cherry Studio</title>
<style>
  :root { color-scheme: light dark; --bg:#f7f7f8; --card:#fff; --text:#18181b; --muted:#71717a; --border:#e4e4e7; --accent:#18181b; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#111113; --card:#1c1c1f; --text:#f4f4f5; --muted:#a1a1aa; --border:#2e2e33; --accent:#f4f4f5; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:var(--bg); color:var(--text);
         font:15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; padding:24px; }
  form { width:100%; max-width:340px; background:var(--card); border:1px solid var(--border); border-radius:16px; padding:28px 24px; }
  h1 { margin:0 0 4px; font-size:18px; font-weight:600; }
  p.hint { margin:0 0 20px; color:var(--muted); font-size:13px; }
  label { display:block; font-size:13px; color:var(--muted); margin-bottom:6px; }
  input[type=password] { width:100%; padding:10px 12px; font-size:15px; color:var(--text); background:transparent;
                          border:1px solid var(--border); border-radius:10px; outline:none; }
  input[type=password]:focus { border-color:var(--accent); }
  button { width:100%; margin-top:16px; padding:10px 12px; font-size:15px; font-weight:500; cursor:pointer;
           color:var(--bg); background:var(--accent); border:0; border-radius:10px; }
  button:disabled { opacity:.6; cursor:progress; }
  .error { margin:0 0 16px; padding:8px 12px; font-size:13px; color:#dc2626; background:rgba(220,38,38,.08); border-radius:8px; }
</style>
</head>
<body>
<form id="login">
  <h1>Cherry Studio</h1>
  <p class="hint">请输入访问密码</p>
  ${errorBlock}
  <label for="password">密码</label>
  <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
  <input name="next" type="hidden" value="${nextValue}">
  <button type="submit">登录</button>
</form>
<script>
  const form = document.getElementById('login')
  const password = document.getElementById('password')
  const next = form.querySelector('input[name=next]').value
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = form.querySelector('button')
    button.disabled = true
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password: password.value })
      })
      if (response.ok) {
        window.location.replace(next || '/')
        return
      }
      const message = response.status === 429 ? '尝试次数过多，请稍后再试' : '密码错误'
      showError(message)
    } catch {
      showError('网络错误，请重试')
    } finally {
      button.disabled = false
    }
  })
  function showError(message) {
    let node = document.querySelector('.error')
    if (!node) {
      node = document.createElement('p')
      node.className = 'error'
      node.setAttribute('role', 'alert')
      form.querySelector('p.hint').after(node)
    }
    node.textContent = message
    password.select()
  }
</script>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

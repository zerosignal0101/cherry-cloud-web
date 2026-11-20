/**
 * The guest half of the iframe bridge.
 *
 * It is inlined into every local app's HTML by the asset route, so an app needs no
 * build step and no extra script tag. The only transport is `postMessage` to the
 * host pane; every reply is a `BridgeResult` value, matching the desktop bridge's
 * frozen error names.
 */
export function buildMiniAppBridgeScript(appId: string): string {
  return `(() => {
  if (window.cherry && window.cherry.__bridgeVersion) return;
  const APP_ID = ${JSON.stringify(appId)};
  const VERSION = 'web-1';
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();

  function invoke(method, params, callId) {
    return new Promise((resolve, reject) => {
      const requestId = VERSION + ':' + (++seq);
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(Object.assign(new Error('Mini app bridge timed out'), { name: 'Unavailable' }));
      }, 120000);
      pending.set(requestId, { resolve, reject, timeout });
      window.parent.postMessage({
        type: 'cherry:bridge:request',
        appId: APP_ID,
        requestId,
        method,
        params,
        ...(callId ? { callId } : {})
      }, '*');
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'cherry:bridge:reply' && typeof data.requestId === 'string') {
      const entry = pending.get(data.requestId);
      if (!entry) return;
      pending.delete(data.requestId);
      clearTimeout(entry.timeout);
      const result = data.result;
      if (result && result.ok) entry.resolve(result.value);
      else {
        const error = result && result.error ? result.error : { name: 'Internal', message: 'Internal error' };
        entry.reject(Object.assign(new Error(error.message || 'Mini app call failed'), { name: error.name }));
      }
      return;
    }
    if (data.type === 'cherry:bridge:event') {
      for (const listener of listeners.get(data.event) || []) {
        try { listener(data.payload); } catch (_) {}
      }
    }
  });

  const objectOr = (first, second, keys) => {
    if (first && typeof first === 'object' && !Array.isArray(first)) return first;
    const out = {};
    keys.forEach((key, index) => { if (index === 0 ? first !== undefined : second !== undefined) out[key] = index === 0 ? first : second; });
    return out;
  };

  const storage = {
    get: (key) => invoke('storage.get', { key }),
    set: (key, value) => invoke('storage.set', { key, value }),
    delete: (key) => invoke('storage.delete', { key }),
    keys: () => invoke('storage.keys'),
    usage: () => invoke('storage.usage')
  };

  const file = {
    save: (name, data) => invoke('file.save', { name, data }),
    load: (name) => invoke('file.load', { name }),
    list: () => invoke('file.list'),
    delete: (name) => invoke('file.delete', { name }),
    usage: () => invoke('file.usage'),
    export: (name, suggestedName) => invoke('file.export', { name, ...(suggestedName ? { suggestedName } : {}) })
  };

  const ai = {
    chat: (messages, options) => {
      const input = Array.isArray(messages) ? { ...(options || {}), messages } : messages;
      return invoke('ai.chat', input, input && input.callId);
    },
    cancel: (params) => invoke('ai.cancel', typeof params === 'string' ? { callId: params } : params),
    getCapabilities: (params) => invoke('ai.getCapabilities', params || undefined)
  };

  const notification = {
    show: (title, body) => invoke('notification.show', typeof title === 'string' ? { title, ...(body ? { body } : {}) } : title)
  };

  const clipboard = {
    read: () => invoke('clipboard.read'),
    write: (text) => invoke('clipboard.write', typeof text === 'string' ? { text } : text)
  };

  const network = {
    fetch: (url, options) => invoke('network.fetch', typeof url === 'string' ? { ...(options || {}), url } : url)
  };

  window.cherry = Object.freeze({
    __bridgeVersion: VERSION,
    app: {
      getInfo: () => invoke('app.getInfo'),
      getPermissions: () => invoke('app.getPermissions')
    },
    storage,
    file,
    ai,
    notification,
    clipboard,
    network,
    on: (event, listener) => {
      const set = listeners.get(event) || new Set();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    }
  });
})();`
}

import type { WebSocket } from 'ws'

/** Fan-out hub for server → browser events. One connection may observe every event. */
export class EventHub {
  private readonly clients = new Set<WebSocket>()

  add(socket: WebSocket): void {
    this.clients.add(socket)
    socket.on('close', () => this.clients.delete(socket))
    socket.on('error', () => this.clients.delete(socket))
  }

  broadcast(event: string, payload: unknown): void {
    const message = JSON.stringify({ type: 'event', event, payload })
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(message)
    }
  }

  get size(): number {
    return this.clients.size
  }

  closeAll(): void {
    for (const client of this.clients) client.close(1001, 'server shutting down')
    this.clients.clear()
  }
}

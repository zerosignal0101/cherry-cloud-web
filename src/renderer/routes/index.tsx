import { createFileRoute, redirect } from '@tanstack/react-router'

/** `/` has no page of its own: the chat is the landing surface. */
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/app/chat' })
  }
})

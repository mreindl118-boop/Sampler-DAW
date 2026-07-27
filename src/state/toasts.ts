import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'warn' | 'error'
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

export function toast(text: string, kind: Toast['kind'] = 'info', ttlMs = 5000): void {
  const t: Toast = { id: nextId++, text, kind }
  toasts = [...toasts, t]
  notify()
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id)
    notify()
  }, ttlMs)
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((x) => x.id !== id)
  notify()
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => toasts
  )
}

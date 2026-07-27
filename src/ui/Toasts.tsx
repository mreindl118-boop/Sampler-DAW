import { dismissToast, useToasts } from '../state/toasts'

export function Toasts() {
  const toasts = useToasts()
  if (toasts.length === 0) return null
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.kind === 'warn' ? '⚠ ' : t.kind === 'error' ? '✗ ' : ''}
          {t.text}
        </div>
      ))}
    </div>
  )
}

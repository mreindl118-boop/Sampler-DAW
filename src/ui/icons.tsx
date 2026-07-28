/** Geometric 16×16 icon set — replaces emoji so the UI reads as engineered hardware, not chat. */

export type IconName =
  | 'play' | 'pause' | 'stop' | 'record' | 'rtz' | 'loop' | 'metro'
  | 'undo' | 'redo' | 'gear' | 'cut' | 'dup' | 'flag' | 'import'
  | 'plus' | 'minus' | 'keys' | 'roll' | 'steps' | 'chords' | 'inst'
  | 'mixer' | 'phones' | 'up' | 'down' | 'x'

const P: Record<IconName, React.ReactNode> = {
  play: <path d="M5.2 3.2 12.6 8l-7.4 4.8z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="4.6" y="3.4" width="2.4" height="9.2" fill="currentColor" stroke="none" />
      <rect x="9" y="3.4" width="2.4" height="9.2" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="4.2" y="4.2" width="7.6" height="7.6" fill="currentColor" stroke="none" />,
  record: <circle cx="8" cy="8" r="4.2" fill="currentColor" stroke="none" />,
  rtz: (
    <>
      <path d="M4.2 3.4v9.2" />
      <path d="M12.8 3.6 6.4 8l6.4 4.4z" fill="currentColor" stroke="none" />
    </>
  ),
  loop: (
    <>
      <path d="M3 8.6V8a4.2 4.2 0 0 1 4.2-4.2h4" />
      <path d="m9.6 1.6 2.2 2.2-2.2 2.2" />
      <path d="M13 7.4V8a4.2 4.2 0 0 1-4.2 4.2h-4" />
      <path d="m6.4 14.4-2.2-2.2 2.2-2.2" />
    </>
  ),
  metro: (
    <>
      <path d="M6.3 2.6h3.4l1.7 10.6H4.6z" />
      <path d="m8 8.4 3.6-4.6" />
    </>
  ),
  undo: (
    <>
      <path d="M3.2 6.4h6.6a3.4 3.4 0 0 1 0 6.8H7" />
      <path d="M6.2 3.4 3.2 6.4l3 3" />
    </>
  ),
  redo: (
    <>
      <path d="M12.8 6.4H6.2a3.4 3.4 0 0 0 0 6.8H9" />
      <path d="m9.8 3.4 3 3-3 3" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.6v2.1M8 12.3v2.1M1.6 8h2.1M12.3 8h2.1M3.5 3.5 5 5M11 11l1.5 1.5M12.5 3.5 11 5M5 11l-1.5 1.5" />
    </>
  ),
  cut: (
    <>
      <circle cx="4.4" cy="4.2" r="1.7" />
      <circle cx="4.4" cy="11.8" r="1.7" />
      <path d="m5.8 5.4 7.4 5.8M5.8 10.6l7.4-5.8" />
    </>
  ),
  dup: (
    <>
      <rect x="2.8" y="2.8" width="7" height="7" rx="1" />
      <path d="M6.2 12.4v.2a.8.8 0 0 0 .8.8h5.4a.8.8 0 0 0 .8-.8V7a.8.8 0 0 0-.8-.8h-.2" />
    </>
  ),
  flag: (
    <>
      <path d="M4.2 14.2V2.4" />
      <path d="M4.2 3h7.6l-1.8 2.6 1.8 2.6H4.2" />
    </>
  ),
  import: (
    <>
      <path d="M8 2.4v7.4M5 7l3 3 3-3" />
      <path d="M2.8 13.4h10.4" />
    </>
  ),
  plus: <path d="M8 3.4v9.2M3.4 8h9.2" />,
  minus: <path d="M3.4 8h9.2" />,
  keys: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M5.8 3v6.2M10.2 3v6.2" />
    </>
  ),
  roll: (
    <>
      <rect x="2.4" y="3.2" width="6.2" height="2.2" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="6.4" y="6.9" width="7.2" height="2.2" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="3.4" y="10.6" width="5" height="2.2" rx="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  steps: (
    <>
      {[2.4, 6, 9.6, 13.2].map((x, i) => (
        <rect key={i} x={x - 1.3} y="3.4" width="2.6" height="2.6" rx="0.5" fill={i % 3 === 0 ? 'currentColor' : 'none'} />
      ))}
      {[2.4, 6, 9.6, 13.2].map((x, i) => (
        <rect key={i + 4} x={x - 1.3} y="9.4" width="2.6" height="2.6" rx="0.5" fill={i % 2 === 1 ? 'currentColor' : 'none'} />
      ))}
    </>
  ),
  chords: <path d="M6.2 2.4v11.2M9.8 2.4v11.2M3.6 6.2h9M3.4 9.8h9.2" />,
  inst: <path d="M1.6 8c1.6-5.2 3.2-5.2 4.3 0s2.7 5.2 4.2 0 2.7-5.2 4.3 0" />,
  mixer: (
    <>
      <path d="M4 2.4v11.2M8 2.4v11.2M12 2.4v11.2" />
      <rect x="2.6" y="8.6" width="2.8" height="2" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="6.6" y="4.4" width="2.8" height="2" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="10.6" y="6.8" width="2.8" height="2" rx="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  phones: (
    <>
      <path d="M3 10V9a5 5 0 0 1 10 0v1" />
      <rect x="2.2" y="9.4" width="2.4" height="4" rx="1" />
      <rect x="11.4" y="9.4" width="2.4" height="4" rx="1" />
    </>
  ),
  up: <path d="m4 9.6 4-4 4 4" />,
  down: <path d="m4 6.4 4 4 4-4" />,
  x: <path d="m4.4 4.4 7.2 7.2M11.6 4.4 4.4 11.6" />,
}

export function Ic({ n, size = 14 }: { n: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {P[n]}
    </svg>
  )
}

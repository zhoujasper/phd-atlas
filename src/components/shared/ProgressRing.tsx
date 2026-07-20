export function ProgressRing({
  progress,
  size = 120,
  strokeWidth = 5,
  label = 'ready',
}: {
  progress: number
  size?: number
  strokeWidth?: number
  label?: string
}) {
  const center = size / 2
  const radius = center - strokeWidth - 4
  // Scale text to the ring itself (same ratio as the original 120px design) so it
  // stays legible at any size, instead of relying on ancestor selectors to force
  // a fixed font-size that shrinks too far on smaller rings.
  const valueFontSize = Math.round(Math.max(17, size * 0.217))
  const labelFontSize = Math.round(Math.max(11, size * 0.1))

  return (
    <div
      className="progress-orbit"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${progress}% ${label}`}
    >
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={center} cy={center} r={radius} />
        <circle
          cx={center}
          cy={center}
          r={radius}
          pathLength="100"
          style={{ strokeDasharray: `${progress} 100` }}
        />
      </svg>
      <div className="progress-orbit-label">
        <strong style={{ fontSize: valueFontSize }}>{progress}%</strong>
        <span style={{ fontSize: labelFontSize }}>{label}</span>
      </div>
    </div>
  )
}

export function Skeleton({
  width,
  height = 14,
  radius = 6,
}: {
  width?: string | number
  height?: string | number
  radius?: number
}) {
  return (
    <div
      className="skeleton"
      style={{
        width: width ?? '100%',
        height,
        borderRadius: radius,
      }}
      aria-hidden="true"
    />
  )
}

export function SkeletonLine({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: 'grid', gap: 10 }} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  )
}

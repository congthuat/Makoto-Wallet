export type ChartPoint = [number, number]

export function chartCoordinates(points: readonly ChartPoint[], width: number, height: number, pad = 4) {
  if (!points.length) return []
  const values = points.map((point) => point[1])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const firstTime = points[0][0]
  const spanTime = points[points.length - 1][0] - firstTime
  return points.map(([time, value]) => [
    spanTime > 0 ? ((time - firstTime) / spanTime) * width : width / 2,
    max === min ? height / 2 : pad + (1 - (value - min) / (max - min)) * (height - pad * 2),
  ])
}

export function closestPointIndex(points: readonly ChartPoint[], fraction: number) {
  if (!points.length) return 0
  const first = points[0][0]
  const target = first + Math.max(0, Math.min(1, fraction)) * (points[points.length - 1][0] - first)
  let best = 0
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i][0] - target) < Math.abs(points[best][0] - target)) best = i
  }
  return best
}

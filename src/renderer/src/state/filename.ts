// Builds a unique default filename: 3d5d-insta-month-day-hour-minute.[ext]
export function defaultFilename(ext: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`
  return `3d5d-insta-${stamp}.${ext}`
}

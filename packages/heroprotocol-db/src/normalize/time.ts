/** Windows FILETIME (100 ns ticks since 1601-01-01) → ISO-8601 UTC. */
export function filetimeToIso(filetime: number): string {
  return new Date(filetime / 10000 - 11644473600000).toISOString();
}

/** `m_timeLocalOffset` (100 ns ticks) → hours. */
export function ticksToHours(ticks: number): number {
  return ticks / 10000000 / 3600;
}

/** Fixed-point map coordinates and stat values carry 12 fractional bits. */
export function fixed(value: number): number {
  return value / 4096;
}

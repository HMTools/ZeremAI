// Moving a folder: the mods file API cannot move or delete, so the mod runs the platform's own command.
// macOS and Linux: `mkdir -p` and `mv`. Windows: one PowerShell command (PowerShell 5 ships with Windows, and takes `/` in a path).

export const slash = (path: string): string => path.replace(/\\/g, '/')

const quote = (path: string) => `'${path.replace(/'/g, "''")}'` // a PowerShell single-quoted string

export function moveCommands(windows: boolean, from: string, to: string): string[][] {
  const parent = to.slice(0, to.lastIndexOf('/'))
  if (!windows) return [['mkdir', '-p', parent], ['mv', from, to]]
  const script = `$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Force -Path ${quote(parent)} | Out-Null; Move-Item -LiteralPath ${quote(from)} -Destination ${quote(to)}`
  return [['powershell', '-NoProfile', '-NonInteractive', '-Command', script]]
}

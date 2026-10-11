// What the infra functions need from the mods API. The mod builds these from `$`, because
// a mod cannot pass `$` into a function from another file.

export type FileSystem = {
  home(): Promise<string | undefined>
  list(path: string): Promise<{ name: string; kind: string; mtimeMs?: number }[]>
  exists(path: string): Promise<boolean>
  read(path: string): Promise<string>
}

export type ListAgents = () => Promise<{ type: string; status: string }[]>

export type FileWriter = (path: string, text: string) => Promise<void>

// One open approval gate for each session. The mod keeps it in its store, so a restart does not lose it.
export type Gate = { dir: string; stepId: string; dialog?: boolean } // dialog: the question is on screen now
export type GateStore = {
  get(sessionId: string): Promise<Gate | undefined>
  set(sessionId: string, gate: Gate): Promise<void>
  clear(sessionId: string): Promise<void>
}

// The folders a session bound, oldest first: a parent flow, then its child. The mod keeps them in its store.
export type SessionLinks = { get(sessionId: string): Promise<string[]> }

export type Ask = (question: string, options: readonly string[]) => Promise<string>


// What the flow tools need from the mods API. The mod builds it from `$`.
export type ManagerPorts = {
  files: FileSystem
  write: FileWriter
  move(from: string, to: string): Promise<void> // moves a folder; rejects with the reason when it fails
  now(): string
  uuid(): string
  pluginRoot: string
  cwd(): Promise<string>
  sessionId(): Promise<string>
  links: SessionLinks & { add(sessionId: string, dir: string): Promise<void> }
}

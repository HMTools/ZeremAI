import { addMarketplace, listMarketplaces, refreshMarketplaces, removeMarketplace, toggleMarketplace, updateMarketplace } from './templates'
import type { TemplatePorts } from './templates'

// /zeremai:marketplace: the buttons of the Marketplaces screen, as words. Every rule (names, addresses, the saved copy) stays in templates.ts.

export const MARKETPLACE_HELP = [
  '/zeremai:marketplace list                          show every marketplace',
  '/zeremai:marketplace add <name> <git address> [--branch b] [--priority n]',
  '/zeremai:marketplace edit <name> [--url u] [--branch b] [--priority n] [--rename n]',
  '/zeremai:marketplace on <name> | off <name>        refresh skips a marketplace that is off',
  '/zeremai:marketplace remove <name> [--yes]         deletes its saved copy; installed templates stay',
  '/zeremai:marketplace refresh                       get the latest catalog of each one that is on',
].join('\n')

const FLAGS = ['branch', 'priority', 'url', 'rename']

function parse(words: string[]): { args: string[]; flags: Record<string, string>; yes: boolean } {
  const args: string[] = []
  const flags: Record<string, string> = {}
  let yes = false
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w === '--yes') yes = true
    else if (w.startsWith('--')) {
      const key = w.slice(2)
      if (!FLAGS.includes(key) || words[i + 1] === undefined) throw new Error(`${w} is not understood here.\n${MARKETPLACE_HELP}`)
      flags[key] = words[++i]
    } else args.push(w)
  }
  return { args, flags, yes }
}

// Returns the text to show. `confirm` asks the user a yes/no question (remove only).
export async function runMarketplaceCommand(ports: TemplatePorts, text: string, confirm: (question: string) => Promise<boolean>): Promise<string> {
  const [verb = 'help', ...rest] = text.trim().split(/\s+/).filter(Boolean)
  try {
    const { args, flags, yes } = parse(rest)
    const need = (n: number) => {
      if (args.length !== n) throw new Error(`/zeremai:marketplace ${verb} takes ${n} word${n === 1 ? '' : 's'}.\n${MARKETPLACE_HELP}`)
    }
    switch (verb.toLowerCase()) {
      case 'list': {
        const all = await listMarketplaces(ports)
        if (!all.length) return 'No marketplaces. Add one: /zeremai:marketplace add <name> <git address>'
        return all.map(m => `${m.name.padEnd(12)}${(!m.enabled ? 'Off' : m.cached ? 'Ready' : 'Not cloned').padEnd(12)}${m.branch}  priority ${m.priority}\n${' '.repeat(12)}${m.url}`).join('\n')
      }
      case 'add': {
        need(2)
        await addMarketplace(ports, { name: args[0], url: args[1], branch: flags.branch ?? '', priority: flags.priority ?? '' })
        return (await refreshMarketplaces(ports, { onlyMissing: true })).join('\n') || 'Added.'
      }
      case 'edit': {
        need(1)
        const m = (await listMarketplaces(ports)).find(m => m.name === args[0])
        if (!m) throw new Error(`Marketplace ${args[0]} not found`)
        const url = flags.url ?? m.url
        const branch = flags.branch ?? m.branch
        await updateMarketplace(ports, m.name, { name: flags.rename ?? m.name, url, branch, priority: flags.priority ?? String(m.priority) })
        return url !== m.url || branch !== m.branch ? `${m.name} saved. The copy is deleted. Run refresh to clone it again.` : `${m.name} saved.`
      }
      case 'on':
      case 'off': {
        need(1)
        const want = verb.toLowerCase() === 'on'
        const m = (await listMarketplaces(ports)).find(m => m.name === args[0])
        if (!m) throw new Error(`Marketplace ${args[0]} not found`)
        if (m.enabled !== want) await toggleMarketplace(ports, m.name) // twice the same word gives the same result
        return `${m.name} is ${want ? 'On' : 'Off'}.${want ? '' : ' Refresh skips it. Installed templates stay.'}`
      }
      case 'remove': {
        need(1)
        if (!(await listMarketplaces(ports)).some(m => m.name === args[0])) throw new Error(`Marketplace ${args[0]} not found`)
        if (!yes && !(await confirm(`Remove "${args[0]}" and its saved copy? Installed templates stay.`))) return 'Cancelled.'
        await removeMarketplace(ports, args[0])
        return 'Removed.'
      }
      case 'refresh':
        need(0)
        return (await refreshMarketplaces(ports)).join('\n') || 'Nothing to refresh.'
      default:
        return MARKETPLACE_HELP
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

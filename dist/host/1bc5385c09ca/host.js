import { LEAD_INSTRUCTION, WORKER_INSTRUCTION } from './prompts.js'

const sessionIdOf = value => {
  if (typeof value !== 'string' || !value) throw new Error('sessionId is required')
  return value
}

/** A root-session switch determines lead / worker / off on every assembly. */
export function createRuntime(ctx, bridge) {
  const { settings, headers, owners } = bridge

  async function headerFor(id, fresh = false) {
    const live = ctx.agents.get(id)?.session.header
    if (live) { headers.set(id, live); return live }
    if (!fresh && headers.has(id)) return headers.get(id)
    const observation = await ctx.sessionQuery.observeSession(id)
    try { headers.set(id, observation.header); return observation.header }
    finally { observation[Symbol.dispose]() }
  }
  async function rootFor(header) {
    let current = header
    const visited = new Set()
    while (current.origin === 'subagent') {
      if (!current.parentSession || visited.has(current.id)) throw new Error('Invalid subagent parent chain')
      visited.add(current.id)
      try { current = await headerFor(current.parentSession) }
      catch (error) {
        if (error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') return undefined
        throw error
      }
    }
    return current.id
  }
  function currentRoot(agent) {
    const id = agent.session.header.id
    if (owners.has(id)) return owners.get(id)
    let header = agent.session.header
    const visited = new Set()
    while (header.origin === 'subagent') {
      if (!header.parentSession || visited.has(header.id)) throw new Error('Invalid subagent parent chain')
      visited.add(header.id)
      header = ctx.agents.get(header.parentSession)?.session.header ?? headers.get(header.parentSession)
      if (!header) return undefined
    }
    owners.set(id, header.id)
    return header.id
  }
  async function initialize(agent) {
    const header = agent.session.header
    headers.set(header.id, header)
    const root = await rootFor(header)
    if (root !== undefined) owners.set(header.id, root)
  }
  function text(context) {
    const agent = context.agent ?? context.scope
    if (!agent?.session?.header) return ''
    const root = currentRoot(agent)
    if (root === undefined || settings.get(root)?.enabled !== true) return ''
    return agent.session.header.origin === 'subagent' ? WORKER_INSTRUCTION : LEAD_INSTRUCTION
  }
  function onDisposed(agent) {
    owners.delete(agent.session.id)
    headers.delete(agent.session.id)
  }
  async function get(payload) {
    const sessionId = sessionIdOf(payload?.sessionId)
    const header = await headerFor(sessionId, true)
    const rootSessionId = await rootFor(header)
    if (rootSessionId === undefined) throw new Error('The parent session is no longer available')
    owners.set(sessionId, rootSessionId)
    const enabled = settings.get(rootSessionId)?.enabled === true
    const inherited = header.origin === 'subagent'
    return { sessionId, rootSessionId, enabled, inherited, role: !enabled ? 'off' : inherited ? 'worker' : 'lead', runtime: bridge.runtime }
  }
  async function set(payload) {
    const sessionId = sessionIdOf(payload?.sessionId)
    if (typeof payload.enabled !== 'boolean') throw new Error('enabled must be true or false')
    const header = await headerFor(sessionId, true)
    if (header.origin === 'subagent') throw new Error('Change Devin Fusion in the main session; subagents follow its switch')
    await settings.put(sessionId, { enabled: payload.enabled })
    // Invalidate native prompt previews, without starting a request or changing tools.
    ctx.emit('system-prompt/change')
    return get({ sessionId })
  }
  async function remove(id) {
    owners.delete(id)
    headers.delete(id)
    await settings.delete(id)
  }
  async function cleanup() {
    const candidates = [...settings.entries()]
    if (!candidates.length) return
    const present = new Set((await ctx.sessionQuery.listSessions()).map(record => record.header.id))
    for (const agent of ctx.agents.list()) present.add(agent.session.header.id)
    for (const [id, value] of candidates) if (!present.has(id) && settings.get(id) === value) await remove(id)
  }
  return { text, initialize, onDisposed, get, set, remove, cleanup }
}

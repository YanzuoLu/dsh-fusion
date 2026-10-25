import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

export const name = 'devin-fusion'
export const inject = ['agents', 'sessionQuery', 'storageDomain', 'systemPrompt', 'connection']
const domainSpec = defineDomain({
  name: 'devin_fusion', version: 1,
  tables: { sessions: domainTable(z.object({ enabled: z.boolean() })) },
})

/** Stable native-context registration; implementation revisions never unload agents. */
export async function apply(ctx) {
  const domain = await ctx.storageDomain.open(domainSpec)
  const bridge = {
    settings: domain.table('sessions'), headers: new Map(), owners: new Map(), current: null,
    closing: false, operations: new Set(), runtime: { revision: null, pendingRevision: null, error: null },
  }
  const operation = callback => {
    const promise = Promise.resolve().then(callback)
    bridge.operations.add(promise)
    return promise.finally(() => bridge.operations.delete(promise))
  }
  let checking = false, rejected
  async function load(initial = false) {
    if (checking || bridge.closing) return
    checking = true
    let release
    try {
      try { release = JSON.parse(await readFile(new URL('./release.json', import.meta.url), 'utf8')) }
      catch (error) { if (!initial && error.code === 'ENOENT') return; throw error }
      if (!/^[a-f0-9]{12}$/.test(release.revision) || release.entry !== `./dist/host/${release.revision}/host.js`) throw new Error('Invalid Devin Fusion release manifest')
      if (release.revision === bridge.runtime.revision || release.revision === rejected) return
      bridge.runtime.pendingRevision = release.revision
      if (!initial && bridge.operations.size) return
      const next = await import(new URL(release.entry, import.meta.url).href)
      if (bridge.closing || (!initial && bridge.operations.size)) return
      const runtime = next.createRuntime(ctx, bridge)
      for (const method of ['text', 'initialize', 'onDisposed', 'get', 'set', 'remove', 'cleanup']) {
        if (typeof runtime[method] !== 'function') throw new Error(`Missing Devin Fusion method: ${method}`)
      }
      // Text providers are synchronous, so a request captures one complete
      // revision. Updating this pointer cannot modify an already assembled call.
      bridge.current = runtime
      bridge.runtime.revision = release.revision
      bridge.runtime.pendingRevision = null
      bridge.runtime.error = null
      if (!initial) ctx.emit('system-prompt/change')
    } catch (error) {
      if (initial) throw error
      rejected = release?.revision
      bridge.runtime.error = error.message
      ctx.logger.warn(`Devin Fusion update: ${error.message}`)
    } finally { checking = false }
  }
  ctx.effect(() => async () => {
    bridge.closing = true
    await Promise.allSettled([...bridge.operations])
    await domain.close()
  }, 'devin-fusion: settings lifetime')
  await load(true)

  ctx.on('agent/created', ({ agent }) => {
    if (bridge.closing) return
    return operation(() => bridge.current.initialize(agent))
  })
  ctx.on('agent/disposed', ({ agent }) => bridge.current.onDisposed(agent))
  ctx.on('api-session/removed', id => {
    if (!bridge.closing) void operation(() => bridge.current.remove(id)).catch(error => ctx.logger.warn(`Devin Fusion preference removal: ${error.message}`))
  })
  for (const agent of ctx.agents.list()) await operation(() => bridge.current.initialize(agent))

  ctx.systemPrompt.context({
    name: 'devin-fusion:role',
    order: ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION') + 1,
    text: context => bridge.closing ? '' : bridge.current.text(context),
  })

  for (const endpoint of ['get', 'set']) {
    ctx.connection.fetch.register({
      path: `/api/devin-fusion/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        try {
          if (bridge.closing) return Response.json({ ok: false, error: { message: 'Devin Fusion settings are stopping' } }, { status: 503 })
          const value = await operation(async () => bridge.current[endpoint](await request.json()))
          return Response.json({ ok: true, value })
        } catch (error) {
          return Response.json({ ok: false, error: { message: error.message } }, { status: 400 })
        }
      },
    })
  }
  ctx.effect(() => {
    let cleaning = false
    const updates = setInterval(() => { void load() }, 2000)
    const cleanup = setInterval(() => {
      if (cleaning || bridge.closing) return
      cleaning = true
      void operation(() => bridge.current.cleanup()).catch(error => ctx.logger.warn(`Devin Fusion cleanup: ${error.message}`)).finally(() => { cleaning = false })
    }, 30000)
    updates.unref?.(); cleanup.unref?.()
    return () => { clearInterval(updates); clearInterval(cleanup) }
  }, 'devin-fusion: releases and cleanup')
}

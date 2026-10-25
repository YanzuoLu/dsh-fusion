import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const root = new URL('../', import.meta.url)
const host = await readFile(new URL('lib/host.js', root), 'utf8')
const lead = (await readFile(new URL('prompts/lead.md', root), 'utf8')).trimEnd()
const worker = (await readFile(new URL('prompts/worker.md', root), 'utf8')).trimEnd()
const prompts = `export const LEAD_INSTRUCTION = ${JSON.stringify(lead)}\nexport const WORKER_INSTRUCTION = ${JSON.stringify(worker)}\n`
const revision = createHash('sha256').update(host).update('\0').update(prompts).digest('hex').slice(0, 12)
const directory = new URL(`dist/host/${revision}/`, root)
await mkdir(directory, { recursive: true })
for (const [name, content] of [['host.js', host], ['prompts.js', prompts]]) {
  const target = new URL(name, directory)
  let previous
  try { previous = await readFile(target, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (previous !== undefined && previous !== content) throw new Error(`Immutable release collision for ${revision}/${name}`)
  if (previous === undefined) await writeFile(target, content, { flag: 'wx' })
}
const manifest = JSON.stringify({ revision, entry: `./dist/host/${revision}/host.js` }, null, 2) + '\n'
const target = new URL('release.json', root)
let previous
try { previous = await readFile(target, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
if (previous !== manifest) await writeFile(target, manifest)
console.log(`Devin Fusion host ${revision}`)

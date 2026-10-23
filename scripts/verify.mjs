// Check that a live site serves exactly the files of a build. Every file in the build directory is fetched from the
// site the way a visitor's browser would, and its SHA-256 compared with the local copy.
//   node scripts/verify.mjs <site url> [build directory, default dist]
// The build directory can be an unzipped release from GitHub, or your own `npm run build` of the same commit with the
// same settings (the release notes list them). _headers holds the host's header rules rather than a page, so it is
// skipped. Exits 1 if any file differs or is missing.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const [site, dir = 'dist'] = process.argv.slice(2)
if (!site) {
  console.error('usage: node scripts/verify.mjs <site url> [build directory]')
  process.exit(2)
}
const base = site.replace(/\/*$/, '/')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const files = readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => relative(dir, join(d.parentPath, d.name)).split(sep).join('/'))
  .filter((f) => f !== '_headers')
  .sort()

let bad = 0
for (const file of files) {
  // Pages are loaded by their directory path, as links point to them. 404.html must come back, with a 404 status, for
  // an address that does not exist.
  const missing = file === '404.html'
  const url = new URL(missing ? `no-such-page-${Date.now()}/` : file.replace(/(^|\/)index\.html$/, '$1'), base)
  const want = sha256(readFileSync(join(dir, file)))
  const res = await fetch(url, { cache: 'no-store' }).catch((e) => ({ ok: false, status: e.message }))
  const served = missing ? res.status === 404 : res.ok
  const got = served ? sha256(Buffer.from(await res.arrayBuffer())) : `HTTP ${res.status}`
  if (got !== want) bad++
  console.log(`${got === want ? 'OK  ' : 'DIFF'}  ${url.pathname}${got === want ? '' : `\n      expected ${want}\n      served   ${got}`}`)
}
console.log(bad ? `\n${bad} of ${files.length} files differ from the build` : `\nAll ${files.length} files match the build`)
process.exit(bad ? 1 : 0)

import { readFileSync, statSync, existsSync, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, relative, isAbsolute, sep, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const manifest=JSON.parse(readFileSync(join(root,'release-manifest.json'),'utf8'))
let verified=0
for(const file of manifest.files){
  const path=resolve(root,file.path),rel=relative(root,path)
  if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Unsafe manifest entry')
  if(!existsSync(path)||statSync(path).size!==file.size)throw Error('Missing or changed file: '+file.path)
  const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk)
  if(hash.digest('hex')!==file.sha256)throw Error('Checksum mismatch: '+file.path)
  verified++
}
console.log(JSON.stringify({verified,version:manifest.version,platform:manifest.platform,arch:manifest.arch}))

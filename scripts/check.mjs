import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createAccount, createClient} from 'genlayer-js'
import {chain, read, waitForFinality} from '../chain.js'

const {address} = JSON.parse(await readFile(new URL('../archive-deployment.json', import.meta.url)))
const account = createAccount()
const client = createClient({chain, account})
assert.equal(Number(await client.getChainId()), 61999)
assert.equal(BigInt(await client.request({method:'eth_gasPrice', params:[]})), 0n)
const key = [account.address, 'open-gallery']
for (const revision of [0, 1]) {
  const hash = await client.writeContract({address, functionName:'capture', args:[key[1], '92937,151904', revision], value:0n, leaderOnly:false})
  console.log('Capture', hash)
  await waitForFinality(hash, status => console.log(status))
  const manifest = await read(address, 'get_manifest', key)
  assert.equal(manifest.revision, 1)
  const rows = await read(address, 'get_edition', [...key, 1])
  assert.deepEqual(rows.map(row => row.id), [92937, 151904])
  assert.ok(rows.some(row => row.state === 'public_domain'))
  console.log(account.address, JSON.stringify(rows))
}

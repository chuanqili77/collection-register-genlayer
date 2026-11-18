import assert from 'node:assert/strict'
import {readFile, writeFile} from 'node:fs/promises'
import {createAccount, createClient} from 'genlayer-js'
import {chain, reader, read, waitForFinality} from '../chain.js'

const {address} = JSON.parse(await readFile(new URL('../deployment.json', import.meta.url)))
const editor = createAccount()
const reviewer = createAccount()
const slug = 'illustrated-issue'
const key = [editor.address.toLowerCase(), slug]
const transactions = {}
const getBatch = () => read(address, 'get_batch', key)
assert.equal(Number(await reader.getChainId()), 61999)
assert.equal(BigInt(await reader.request({method:'eth_gasPrice', params:[]})), 0n)

async function step(label, account, functionName, args, expectedError) {
  const client = createClient({chain, account})
  const hash = await client.writeContract({address, functionName, args, value:0n, leaderOnly:false})
  console.log(label, hash)
  transactions[label] = hash
  const receipt = waitForFinality(hash, status => console.log(label, status))
  if (!expectedError) return receipt
  await assert.rejects(receipt, /Finalized without successful execution/)
  const tx = await reader.getTransaction({hash})
  const leader = [tx.consensus_data?.leader_receipt].flat().find(item => item?.mode === 'leader')
  assert.equal(leader?.execution_result, 'ERROR')
  assert.equal(leader.result?.payload, expectedError)
}

await step('opened', editor, 'open_batch', [slug, 'The illustrated issue', reviewer.address, '92937,124245'])
const batch = await getBatch()
assert.equal(batch.revision, 1)
assert.deepEqual(batch.rows.map(row => [row.evidence.id, row.evidence.state]), [[92937, 'public_domain'], [124245, 'restricted']])

await Promise.all([
  step('unsigned_release_rejected', editor, 'issue_release', [slug, 1], 'APPROVAL_REQUIRED'),
  step('restricted_image_rejected', reviewer, 'approve_image', [...key, 124245, 1], 'IMAGE_NOT_ELIGIBLE'),
])
assert.equal(await read(address, 'get_release', [...key, 1]), null)
await Promise.all([
  step('editor_signoff_rejected', editor, 'approve_image', [...key, 92937, 1], 'REVIEWER_REQUIRED'),
  step('stale_evidence_rejected', reviewer, 'approve_image', [...key, 92937, 0], 'STALE_IMAGE_EVIDENCE'),
])
await step('approved', reviewer, 'approve_image', [...key, 92937, 1])
assert.deepEqual((await getBatch()).approvals, {'92937':[1]})
await step('issued', editor, 'issue_release', [slug, 1])
const release = await read(address, 'get_release', [...key, 1])
assert.deepEqual(release.included.map(row => row.id), [92937])
assert.deepEqual(release.excluded.map(row => row.id), [124245])
assert.equal(release.reviewer, reviewer.address.toLowerCase())
const result = {owner:key[0], slug, address, revision:1, transactions}
console.log(JSON.stringify(result))
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2) + '\n')

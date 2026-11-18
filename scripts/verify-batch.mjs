import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {reader, read, waitForFinality} from '../chain.js'

async function load(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

const [deployment, sample, source] = await Promise.all([
  load('../deployment.json').then(JSON.parse),
  load('../demo.json').then(JSON.parse),
  load('../contracts/collection_register.py'),
])
const {address} = deployment
assert.equal(address, sample.address)
assert.equal(Number(await reader.getChainId()), 61999)
assert.equal(await reader.getContractCode(address), source)
const provision = await waitForFinality(deployment.hash)
assert.equal(provision.data.contract_address.toLowerCase(), address.toLowerCase())
const key = [sample.owner, sample.slug]
const [batch, release] = await Promise.all([
  read(address, 'get_batch', key),
  read(address, 'get_release', [...key, sample.revision]),
])
assert.equal(batch.reviewer, release.reviewer)
assert.equal(release.owner, sample.owner)
assert.deepEqual(release.included.map(row => [row.id, row.license, row.evidence_version]), [[92937, 'CC0', 1]])
assert.deepEqual(release.excluded.map(row => [row.id, row.state]), [[124245, 'restricted']])
assert.ok(batch.approvals['92937'].includes(1))

const checks = [
  ['opened', 'open_batch', sample.owner],
  ['unsigned_release_rejected', 'issue_release', sample.owner, 'APPROVAL_REQUIRED'],
  ['restricted_image_rejected', 'approve_image', release.reviewer, 'IMAGE_NOT_ELIGIBLE'],
  ['editor_signoff_rejected', 'approve_image', sample.owner, 'REVIEWER_REQUIRED'],
  ['stale_evidence_rejected', 'approve_image', release.reviewer, 'STALE_IMAGE_EVIDENCE'],
  ['approved', 'approve_image', release.reviewer],
  ['issued', 'issue_release', sample.owner],
]
for (const [label, method, sender, reason] of checks) {
  const tx = await reader.getTransaction({hash:sample.transactions[label]})
  assert.ok(tx.status === 7 || tx.statusName === 'FINALIZED')
  assert.ok([6, 'MAJORITY_AGREE'].includes(tx.result))
  assert.equal(tx.from_address.toLowerCase(), sender.toLowerCase())
  assert.equal(tx.to_address.toLowerCase(), address.toLowerCase())
  const leader = [tx.consensus_data?.leader_receipt].flat().find(item => item?.mode === 'leader')
  assert.ok(leader.calldata.readable.includes('"method":"' + method + '"'))
  assert.ok(leader.calldata.readable.includes(JSON.stringify(sample.slug)))
  assert.equal(leader.execution_result, reason ? 'ERROR' : 'SUCCESS')
  if (reason) assert.equal(leader.result.payload, reason)
  console.log(label, leader.execution_result, reason ?? '')
}
console.log('Deployed source, seven finalized receipts and the released list verified.')

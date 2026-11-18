import './style.css'
import {createClient} from 'genlayer-js'
import {chain, explorer, reader, read, waitForFinality} from './chain.js'
import deployment from './deployment.json'
import demo from './demo.json'

const byId = id => document.getElementById(id)
const {address} = deployment
const status = message => { byId('status').textContent = message }
const slugPattern = /^[a-z0-9][a-z0-9-]{2,39}$/
const walletPattern = /^0x[0-9a-f]{40}$/i
let active
let busy = false

if (address) {
  byId('contract-link').href = explorer + '/address/' + address
  byId('contract-link').hidden = false
}

function reference() {
  const owner = byId('owner').value.trim().toLowerCase()
  const slug = byId('slug').value.trim()
  if (!walletPattern.test(owner)) throw Error('Enter a valid publisher wallet address.')
  if (!slugPattern.test(slug)) throw Error('Use 3–40 lowercase letters, numbers or hyphens for the batch key.')
  return [owner, slug]
}

function line(tag, content, className = '') {
  const element = document.createElement(tag)
  element.textContent = content
  if (className) element.className = className
  return element
}

async function wallet() {
  const provider = window.ethereum
  if (!provider) throw Error('Install or open an EIP-1193 browser wallet to publish.')
  const [account] = await provider.request({method:'eth_requestAccounts'})
  if (!walletPattern.test(account ?? '')) throw Error('No wallet account selected.')
  const chainId = '0xf22f'
  if (Number(await provider.request({method:'eth_chainId'})) !== chain.id) {
    try {
      await provider.request({method:'wallet_switchEthereumChain', params:[{chainId}]})
    } catch (error) {
      if ((error.data?.originalError?.code ?? error.code) !== 4902) throw error
      await provider.request({
        method:'wallet_addEthereumChain',
        params:[{chainId, chainName:'GenLayer Stable Studionet', nativeCurrency:{name:'GEN',symbol:'GEN',decimals:18},rpcUrls:['https://studio.genlayer.com/api'],blockExplorerUrls:[explorer]}],
      })
      await provider.request({method:'wallet_switchEthereumChain', params:[{chainId}]})
    }
  }
  const guarded = {
    async request(request) {
      if (request.method === 'eth_sendTransaction') {
        const [selected] = await provider.request({method:'eth_accounts'})
        if (selected?.toLowerCase() !== account.toLowerCase() ||
            Number(await provider.request({method:'eth_chainId'})) !== chain.id) {
          throw Error('Wallet account or network changed before signing.')
        }
      }
      return provider.request(request)
    },
  }
  return {account:account.toLowerCase(), client:createClient({chain, account, provider:guarded})}
}

function handle(id, eventName, action) {
  byId(id).addEventListener(eventName, event => {
    event.preventDefault()
    run(action)
  })
}

async function run(action) {
  if (busy) return
  busy = true
  const controls = document.querySelectorAll('button, input')
  const revision = byId('revision')
  revision.disabled = true
  controls.forEach(control => { control.disabled = true })
  try {
    if (!address) throw Error('This build has no configured deployment.')
    await action()
  } catch (error) {
    status(error.shortMessage ?? error.message ?? String(error))
  } finally {
    controls.forEach(control => { control.disabled = false })
    revision.disabled = !active || byId('batch-panel').hidden
    busy = false
  }
}

const labels = {restricted:'Museum marks restricted', unavailable:'No CC0 image URL', missing:'Museum record missing'}
const param = new URLSearchParams(location.search)
let displayedRelease

function batchLink(key) {
  return './?' + new URLSearchParams({owner:key[0], batch:key[1]}) + '#register'
}

function rowStatus(entry, batch) {
  if (entry.evidence.state !== 'public_domain') return 'blocked'
  return batch.approvals[String(entry.evidence.id)]?.includes(entry.version) ? 'signed' : 'pending'
}

function totals(rows, batch) {
  const counts = {signed:0, pending:0, blocked:0}
  for (const entry of rows) counts[rowStatus(entry, batch)]++
  byId('totals').replaceChildren(...Object.entries(counts).map(([state, count]) => {
    const metric = document.createElement('div')
    metric.append(line('dt', {signed:'Signed off',pending:'Awaiting review',blocked:'Excluded'}[state]), line('dd', count))
    return metric
  }))
  return counts
}

async function renderRevision(revision) {
  const {key, batch} = active
  const current = revision === batch.revision
  const [rows, previous] = await Promise.all([
    current ? batch.rows : read(address, 'get_batch_observation', [...key, revision]),
    revision > 1 ? read(address, 'get_batch_observation', [...key, revision - 1]) : null,
  ])
  displayedRelease = batch.release_revisions.includes(revision) ?
    await read(address, 'get_release', [...key, revision]) : null
  const counts = totals(rows, batch)
  byId('recheck').hidden = !current
  byId('issue').hidden = !current || Boolean(displayedRelease) || !counts.signed || Boolean(counts.pending)
  byId('release-panel').hidden = !displayedRelease
  if (displayedRelease) {
    byId('release-title').textContent = current ? 'Issued release list' : 'Historical release list'
    byId('release-summary').textContent = displayedRelease.included.length + ' approved image(s) included · ' +
      displayedRelease.excluded.length + ' image(s) excluded · evidence revision ' + revision
  }
  byId('records').replaceChildren(...rows.map(entry => {
    const {evidence:row, version} = entry
    const state = rowStatus(entry, batch)
    const details = document.createElement('div')
    const source = line('a', 'Artwork ' + row.id + ' ↗')
    source.href = row.accession ? 'https://www.clevelandart.org/art/' + row.accession : 'https://openaccess-api.clevelandart.org/api/artworks/' + row.id
    details.append(source, line('h3', row.title ?? 'No catalog record'))
    details.append(line('p', (row.license ?? 'No license data') + ' · Evidence version ' + version))
    if (row.state === 'public_domain' && row.image) {
      const asset = line('a', 'Open museum image ↗')
      asset.href = row.image
      details.append(asset)
    }
    const older = previous?.find(item => item.evidence.id === row.id)
    if (older && older.version !== version) {
      const fields = {license:'Share license', image:'Image URL', state:'Availability', accession:'Accession'}
      for (const [name, label] of Object.entries(fields)) {
        if (older.evidence[name] !== row[name]) {
          details.append(line('p', label + ': ' + (older.evidence[name] ?? '—') + ' → ' + (row[name] ?? '—')))
        }
      }
    }
    const review = document.createElement('aside')
    review.append(line('span', state === 'blocked' ? labels[row.state] :
      state === 'signed' ? 'Reviewer signed' : 'Awaiting reviewer', 'mark ' + state))
    if (current && state === 'pending') {
      const approve = line('button', 'Sign off this image')
      approve.addEventListener('click', () => run(() => write(
        'approve_image', [...key, row.id, version], key, batch.reviewer,
        updated => updated.approvals[String(row.id)]?.includes(version) ? 'Image sign-off confirmed.' :
          'Sign-off finalized. Review the latest evidence version.',
      )))
      review.append(approve)
    }
    const item = document.createElement('li')
    item.append(details, review)
    return item
  }))
}

async function load(key) {
  active = null
  byId('batch-panel').hidden = true
  const select = byId('revision')
  select.replaceChildren()
  select.disabled = true
  const batch = await read(address, 'get_batch', key)
  if (!batch) {
    byId('record-title').textContent = 'Batch not found'
    status('No finalized batch exists at that editor wallet and key.')
    return
  }
  active = {key, batch}
  history.replaceState(null, '', batchLink(key))
  byId('owner').value = key[0]
  byId('slug').value = key[1]
  byId('record-title').textContent = batch.title
  byId('reviewer-line').textContent = 'Assigned reviewer · ' + batch.reviewer
  for (let revision = batch.revision; revision >= 1; revision--) {
    select.add(new Option('Revision ' + revision, String(revision)))
  }
  await renderRevision(batch.revision)
  byId('batch-panel').hidden = false
  status('Showing finalized evidence revision ' + batch.revision + '.')
}

async function write(method, args, key, required, result, signer) {
  const {account, client} = signer ?? await wallet()
  if (required && account !== required.toLowerCase()) throw Error('Switch to the assigned wallet for this action.')
  if (BigInt(await reader.request({method:'eth_gasPrice',params:[]})) !== 0n) {
    throw Error('Stable Studionet is reporting a nonzero gas price.')
  }
  status('Review the transaction in your wallet.')
  const hash = await client.writeContract({address, functionName:method, args, value:0n, leaderOnly:false})
  const link = byId('transaction')
  link.href = explorer + '/transactions/' + hash
  link.hidden = false
  status('Submitted · awaiting consensus.')
  await waitForFinality(hash, stage => status('Consensus · ' + stage))
  await load(key)
  if (!active) throw Error('The transaction finalized, but the batch readback is unavailable.')
  status(result(active.batch))
}

handle('lookup', 'submit', () => load(reference()))
handle('capture', 'submit', async () => {
  const slug = byId('new-slug').value.trim()
  const title = byId('title').value.trim()
  const reviewer = byId('reviewer').value.toLowerCase()
  const ids = byId('ids').value.split(',').map(id => id.trim())
  if (!title || !slugPattern.test(slug)) throw Error('Enter a title and a valid batch key.')
  if (ids.length > 4 || ids.some(id => !/^[1-9][0-9]{0,8}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw Error('Enter one to four distinct artwork IDs.')
  }
  const signer = await wallet()
  if (signer.account === reviewer || /^0x0{40}$/.test(reviewer)) throw Error('Assign a distinct reviewer wallet.')
  await write('open_batch', [slug, title, reviewer, ids.join(',')], [signer.account, slug], null,
    () => 'Batch opened. Share this page with the assigned reviewer.', signer)
  byId('capture').closest('details').open = false
})
handle('recheck', 'click', () => {
  const {key, batch} = active
  return write('recheck_batch', [key[1], batch.revision], key, key[0], updated =>
    updated.revision === batch.revision ? 'Museum evidence is unchanged.' :
      'New evidence captured. Check the affected lines for updated review requirements.')
})
handle('issue', 'click', () => {
  const {key, batch} = active
  return write('issue_release', [key[1], batch.revision], key, key[0], updated =>
    updated.release_revisions.includes(batch.revision) ? 'Release issued. Download the handoff list below.' :
      'Museum data changed during issuance. Review the new evidence before issuing.')
})
handle('revision', 'change', async () => {
  const revision = Number(byId('revision').value)
  await renderRevision(revision)
  status('Showing finalized evidence revision ' + revision + '.')
})
handle('download', 'click', () => {
  const documentUrl = URL.createObjectURL(new Blob([
    JSON.stringify({network:chain.id, contract:address, ...displayedRelease}, null, 2),
  ], {type:'application/json'}))
  const link = document.createElement('a')
  link.href = documentUrl
  link.download = displayedRelease.slug + '-release-' + displayedRelease.revision + '.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(documentUrl), 5000)
})

if (demo.owner && demo.address === address) {
  byId('demo').href = batchLink([demo.owner, demo.slug])
  byId('demo').hidden = false
}
const owner = param.get('owner')
const slug = param.get('batch')
if (walletPattern.test(owner ?? '') && slugPattern.test(slug ?? '')) {
  byId('owner').value = owner
  byId('slug').value = slug
  byId('lookup').requestSubmit()
} else if (walletPattern.test(owner ?? '') && slugPattern.test(param.get('register') ?? '')) {
  location.replace('./archive.html' + location.search + location.hash)
}

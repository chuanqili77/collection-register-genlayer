import './style.css'
import {createClient} from 'genlayer-js'
import {chain, explorer, reader, read, waitForFinality} from './chain.js'
import deployment from './archive-deployment.json'

const byId = id => document.getElementById(id)
const {address} = deployment
const status = message => { byId('status').textContent = message }
const slugPattern = /^[a-z0-9][a-z0-9-]{2,39}$/
const walletPattern = /^0x[0-9a-f]{40}$/i
const states = {public_domain:'CC0 image', restricted:'Restricted', unavailable:'No image', missing:'Record missing'}
let active
let busy = false
const singleView = new URLSearchParams(window.location.search)

if (address) {
  byId('contract-link').href = explorer + '/address/' + address
  byId('contract-link').hidden = false
}

function reference() {
  const owner = byId('owner').value.trim().toLowerCase()
  const slug = byId('slug').value.trim()
  if (!walletPattern.test(owner)) throw Error('Enter a valid publisher wallet address.')
  if (!slugPattern.test(slug)) throw Error('Use 3–40 lowercase letters, numbers or hyphens for the register name.')
  return [owner, slug]
}

function line(tag, content, className = '') {
  const element = document.createElement(tag)
  element.textContent = content
  if (className) element.className = className
  return element
}

async function renderEdition(revision) {
  const previous = revision > 1 ? read(address, 'get_edition', [...active.key, revision - 1]) : null
  const [rows, baseline] = await Promise.all([read(address, 'get_edition', [...active.key, revision]), previous])
  if (!rows) throw Error('Edition could not be loaded.')
  byId('records').replaceChildren(...rows.map(row => {
    const older = baseline?.find(item => item.id === row.id)
    const details = document.createElement('div')
    const link = line('a', 'Artwork ' + row.id + ' ↗')
    link.href = row.accession ? 'https://www.clevelandart.org/art/' + row.accession : 'https://openaccess-api.clevelandart.org/api/artworks/' + row.id
    details.append(link, line('h3', row.title ?? 'No catalog record'))
    if (row.image && row.state === 'public_domain') {
      const asset = line('a', 'Museum image ↗')
      asset.href = row.image
      const paragraph = document.createElement('p')
      paragraph.append(asset)
      details.append(paragraph)
    }
    if (older) {
      const fields = [['state','Availability'], ['license','Share license'], ['image','Image URL'], ['title','Title']]
      const changes = fields.filter(([field]) => older[field] !== row[field])
      if (!changes.length) details.append(line('p','Unchanged from previous edition'))
      for (const [field, name] of changes) {
        const stringify = value => field === 'state' ? states[value] : String(value ?? '—')
        details.append(line('p', name + ' · ' + stringify(older[field]) + ' → ' + stringify(row[field])))
      }
    }
    const item = document.createElement('li')
    item.append(details, line('span', states[row.state], 'mark'))
    return item
  }))
}

async function load(key) {
  active = null
  const select = byId('revision')
  select.replaceChildren()
  select.disabled = true
  byId('records').replaceChildren()
  byId('record-title').textContent = key[1]
  const manifest = await read(address, 'get_manifest', key)
  if (!manifest) return status('No finalized editions for this publisher and register name.')
  active = {key, manifest}
  const url = new URL(location.href)
  url.searchParams.set('owner', key[0])
  url.searchParams.set('register', key[1])
  history.replaceState(null, '', url)
  byId('ids').value = manifest.ids.join(',')
  for (let revision = manifest.revision; revision >= 1; revision--) {
    select.add(new Option(String(revision), String(revision)))
  }
  await renderEdition(manifest.revision)
  select.disabled = false
  status('Showing finalized edition ' + manifest.revision + '.')
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
  byId(id).addEventListener(eventName, async event => {
    event.preventDefault()
    if (busy) return
    busy = true
    const controls = document.querySelectorAll('button, input')
    controls.forEach(control => { control.disabled = true })
    try {
      if (!address) throw Error('This build has no configured deployment.')
      await action()
    } catch (error) {
      status(error.shortMessage ?? error.message ?? String(error))
    } finally {
      controls.forEach(control => { control.disabled = false })
      busy = false
    }
  })
}

handle('lookup', 'submit', () => load(reference()))
handle('revision', 'change', async () => {
  const revision = Number(byId('revision').value)
  await renderEdition(revision)
  status('Showing finalized edition ' + revision + '.')
})
handle('capture', 'submit', async () => {
  byId('transaction').hidden = true
  if (!slugPattern.test(byId('slug').value)) throw Error('Use a valid register name.')
  const ids = byId('ids').value.split(',').map(id => id.trim())
  if (ids.length > 4 || ids.some(id => !/^[1-9][0-9]{0,8}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw Error('Enter one to four distinct artwork IDs.')
  }
  const {account, client} = await wallet()
  if (byId('owner').value && byId('owner').value.toLowerCase() !== account) {
    throw Error('This publisher differs from the connected wallet. Set Publisher wallet to your address or clear it.')
  }
  byId('owner').value = account
  const key = reference()
  const manifest = await read(address, 'get_manifest', key)
  const revision = manifest?.revision ?? 0
  if (manifest && manifest.ids.join(',') !== ids.map(Number).sort((a,b) => a - b).join(',')) {
    throw Error('This register has a fixed artwork list. Use a new register name for a different list.')
  }
  if (BigInt(await reader.request({method:'eth_gasPrice',params:[]})) !== 0n) {
    throw Error('Stable Studionet is reporting a nonzero gas price.')
  }
  status('Approve the capture in your wallet.')
  const link = byId('transaction')
  const hash = await client.writeContract({address, functionName:'capture', args:[key[1], ids.join(','), revision], value:0n, leaderOnly:false})
  link.href = explorer + '/transactions/' + hash
  link.hidden = false
  status('Submitted · awaiting consensus.')
  await waitForFinality(hash, stage => status('Consensus · ' + stage))
  await load(key)
  if (active?.manifest.revision === revision) status('Recheck finalized. Museum fields are unchanged.')
})

if (address && walletPattern.test(singleView.get('owner') ?? '') && slugPattern.test(singleView.get('register') ?? '')) {
  byId('owner').value = singleView.get('owner')
  byId('slug').value = singleView.get('register')
  byId('lookup').requestSubmit()
}

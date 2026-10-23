// NEAR wallets, hand-written against each wallet's own protocol, behind one small interface. Loaded lazily, only when
// someone connects a NEAR wallet.
//
// Meteor: its browser extension injects window.meteorComV2 (or the older window.meteorCom); without it, Meteor's web
// wallet opens in a popup and talks over postMessage. Both carry the same messages: the page repeats
// {uid, status, actionType, endTags, network, inputs} every 500 ms until the wallet answers closed_success (with the
// result) or closed_fail. The wallet fills in its own key and nonce, signs, broadcasts, and returns the outcomes.
//
// HOT: its browser extension injects window.hotExtension. Without it, the HOT app on a phone (or HOT's Telegram wallet)
// answers through HOT's relay at h4n.app: the page stores the request there, shows its link as a QR code, and polls
// for the answer. Either way the requests are near:signIn and near:signAndSendTransactions with JSON actions, and HOT
// signs, broadcasts and returns the outcomes.
import { encodeNearTransaction } from './near-tx.ts'
import { nearRpc, type NearTx } from './near.ts'
import { base58, errorText, toBase64 } from './format.ts'
import { hex } from './wormhole.ts'
import { relay } from './hot-relay.svelte.ts'
import { qrSvg } from './qr.ts'

export type NearWallet = {
  id: string
  name: string
  accountId: string
  // Sign and send the transactions in order, under one approval; resolves with each one's hash and signer. The signer
  // is not always the account: HOT sends for a nearly empty account through its own relayer.
  signAndSend: (txs: NearTx[]) => Promise<SentTx[]>
}
export type SentTx = { hash: string; signer: string }

// What a wallet returns for each transaction: a near-api-js FinalExecutionOutcome.
const sent = (outcomes: any[] | undefined, count: number, wallet: string): SentTx[] => {
  if (outcomes?.length !== count) throw new Error(`${wallet} returned ${outcomes?.length ?? 0} of ${count} transactions`)
  return outcomes.map((o) => ({ hash: o.transaction?.hash ?? o.transaction_outcome?.id, signer: o.transaction?.signer_id }))
}

const METEOR = 'https://wallet.meteorwallet.app'

type MeteorMessage = { uid: string; status: string; endTags?: string[]; payload?: any }
type MeteorExtension = { sendMessageData: (m: unknown) => void; addMessageDataListener: (l: (m?: MeteorMessage) => void) => void }
type MeteorExtensionV2 = { sendMessageDataAndRespond: (m: unknown) => Promise<MeteorMessage> }
const meteorV2 = () => (window as any).meteorComV2 as MeteorExtensionV2 | undefined
const meteorV1 = () => (window as any).meteorCom as MeteorExtension | undefined
export const meteorExtensionInstalled = () => !!(meteorV2() ?? meteorV1())

// A 21-character URL-safe id per action, as Meteor's SDK makes with nanoid.
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(21)), (b) => ID_CHARS[b & 63]).join('')

// One Meteor action. Call it straight from the click that asked for it: without the extension it opens the popup at
// once (browsers block popups opened later), and the inputs follow when they are ready.
function meteorAction(actionType: 'login' | 'sign', inputs: Promise<Record<string, unknown>>): Promise<any> {
  const id = uid()
  const extension = meteorV2() ?? meteorV1()
  let popup: Window | null = null
  if (!extension) {
    const q = new URLSearchParams({ connectionUid: id, pageUri: encodeURIComponent(location.href), source: 'wpm' })
    const x = Math.round(screenX + (outerWidth - 390) / 2), y = Math.round(screenY + (outerHeight - 650) / 2)
    popup = open(`${METEOR}/connect/mainnet/${actionType}?${q}`, '_blank', `popup=1,width=390,height=650,top=${y},left=${x}`)
    if (!popup) return Promise.reject(new Error('the browser blocked the Meteor popup; allow popups for this site'))
  }
  return new Promise((resolve, reject) => {
    let status = 'initializing'
    let ready: Record<string, unknown> | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    const stop = (fn: () => void) => {
      clearInterval(timer)
      removeEventListener('message', onMessage)
      status = 'done'
      fn()
    }
    const handle = (m?: MeteorMessage) => {
      if (!m || m.uid !== id || status === 'done') return
      if (m.status === 'connected') status = 'connected'
      else if (m.status === 'attempting_reconnect') status = 'initializing'
      else if (m.status === 'closed_success') {
        status = 'closed_success'
        tick() // acknowledge, as Meteor's SDK does
        stop(() => resolve(m.payload))
      } else if (m.status === 'closed_fail') {
        const tags = m.endTags ?? []
        stop(() => reject(new Error(tags.includes('USER_CANCELLED') ? 'cancelled in Meteor' : `Meteor: ${tags.join(', ') || 'failed'}`)))
      } else if (m.status === 'closed_window') stop(() => reject(new Error('cancelled in Meteor')))
    }
    // Only the popup we opened, from Meteor's own origin, is listened to.
    const onMessage = (e: MessageEvent) => {
      if (e.origin === METEOR && e.source === popup) handle(e.data)
    }
    function tick() {
      if (status === 'done' || !ready) return
      if (popup?.closed) return stop(() => reject(new Error('cancelled in Meteor')))
      const msg = { uid: id, status, actionType, endTags: [], network: 'mainnet', ...(status === 'initializing' ? { inputs: ready } : {}) }
      if (popup) popup.postMessage(msg, METEOR)
      else if (meteorV2()) meteorV2()!.sendMessageDataAndRespond(msg).then(handle, () => {})
      else meteorV1()!.sendMessageData(msg)
    }
    if (popup) addEventListener('message', onMessage)
    else if (!meteorV2()) meteorV1()!.addMessageDataListener(handle)
    inputs.then(
      (i) => {
        ready = i
        tick()
        timer = setInterval(tick, 500)
      },
      (e) => {
        popup?.close()
        stop(() => reject(e))
      },
    )
  })
}

// Signs in without adding an access key: every transaction here attaches NEAR, which only the wallet's own key can do.
export async function connectMeteor(): Promise<NearWallet> {
  const r = await meteorAction('login', Promise.resolve({ methods: [] }))
  if (!r?.accountId) throw new Error('Meteor did not return an account')
  return meteorWallet(r.accountId)
}

// A remembered connection, without prompting: Meteor needs only the account id, since it signs with its own keys.
export async function restoreNearWallet(id: string, accountId: string): Promise<NearWallet | undefined> {
  if (!accountId) return undefined
  if (id === 'meteor') return meteorWallet(accountId)
  if (id === 'hot') return hotExtension() ? hotWallet(accountId, 'extension') : undefined
  if (id === 'hot-app') return hotWallet(accountId, 'relay')
  return undefined
}

export function meteorWallet(accountId: string): NearWallet {
  return {
    id: 'meteor',
    name: 'Meteor',
    accountId,
    async signAndSend(txs) {
      // Meteor replaces the key and nonce with its own; the block hash must be recent.
      const inputs = nearRpc('block', { finality: 'final' }).then((b) => {
        const fake = crypto.getRandomValues(new Uint8Array(32))
        const encoded = txs.map((tx, i) => toBase64(encodeNearTransaction(accountId, fake, BigInt(i), tx, b.header.hash)))
        return { transactions: encoded.join(',') }
      })
      const r = await meteorAction('sign', inputs)
      return sent(r?.executionOutcomes, txs.length, 'Meteor').map((t) => ({ ...t, signer: t.signer ?? accountId }))
    },
  }
}

const HOT_RELAY = 'https://h4n.app'
type HotExtension = { request: (method: string, request: unknown) => Promise<any> }
const hotExtension = () => (window as any).hotExtension as HotExtension | undefined
export const hotExtensionInstalled = () => !!hotExtension()

// HOT reads the request as base58 of its characters' codes, so the JSON is kept to ASCII.
const asciiJson = (v: unknown) => JSON.stringify(v).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

// One request through the relay: store it, show its link until the HOT app answers, and return the answer's payload.
// The app refuses a request opened after its deadline (a minute). One opened in time may take a while to approve, so the
// page waits ten minutes in all, and says after the first minute that an unopened request has expired.
async function relayCall(method: string, request: unknown, what: string): Promise<any> {
  const deadline = Date.now() + 60_000
  const query = base58(new TextEncoder().encode(asciiJson({ method, request, deadline, id: crypto.randomUUID(), $hot: true, origin: location.href })))
  const id = hex(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(query))))
  const stored = await fetch(`${HOT_RELAY}/${id}/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: query }) })
  if (!stored.ok) throw new Error(`HOT relay refused the request (HTTP ${stored.status})`)
  const link = `https://app.hot-labs.org/link?hotcall-${id}`
  const qr = await qrSvg(link)
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (fn: () => void) => {
      done = true
      relay.current = undefined
      fn()
    }
    relay.current = { what, link, telegram: `https://t.me/hot_wallet/app?startapp=hotcall-${id}`, qr, expired: false, cancel: () => finish(() => reject(new Error('cancelled'))) }
    const poll = async () => {
      if (done) return
      try {
        const r = await (await fetch(`${HOT_RELAY}/${id}/response`, { cache: 'no-store' })).json()
        if (r?.data && !done) {
          const answer = JSON.parse(r.data)
          return finish(() => (answer.success ? resolve(answer.payload) : reject(new Error(answer.payload === 'Reject' ? 'cancelled in HOT' : `HOT: ${errorText(answer.payload)}`))))
        }
      } catch {
        // a dropped poll is retried
      }
      if (Date.now() > deadline + 9 * 60_000) return finish(() => reject(new Error('HOT did not answer; start again')))
      if (Date.now() > deadline && relay.current && !relay.current.expired) relay.current = { ...relay.current, expired: true }
      setTimeout(poll, 3000)
    }
    setTimeout(poll, 3000)
  })
}

// Signs in without adding an access key, as with Meteor.
export async function connectHot(): Promise<NearWallet> {
  const ext = hotExtension()
  const r = ext ? await ext.request('near:signIn', {}) : await relayCall('near:signIn', {}, 'Sign in with the NEAR account you want to use.')
  if (!r?.accountId) throw new Error('HOT did not return an account')
  return hotWallet(r.accountId, ext ? 'extension' : 'relay')
}

function hotWallet(accountId: string, via: 'extension' | 'relay'): NearWallet {
  return {
    id: via === 'extension' ? 'hot' : 'hot-app',
    name: via === 'extension' ? 'HOT' : 'HOT (phone)',
    accountId,
    async signAndSend(txs) {
      const transactions = txs.map((tx) => ({
        receiverId: tx.receiverId,
        actions: tx.actions.map((a) => ({ type: 'FunctionCall', params: { methodName: a.methodName, args: a.args, gas: a.gas.toString(), deposit: a.deposit.toString() } })),
      }))
      const what = `Approve ${txs.length} transaction${txs.length === 1 ? '' : 's'}: ${txs.map((tx) => tx.label.toLowerCase()).join(', ')}.`
      const r = via === 'extension' ? await hotExtension()!.request('near:signAndSendTransactions', { transactions }) : await relayCall('near:signAndSendTransactions', { transactions }, what)
      return sent(r?.transactions, txs.length, 'HOT').map((t) => ({ ...t, signer: t.signer ?? accountId }))
    },
  }
}

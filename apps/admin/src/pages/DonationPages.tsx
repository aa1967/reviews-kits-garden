import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Heart, ShieldCheck, Wallet } from 'lucide-react';
import QRCode from 'qrcode';
import { DONATION_COINS, DONATION_CURRENCIES, donationAtomicAmount, donationPaymentUri, type DonationAccountData, type DonationAdminData, type DonationCurrency, type DonationIdentity, type DonationPublicData, type DonationRecord, type DonationSettings, type DonationWallet } from '@reviewskits/types';
import { authClient } from '../lib/auth-client';
import { directoryRequest as api, useDirectory, type Account } from '../services/directory';
import { Shell } from './DirectoryPages';
import './donations.css';

const message = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
const localDate = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={'dir-notice' + (error ? ' dir-error' : '')} role={error ? 'alert' : 'status'}>{children}</div>;
}
function PaymentDetails({ currency, address, amount }: { currency: DonationCurrency; address: string; amount?: string }) {
  const [qr, setQr] = useState({ uri: '', src: '' }), [copied, setCopied] = useState(''), [copyError, setCopyError] = useState('');
  let uri = '', error = '';
  try { uri = donationPaymentUri(currency, address, amount); } catch (cause) { error = message(cause); }
  useEffect(() => {
    let cancelled = false;
    if (uri) QRCode.toDataURL(uri, { width: 220, margin: 2, errorCorrectionLevel: 'M' }).then((value) => {
      if (!cancelled) setQr({ uri, src: value });
    }).catch(() => { /* The address and wallet link remain usable without QR. */ });
    return () => { cancelled = true; };
  }, [uri]);
  return <div className="donation-payment">
    <div className="donation-qr">{qr.uri === uri && qr.src ? <img src={qr.src} width="220" height="220" alt={currency + ' donation payment QR code'} /> : <Wallet aria-hidden="true" size={46} />}</div>
    <div className="donation-payment-details"><p className="dir-small dir-muted">{DONATION_COINS[currency].name} mainnet receiving address</p><code className="dir-code donation-address">{address}</code>
      <div className="dir-row"><button className="dir-button secondary" type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(address); setCopied(address); setCopyError(''); } catch { setCopyError('Select and copy the receiving address above.'); }
      }}><Copy size={14} /> {copied === address ? 'Address copied' : 'Copy address'}</button>{uri && <a className="dir-button" href={uri}>Open {currency} wallet</a>}</div>
      {error && <Notice error>{error}</Notice>}{copyError && <Notice>{copyError}</Notice>}
      <p className="dir-small dir-muted">Send only {currency} on its mainnet. Network fees are paid separately. QR codes are generated on this device.</p>
    </div>
  </div>;
}

function PaymentReport({ donation, reload }: { donation: DonationRecord; reload: () => void }) {
  const [transactionId, setTransactionId] = useState(donation.transactionId ?? ''), [note, setNote] = useState(donation.donorNote), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <form onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/donations/' + donation.id + '/payment', 'PATCH', { transactionId, donorNote: note, updatedAt: donation.updatedAt }); reload(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }}>
    <label>Transaction ID<input value={transactionId} onChange={(e) => setTransactionId(e.target.value)} pattern="[a-fA-F0-9]{64}" maxLength={64} required autoComplete="off" /></label>
    <label>Private note for the administrator (optional)<textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
    <p className="dir-small dir-muted">Use the transaction ID from your sending wallet. Never enter a private key or seed phrase. Details stay private to you and administrators.</p>
    <button className="dir-button secondary" disabled={busy}>{busy ? 'Saving…' : 'Submit payment details'}</button>{error && <Notice error>{error}</Notice>}
  </form>;
}

function LeaderboardIdentity({ identity, accountName, reload, verified }: { identity: DonationIdentity; accountName: string; reload: () => void; verified: boolean }) {
  const [mode, setMode] = useState(identity.mode), [pseudonym, setPseudonym] = useState(identity.pseudonym ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  return <form className="donation-identity" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try { await api('/donations/identity', 'PUT', { mode, ...(mode === 'pseudonym' ? { pseudonym } : {}) }); reload(); setSuccess('Your persistent leaderboard identity has been saved.'); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }}><h3>Your leaderboard identity</h3><p className="dir-small dir-muted">Saved name: <strong>{identity.name}</strong>. This applies to all your public donations, including future donations, and does not change your review display name.</p>
    <label>Leaderboard name<select value={mode} onChange={(e) => setMode(e.target.value as DonationIdentity['mode'])}><option value="account">Use my account display name ({accountName})</option><option value="pseudonym">Use a persistent pseudonym</option></select></label>
    {mode === 'pseudonym' && <label>Supporter pseudonym<input value={pseudonym} onChange={(e) => setPseudonym(e.target.value)} required minLength={3} maxLength={40} autoComplete="off" placeholder="e.g. MoonBadger" /></label>}
    <p className="dir-small dir-muted">Pseudonyms are unique without regard to letter case. You can still keep individual donations anonymous.</p>
    <button className="dir-button secondary" disabled={busy || !verified}>{busy ? 'Saving…' : 'Save leaderboard identity'}</button>{error && <Notice error>{error}</Notice>}{success && <Notice>{success}</Notice>}
  </form>;
}

export function DonationPage() {
  const { data: session } = authClient.useSession();
  const account = useDirectory<Account>(session ? '/me' : null);
  const own = useDirectory<DonationAccountData>(session ? '/donations/me' : null);
  const [currency, setCurrency] = useState<DonationCurrency>('BTC'), [period, setPeriod] = useState<'all' | 'month'>('all');
  const [amount, setAmount] = useState(''), [publicCredit, setPublicCredit] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const data = useDirectory<DonationPublicData>('/donations?currency=' + currency + '&period=' + period);
  const current = data.data?.currency === currency && data.data.period === period ? data.data : undefined;
  const wallet = current?.wallets.find((entry) => entry.currency === currency);
  const verified = account.data?.user.emailVerified || account.data?.user.isSystemAdmin;
  const reload = () => { own.reload(); data.reload(); };
  const prepare = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      donationAtomicAmount(currency, amount);
      await api('/donations', 'POST', { currency, amount, publicCredit: Boolean(current?.leaderboardEnabled && publicCredit) });
      own.reload(); setSuccess('Receipt prepared. Use its payment details below, then submit your transaction ID. Payment is confirmed after an administrator checks the receiving wallet.');
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  return <Shell>
    <section className="dir-hero donation-hero"><div className="dir-icon"><Heart size={27} /></div><br /><span className="dir-eyebrow">Community supported. Independently moderated.</span>
      <h1>Help keep honest<br />reviews open.</h1><p className="dir-muted">Your donations help cover hosting and keep this directory running. Choose Bitcoin, Litecoin, or Monero. Give anonymously or request a private donation receipt.</p>
      {account.data?.user.isSystemAdmin && <Link className="dir-button secondary" to="/donations/manage"><ShieldCheck size={15} /> Manage donations</Link>}
    </section>
    {error && <Notice error>{error}</Notice>}{success && <Notice>{success}</Notice>}
    <div className={'dir-columns donation-columns' + (!current?.leaderboardEnabled ? ' donation-single' : '')}><section className="dir-card" aria-label="Make a donation">
      <h2>Choose your currency</h2><div className="donation-coins">{DONATION_CURRENCIES.map((coin) => <button type="button" key={coin} className={'dir-button secondary' + (currency === coin ? ' active' : '')} aria-pressed={currency === coin} onClick={() => { setCurrency(coin); setAmount(''); setSuccess(''); setError(''); }}><strong>{coin}</strong><span>{DONATION_COINS[coin].name}</span></button>)}</div>
      {data.error && <Notice error>{data.error}</Notice>}
      {!current && !data.error ? <p>Loading donation details…</p> : wallet?.enabled ? <>
        <label>Amount in {currency} (optional)<input inputMode="decimal" value={amount} maxLength={26} placeholder="Choose an amount" onChange={(e) => setAmount(e.target.value)} /></label>
        <PaymentDetails currency={currency} address={wallet.address} amount={amount || undefined} />
        <div className="dir-divider" /><h3>Anonymous by default</h3><p className="dir-small dir-muted">You can send directly to this address without an account. Your name will not appear on our site. Administrators add verified anonymous donations to the received total.</p>
        {session && current?.leaderboardEnabled && own.data && <LeaderboardIdentity identity={own.data.identity} accountName={account.data?.user.name ?? session.user.name} verified={Boolean(verified)} reload={own.reload} />}
        {session ? <form onSubmit={prepare}><h3>{current?.leaderboardEnabled ? 'Want a receipt or public credit?' : 'Want a private receipt?'}</h3>
          <p className="dir-small dir-muted">Prepare a receipt before sending so we can match the transfer to your account. Existing receipts keep their original receiving address.</p>
          {current?.leaderboardEnabled && <label className="donation-check"><input type="checkbox" checked={publicCredit} onChange={(e) => setPublicCredit(e.target.checked)} /> Show {own.data?.identity.name ?? account.data?.user.name ?? 'my saved name'} and this donation amount on the public leaderboard</label>}
          <p className="dir-small dir-muted">{current?.leaderboardEnabled ? 'Leave this unchecked to stay anonymous publicly. ' : 'The public leaderboard is currently off. '}Administrators can see receipts submitted from your account.</p>
          {!verified && <Notice>Verify your email before preparing a receipt.</Notice>}
          <button className="dir-button" disabled={busy || !verified || !amount}>{busy ? 'Preparing…' : 'Prepare donation receipt'}</button>
        </form> : <p className="dir-small"><Link className="dir-link" to="/login" state={{ from: '/donate' }}>Sign in</Link> to prepare a receipt{current?.leaderboardEnabled ? ' or request public credit under your display name or a pseudonym' : ''}. Anonymous donations do not require sign-in.</p>}
      </> : current && <Notice>{DONATION_COINS[currency].name} donations are not open yet. Please check back soon.</Notice>}
    </section>
    {current?.leaderboardEnabled && <section className="dir-card" id="leaderboard" aria-label="Donation leaderboard"><span className="dir-eyebrow">Thank you for your support</span><h2>{currency} supporters</h2>
      <label>Leaderboard period<select value={period} onChange={(e) => setPeriod(e.target.value as 'all' | 'month')}><option value="all">All time</option><option value="month">This month (UTC)</option></select></label>
      <div className="donation-total"><strong>{current?.totalAmount ?? '…'} <span>{currency}</span></strong><p className="dir-small dir-muted">Verified donations received, including anonymous contributions</p></div>
      {current && (current.leaders.length ? <ol className="donation-leaders">{current.leaders.map((entry) => <li key={entry.rank}><span className="donation-rank">{entry.rank}</span><span className="donation-donor">{entry.name}</span><strong>{entry.amount} <span>{currency}</span></strong></li>)}</ol> : <p className="dir-muted">No public supporters for this period yet. Anonymous contributions stay off this list.</p>)}
      <p className="dir-small dir-muted">Only confirmed donations with public credit enabled appear here, under each donor's saved name or pseudonym. Rankings are separate for each currency; there is no exchange-rate conversion.</p>
    </section>}</div>
    {session && <section aria-label="My donations"><div className="dir-row dir-between"><h2>Your donation receipts</h2><button className="dir-link" onClick={async () => {
      setError(''); try { await api('/donations/hide-all', 'POST', {}); reload(); setSuccess('All of your donations are now anonymous publicly.'); } catch (cause) { setError(message(cause)); }
    }}>Make all my donations anonymous</button></div>
      {own.error && <Notice error>{own.error}</Notice>}{own.data?.donations.length === 0 && <p className="dir-muted">Your prepared receipts will appear here. Direct anonymous transfers do not require a receipt.</p>}
      {own.data?.donations.map((entry) => <article className="dir-card" key={entry.id} data-donation-id={entry.id}><div className="dir-row dir-between"><h3>{entry.amount ?? entry.declaredAmount} {entry.currency}</h3><span className={'dir-tag ' + entry.status}>{entry.status}</span></div>
        <p className="dir-small dir-muted">{entry.publicCredit ? current?.leaderboardEnabled ? 'Public credit uses your saved leaderboard identity' : 'Public credit saved; the leaderboard is currently off' : 'Anonymous on the public leaderboard'} · Prepared {new Date(entry.createdAt).toLocaleString()}</p>
        {(entry.publicCredit || current?.leaderboardEnabled) && <button className="dir-link" onClick={async () => {
          try { await api('/donations/' + entry.id + '/visibility', 'PATCH', { publicCredit: !entry.publicCredit }); reload(); } catch (cause) { setError(message(cause)); }
        }}>{entry.publicCredit ? 'Make anonymous' : 'Show on leaderboard'}</button>}
        {entry.decisionReason && <Notice>{entry.decisionReason}</Notice>}
        {entry.status === 'pending' && <details open={!entry.transactionId}><summary>Payment details and verification</summary><PaymentDetails currency={entry.currency} address={entry.walletAddress} amount={entry.declaredAmount} />
          <PaymentReport key={entry.updatedAt} donation={entry} reload={own.reload} /></details>}
      </article>)}
    </section>}
    <section className="dir-card"><h2>A little clarity before you give</h2><p>Donations never influence review scores, publication decisions, or moderation privileges.</p>
      <p className="dir-small dir-muted">Anonymous means your donation is excluded from our public supporter rankings. Bitcoin and Litecoin transfers remain visible on their public blockchains. Monero transfers are checked privately in the receiving wallet; a public block explorer cannot confirm their amounts.</p>
      <p className="dir-small dir-muted">No payment is considered received until an administrator verifies it. We never ask for wallet private keys or seed phrases.</p>
    </section>
  </Shell>;
}

function WalletSettings({ wallet, reload }: { wallet: DonationWallet; reload: () => void }) {
  const [address, setAddress] = useState(wallet.address), [enabled, setEnabled] = useState(wallet.enabled), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <form className="dir-card" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/donations/admin/wallets/' + wallet.currency, 'PUT', { address, enabled, updatedAt: wallet.updatedAt }); reload(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }}><h3>{DONATION_COINS[wallet.currency].name} · {wallet.currency}</h3><label>{wallet.currency} mainnet receiving address<input value={address} maxLength={120} autoComplete="off" onChange={(e) => setAddress(e.target.value)} /></label>
    <label className="donation-check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Accept {wallet.currency} donations</label>
    <button className="dir-button secondary" disabled={busy}>{busy ? 'Saving…' : 'Save ' + wallet.currency + ' wallet'}</button>{error && <Notice error>{error}</Notice>}
  </form>;
}

function LeaderboardSettings({ settings, reload }: { settings: DonationSettings; reload: () => void }) {
  const [enabled, setEnabled] = useState(settings.leaderboardEnabled), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <form className="dir-card" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/donations/admin/settings', 'PUT', { leaderboardEnabled: enabled, updatedAt: settings.updatedAt }); reload(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }}><h2>Optional public leaderboard</h2><label className="donation-check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enable the public donation leaderboard</label>
    <p className="dir-small dir-muted">Off by default. Donations continue when it is off, with no public rankings or donor names. Turning it back on restores confirmed entries whose donors still allow public credit. Donors may use a persistent pseudonym.</p>
    <button className="dir-button secondary" disabled={busy}>{busy ? 'Saving…' : 'Save leaderboard setting'}</button>{error && <Notice error>{error}</Notice>}
  </form>;
}

function DonationDecision({ donation, reload }: { donation: DonationRecord; reload: () => void }) {
  const [status, setStatus] = useState(donation.status === 'confirmed' ? 'reversed' : 'confirmed'), [amount, setAmount] = useState(''), [transactionId, setTransactionId] = useState(donation.transactionId ?? ''), [receivedAt, setReceivedAt] = useState(localDate), [reason, setReason] = useState(''), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <form className="donation-decision" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/donations/admin/' + donation.id + '/decision', 'POST', { status, ...(status === 'confirmed' ? { amount, transactionId, receivedAt: new Date(receivedAt).toISOString(), walletVerified: checked } : {}), reason, updatedAt: donation.updatedAt }); reload(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }}>
    {donation.status === 'pending' ? <label>Decision<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="confirmed">Confirm received</option><option value="rejected">Reject this request</option></select></label> : <h3>Reverse this confirmation</h3>}
    {status === 'confirmed' && <><div className="donation-form-grid"><label>Amount actually received ({donation.currency})<input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={26} /></label><label>Received at (your local time)<input type="datetime-local" required value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} /></label></div>
      <label>Verified transaction ID<input required pattern="[a-fA-F0-9]{64}" maxLength={64} value={transactionId} onChange={(e) => setTransactionId(e.target.value)} /></label>
      <label className="donation-check"><input type="checkbox" required checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I verified the transfer and donor attribution in the receiving wallet</label></>}
    <label>Reason shared with the donor<textarea value={reason} minLength={10} maxLength={1000} required onChange={(e) => setReason(e.target.value)} /></label>
    <button className={'dir-button' + (status === 'reversed' ? ' danger' : '')} disabled={busy}>{busy ? 'Saving…' : status === 'reversed' ? 'Reverse donation confirmation' : 'Save donation decision'}</button>{error && <Notice error>{error}</Notice>}
  </form>;
}

function RecordAnonymousDonation({ wallets, reload }: { wallets: DonationWallet[]; reload: () => void }) {
  const [currency, setCurrency] = useState<DonationCurrency>('BTC'), [address, setAddress] = useState(wallets.find((entry) => entry.currency === 'BTC')?.address ?? ''), [amount, setAmount] = useState(''), [transactionId, setTransactionId] = useState(''), [receivedAt, setReceivedAt] = useState(localDate), [reason, setReason] = useState(''), [checked, setChecked] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [success, setSuccess] = useState('');
  return <details className="dir-card"><summary>Record a direct anonymous donation received in your wallet</summary><p className="dir-small dir-muted">Use this for donations sent without an account or receipt. This entry can never grant public credit to an account.</p><form onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try { await api('/donations/admin/received', 'POST', { currency, amount, walletAddress: address, transactionId, receivedAt: new Date(receivedAt).toISOString(), reason, walletVerified: checked }); setAmount(''); setTransactionId(''); setReason(''); setChecked(false); setSuccess('Verified anonymous donation recorded.'); reload(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }}><div className="donation-form-grid"><label>Received currency<select value={currency} onChange={(e) => { const coin = e.target.value as DonationCurrency; setCurrency(coin); setAddress(wallets.find((entry) => entry.currency === coin)?.address ?? ''); }}>
      {DONATION_CURRENCIES.map((coin) => <option value={coin} key={coin}>{coin}</option>)}</select></label><label>Amount received<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={26} required /></label></div>
    <label>Receiving address<input required value={address} maxLength={120} onChange={(e) => setAddress(e.target.value)} /></label><label>Transaction ID<input required pattern="[a-fA-F0-9]{64}" value={transactionId} maxLength={64} onChange={(e) => setTransactionId(e.target.value)} /></label>
    <label>Received at (your local time)<input required type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} /></label><label>Verification note<textarea required minLength={10} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    <label className="donation-check"><input type="checkbox" required checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I verified this transfer in the receiving wallet</label>
    <button className="dir-button" disabled={busy}>{busy ? 'Saving…' : 'Record anonymous donation'}</button>{error && <Notice error>{error}</Notice>}{success && <Notice>{success}</Notice>}
  </form></details>;
}

export function ManageDonationsPage() {
  const account = useDirectory<Account>('/me');
  const [status, setStatus] = useState('pending'), [page, setPage] = useState(1);
  const data = useDirectory<DonationAdminData>(account.data?.user.isSystemAdmin ? '/donations/admin?status=' + status + '&page=' + page : null);
  if (!account.data) return <Shell>{account.error ? <Notice error>{account.error}</Notice> : <p>Loading donation management…</p>}</Shell>;
  if (!account.data.user.isSystemAdmin) return <Shell><Notice error>Donation management is restricted to platform administrators.</Notice></Shell>;
  return <Shell><div className="dir-row dir-between"><div><span className="dir-eyebrow">Platform administration</span><h1>Donations</h1></div><Link className="dir-button secondary" to="/donate">View donation page</Link></div>
    <p className="dir-muted">Configure receiving addresses, verify payments in your wallets, and manage supporter credit. Keep wallet keys outside this application.</p>
    {data.error && <Notice error>{data.error}</Notice>}
    {data.data && <LeaderboardSettings key={data.data.settings.updatedAt} settings={data.data.settings} reload={data.reload} />}
    <div className="dir-grid">{data.data?.wallets.map((entry) => <WalletSettings key={entry.currency + entry.updatedAt} wallet={entry} reload={data.reload} />)}</div>
    {data.data && <RecordAnonymousDonation key={data.data.wallets.map((entry) => entry.updatedAt).join(',')} wallets={data.data.wallets} reload={data.reload} />}
    <div className="dir-row dir-between"><h2>Donation verification</h2><button className="dir-link" onClick={data.reload}>Refresh donations</button></div>
    <p className="dir-small dir-muted">Verify receipt, confirmations, actual amount, and attribution independently. A public transaction ID alone does not prove who paid. Monero amounts must be checked in your receiving wallet.</p>
    <label>Donation status<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="rejected">Rejected</option><option value="reversed">Reversed</option><option value="all">All donations</option></select></label>
    {data.data?.donations.length === 0 && <p className="dir-muted">No donations in this queue.</p>}
    {data.data?.donations.map((entry) => <article className="dir-card" key={entry.id} data-donation-id={entry.id}><div className="dir-row dir-between"><h3>{entry.amount ?? entry.declaredAmount} {entry.currency}</h3><span className={'dir-tag ' + entry.status}>{entry.status}</span></div>
      <p>{entry.donor ? entry.donor.name + ' · ' + entry.donor.email : 'Anonymous direct donation'}<br /><span className="dir-small dir-muted">{entry.publicCredit ? 'Donor opted into public credit' : 'Keep anonymous publicly'} · Prepared {new Date(entry.createdAt).toLocaleString()}</span></p>
      <p className="dir-small dir-muted">Receiving address</p><code className="dir-code donation-address">{entry.walletAddress}</code><p className="dir-small">Transaction ID: {entry.transactionId ?? 'Not submitted yet'}</p>
      {entry.donorNote && <Notice>{entry.donorNote}</Notice>}{entry.decisionReason && <p className="dir-small">Previous decision: {entry.decisionReason}</p>}
      {['pending', 'confirmed'].includes(entry.status) && <DonationDecision key={entry.updatedAt} donation={entry} reload={data.reload} />}
    </article>)}
    <div className="dir-row">{page > 1 && <button className="dir-button secondary" onClick={() => setPage(page - 1)}>Previous page</button>}{data.data && page * 30 < data.data.total && <button className="dir-button secondary" onClick={() => setPage(page + 1)}>Next page</button>}</div>
  </Shell>;
}

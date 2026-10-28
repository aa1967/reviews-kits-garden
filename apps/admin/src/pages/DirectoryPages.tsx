import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, ArrowRight, Check, Copy, Globe, Moon, Search, ShieldCheck, Sun } from 'lucide-react';
import { authClient } from '../lib/auth-client';
import { directoryRequest as api, useDirectory, type Account, type Business, type Claim, type Evidence, type Managed, type Moderation, type Monitoring, type Review, type Score } from '../services/directory';
import { BusinessAdministration } from './AdministrationPages';
import { useTheme } from '../hooks/useTheme';
import { ProfileAvatar } from '../components/profile-avatar';
import { ResolutionRequest, ResolutionResponse, ReviewPrivacy } from './ReviewActions';
import { UserAdministration } from './UserAdministration';
import './directory.css';

const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not yet checked';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
const categories = ['Software', 'Shopping', 'Professional services', 'Education', 'Travel', 'Health', 'Other'];
const button = 'dir-button';

export function Shell({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession();
  const account = useDirectory<Account>(session ? '/me' : null);
  const { theme, toggleTheme } = useTheme();
  return <div className="directory">
    <nav className="dir-nav" aria-label="Main navigation">
      <Link className="dir-brand" to="/">reviews<span>kits.</span></Link>
      <div className="dir-nav-links">
        <Link to="/">Explore businesses</Link>
        <Link to="/donate">Donate</Link>
        {session ? <>
          <Link to="/dashboard">My dashboard</Link><Link to="/settings">Profile & settings</Link>
          {account.data?.user.isSystemAdmin && <><Link to="/moderation"><ShieldCheck size={13} style={{ display: 'inline' }} /> Administration</Link><Link to="/site-settings">Site settings & themes</Link></>}
          <button className="dir-link" onClick={async () => { await authClient.signOut(); window.location.href = '/'; }}>Sign out</button>
        </> : <><Link to="/login">Sign in</Link><Link className={button} to="/signup">Get started <ArrowRight size={14} /></Link></>}
        <button className="dir-link" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light ruby red' : 'Switch to dark ruby red'} title={theme === 'dark' ? 'Light ruby red' : 'Dark ruby red'}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
      </div>
    </nav>
    <main className="dir-main">{children}<footer className="dir-foot">Independent reviews. Business ownership is verified separately from review authenticity. <Link to="/principles">How we build trust</Link></footer></main>
  </div>;
}
function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div role={error ? 'alert' : 'status'} className={'dir-notice' + (error ? ' dir-error' : '')}>{children}</div>; }
function Tag({ children, status = '' }: { children: ReactNode; status?: string }) { return <span className={'dir-tag ' + status}>{children}</span>; }
function Stars({ rating }: { rating: number }) { return <span className="dir-stars" aria-label={rating + ' out of 5'}>{'★'.repeat(Math.max(0, Math.min(5, Math.round(rating))))}{'☆'.repeat(Math.max(0, 5 - Math.round(rating)))}</span>; }
function CopyCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return <><code className="dir-code">{value}</code><button className={button + ' secondary'} onClick={async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setError(''); } catch { setError('Select and copy the code above.'); }
  }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button>{error && <p>{error}</p>}</>;
}
function TextAction({ path, label, field = 'reason', extra, onSuccess }: { path: string; label: string; field?: string; extra?: Record<string, unknown>; onSuccess?: () => void }) {
  const [text, setText] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [ok, setOk] = useState(false);
  return <form onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setMessage('');
    try { await api(path, 'POST', { [field]: text, ...extra }); setOk(true); setMessage('Saved.'); setText(''); onSuccess?.(); } catch (error) { setOk(false); setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }}><label>{label}<textarea required minLength={field === 'reply' ? 2 : 10} maxLength={field === 'reply' ? 3000 : 2000} value={text} onChange={(e) => setText(e.target.value)} /></label>
    <button className={button + ' secondary'} disabled={busy}>{field === 'reply' ? 'Post business response' : 'Submit'}</button>{message && <Notice error={!ok}>{message}</Notice>}</form>;
}
function Verification({ account, reload }: { account: Account; reload: () => void }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  if (account.user.emailVerified || account.user.isSystemAdmin) return null;
  return <Notice><strong>Verify your email to write reviews or claim a website.</strong><p>{account.emailConfigured ? 'We sent a verification link when you registered. Check your inbox and spam folder.' : 'Email verification is temporarily unavailable. Please contact platform support.'}</p>
    <button className={button + ' secondary'} disabled={busy || !account.emailConfigured} onClick={async () => { setBusy(true); try { await api('/verification-email', 'POST'); setMessage('Verification email sent.'); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); } }}>Resend verification</button>{' '}
    <button className="dir-link" onClick={reload}>I have verified my email</button>{message && <p>{message}</p>}
  </Notice>;
}

export function DirectoryHome() {
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [category, setCategory] = useState(''), [page, setPage] = useState(1);
  const data = useDirectory<{ businesses: Business[]; total: number }>('/businesses?' + new URLSearchParams({ q: query, category, page: String(page) }));
  return <Shell><section className="dir-hero"><span className="dir-eyebrow">Real experiences. A clearer picture.</span>
    <h1>Find your next<br /><span style={{ color: 'var(--v3-accent)' }}>good experience.</span></h1>
    <p className="dir-muted">Explore independently moderated reviews and see how websites perform. Share your experience, or claim your business and join the conversation.</p>
    <form className="dir-search" onSubmit={(e) => { e.preventDefault(); setQuery(search); setPage(1); }}><input aria-label="Search business or website" placeholder="Search a business or website…" value={search} onChange={(e) => setSearch(e.target.value)} /><button className={button}><Search size={17} /> Search</button></form>
    <div className="dir-pills" style={{ justifyContent: 'center' }}>{['All', ...categories].map((label) => <button key={label} className={button + ' secondary' + ((category || 'All') === label ? ' active' : '')} onClick={() => { setCategory(label === 'All' ? '' : label); setPage(1); }}>{label}</button>)}</div>
  </section>
    <div className="dir-row dir-between"><h2>Explore the directory</h2><span className="dir-muted dir-small">{data.data?.total ?? 0} businesses · independent moderation</span></div>
    {data.error && <Notice error>{data.error}</Notice>}
    {data.loading ? <div className="dir-empty">Loading businesses…</div> : !data.data?.businesses.length ? <div className="dir-empty"><Globe size={32} style={{ margin: '0 auto 16px' }} /><h3>{query ? 'No matching businesses yet' : 'Every trusted directory starts somewhere'}</h3><p>Add a website to create its public listing. Owners can verify their claim afterward.</p><Link className={button} to="/dashboard">Add a business <ArrowRight size={14} /></Link></div> :
      <div className="dir-grid">{data.data.businesses.map((site) => <Link className="dir-card interactive" to={'/business/' + site.domain} key={site.id}><div className="dir-icon"><Globe size={23} /></div><div className="dir-row dir-between"><h3>{site.name}</h3>{site.claimed && <Tag status="verified">Domain verified</Tag>}</div><div className="dir-domain">{site.domain}</div><p className="dir-muted dir-small">{site.category}</p>{site.permanentlyClosed && <Tag status="closed">Permanently closed</Tag>}{site.reviewsClosed && !site.permanentlyClosed && <Tag>Reviews closed</Tag>}<div className="dir-row"><Stars rating={site.score?.average ?? 0} /><strong>{site.score?.average ?? '—'}</strong><span className="dir-muted dir-small">{site.score?.count ?? 0} reviews</span></div></Link>)}</div>}
    <div className="dir-row" style={{ marginTop: 24 }}>{page > 1 && <button className={button + ' secondary'} onClick={() => setPage(page - 1)}>Previous</button>}{page * 24 < (data.data?.total ?? 0) && <button className={button + ' secondary'} onClick={() => setPage(page + 1)}>Next page</button>}</div>
  </Shell>;
}

export function DirectoryAuth() {
  const location = useLocation();
  const requested = (location.state as { from?: string } | null)?.from;
  const destination = requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/dashboard';
  const signup = window.location.pathname === '/signup';
  const { data: session, isPending } = authClient.useSession();
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  if (session && !isPending) return <Navigate to={destination} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const result = signup ? await authClient.signUp.email({ email, password, name, callbackURL: window.location.origin + destination }) : await authClient.signIn.email({ email, password, callbackURL: window.location.origin + destination });
      if (result.error) throw new Error(result.error.message || (signup ? 'Unable to create your account.' : 'Unable to sign in.'));
      window.location.href = destination;
    } catch (cause) { setError(errorMessage(cause)); setBusy(false); }
  };
  return <Shell><div className="dir-auth"><span className="dir-eyebrow">One account. Your voice.</span><h1>{signup ? 'Join the conversation.' : 'Welcome back.'}</h1><p className="dir-muted">{signup ? 'Write reviews, claim a website, and manage your business in one place.' : 'Sign in to review a business or manage your website.'}</p><form className="dir-card" onSubmit={submit}>
    {signup && <label>Your public display name<input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>}
    <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label>Password<input type="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {error && <Notice error>{error}</Notice>}<button className={button} disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'} <ArrowRight size={14} /></button>
  </form><p className="dir-small dir-muted">{signup ? 'Already a member? ' : 'New here? '}<Link to={signup ? '/login' : '/signup'}>{signup ? 'Sign in' : 'Create an account'}</Link></p><p className="dir-small dir-muted">Your email is private. Your display name appears with your reviews.</p></div></Shell>;
}

function ReviewEditor({ siteId, initial, onSuccess, defaultAnonymous = false }: { siteId: string; initial?: Account['reviews'][number]; onSuccess: () => void; defaultAnonymous?: boolean }) {
  const [title, setTitle] = useState(initial?.title ?? ''), [content, setContent] = useState(initial?.content ?? ''), [rating, setRating] = useState(initial?.rating ?? 5), [honey, setHoney] = useState('');
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [ok, setOk] = useState(false);
  const [anonymous, setAnonymous] = useState(initial?.anonymous ?? defaultAnonymous);
  return <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setMessage(''); try {
    await api(initial ? '/reviews/' + initial.id : '/businesses/' + siteId + '/reviews', initial ? 'PATCH' : 'POST', { title, content, rating, anonymous, _honey: honey });
    setOk(true); setMessage('Thank you. Your review is awaiting independent moderation.'); onSuccess();
  } catch (error) { setOk(false); setMessage(errorMessage(error)); } finally { setBusy(false); } }}>
    <label>Rating<select aria-label="Rating" value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} out of 5</option>)}</select></label>
    <label>Review title<input required minLength={3} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label>Your first-hand experience<textarea required minLength={20} maxLength={5000} value={content} onChange={(e) => setContent(e.target.value)} /></label>
    <label className="account-check"><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />Post this review anonymously</label><p className="dir-small dir-muted">Anonymous reviews hide your public name and picture. Moderators retain account attribution. You can change this later from My dashboard.</p>
    <div className="dir-hidden-field" aria-hidden="true"><label>Leave this field empty<input tabIndex={-1} autoComplete="off" value={honey} onChange={(e) => setHoney(e.target.value)} /></label></div>
    <p className="dir-small dir-muted">Both positive and negative experiences are welcome. Avoid private personal information. Every edit returns the review to moderation.</p>
    <button className={button} disabled={busy}>{initial ? 'Save for review' : 'Submit review'}</button>{message && <Notice error={!ok}>{message}</Notice>}
  </form>;
}
function ReviewCard({ review, canReply = false, canRequestResolution = false, onChange }: { review: Review; canReply?: boolean; canRequestResolution?: boolean; onChange?: () => void }) {
  const { data: session } = authClient.useSession();
  return <article className="dir-card"><div className="dir-review-head"><div className="account-review-author">{!review.anonymous && review.avatar && <ProfileAvatar image={review.avatar} name={review.author} />}<div><strong>{review.author}</strong>{' '}{review.emailVerified && <Tag status="verified">Email verified</Tag>}<div className="dir-muted dir-small">{date(review.createdAt)}</div></div></div><Stars rating={review.rating} /></div>
    <h3>{review.title}</h3><p className="dir-review-body">{review.content}</p>
    {review.resolutionAccepted && <div className="dir-notice"><Tag status="verified">Resolution confirmed by reviewer</Tag>{review.resolutionNote && <p>{review.resolutionNote}</p>}</div>}
    {review.reply && <div className="dir-reply"><strong className="dir-small">Business response</strong><p>{review.reply}</p><span className="dir-muted dir-small">{date(review.replyAt)}</span></div>}
    {session && <details><summary>Report this review</summary><TextAction path={'/reviews/' + review.id + '/reports'} label="Explain the concern (at least 10 characters)" /></details>}
    {canReply && <details open={!review.reply}><summary>{review.reply ? 'Update business response' : 'Respond as the business'}</summary><TextAction path={'/reviews/' + review.id + '/reply'} label="Public business response" field="reply" onSuccess={onChange} /></details>}
    {canRequestResolution && <ResolutionRequest review={review} reload={onChange} />}
  </article>;
}
function MonitorPanel({ data }: { data: Monitoring | null }) {
  if (!data?.started) return <p className="dir-muted dir-small">Website monitoring has not been enabled by the verified owner.</p>;
  return <><div className="dir-row dir-between"><h2><Activity size={20} style={{ display: 'inline' }} /> Website availability</h2><Tag status={data.status}>{data.status}</Tag></div>
    <p className="dir-muted dir-small">Observed from one monitoring location since {date(data.since)}. Gaps are unknown; availability percentages use observed periods.</p>
    <div className="dir-metrics">{data.windows.map((w) => <div className="dir-metric" key={w.days}><span className="dir-muted dir-small">{w.days === 1 ? '24 hours' : w.days + ' days'}</span><strong>{w.uptimePercent === null ? '—' : w.uptimePercent + '%'}</strong><span className="dir-small dir-muted">{w.coveragePercent}% coverage · {w.observedDowntimeMinutes} min down</span></div>)}</div>
    <p className="dir-small dir-muted">Latest check: {date(data.lastCheckAt)} · Response: {data.responseMs === null ? '—' : data.responseMs + ' ms'}<br />{data.incidentCount} incidents · longest observed incident {data.longestIncidentMinutes} minutes</p>
    <p className="dir-small dir-muted">TLS certificate expiry: {data.tlsExpiresAt ? date(data.tlsExpiresAt) : 'Unknown'} · Widget in initial HTML: {data.widgetInstalled === null ? 'Unknown' : data.widgetInstalled ? 'Detected' : 'Not detected'}</p>
    {!!data.incidents.length && <details><summary>Outage history</summary><div className="dir-table-wrap"><table className="dir-table"><thead><tr><th>First observed failure</th><th>Ended</th><th>Reason</th></tr></thead><tbody>{data.incidents.map((i) => <tr key={i.id}><td>{date(i.startedAt)}</td><td>{i.endedAt ? date(i.endedAt) : 'Open · see current coverage'}</td><td>{i.reason}</td></tr>)}</tbody></table></div></details>}
  </>;
}
function ClaimProof({ domain, claim, onChange }: { domain: string; claim: Claim; onChange: () => void }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  return <div className="dir-notice"><div className="dir-row dir-between"><strong>{claim.method === 'dns' ? 'Add this DNS TXT record' : 'Upload this verification file'}</strong><Tag status={claim.status}>{claim.status}</Tag></div>
    {claim.method === 'dns' ? <><p className="dir-small">Record name: <strong>_reviewskits-verify.{domain}</strong></p><p className="dir-small">TXT value:</p><CopyCode value={claim.token} /></> :
      <><p className="dir-small">Serve this exact text at:</p><code className="dir-code">https://{domain}/.well-known/reviewskits-verification.txt</code><CopyCode value={claim.token} /></>}
    <p className="dir-small">Automatic checks run every five minutes. Expires {date(claim.expiresAt)}. This verifies this exact hostname. Keep the proof published: ownership is rechecked daily, with seven days to restore a missing proof.</p>
    {claim.lastError && <p className="dir-small">{claim.lastError}</p>}
    {claim.status === 'pending' && <button disabled={busy} className={button + ' secondary'} onClick={async () => { setBusy(true); try { await api('/claims/' + claim.id + '/check', 'POST'); setMessage('Verification checked.'); onChange(); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); } }}>Check now</button>}
    {claim.status === 'verified' && <Link className={button} to={'/business/' + domain + '/manage'}>Open business dashboard</Link>}{message && <p className="dir-small">{message}</p>}
  </div>;
}
export function BusinessDirectoryPage() {
  const { domain = '' } = useParams(); const [page, setPage] = useState(1);
  const site = useDirectory<{ business: Business; score: Score; reviews: Review[]; monitoring: Monitoring | null }>('/businesses/' + encodeURIComponent(domain) + '?page=' + page, 60000);
  const { data: session } = authClient.useSession(); const account = useDirectory<Account>(session ? '/me' : null, 30000);
  const [method, setMethod] = useState<'dns' | 'file'>('dns'), [claimError, setClaimError] = useState(''), [busy, setBusy] = useState(false);
  if (site.error) return <Shell><Notice error>{site.error}</Notice><Link to="/">Back to the directory</Link></Shell>;
  if (!site.data) return <Shell><div className="dir-empty">Loading website…</div></Shell>;
  const { business, score, reviews, monitoring } = site.data;
  const ownReview = account.data?.reviews.find((r) => r.domain === domain);
  const claim = account.data?.claims.find((r) => r.domain === domain)?.claim;
  const manages = account.data?.businesses.some((b) => b.id === business.id) || account.data?.user.isSystemAdmin;
  return <Shell><Link className="dir-link" to="/">← Explore businesses</Link><div className="dir-row dir-between" style={{ margin: '20px 0 32px' }}><div><span className="dir-eyebrow">{business.category}</span><h1>{business.name}</h1><a className="dir-domain" href={'https://' + business.domain} target="_blank" rel="noopener noreferrer">{business.domain} ↗</a></div><Tag status={business.claimed ? 'verified' : ''}>{business.claimed ? 'Domain ownership verified' : 'Unclaimed business'}</Tag></div>
    {business.permanentlyClosed && <Notice><strong>Permanently closed</strong><p>This business is marked permanently closed. Published reviews and scores are retained. New reviews and author edits are closed.</p></Notice>}
    {business.reviewsClosed && !business.permanentlyClosed && <Notice><strong>Reviews are closed for this business.</strong><p>Published experiences remain visible. New submissions and author edits are paused by platform administrators.</p></Notice>}
    {account.data?.user.isSystemAdmin && <p style={{ marginBottom: 20 }}><Link className={button + ' secondary'} to={'/moderation?tab=Businesses&q=' + encodeURIComponent(business.domain)}>Administer this business</Link></p>}
    <div className="dir-columns"><div><section className="dir-card"><div className="dir-row"><span className="dir-score">{score.average ?? '—'}</span><div><Stars rating={score.average ?? 0} /><div className="dir-muted dir-small">{score.count} published reviews · all ratings included</div></div></div>
      {score.distribution.map((r) => <div className="dir-chart-row" key={r.rating}><span>{r.rating} stars</span><div className="dir-bar"><span style={{ width: (score.count ? r.count / score.count * 100 : 0) + '%' }} /></div><span>{r.count}</span></div>)}
      {business.description && <p>{business.description}</p>}<p className="dir-muted dir-small">Businesses can respond. Platform administrators independently moderate reviews.</p></section>
      <h2>Customer experiences</h2>{!reviews.length && <div className="dir-empty">No published reviews yet. Be the first to share your experience.</div>}{reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
      <div className="dir-row">{page > 1 && <button className={button + ' secondary'} onClick={() => setPage(page - 1)}>Previous</button>}{page * 20 < score.count && <button className={button + ' secondary'} onClick={() => setPage(page + 1)}>Next reviews</button>}</div>
      <section className="dir-card" style={{ marginTop: 24 }}><h2>{ownReview ? 'Your review' : 'Share your experience'}</h2>{business.reviewsClosed ? <p className="dir-muted">Reviews are closed. Existing reviews remain available, and concerns can still be reported to platform moderators.</p> : account.data ? <><Verification account={account.data} reload={account.reload} /><ReviewEditor key={business.id} siteId={business.id} initial={ownReview} defaultAnonymous={account.data.identity.defaultAnonymousReviews} onSuccess={account.reload} /></> : <p><Link className={button} to="/signup">Create an account to review</Link>{' '}<Link className="dir-link" to="/login">Sign in</Link></p>}</section>
    </div><aside><section className="dir-card"><span className="dir-icon"><ShieldCheck size={22} /></span><h2>{business.claimed ? 'For business owners' : 'Is this your business?'}</h2><p className="dir-muted">Verify your website once to reply to reviews, invite your team, enable monitoring, and embed your score.</p>
      {manages && business.claimed ? <Link className={button} to={'/business/' + domain + '/manage'}>Manage business <ArrowRight size={14} /></Link> : business.claimed ? <p className="dir-small dir-muted">Already claimed. Ask the owner for a team invitation. Ownership disputes are reviewed by platform administrators.</p> : business.permanentlyClosed ? <p className="dir-muted dir-small">Ownership claims are unavailable while this business is marked permanently closed.</p> : !account.data ? <Link className={button} to="/signup">Create an account to claim</Link> : <>
        <Verification account={account.data} reload={account.reload} /><label>Verification method<select value={method} onChange={(e) => setMethod(e.target.value as 'dns' | 'file')}><option value="dns">DNS TXT record</option><option value="file">HTTPS verification file</option></select></label>
        <button disabled={busy} className={button} onClick={async () => { setBusy(true); setClaimError(''); try { await api('/businesses/' + business.id + '/claims', 'POST', { method }); account.reload(); } catch (error) { setClaimError(errorMessage(error)); } finally { setBusy(false); } }}>{claim?.status === 'pending' ? 'Create a replacement challenge' : 'Start ownership verification'}</button>
        {claimError && <Notice error>{claimError}</Notice>}{claim && <ClaimProof domain={domain} claim={claim} onChange={() => { account.reload(); site.reload(); }} />}
      </>}
    </section><section className="dir-card"><MonitorPanel data={monitoring} /></section><section className="dir-card"><h3>What verification means</h3><p className="dir-small dir-muted">A verified domain means someone proved website control. Verified email means a reviewer confirmed their mailbox. Neither is a verified purchase or a guarantee that a review is genuine.</p><Link className="dir-link" to="/principles">Our review principles →</Link></section></aside></div>
  </Shell>;
}

function AddBusiness({ onSuccess }: { onSuccess: () => void }) {
  const navigate = useNavigate();
  const [domain, setDomain] = useState(''), [name, setName] = useState(''), [category, setCategory] = useState('Other'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const site = await api<Business>('/businesses', 'POST', { domain, name, category }); onSuccess(); navigate('/business/' + site.domain); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }}>
    <label>Website domain<input required placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} /></label><label>Business name<input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
    <label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((v) => <option key={v}>{v}</option>)}</select></label><p className="dir-small dir-muted">Adding a listing does not claim ownership. You can verify the website on its new public page.</p><button className={button} disabled={busy}>Add website <ArrowRight size={14} /></button>{error && <Notice error>{error}</Notice>}
  </form>;
}
export function DirectoryDashboard() {
  const account = useDirectory<Account>('/me', 30000); const [params, setParams] = useSearchParams(); const [inviteError, setInviteError] = useState(''), [inviteBusy, setInviteBusy] = useState(false);
  if (!account.data) return <Shell>{account.error ? <Notice error>{account.error}</Notice> : <div className="dir-empty">Loading your dashboard…</div>}</Shell>;
  const data = account.data;
  return <Shell><span className="dir-eyebrow">Your account</span><h1>Hello, {data.user.name.split(' ')[0]}.</h1><section className="dir-card account-summary"><ProfileAvatar image={data.user.image} name={data.identity.publicName} size={64} /><div><strong>{data.identity.publicName}</strong><p className="dir-small dir-muted">{data.user.email} · {data.identity.defaultAnonymousReviews ? 'New reviews anonymous by default' : 'Choose privacy on each review'}</p></div><Link className={button} to="/settings">Edit profile & settings</Link><Link className={button + ' secondary'} to="/settings?tab=donations">My donation settings</Link><Link className={button + ' secondary'} to="/settings?tab=appearance">Themes & appearance</Link></section><p className="dir-muted">Your reviews, verified websites, and the latest updates.</p><Verification account={data} reload={account.reload} />
    {params.get('invite') && <Notice><strong>You have a business team invitation.</strong><p>Accept it while signed in with the invited email address.</p><button className={button} disabled={inviteBusy} onClick={async () => { setInviteBusy(true); try { await api('/invites/accept', 'POST', { token: params.get('invite') }); setParams({}); account.reload(); } catch (error) { setInviteError(errorMessage(error)); } finally { setInviteBusy(false); } }}>Accept invitation</button>{inviteError && <p>{inviteError}</p>}</Notice>}
    {data.user.isSystemAdmin && <Notice><div className="dir-row dir-between"><span><ShieldCheck size={17} style={{ display: 'inline' }} /> You control platform moderation.</span><div className="dir-pills"><Link className={button} to="/moderation">Open administration</Link><Link className={button + ' secondary'} to="/moderation?tab=Businesses">Manage businesses</Link><Link className={button + ' secondary'} to="/moderation?tab=Users">Manage users</Link><Link className={button + ' secondary'} to="/site-settings">Site settings & themes</Link></div></div></Notice>}
    <div className="dir-columns"><div><h2>My businesses</h2>{!data.businesses.length && <div className="dir-empty">No verified websites yet. Add a listing and verify domain ownership to get started.</div>}{data.businesses.map((b) => <div className="dir-card" key={b.id}><div className="dir-row dir-between"><div><h3>{b.name}</h3><span className="dir-domain">{b.domain}</span></div><Tag status="verified">{b.isOwner ? 'Owner' : 'Team member'}</Tag></div><Link className="dir-button secondary" to={'/business/' + b.domain + '/manage'}>Manage website</Link></div>)}
      {data.claims.filter((r) => r.claim.status === 'pending' || (r.claim.status === 'verified' && r.claim.lastError)).map((r) => <section className="dir-card" key={r.claim.id}><h3>Verify {r.domain}</h3><ClaimProof domain={r.domain} claim={r.claim} onChange={account.reload} /></section>)}
      <h2>My reviews</h2>{!data.reviews.length && <p className="dir-muted">Your submitted reviews will appear here.</p>}{data.reviews.map((r) => <section className="dir-card" key={r.id}><div className="dir-row dir-between"><Link to={'/business/' + r.domain}><strong>{r.domain}</strong></Link><Tag status={r.status}>{r.status}</Tag></div><h3>{r.title}</h3><Stars rating={r.rating} /><p>{r.content}</p><ReviewPrivacy review={r} reload={account.reload} /><ResolutionResponse review={r} reload={account.reload} />{r.moderationReason && <Notice>Moderator decision: {r.moderationReason}</Notice>}{r.reviewsClosed || !r.listed ? <p className="dir-small dir-muted">Review submissions and author edits are closed for this business.</p> : <details><summary>Edit your review</summary><ReviewEditor siteId="" initial={r} onSuccess={account.reload} /></details>}{['rejected', 'quarantined'].includes(r.status) && <details><summary>Appeal this decision</summary><TextAction path={'/reviews/' + r.id + '/reports'} label="Why should this decision be reconsidered?" extra={{ kind: 'appeal' }} /></details>}</section>)}
    </div><aside><section className="dir-card"><span className="dir-icon"><Globe size={22} /></span><h2>Add a business</h2><AddBusiness onSuccess={account.reload} /></section><section className="dir-card"><h2>Recent updates</h2>{!data.alerts.length && <p className="dir-muted dir-small">Verification, review decisions, and monitor alerts will appear here.</p>}{data.alerts.map((alert) => <div key={alert.id}><strong className="dir-small">{alert.title}</strong><p className="dir-small">{alert.body}</p><span className="dir-muted dir-small">{date(alert.createdAt)}</span><div className="dir-divider" /></div>)}</section></aside></div>
  </Shell>;
}

function ProfileForm({ data, reload }: { data: Managed; reload: () => void }) {
  const [name, setName] = useState(data.business.name), [description, setDescription] = useState(data.business.description), [category, setCategory] = useState(data.business.category), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  return <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await api('/managed/' + data.business.id, 'PATCH', { name, description, category }); setSaved(true); setError(''); reload(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }}>
    <label>Business name<input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label><label>Description<textarea maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label><label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((v) => <option key={v}>{v}</option>)}</select></label><button className={button} disabled={busy}>Save profile</button>{saved && <Notice>Profile saved.</Notice>}{error && <Notice error>{error}</Notice>}
  </form>;
}
function MonitorForm({ data, reload }: { data: Managed; reload: () => void }) {
  const [url, setUrl] = useState(data.monitor?.url ?? 'https://' + data.business.domain), [text, setText] = useState(data.monitor?.expectedText ?? ''), [enabled, setEnabled] = useState(data.monitor?.enabled ?? false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  return <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await api('/managed/' + data.business.id + '/monitor', 'PUT', { enabled, url, expectedText: text }); setSaved(true); setError(''); reload(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }}>
    <label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enable five-minute HTTPS checks</label><label>Page to check<input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} /></label><label>Expected text (optional)<input maxLength={200} value={text} onChange={(e) => setText(e.target.value)} /></label>
    <p className="dir-small dir-muted">Use a page on {data.business.domain}. Failures and recoveries are confirmed before alerts. Checks also observe TLS expiry, DNS changes, and widget presence in initial HTML.</p><button className={button} disabled={busy}>Save monitoring</button>{saved && <Notice>Monitoring updated. Results appear after the worker completes its next check.</Notice>}{error && <Notice error>{error}</Notice>}
  </form>;
}
function Team({ data, reload }: { data: Managed; reload: () => void }) {
  const [email, setEmail] = useState(''), [link, setLink] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <><div className="dir-table-wrap"><table className="dir-table"><tbody>{data.members.map((m) => <tr key={m.id}><td>{m.name}<br /><span className="dir-muted">{m.email}</span></td><td>{data.business.isOwner && <button className="dir-link" onClick={async () => { try { await api('/managed/' + data.business.id + '/members/' + m.id, 'DELETE'); reload(); } catch (cause) { setError(errorMessage(cause)); } }}>Remove</button>}</td></tr>)}</tbody></table></div>
    {data.business.isOwner && <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const result = await api<{ link: string }>('/managed/' + data.business.id + '/invites', 'POST', { email }); setLink(result.link); setError(''); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }}><label>Invite a colleague<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><button className={button + ' secondary'} disabled={busy}>Create invitation</button><p className="dir-small dir-muted">Invitations expire after seven days and can only be accepted by the invited email address.</p>{link && <CopyCode value={link} />}</form>}
    {error && <Notice error>{error}</Notice>}
  </>;
}
function Widgets({ data }: { data: Managed }) {
  const [mode, setMode] = useState('badge'), [theme, setTheme] = useState('light'), [selected, setSelected] = useState<string[]>([]);
  const base = window.location.origin + '/api/v1/directory';
  const params = new URLSearchParams({ mode, theme, ...(mode === 'highlights' && selected.length ? { ids: selected.join(',') } : {}) });
  const src = base + '/widgets/' + data.business.domain + '?' + params;
  const snippet = '<iframe src="' + src.replace(/&/g, '&amp;') + '" title="' + data.business.domain + ' independent reviews" width="100%" height="' + (mode === 'badge' ? 190 : 720) + '" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-popups allow-popups-to-escape-sandbox" style="border:0"></iframe>';
  const loader = '<script src="' + base + '/embed.js" data-domain="' + data.business.domain + '" data-mode="' + mode + '" data-theme="' + theme + '"' + (mode === 'highlights' && selected.length ? ' data-ids="' + selected.join(',') + '"' : '') + ' defer></script>';
  return <><p className="dir-muted">Add a live overall-score badge, latest reviews, or selected highlights to any website. No private API key is needed.</p><div className="dir-row"><label style={{ flex: 1 }}>Widget<select aria-label="Widget type" value={mode} onChange={(e) => setMode(e.target.value)}><option value="badge">Overall score badge</option><option value="recent">Latest published reviews</option><option value="highlights">Selected review highlights</option></select></label><label style={{ flex: 1 }}>Theme<select aria-label="Widget theme" value={theme} onChange={(e) => setTheme(e.target.value)}><option value="light">Light</option><option value="dark">Dark</option></select></label></div>
    {mode === 'highlights' && <details><summary>Select up to six published reviews (optional)</summary><p className="dir-small dir-muted">Without an explicit selection, this shows recent published reviews rated 4 or 5 stars. The overall score always uses every published rating.</p>{data.reviews.map((r) => <label key={r.id}><input type="checkbox" checked={selected.includes(r.id)} disabled={!selected.includes(r.id) && selected.length >= 6} onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((v) => v !== r.id))} /> {r.rating}★ · {r.title}</label>)}</details>}
    <Notice>{mode === 'highlights' ? 'Highlights are visibly labeled as selected reviews. They never change your overall score.' : 'Scores and reviews come directly from the directory. Moderation updates appear within one minute.'}</Notice>
    <iframe title="Live widget preview" src={src} width="100%" height={mode === 'badge' ? 190 : 720} sandbox="allow-popups allow-popups-to-escape-sandbox" />
    <details open><summary>Copy and paste HTML</summary><CopyCode value={snippet} /></details><details><summary>Optional JavaScript loader</summary><CopyCode value={loader} /></details><details><summary>Public score API</summary><CopyCode value={base + '/scores/' + data.business.domain} /><p className="dir-small dir-muted">Use this public endpoint from your server when building a custom integration. Published ratings only; no reviewer emails or investigation data.</p></details>
  </>;
}
export function ManageDirectoryBusiness() {
  const { domain = '' } = useParams();
  const site = useDirectory<{ business: Business }>('/businesses/' + encodeURIComponent(domain));
  const data = useDirectory<Managed>(site.data ? '/managed/' + site.data.business.id : null, 30000);
  const [tab, setTab] = useState('Overview');
  if (site.error || data.error) return <Shell><Notice error>{site.error || data.error}</Notice></Shell>;
  if (!data.data) return <Shell><div className="dir-empty">Loading business dashboard…</div></Shell>;
  const managed = data.data;
  return <Shell><Link className="dir-link" to={'/business/' + domain}>← Public business page</Link><h1>{managed.business.name}</h1><p className="dir-muted">{domain} · verified business dashboard</p>
    <div className="dir-pills" style={{ marginBottom: 30 }}>{['Overview', 'Reviews', 'Widgets', 'Profile', 'Team'].map((v) => <button className={button + ' secondary' + (tab === v ? ' active' : '')} key={v} onClick={() => setTab(v)}>{v}</button>)}</div>
    {tab === 'Overview' && <div className="dir-columns"><section className="dir-card"><MonitorPanel data={managed.monitoring} /></section><section className="dir-card"><h2>Monitoring settings</h2>{managed.business.isOwner ? <MonitorForm data={managed} reload={data.reload} /> : <p className="dir-muted">Only the business owner can change monitoring settings.</p>}</section></div>}
    {tab === 'Reviews' && <><Notice>You can reply to published reviews and report concerns. Publication and removal decisions belong to platform moderators.</Notice>{managed.reviews.length ? managed.reviews.map((r) => <ReviewCard key={r.id} review={r} canReply canRequestResolution={managed.canRequestResolution} onChange={data.reload} />) : <div className="dir-empty">No published reviews yet.</div>}</>}
    {tab === 'Widgets' && <section className="dir-card"><h2>Bring your reputation to your website</h2><Widgets data={managed} /></section>}
    {tab === 'Profile' && <section className="dir-card"><h2>Business profile</h2><ProfileForm data={managed} reload={data.reload} /></section>}
    {tab === 'Team' && <section className="dir-card"><h2>Your team</h2><Team data={managed} reload={data.reload} /></section>}
  </Shell>;
}

function ModerateCard({ item, reload }: { item: Moderation['reviews'][number]; reload: () => void }) {
  const [decision, setDecision] = useState('published'), [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [evidence, setEvidence] = useState<Evidence>();
  const { review, reviewer, business } = item;
  return <article className="dir-card" id={'review-' + review.id}><div className="dir-review-head"><div><Link to={'/business/' + business.domain}><strong>{business.name}</strong></Link><div className="dir-small dir-muted">{reviewer.name} · {reviewer.email} · account created {date(reviewer.createdAt)}</div></div><div className="dir-row"><Tag status={review.status}>{review.status}</Tag><Tag status={review.riskScore >= 60 ? 'quarantined' : ''}>Risk {review.riskScore}/100</Tag></div></div>
    <h3>{review.title}</h3><Stars rating={review.rating} /><p>{review.content}</p><div className="dir-pills">{review.riskReasons.map((reason) => <Tag key={reason}>{reason}</Tag>)}</div>
    <button className="dir-link" style={{ marginTop: 16 }} onClick={async () => { try { setEvidence(await api<Evidence>('/moderation/reviews/' + review.id + '/evidence')); } catch (cause) { setError(errorMessage(cause)); } }}>Investigate possible connections</button>
    {evidence && <Notice><p>{evidence.notice}</p>{evidence.possibleConnections.length ? evidence.possibleConnections.map((r) => <p key={r.id} className="dir-small">{r.author} · {r.domain} · {r.title} · {r.status}</p>) : <p>No matching activity found in retained evidence.</p>}</Notice>}
    {review.anonymous && <Tag>Anonymous publicly; account attribution visible only to staff</Tag>}
    {['accepted', 'requested'].includes(review.resolutionStatus) && <div className="dir-notice"><p>Resolution status: {review.resolutionStatus}</p><button className={button + ' secondary'} disabled={busy || reason.trim().length < 5} onClick={async () => { setBusy(true); try { await api('/moderation/reviews/' + review.id + '/resolution', 'POST', { reason, version: review.resolutionVersion }); reload(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }}>Remove resolution label or request</button><p className="dir-small dir-muted">Enter the moderation reason below first. Only the reviewer can accept a resolution.</p></div>}
    {review.moderationReason && <p className="dir-small dir-muted">Previous decision: {review.moderationReason}</p>}
    <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await api('/moderation/reviews/' + review.id, 'POST', { status: decision, reason, updatedAt: review.updatedAt }); reload(); setError(''); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }}>
      <div className="dir-row"><label style={{ flex: 1 }}>Decision<select value={decision} onChange={(e) => setDecision(e.target.value)}><option value="published">Publish</option><option value="quarantined">Quarantine</option><option value="rejected">Reject / remove</option><option value="pending">Return to pending</option></select></label><label style={{ flex: 3 }}>Reason (shared with the author)<input required minLength={5} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></label></div><button className={button} disabled={busy}>Save moderation decision</button>
    </form>{error && <Notice error>{error}</Notice>}
  </article>;
}
export function DirectoryModeration() {
  const account = useDirectory<Account>('/me');
  const [params, setParams] = useSearchParams();
  const target = params.get('review');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('pending');
  const tab = ['Reviews', 'Reports & appeals', 'Businesses', 'Users', 'Audit trail'].includes(params.get('tab') ?? '') ? params.get('tab')! : 'Reviews';
  const data = useDirectory<Moderation>(account.data?.user.isSystemAdmin ? '/moderation?' + new URLSearchParams({ status: filter, page: String(page), ...(target ? { reviewId: target } : {}) }) : null, 30000);
  if (account.data && !account.data.user.isSystemAdmin) return <Shell><Notice error>Platform moderation is restricted to administrators.</Notice></Shell>;
  if (!data.data) return <Shell>{data.error || account.error ? <Notice error>{data.error || account.error}</Notice> : <div className="dir-empty">Loading moderation…</div>}</Shell>;
  const moderation = data.data;
  const workerHealthy = moderation.workerHealthy;
  return <Shell><span className="dir-eyebrow">Platform administration</span><h1>Your directory. Your standards.</h1><div className="dir-row" style={{ marginBottom: 20 }}><Link className={button + ' secondary'} to="/site-settings">Site settings & themes</Link><Link className={button + ' secondary'} to="/donations/manage">Donation settings</Link></div><p className="dir-muted">Apply the same standards to positive and negative reviews. Businesses cannot publish or remove directory reviews.</p>
    <div className="dir-row"><Tag status={workerHealthy ? 'up' : 'down'}>Background worker {workerHealthy ? 'online' : 'not reporting'}</Tag><Tag status={moderation.emailConfigured ? 'up' : 'pending'}>Email {moderation.emailConfigured ? 'configured' : 'not configured'}</Tag></div>
    <div className="dir-pills" style={{ margin: '24px 0' }}>{['Reviews', 'Reports & appeals', 'Businesses', 'Users', 'Audit trail'].map((v) => <button className={button + ' secondary' + (tab === v ? ' active' : '')} key={v} onClick={() => setParams({ tab: v })}>{v}{v === 'Reports & appeals' ? ' (' + moderation.reports.length + ')' : ''}</button>)}</div>
    {tab === 'Reviews' && <>{target && <Notice>Review selected from a report or appeal. <Link to="/moderation">Return to the full queue</Link></Notice>}<div className="dir-pills" style={{ marginBottom: 24 }}>{['pending', 'quarantined', 'published', 'rejected', 'all'].map((v) => <button key={v} className={button + ' secondary' + (filter === v ? ' active' : '')} onClick={() => { setFilter(v); setPage(1); }}>{v} {v === 'all' ? '' : '(' + (moderation.counts.find((r) => r.status === v)?.count ?? 0) + ')'}</button>)}</div>{moderation.reviews.length ? moderation.reviews.map((item) => <ModerateCard key={item.review.id + item.review.updatedAt} item={item} reload={data.reload} />) : <div className="dir-empty"><ShieldCheck size={30} style={{ margin: 'auto' }} /><h3>Nothing in this queue</h3><p>New reviews and flagged activity will appear here.</p></div>}{!target && <div className="dir-row">{page > 1 && <button className={button + ' secondary'} onClick={() => setPage(page - 1)}>Previous page</button>}{moderation.reviews.length === 100 && <button className={button + ' secondary'} onClick={() => setPage(page + 1)}>Next page</button>}</div>}</>}
    {tab === 'Reports & appeals' && <>{!moderation.reports.length && <div className="dir-empty">No open reports or appeals.</div>}{moderation.reports.map(({ report, title, domain }) => <section className="dir-card" key={report.id}><Tag>{report.kind}</Tag><h3>{title}</h3><p className="dir-muted dir-small">{domain} · review {report.reviewId} · {date(report.createdAt)}</p><p>{report.reason}</p><Link className={button + ' secondary'} to={'/moderation?review=' + report.reviewId}>Open review and make a moderation decision</Link><TextAction path={'/moderation/reports/' + report.id} label="Resolution (shared with the person who reported it)" field="resolution" onSuccess={data.reload} /></section>)}</>}
    {tab === 'Businesses' && <BusinessAdministration initialQuery={params.get('q') ?? ''} />}
    {tab === 'Users' && <UserAdministration currentUserId={account.data!.user.id} />}
    {tab === 'Audit trail' && <section className="dir-card"><h2>Recent decisions</h2><div className="dir-table-wrap"><table className="dir-table"><thead><tr><th>When</th><th>Action</th><th>Reason</th></tr></thead><tbody>{moderation.audit.map((a) => <tr key={a.id}><td>{date(a.createdAt)}</td><td>{a.action}</td><td>{a.note}</td></tr>)}</tbody></table></div></section>}
  </Shell>;
}

export function DirectoryPrinciples() {
  return <Shell><div style={{ maxWidth: 760, margin: 'auto' }}><span className="dir-eyebrow">Our review principles</span><h1>Trust needs context.</h1><section className="dir-card"><h2>Independent moderation</h2><p>Platform moderators decide which reviews are published under the same standards for praise and criticism. Businesses can reply and report concerns. They cannot remove a review or change the directory's overall score.</p><h2>Clear verification labels</h2><p>Domain verified means a representative demonstrated control of that exact website. Email verified means a reviewer confirmed their email address. Neither label is a verified purchase or proof that every statement is accurate.</p><h2>Your review and your privacy</h2><p>Choose a persistent profile pseudonym or make individual reviews anonymous from Profile &amp; settings and My dashboard. Anonymous reviews hide the public name and profile picture; staff retain account attribution for moderation. Privacy can be changed after publication without changing the score.</p><h2>Business responses and resolutions</h2><p>Verified businesses can respond publicly and ask the reviewer to confirm a resolution. A label appears only after the reviewer accepts it. Acceptance never automatically changes a rating, and the reviewer can remove the label later.</p><p>Your display name and review are public; your email address and anti-abuse evidence are not. We use account activity, repeated text, and short-lived pseudonymous network signals to help investigate abuse. Network identifiers are removed after 30 days. Similarity and shared networks are leads, not proof of identity. We do not use covert browser fingerprinting.</p><h2>Reports and appeals</h2><p>Signed-in users can report published reviews. Authors can appeal rejected or quarantined reviews from their dashboard. Moderation decisions include a reason and are recorded in an audit trail.</p><h2>Closed businesses and reviews</h2><p>Platform administrators can mark a business permanently closed or close new review submissions and author edits. Existing published reviews remain visible and count toward scores. Reports, appeals and staff moderation remain available.</p><h2>Honest widgets</h2><p>Overall scores include all published ratings. Highlight widgets are clearly marked as selected reviews and always link to the full directory page.</p><h2>Observed uptime</h2><p>Monitoring starts when a verified owner enables it. Confirmed incidents reflect observations from one location. Unknown coverage is shown separately, and outage counts reflect incidents rather than individual failed requests. Observations are not a service guarantee.</p></section></div></Shell>;
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminUserDetail, AdminUserSummary } from '@reviewskits/types';
import { directoryRequest as api, useDirectory } from '../services/directory';
import { ProfileAvatar } from '../components/profile-avatar';
import './account.css';

const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not recorded';
const message = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
function UserEditor({ detail, currentUserId, reload, deleted, notify }: { detail: AdminUserDetail; currentUserId: string; reload: () => void; deleted: () => void; notify: (value: string) => void }) {
  const target = detail.user, self = target.id === currentUserId;
  const [name, setName] = useState(target.name), [pseudonym, setPseudonym] = useState(detail.identity.pseudonym ?? ''), [mode, setMode] = useState(detail.identity.mode);
  const [anonymous, setAnonymous] = useState(detail.identity.defaultAnonymousReviews), [admin, setAdmin] = useState(target.isSystemAdmin), [suspended, setSuspended] = useState(!!target.suspendedAt);
  const [reason, setReason] = useState(''), [confirmEmail, setConfirmEmail] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const action = async (path: string, method: string, values: object) => {
    setBusy(true); setError('');
    try {
      await api('/moderation/users/' + target.id + path, method, { ...values, reason, updatedAt: target.updatedAt });
      notify(path === '/revoke-sessions' ? 'All account sessions were signed out.' : 'Account changes saved.');
      if (method === 'DELETE') deleted(); else if (self && path === '/revoke-sessions') window.location.href = '/login'; else reload();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  return <><form onSubmit={(event) => { event.preventDefault(); void action('', 'PATCH', { name, pseudonym: pseudonym || null, mode, defaultAnonymousReviews: anonymous, isSystemAdmin: admin, suspended, removeAvatar }); }}>
    <h3>Manage account</h3><fieldset disabled={busy}><div className="dir-form-grid"><label>Account display name<input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Public identity mode<select aria-label="Public identity mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="account">Account display name</option><option value="pseudonym">Profile pseudonym</option></select></label></div>
    <label>Profile pseudonym<input minLength={3} maxLength={40} required={mode === 'pseudonym'} value={pseudonym} onChange={(e) => setPseudonym(e.target.value)} /></label>
    <label className="account-check"><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />New reviews anonymous by default</label>
    <label className="account-check"><input type="checkbox" checked={admin} disabled={self} onChange={(e) => setAdmin(e.target.checked)} />Platform administrator</label>
    <label className="account-check"><input type="checkbox" checked={suspended} disabled={self} onChange={(e) => setSuspended(e.target.checked)} />Suspend account</label>
    {target.image && <label className="account-check"><input type="checkbox" checked={removeAvatar} onChange={(e) => setRemoveAvatar(e.target.checked)} />Remove profile picture</label>}
    <p className="dir-small dir-muted">Suspension blocks sign-in and authenticated API use, signs out sessions and disables API keys. Restoring an account does not reactivate old keys. Role changes also sign out the affected account. Published reviews remain until separately moderated.</p>
    <label>Administrative reason<input required minLength={5} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    <button className="dir-button" disabled={busy}>Save account changes</button></fieldset>
  </form>
    <button className="dir-button secondary" style={{ marginTop: 20 }} disabled={busy || reason.trim().length < 5} onClick={() => action('/revoke-sessions', 'POST', {})}>Sign out all account sessions</button>
    {!self && <details><summary>Permanently delete account</summary><div className="dir-danger-zone"><p>This removes the account, its profile picture, sessions and reviews. Its businesses remain unclaimed and monitoring pauses. Verified donations remain in the ledger anonymously. The audit record is retained.</p>
      <label>Type {target.email} to confirm account deletion<input value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} autoComplete="off" /></label>
      <button className="dir-button danger" disabled={busy || confirmEmail !== target.email || reason.trim().length < 5} onClick={() => action('', 'DELETE', { confirmEmail })}>Permanently delete account</button><p className="dir-small dir-muted">Enter the administrative reason above first.</p></div></details>}
    {error && <div role="alert" className="dir-notice dir-error">{error} <button className="dir-link" onClick={reload}>Reload account</button></div>}
  </>;
}
export function UserAdministration({ currentUserId }: { currentUserId: string }) {
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(1), [selected, setSelected] = useState<string | null>(null), [reviewPage, setReviewPage] = useState(1), [notice, setNotice] = useState('');
  const list = useDirectory<{ users: AdminUserSummary[]; total: number }>('/moderation/users?' + new URLSearchParams({ q: query, filter, page: String(page) }));
  const detail = useDirectory<AdminUserDetail>(selected ? '/moderation/users/' + selected + '?reviewPage=' + reviewPage : null);
  const reload = () => { list.reload(); detail.reload(); };
  return <><section className="dir-card"><h2>Users and account activity</h2><p className="dir-muted">Find accounts, inspect their reviews and businesses, and manage access. Risk signals are investigation leads, not proof of abuse.</p>
    <form className="dir-search" style={{ maxWidth: 'none' }} onSubmit={(e) => { e.preventDefault(); setQuery(search); setPage(1); }}><input aria-label="Find users" value={search} placeholder="Search name, email or profile pseudonym…" onChange={(e) => setSearch(e.target.value)} /><button className="dir-button">Find users</button></form>
    <label>Account status<select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}><option value="all">All accounts</option><option value="active">Active accounts</option><option value="suspended">Suspended accounts</option><option value="admins">Platform administrators</option></select></label>
    {notice && <div role="status" className="dir-notice">{notice}</div>}{list.error && <div role="alert" className="dir-notice dir-error">{list.error}</div>}
    <p className="dir-small dir-muted">{list.data?.total ?? 0} matching accounts</p><div className="account-user-list">
      {list.data?.users.map((user) => <button className="account-user" aria-pressed={selected === user.id} key={user.id} onClick={() => { setSelected(user.id); setReviewPage(1); }}>
        <ProfileAvatar image={user.image} name={user.name} /><span><strong>{user.name}</strong><small>{user.email}</small>{user.pseudonym && <small>Profile: {user.pseudonym}</small>}
          <small>{user.reviewCount} reviews · {user.businessCount} owned businesses · {user.riskCount} flagged reviews</small><span className="dir-tag">{user.suspendedAt ? 'Suspended' : user.isSystemAdmin ? 'Administrator' : 'Active'}</span></span>
      </button>)}
    </div><div className="dir-row">{page > 1 && <button className="dir-button secondary" onClick={() => setPage(page - 1)}>Previous accounts</button>}{page * 20 < (list.data?.total ?? 0) && <button className="dir-button secondary" onClick={() => setPage(page + 1)}>Next accounts</button>}</div>
  </section>
    {selected && <section className="dir-card account-user-detail" aria-label="Selected account"><div className="dir-row dir-between"><h2>Account details</h2><button className="dir-link" onClick={() => setSelected(null)}>Close account details</button></div>
      {detail.error && <div role="alert" className="dir-notice dir-error">{detail.error}</div>}
      {detail.data?.user.id === selected ? <><div className="account-summary"><ProfileAvatar image={detail.data.user.image} name={detail.data.user.name} size={64} /><div><h3>{detail.data.user.name}</h3><p>{detail.data.user.email}</p><p className="dir-small dir-muted">Created {date(detail.data.user.createdAt)} · Last sign-in {date(detail.data.user.lastSignInAt)} · Email {detail.data.user.emailVerified ? 'verified' : 'unverified'}</p></div></div>
        {detail.data.user.suspensionReason && <div className="dir-notice">Suspension reason: {detail.data.user.suspensionReason}</div>}
        <UserEditor key={detail.data.user.id + detail.data.user.updatedAt} detail={detail.data} currentUserId={currentUserId} reload={reload} notify={setNotice} deleted={() => { setNotice('Account deleted; the verified donation ledger was retained anonymously.'); setSelected(null); list.reload(); }} />
        <details open><summary>Reviews and moderation history ({detail.data.user.reviewCount})</summary>{detail.data.reviews.map((review) => <article key={review.id}><Link className="dir-link" to={'/moderation?review=' + review.id}>{review.title} · {review.domain}</Link><p className="dir-small">{review.rating}/5 · {review.status} · {review.anonymous ? 'Anonymous publicly' : 'Profile identity'} · Risk {review.riskScore}/100</p><p className="dir-small dir-muted">{review.riskReasons.join(' · ')}</p><Link className="dir-link" to={'/moderation?review=' + review.id}>Moderate and investigate possible connections</Link></article>)}
          <div className="dir-row">{reviewPage > 1 && <button className="dir-button secondary" onClick={() => setReviewPage(reviewPage - 1)}>Previous user reviews</button>}{reviewPage * 20 < detail.data.user.reviewCount && <button className="dir-button secondary" onClick={() => setReviewPage(reviewPage + 1)}>Next user reviews</button>}</div></details>
        <details><summary>Business access (up to 100 recent entries)</summary>{detail.data.businesses.map((business) => <p key={business.id}><Link className="dir-link" to={'/business/' + business.domain + '/manage'}>{business.name} · {business.domain}</Link> · {business.role}</p>)}</details>
        <details><summary>Recent donations (up to 30)</summary>{detail.data.donations.map((donation) => <p key={donation.id}>{donation.amount ?? 'Awaiting verification'} {donation.currency} · {donation.status} · {donation.publicCredit ? 'Public credit requested' : 'Anonymous publicly'}</p>)}<Link className="dir-link" to="/donations/manage">Open wallet verification and full donation records</Link></details>
        <details><summary>Active sessions (up to 30)</summary>{detail.data.sessions.map((session) => <p className="dir-small" key={session.id}>Signed in {date(session.createdAt)} · Expires {date(session.expiresAt)}</p>)}</details>
        <details><summary>Recent account audit (up to 50)</summary>{detail.data.audit.map((entry) => <article key={entry.id}><strong className="dir-small">{entry.action} · {date(entry.createdAt)}</strong><p className="dir-small">{entry.note}</p></article>)}</details>
      </> : !detail.error && <p>Loading selected account…</p>}
    </section>}
  </>;
}

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Search, Sun } from 'lucide-react';
import type { SiteSettings, SiteTheme } from '@reviewskits/types';
import { directoryRequest as api, useDirectory, type Account, type Business } from '../services/directory';
import { useTheme } from '../hooks/useTheme';
import { Shell } from './DirectoryPages';

const message = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
const categories = ['Software', 'Shopping', 'Professional services', 'Education', 'Travel', 'Health', 'Other'];

function StaffBusiness({ site, reload, saved }: { site: Business; reload: () => void; saved: (value: string) => void }) {
  const [name, setName] = useState(site.name), [description, setDescription] = useState(site.description), [category, setCategory] = useState(site.category);
  const [listed, setListed] = useState(!!site.listed), [closed, setClosed] = useState(site.permanentlyClosed), [reviewsClosed, setReviewsClosed] = useState(site.reviewsClosed);
  const [reason, setReason] = useState(''), [ownerEmail, setOwnerEmail] = useState(''), [confirmDomain, setConfirmDomain] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const update = async (input: Record<string, unknown>, method = 'PATCH') => {
    setBusy(true); setError('');
    try {
      await api('/moderation/businesses/' + site.id, method, { ...input, reason, updatedAt: site.updatedAt });
      saved(method === 'DELETE' ? site.domain + ' was permanently deleted.' : site.domain + ' was updated.'); reload();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  return <details className="dir-admin-business">
    <summary><span><strong>{site.name}</strong><br /><span className="dir-domain">{site.domain}</span></span><span className="dir-pills">
      <span className="dir-tag">{site.listed ? 'Listed' : 'Hidden'}</span>
      {site.permanentlyClosed && <span className="dir-tag closed">Permanently closed</span>}
      {site.reviewsClosed && <span className="dir-tag">Reviews closed</span>}
      <span className="dir-tag">{site.claimed ? 'Claimed' : 'Unclaimed'}</span>
    </span></summary>
    {site.listed && <Link className="dir-link" to={'/business/' + site.domain}>View public listing ↗</Link>}
    <form onSubmit={(event) => { event.preventDefault(); void update({ name, description, category, listed, permanentlyClosed: closed, reviewsClosed }); }}>
      <fieldset disabled={busy}>
        <div className="dir-form-grid"><label>Business name<input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label></div>
        <label>Business description<textarea maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="dir-check"><input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />Show in the public directory</label>
        <label className="dir-check"><input type="checkbox" checked={closed} onChange={(e) => { setClosed(e.target.checked); if (e.target.checked) setReviewsClosed(true); }} />Permanently closed</label>
        <label className="dir-check"><input type="checkbox" checked={reviewsClosed} disabled={closed} onChange={(e) => setReviewsClosed(e.target.checked)} />Close reviews for this business</label>
        <p className="dir-small dir-muted">Closing reviews stops new submissions and author edits. Published reviews, scores, reports and appeals remain available. Marking a business permanently closed also pauses monitoring. Reopening it leaves monitoring paused until its owner enables it.</p>
        <label>Reason for this administrative change<input required minLength={5} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <button className="dir-button" disabled={busy}>Save business</button>
      </fieldset>
    </form>
    <details><summary>Transfer business ownership</summary><p className="dir-small dir-muted">Review ownership evidence first. A transfer revokes the previous team and unused invitations.</p>
      <form onSubmit={(e) => { e.preventDefault(); void update({ ownerEmail }); }}><label>New owner’s verified email<input type="email" required value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} /></label>
        <button className="dir-button secondary" disabled={busy || reason.trim().length < 5}>Transfer ownership</button><p className="dir-small dir-muted">Enter the administrative reason above before transferring.</p></form>
    </details>
    <details><summary>Permanently delete this business</summary><div className="dir-danger-zone"><h3>Delete {site.domain}</h3><p>This permanently deletes the listing, every review and report about it, ownership claims, team invitations, and monitoring history. The administrative audit record is kept. Hide the listing above if you need a reversible option.</p>
      <form onSubmit={(e) => { e.preventDefault(); void update({ confirmDomain }, 'DELETE'); }}><label>Type {site.domain} to confirm deletion<input required autoComplete="off" value={confirmDomain} onChange={(e) => setConfirmDomain(e.target.value)} /></label>
        <button className="dir-button danger" disabled={busy || confirmDomain !== site.domain || reason.trim().length < 5}>Permanently delete business</button><p className="dir-small dir-muted">Enter the administrative reason above before deleting.</p></form>
    </div></details>
    {error && <div role="alert" className="dir-notice dir-error">{error}<br /><button className="dir-link" onClick={reload}>Refresh businesses</button></div>}
  </details>;
}

export function BusinessAdministration({ initialQuery = '' }: { initialQuery?: string }) {
  const [search, setSearch] = useState(initialQuery), [query, setQuery] = useState(initialQuery), [filter, setFilter] = useState('all'), [page, setPage] = useState(1), [notice, setNotice] = useState('');
  const data = useDirectory<{ businesses: Business[]; total: number }>('/moderation/businesses?' + new URLSearchParams({ q: query, filter, page: String(page) }));
  return <section className="dir-card"><h2>Manage businesses</h2><p className="dir-muted">Edit profiles, manage listing status, close reviews, or review ownership disputes. Every change requires a reason and is recorded in the audit trail.</p>
    <form className="dir-search" style={{ maxWidth: 'none' }} onSubmit={(e) => { e.preventDefault(); setQuery(search); setPage(1); }}>
      <input aria-label="Find a business to administer" placeholder="Search business name or domain…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <button className="dir-button"><Search size={15} />Find business</button>
    </form>
    <label>Business status<select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}><option value="all">All businesses</option><option value="listed">Publicly listed</option><option value="hidden">Hidden listings</option><option value="closed">Permanently closed</option><option value="reviews-closed">Reviews closed</option></select></label>
    {notice && <div role="status" className="dir-notice">{notice}</div>}
    {data.error && <div role="alert" className="dir-notice dir-error">{data.error}</div>}
    {data.data ? <><p className="dir-small dir-muted">{data.data.total} matching businesses</p>{data.data.businesses.length
      ? data.data.businesses.map((site) => <StaffBusiness key={site.id + site.updatedAt} site={site} reload={data.reload} saved={setNotice} />)
      : <div className="dir-empty">No matching businesses.</div>}
      <div className="dir-row" style={{ marginTop: 20 }}>{page > 1 && <button className="dir-button secondary" onClick={() => setPage(page - 1)}>Previous businesses</button>}
        {page * 20 < data.data.total && <button className="dir-button secondary" onClick={() => setPage(page + 1)}>Next businesses</button>}</div>
    </> : <p>Loading businesses…</p>}
  </section>;
}

function AppearanceSettings({ initial, reload }: { initial: SiteSettings; reload: () => void }) {
  const { preference, followSiteDefault, setSiteSettings } = useTheme();
  const [current, setCurrent] = useState(initial);
  const [choice, setChoice] = useState<SiteTheme>(initial.defaultTheme), [error, setError] = useState(''), [saved, setSaved] = useState(false), [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try {
      const result = await api<SiteSettings>('/moderation/settings', 'PUT', { defaultTheme: choice, updatedAt: current.updatedAt });
      setSiteSettings(result); setCurrent(result); setSaved(true);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  return <section className="dir-card"><h2>Site appearance</h2><p className="dir-muted">Choose the default theme for the public directory and dashboard. Dark ruby red is the initial default. Visitors can override it on their own device.</p>
    <form onSubmit={submit}><div className="dir-theme-options">
      {(['ruby-dark', 'ruby-light'] as const).map((value) => <button key={value} type="button" aria-label={value === 'ruby-dark' ? 'Dark ruby red' : 'Light ruby red'} aria-pressed={choice === value} className="dir-theme-option" disabled={busy} onClick={() => { setChoice(value); setSaved(false); }}>
        <span className={'dir-theme-preview' + (value === 'ruby-light' ? ' light-preview' : '')}><strong>reviews<span style={{ color: value === 'ruby-light' ? '#9c1642' : '#ff8fab' }}>kits.</span></strong><i /><span>Independent reviews.<br />Your community, in ruby red.</span></span>
        <span className="dir-theme-caption"><span className="dir-row">{value === 'ruby-dark' ? <Moon size={17} /> : <Sun size={17} />}<strong>{value === 'ruby-dark' ? 'Dark ruby red' : 'Light ruby red'}</strong></span><small>{value === current.defaultTheme ? 'Current site default' : 'Use as the site default'}</small></span>
      </button>)}
    </div><button className="dir-button" disabled={busy}>{busy ? 'Saving…' : 'Save site theme'}</button>
      {saved && <div role="status" className="dir-notice">Site theme saved.</div>}{error && <div role="alert" className="dir-notice dir-error">{error} <button type="button" className="dir-link" onClick={reload}>Reload settings</button></div>}
    </form>
    {preference && <div className="dir-notice">This device has a personal theme preference. <button className="dir-link" onClick={followSiteDefault}>Use the site default on this device</button></div>}
  </section>;
}

export function SiteSettingsPage() {
  const account = useDirectory<Account>('/me');
  const data = useDirectory<SiteSettings>(account.data?.user.isSystemAdmin ? '/site-settings' : null);
  if (account.data && !account.data.user.isSystemAdmin) return <Shell><div role="alert" className="dir-notice dir-error">Site settings are restricted to platform administrators.</div></Shell>;
  return <Shell><Link className="dir-link" to="/moderation">← Platform administration</Link><span className="dir-eyebrow" style={{ display: 'block', marginTop: 24 }}>Platform administration</span><h1>Site settings</h1>
    {data.error || account.error ? <div role="alert" className="dir-notice dir-error">{data.error || account.error}</div> : data.data ? <AppearanceSettings key={data.data.updatedAt ?? 'initial'} initial={data.data} reload={data.reload} /> : <p>Loading settings…</p>}
    <section className="dir-card"><h2>Donations and supporter rankings</h2><p className="dir-muted">Manage receiving wallets, manual verification, and the optional donation leaderboard.</p><Link className="dir-button secondary" to="/donations/manage">Manage donation settings</Link></section>
  </Shell>;
}

import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { DonationAccountData, DonationPublicData, ProfileSettings } from '@reviewskits/types';
import { authClient } from '../lib/auth-client';
import { directoryRequest as api, useDirectory } from '../services/directory';
import { ProfileAvatar } from '../components/profile-avatar';
import { useTheme } from '../hooks/useTheme';
import { LeaderboardIdentity } from './DonationPages';
import { Shell } from './DirectoryPages';
import './account.css';

const message = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? 'alert' : 'status'} className={'dir-notice' + (error ? ' dir-error' : '')}>{children}</div>;
}
function AvatarPicker({ initial, disabled, reload, saved }: { initial: ProfileSettings; disabled: boolean; reload: () => void; saved: (value: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a PNG or JPEG smaller than 10 MB.');
      const image = await createImageBitmap(file);
      let png: Blob;
      try {
        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
        const context = canvas.getContext('2d'); if (!context) throw new Error('Picture resizing is unavailable in this browser.');
        const edge = Math.min(image.width, image.height);
        context.drawImage(image, (image.width - edge) / 2, (image.height - edge) / 2, edge, edge, 0, 0, 256, 256);
        png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not resize this picture.')), 'image/png'));
      } finally { image.close(); }
      const response = await fetch('/api/v1/directory/account/avatar', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/png' }, body: png });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Picture upload failed.');
      saved('Profile picture saved.'); reload();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  return <section className="account-avatar-editor"><ProfileAvatar image={initial.user.image} name={initial.identity.publicName} size={80} /><div><h3>Profile picture</h3>
    <p className="dir-small dir-muted">PNG or JPEG. Pictures are cropped to a square, resized, and stripped of photo metadata. Anonymous reviews never display your picture.</p>
    <label>Upload profile picture<input type="file" accept="image/png,image/jpeg" disabled={disabled || busy} onChange={upload} /></label>
    {initial.user.image && <button type="button" className="dir-link" disabled={disabled || busy} onClick={async () => {
      setBusy(true); setError(''); try { await api('/account/avatar', 'DELETE'); saved('Profile picture removed.'); reload(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
    }}>Remove profile picture</button>}
    {disabled && <p className="dir-small dir-muted">Save your profile changes before changing the picture.</p>}{busy && <p role="status">Processing picture…</p>}{error && <Notice error>{error}</Notice>}
  </div></section>;
}
function ProfileEditor({ initial, reload, saved }: { initial: ProfileSettings; reload: () => void; saved: (value: string) => void }) {
  const [name, setName] = useState(initial.user.name), [mode, setMode] = useState(initial.identity.mode), [pseudonym, setPseudonym] = useState(initial.identity.pseudonym ?? '');
  const [anonymous, setAnonymous] = useState(initial.identity.defaultAnonymousReviews), [notifications, setNotifications] = useState(initial.notifications);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dirty = name !== initial.user.name || mode !== initial.identity.mode || pseudonym !== (initial.identity.pseudonym ?? '') || anonymous !== initial.identity.defaultAnonymousReviews
    || notifications.newReview !== initial.notifications.newReview || notifications.weeklyReport !== initial.notifications.weeklyReport;
  return <><section className="dir-card"><AvatarPicker initial={initial} disabled={busy || dirty} reload={reload} saved={saved} /></section>
    <form className="dir-card" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError('');
      try { await api('/account', 'PATCH', { name, mode, pseudonym: pseudonym || null, defaultAnonymousReviews: anonymous, notifications, updatedAt: initial.user.updatedAt }); saved('Profile and privacy settings saved.'); reload(); await authClient.getSession({ query: { disableCookieCache: true } }); }
      catch (cause) { setError(message(cause)); } finally { setBusy(false); }
    }}><h2>Profile and privacy</h2><fieldset disabled={busy}>
      <label>Account display name<input required minLength={2} maxLength={80} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <p className="dir-small dir-muted">Use a name you are comfortable making public. Your email stays private: {initial.user.email}.</p>
      <label>Public review identity<select aria-label="Public review identity" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="account">Account display name</option><option value="pseudonym">Persistent profile pseudonym</option></select></label>
      <label>Profile pseudonym<input minLength={3} maxLength={40} required={mode === 'pseudonym'} value={pseudonym} onChange={(e) => setPseudonym(e.target.value)} autoComplete="off" placeholder="e.g. RubyFox" /></label>
      <p className="dir-small dir-muted">The selected identity applies to all non-anonymous reviews, including previous reviews. Pseudonyms are unique without regard to case. It stays reserved when you use your account name.</p>
      <label className="account-check"><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />Post new reviews anonymously by default</label>
      <p className="dir-small dir-muted">Choose anonymity separately on each review, and change it later from My dashboard, even when review edits are closed. Moderators can still identify the account. Previously copied names or pictures cannot be recalled.</p>
      <h3 style={{ marginTop: 24 }}>Notification preferences</h3>
      <label className="account-check"><input type="checkbox" checked={notifications.newReview} onChange={(e) => setNotifications({ ...notifications, newReview: e.target.checked })} />New review notifications</label>
      <label className="account-check"><input type="checkbox" checked={notifications.weeklyReport} onChange={(e) => setNotifications({ ...notifications, weeklyReport: e.target.checked })} />Weekly workspace reports</label>
      <p className="dir-small dir-muted">These are the existing testimonial-workspace preferences. Account security, moderation and resolution notices still appear in your dashboard.</p>
      <button className="dir-button" disabled={busy}>{busy ? 'Saving…' : 'Save profile and privacy'}</button>
    </fieldset>{error && <Notice error>{error} <button type="button" className="dir-link" onClick={reload}>Reload settings</button></Notice>}</form>
    <section className="dir-card"><h2>Existing reviews</h2><p>Hide your name and picture on every existing review. This changes attribution only; your ratings and publication status stay the same.</p><button className="dir-button secondary" disabled={busy} onClick={async () => {
      setBusy(true); setError(''); try { await api('/account/reviews/anonymous', 'POST', {}); saved('All your existing reviews are anonymous publicly.'); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
    }}>Make all my existing reviews anonymous</button><p className="dir-small dir-muted">Use the checkbox above to make future reviews anonymous by default.</p></section>
  </>;
}
function DonationPreferences({ profile }: { profile: ProfileSettings }) {
  const own = useDirectory<DonationAccountData>('/donations/me'), config = useDirectory<DonationPublicData>('/donations');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  return <><section className="dir-card"><h2>Donation identity and privacy</h2><p className="dir-muted">Donations are anonymous unless you opt into public credit for that donation. Your review pseudonym and donation identity can be different.</p>
    {own.error || config.error ? <Notice error>{own.error || config.error}</Notice> : own.data && <LeaderboardIdentity identity={own.data.identity} accountName={profile.user.name} profileAlias={profile.identity.pseudonym} verified={profile.user.emailVerified || profile.user.isSystemAdmin} reload={own.reload} />}
    {!profile.user.emailVerified && !profile.user.isSystemAdmin && <p className="dir-small dir-muted">Verify your email to save a public donation identity. You can always make existing donations anonymous.</p>}
    {!config.data?.leaderboardEnabled && <p className="dir-small dir-muted">The public leaderboard is currently disabled. You can still save your identity and withdraw public credit.</p>}
  </section><section className="dir-card"><h2>My donation receipts</h2><Link className="dir-link" to="/donate">Donate or add payment details</Link>
    <button className="dir-button secondary" style={{ display: 'block', marginTop: 18 }} disabled={busy} onClick={async () => {
      setBusy(true); try { await api('/donations/hide-all', 'POST', {}); own.reload(); setNotice('All of your donations are anonymous publicly.'); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
    }}>Make all my donations anonymous</button>
    {notice && <Notice>{notice}</Notice>}{error && <Notice error>{error}</Notice>}
    {own.data?.donations.length === 0 && <p className="dir-muted">No donation receipts yet.</p>}
    {own.data?.donations.map((entry) => <article className="account-donation" key={entry.id}><strong>{entry.amount ?? entry.declaredAmount} {entry.currency}</strong><span className="dir-tag">{entry.status}</span>
      <span className="dir-small dir-muted">{entry.publicCredit ? 'Public credit requested' : 'Anonymous publicly'}</span>
      {(entry.publicCredit || config.data?.leaderboardEnabled) && <button className="dir-link" disabled={busy} onClick={async () => {
        setBusy(true); try { await api('/donations/' + entry.id + '/visibility', 'PATCH', { publicCredit: !entry.publicCredit }); own.reload(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
      }}>{entry.publicCredit ? 'Make donation anonymous' : 'Show donation on leaderboard'}</button>}
    </article>)}
  </section></>;
}
function Appearance({ profile }: { profile: ProfileSettings }) {
  const { theme, toggleTheme, preference, followSiteDefault, siteSettings } = useTheme();
  return <section className="dir-card"><h2>Appearance</h2><p>Your current theme is <strong>{theme === 'dark' ? 'Dark ruby red' : 'Light ruby red'}</strong>.</p>
    <div className="dir-row"><button className="dir-button" onClick={toggleTheme}>Use {theme === 'dark' ? 'light' : 'dark'} ruby red on this device</button>{preference && <button className="dir-button secondary" onClick={followSiteDefault}>Follow site default</button>}</div>
    <p className="dir-small dir-muted">Site default: {siteSettings.defaultTheme === 'ruby-dark' ? 'Dark ruby red' : 'Light ruby red'}. Personal preferences are saved on this device.</p>
    {profile.user.isSystemAdmin && <Link className="dir-button secondary" to="/site-settings">Change site-wide theme and settings</Link>}
  </section>;
}
function Security() {
  const [currentPassword, setCurrentPassword] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  return <section className="dir-card"><h2>Account security</h2><form onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (password !== confirm) throw new Error('New passwords do not match.');
      const result = await authClient.changePassword({ currentPassword, newPassword: password, revokeOtherSessions: true });
      if (result.error) throw new Error(result.error.message || 'Password change failed.');
      setNotice('Password changed. Other sessions were signed out.'); setCurrentPassword(''); setPassword(''); setConfirm('');
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }}><label>Current password<input type="password" required autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></label>
    <label>New password<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    <label>Confirm new password<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
    <button className="dir-button" disabled={busy}>Change password</button></form>
    <button className="dir-button secondary" style={{ marginTop: 24 }} disabled={busy} onClick={async () => {
      setBusy(true); setError(''); try { const result = await authClient.revokeOtherSessions(); if (result.error) throw new Error(result.error.message); setNotice('Other sessions were signed out.'); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
    }}>Sign out other devices</button>{notice && <Notice>{notice}</Notice>}{error && <Notice error>{error}</Notice>}
  </section>;
}
export default function AccountSettingsPage() {
  const data = useDirectory<ProfileSettings>('/account'), [params, setParams] = useSearchParams(), [notice, setNotice] = useState('');
  const tab = ['profile', 'donations', 'appearance', 'security'].includes(params.get('tab') ?? '') ? params.get('tab')! : 'profile';
  return <Shell><Link className="dir-link" to="/dashboard">← My dashboard</Link><span className="dir-eyebrow" style={{ display: 'block', marginTop: 24 }}>Your account</span><h1>Profile & settings</h1>
    <p className="dir-muted">Manage your profile, privacy, donation identity, theme and security.</p>
    <div className="dir-pills" style={{ margin: '24px 0' }}>{[['profile', 'Profile & privacy'], ['donations', 'Donations'], ['appearance', 'Themes & appearance'], ['security', 'Security']].map(([value, label]) => <button key={value} className={'dir-button secondary' + (tab === value ? ' active' : '')} onClick={() => setParams({ tab: value })}>{label}</button>)}</div>
    {notice && <Notice>{notice}</Notice>}{data.error && <Notice error>{data.error}</Notice>}
    {data.data ? <>{tab === 'profile' && <ProfileEditor key={data.data.user.updatedAt} initial={data.data} reload={data.reload} saved={setNotice} />}
      {tab === 'donations' && <DonationPreferences profile={data.data} />}{tab === 'appearance' && <Appearance profile={data.data} />}{tab === 'security' && <Security />}</> : !data.error && <p>Loading account settings…</p>}
  </Shell>;
}

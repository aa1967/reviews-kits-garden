import { useState } from 'react';
import { directoryRequest as api, type Account, type Review } from '../services/directory';

const message = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
export function ReviewPrivacy({ review, reload }: { review: Account['reviews'][number]; reload: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="dir-review-actions"><span className="dir-tag">{review.anonymous ? 'Anonymous publicly' : 'Uses your public profile identity'}</span>
    <button className="dir-link" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await api('/reviews/' + review.id + '/privacy', 'PATCH', { anonymous: !review.anonymous }); reload(); }
      catch (cause) { setError(message(cause)); } finally { setBusy(false); }
    }}>{review.anonymous ? 'Show my profile on this review' : 'Make this review anonymous'}</button>
    {error && <p role="alert" className="dir-error">{error}</p>}
  </div>;
}
export function ResolutionResponse({ review, reload }: { review: Account['reviews'][number]; reload: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!['requested', 'accepted'].includes(review.resolutionStatus)) return null;
  const respond = async (decision: 'accept' | 'decline' | 'withdraw') => {
    setBusy(true); setError('');
    try { await api('/reviews/' + review.id + '/resolution/respond', 'POST', { decision, version: review.resolutionVersion }); reload(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  return <section className="dir-notice" aria-label="Review resolution"><strong>{review.resolutionStatus === 'accepted' ? 'You confirmed a resolution' : 'The business asks you to confirm a resolution'}</strong>
    <p>{review.resolutionNote}</p><p className="dir-small dir-muted">Accept only if the issue was resolved. Acceptance displays this note and a label on your published review. It does not change your score or require a positive rating. You can remove the label later.</p>
    {review.resolutionStatus === 'requested' ? <div className="dir-row"><button className="dir-button" disabled={busy} onClick={() => respond('accept')}>Accept resolution label</button><button className="dir-button secondary" disabled={busy} onClick={() => respond('decline')}>Decline request</button></div>
      : <><button className="dir-link" disabled={busy} onClick={() => respond('withdraw')}>Remove resolution label</button><p className="dir-small dir-muted">{review.reviewsClosed ? 'Author edits remain closed for this business.' : 'You may update your review and score below if you wish. Content and score edits return to moderation.'}</p></>}
    {error && <p role="alert" className="dir-error">{error}</p>}
  </section>;
}
export function ResolutionRequest({ review, reload }: { review: Review; reload?: () => void }) {
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!review.resolutionVersion) return null;
  if (review.resolutionStatus === 'accepted') return <p className="dir-small dir-muted">The reviewer confirmed a resolution. Only they or a moderator can remove that label.</p>;
  if (review.resolutionStatus === 'requested') return <div className="dir-notice"><strong>Awaiting reviewer confirmation</strong><p>{review.resolutionNote}</p><p className="dir-small dir-muted">A resolution label appears only after the reviewer accepts it.</p></div>;
  const cooldown = review.resolutionStatus === 'declined' && review.resolutionRespondedAt && Date.now() - new Date(review.resolutionRespondedAt).getTime() < 7 * 86400000;
  return <details><summary>Request a resolution label</summary><form onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/reviews/' + review.id + '/resolution', 'POST', { note, version: review.resolutionVersion }); reload?.(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }}><p className="dir-small dir-muted">Post a business response first. Explain how you resolved the issue. This note becomes public only if the reviewer accepts it. Do not include private contact details or offer an incentive to change their rating.</p>
    <label>Proposed resolution note<textarea required minLength={10} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    {cooldown && <p className="dir-small dir-muted">The reviewer declined or withdrew a label. Wait seven days before another request.</p>}
    <button className="dir-button secondary" disabled={busy || !review.reply || !!cooldown}>Ask reviewer to confirm resolution</button>{error && <p role="alert" className="dir-error">{error}</p>}
  </form></details>;
}

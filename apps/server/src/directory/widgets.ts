import { publicBaseUrl } from './mail';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderWidget(
  business: { domain: string; name: string; permanentlyClosed?: boolean; reviewsClosed?: boolean }, score: { count: number; average: number | null },
  reviews: { title: string; content: string; rating: number; author: string }[],
  mode: 'badge' | 'highlights' | 'recent', dark: boolean,
): string {
  const url = escapeHtml(publicBaseUrl() + '/business/' + business.domain);
  const label = mode === 'highlights' ? 'Selected reviews · highlights' : 'Latest published reviews';
  const summary = score.count ? String(score.average) + ' / 5' : 'No ratings yet';
  const cards = reviews.map((r) => '<article><div class="stars" aria-label="' + r.rating + ' out of 5">' +
    '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) + '</div><h3>' + escapeHtml(r.title) +
    '</h3><p>' + escapeHtml(r.content.slice(0, 600)) + '</p><small>' + escapeHtml(r.author) + '</small></article>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(business.name) + ' reviews</title><style>' +
    ':root{color-scheme:' + (dark ? 'dark' : 'light') + ';font:14px/1.5 system-ui,sans-serif;color:' + (dark ? '#f9edf1' : '#30121d') + ';background:' + (dark ? '#1b0e15' : '#fff') + '}' +
    '*{box-sizing:border-box}body{margin:0;padding:20px}a{color:inherit}header{display:flex;flex-wrap:wrap;align-items:center;gap:12px}.score{font-size:28px;font-weight:800}.stars{color:' + (dark ? '#ff8fab' : '#a71949') + ';letter-spacing:2px;font-size:18px}' +
    '.muted,small{opacity:.7}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:16px 0}article{border:1px solid #b77f9255;border-radius:14px;padding:16px}h3{font-size:15px;margin:8px 0}p{white-space:pre-wrap;overflow-wrap:anywhere}footer{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:14px;font-size:12px}</style></head><body>' +
    '<header><strong>' + escapeHtml(business.name) + '</strong><span class="score">' + summary + '</span><span class="muted">' + score.count + ' published reviews</span></header>' +
    (business.permanentlyClosed ? '<p><strong>Permanently closed</strong> · Published reviews are retained.</p>' : business.reviewsClosed ? '<p>New reviews are closed for this business.</p>' : '') +
    '<p class="muted">Overall score includes every published rating.</p>' +
    (mode !== 'badge' ? '<h2 style="font-size:14px">' + label + '</h2><div class="cards">' + (cards || '<p>No reviews match this selection yet.</p>') + '</div>' : '') +
    '<footer><span>Independent reviews · Reviewskits</span><a href="' + url + '" target="_blank" rel="noopener noreferrer">Read all reviews ↗</a></footer></body></html>';
}

// An optional framework-independent loader. No third-party scripts or cookies.
export const embedLoader = [
  '(function(){',
  'var s=document.currentScript;if(!s)return;',
  'var domain=s.getAttribute("data-domain");if(!domain)return;',
  'var mode=s.getAttribute("data-mode")||"badge";',
  'if(["badge","highlights","recent"].indexOf(mode)<0)mode="badge";',
  'var u=new URL("./widgets/"+encodeURIComponent(domain),s.src);',
  'u.searchParams.set("mode",mode);',
  'u.searchParams.set("theme",s.getAttribute("data-theme")==="dark"?"dark":"light");',
  'if(s.getAttribute("data-ids"))u.searchParams.set("ids",s.getAttribute("data-ids"));',
  'var f=document.createElement("iframe");f.src=u.href;',
  'f.title="Independent reviews for "+domain;f.loading="lazy";',
  'f.referrerPolicy="no-referrer";f.style.cssText="width:100%;border:0;display:block";',
  'f.height=mode==="badge"?"190":"720";',
  'f.setAttribute("sandbox","allow-popups allow-popups-to-escape-sandbox");',
  's.parentNode.insertBefore(f,s.nextSibling);',
  '})();',
].join('');

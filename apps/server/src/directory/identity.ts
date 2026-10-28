import { sql } from 'drizzle-orm';
import * as s from '../infrastructure/database/schema';

export function profilePseudonym(value: string) {
  const name = value.normalize('NFKC').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,38}[A-Za-z0-9]$/.test(name)) throw new Error('Use 3–40 letters, numbers, spaces, dots, underscores or hyphens.');
  if (['anonymous', 'anonymous reviewer', 'admin', 'administrator', 'moderator', 'staff', 'system', 'reviewskits'].includes(name.toLowerCase())) throw new Error('Choose a different pseudonym.');
  return name;
}
export const publicAuthor = sql<string>`case when ${s.directoryReviews.anonymous} then 'Anonymous reviewer'
  when ${s.userProfiles.nameMode} = 'pseudonym' then coalesce(${s.userProfiles.pseudonym}, ${s.users.name})
  else ${s.users.name} end`;
export const publicAvatar = sql<string | null>`case when ${s.directoryReviews.anonymous} then null
  when ${s.users.image} ~ '^/api/v1/directory/avatars/[a-f0-9-]{36}$' then ${s.users.image} else null end`;
export function avatarUrl(value: string | null) {
  return value && /^\/api\/v1\/directory\/avatars\/[a-f0-9-]{36}$/.test(value) ? value : null;
}

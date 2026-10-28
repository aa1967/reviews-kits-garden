import { and, eq, sql } from 'drizzle-orm';
import { db } from '../infrastructure/database/db';
import { directoryAudit, directoryBusinesses, directoryClaims, directoryInvites, directoryMembers, directoryMonitors, notifications } from '../infrastructure/database/schema';
import { verifyDomainProof } from './network';
import { nextBusinessVersion } from './administration';

export type Claim = typeof directoryClaims.$inferSelect;

export async function checkClaim(claim: Claim, proof = verifyDomainProof): Promise<void> {
  if (claim.status !== 'pending') return;
  if (claim.expiresAt <= new Date()) {
    await db.update(directoryClaims).set({ status: 'expired', lastError: 'Verification challenge expired. Create a new one.' }).where(eq(directoryClaims.id, claim.id));
    return;
  }
  const [business] = await db.select().from(directoryBusinesses).where(eq(directoryBusinesses.id, claim.businessId));
  if (!business || !business.listed || business.permanentlyClosed) return;
  let matches = false;
  let error = 'Proof not found yet. Automatic checks will continue until the challenge expires.';
  try { matches = await proof(business.domain, claim.method, claim.token); }
  catch { error = 'Could not verify the public DNS record or HTTPS file yet.'; }
  if (!matches) {
    await db.update(directoryClaims).set({
      attempts: sql.join([directoryClaims.attempts, sql.raw(' + 1')], sql.raw('')), lastError: error,
      nextCheckAt: new Date(Date.now() + 5 * 60 * 1000),
    }).where(and(eq(directoryClaims.id, claim.id), eq(directoryClaims.status, 'pending')));
    return;
  }
  await db.transaction(async (tx) => {
    const [site] = await tx.select().from(directoryBusinesses).where(eq(directoryBusinesses.id, claim.businessId)).for('update');
    const [locked] = await tx.select().from(directoryClaims).where(eq(directoryClaims.id, claim.id)).for('update');
    if (!locked || locked.status !== 'pending' || locked.expiresAt <= new Date()) return;
    if (!site || site.ownerId || !site.listed || site.permanentlyClosed) {
      await tx.update(directoryClaims).set({ status: 'conflict', lastError: 'This business is already claimed. Contact platform support about an ownership transfer.' }).where(eq(directoryClaims.id, claim.id));
      return;
    }
    const now = new Date();
    await tx.update(directoryBusinesses).set({ ownerId: claim.userId, claimedAt: now, updatedAt: nextBusinessVersion(site.updatedAt) }).where(eq(directoryBusinesses.id, site.id));
    await tx.insert(directoryMembers).values({ businessId: site.id, userId: claim.userId }).onConflictDoNothing();
    await tx.insert(directoryMonitors).values({ businessId: site.id, url: 'https://' + site.domain }).onConflictDoNothing();
    await tx.update(directoryClaims).set({ status: 'verified', verifiedAt: now, lastError: null, nextCheckAt: new Date(Date.now() + 86400000) }).where(eq(directoryClaims.id, claim.id));
    await tx.insert(directoryAudit).values({ actorId: claim.userId, action: 'business.claimed', targetId: site.id, note: 'Exact-host ownership verified by ' + claim.method });
    await tx.insert(notifications).values({ userId: claim.userId, type: 'directory.claimed', title: 'Website verified', body: site.domain + ' is ready. Open your business dashboard to enable monitoring and get your widgets.' });
  });
}

export async function recheckOwnership(claim: Claim, proof = verifyDomainProof): Promise<void> {
  if (claim.status !== 'verified') return;
  const [business] = await db.select().from(directoryBusinesses).where(eq(directoryBusinesses.id, claim.businessId));
  if (!business || business.ownerId !== claim.userId) {
    await db.update(directoryClaims).set({ status: 'conflict', lastError: 'Ownership changed. Contact the current owner or platform support.' }).where(eq(directoryClaims.id, claim.id));
    return;
  }
  let matches: boolean;
  try { matches = await proof(business.domain, claim.method, claim.token); }
  catch {
    // Resolver outages are not evidence that ownership was lost.
    await db.update(directoryClaims).set({ nextCheckAt: new Date(Date.now() + 86400000), lastError: 'Ownership recheck unavailable. We will retry; access is unchanged.' }).where(eq(directoryClaims.id, claim.id));
    return;
  }
  const missingSince = claim.proofMissingSince ?? new Date();
  await db.transaction(async (tx) => {
    const [site] = await tx.select().from(directoryBusinesses).where(eq(directoryBusinesses.id, claim.businessId)).for('update');
    if (!site || site.ownerId !== claim.userId) return;
    const expired = !matches && Date.now() - missingSince.getTime() >= 7 * 86400000;
    await tx.update(directoryClaims).set({
      nextCheckAt: new Date(Date.now() + 86400000), proofMissingSince: matches ? null : missingSince,
      status: expired ? 'expired' : 'verified',
      lastError: matches ? null : expired ? 'Ownership proof was absent for seven days. Access has been revoked. Verify a new claim or contact support.' : 'Ownership proof is missing. Restore your DNS record or verification file within seven days to keep business access.',
    }).where(eq(directoryClaims.id, claim.id));
    if (expired) {
      await tx.update(directoryBusinesses).set({ ownerId: null, claimedAt: null, updatedAt: nextBusinessVersion(site.updatedAt) }).where(eq(directoryBusinesses.id, site.id));
      await tx.delete(directoryMembers).where(eq(directoryMembers.businessId, site.id));
      await tx.delete(directoryInvites).where(eq(directoryInvites.businessId, site.id));
      await tx.update(directoryMonitors).set({ enabled: false }).where(eq(directoryMonitors.businessId, site.id));
      await tx.insert(directoryAudit).values({ action: 'business.proof-expired', targetId: site.id, note: 'Ownership proof absent for seven days; business access and monitoring revoked' });
    }
    if ((!matches && !claim.proofMissingSince) || expired) {
      await tx.insert(notifications).values({ userId: claim.userId, type: 'directory.ownership', title: expired ? 'Business verification expired' : 'Restore your ownership proof', body: site.domain + ': ' + (expired ? 'Verify your website again to restore access.' : 'Your verification proof is missing. Restore it within seven days.') });
    }
  });
}

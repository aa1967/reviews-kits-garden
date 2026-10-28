export type PublicNameMode = 'account' | 'pseudonym';
export type ReviewResolutionStatus = 'none' | 'requested' | 'accepted' | 'declined';
export interface ProfileSettings {
  user: { id: string; name: string; email: string; emailVerified: boolean; isSystemAdmin: boolean; image: string | null; updatedAt: string };
  identity: { mode: PublicNameMode; pseudonym: string | null; defaultAnonymousReviews: boolean; publicName: string };
  notifications: { newReview: boolean; weeklyReport: boolean };
}
export interface ReviewResolution {
  status: ReviewResolutionStatus;
  note: string | null;
  version: string;
  requestedAt: string | null;
  respondedAt: string | null;
}
export interface AdminUserSummary {
  id: string; name: string; email: string; emailVerified: boolean; isSystemAdmin: boolean;
  image: string | null; suspendedAt: string | null; suspensionReason: string | null;
  createdAt: string; updatedAt: string; lastSignInAt: string | null;
  pseudonym: string | null; reviewCount: number; businessCount: number; riskCount: number;
}
export interface AdminUserDetail {
  user: AdminUserSummary;
  identity: ProfileSettings['identity'];
  reviews: { id: string; domain: string; title: string; rating: number; status: string; anonymous: boolean; riskScore: number; riskReasons: string[]; createdAt: string }[];
  businesses: { id: string; domain: string; name: string; role: 'owner' | 'member' }[];
  donations: { id: string; currency: string; status: string; amount: string | null; publicCredit: boolean; createdAt: string }[];
  sessions: { id: string; createdAt: string; expiresAt: string }[];
  audit: { id: string; action: string; note: string; createdAt: string }[];
}

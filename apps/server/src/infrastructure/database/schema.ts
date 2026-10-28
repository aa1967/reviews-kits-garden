import { pgTable, uuid, text, timestamp, boolean, jsonb, integer, index, unique, uniqueIndex, numeric, date, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ═══════════════════════════════════════
// USERS & AUTH (Better-auth)
// ═══════════════════════════════════════

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').unique().notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  isSystemAdmin: boolean('is_system_admin').notNull().default(false),
  notificationPrefs: jsonb('notification_prefs').default({ newReview: true, weeklyReport: true }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').unique().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ═══════════════════════════════════════
// API KEYS
// ═══════════════════════════════════════

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').unique().notNull(),
  keyPrefix: text('key_prefix').notNull(),
  type: text('type').notNull(), // public | secret
  name: text('name'),
  lastUsed: timestamp('last_used'),
  expiresAt: timestamp('expires_at'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  hashIdx: index('idx_api_keys_hash').on(t.keyHash),
  userIdIdx: index('idx_api_keys_user').on(t.userId),
}));

// ═══════════════════════════════════════
// FORMS
// ═══════════════════════════════════════

export const forms = pgTable('forms', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  publicId: text('public_id').unique().notNull(),
  description: text('description'),
  thankYouMessage: text('thank_you_message'),
  config: jsonb('config').default({}),
  accentColor: text('accent_color'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  userIdIdx: index('idx_forms_user').on(t.userId),
}));

// ═══════════════════════════════════════
// TESTIMONIALS & MEDIA
// ═══════════════════════════════════════

export const formVisits = pgTable('form_visits', {
  id: uuid('id').primaryKey().defaultRandom(),
  formId: uuid('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  visits: integer('visits').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  formDateUnq: unique('unq_form_visits_date').on(t.formId, t.date),
  formIdx: index('idx_form_visits_form').on(t.formId),
  dateIdx: index('idx_form_visits_date').on(t.date),
}));

export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  uploadId: text('upload_id').unique().notNull(),
  originalFilename: text('original_filename').notNull(),
  originalSize: integer('original_size').notNull(), 
  mimeType: text('mime_type').notNull(),
  processedUrls: jsonb('processed_urls').default({}),
  processingStatus: text('processing_status').default('pending'),
  transcript: text('transcript'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const testimonials = pgTable('testimonials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  formId: uuid('form_id').references(() => forms.id, { onDelete: 'set null' }),
  type: text('type').notNull().default('text'), // text | video
  status: text('status').notNull().default('pending'), // pending | approved | rejected
  source: text('source').notNull().default('form'), // form | import | api
  content: text('content').notNull(),
  rating: integer('rating'),
  authorName: text('author_name').notNull(),
  authorEmail: text('author_email'),
  authorTitle: text('author_title'),
  authorUrl: text('author_url'),
  mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
  position: integer('position').notNull().default(0),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  userIdIdx: index('idx_testimonials_user').on(t.userId),
  statusIdx: index('idx_testimonials_status').on(t.status),
  formIdx: index('idx_testimonials_form').on(t.formId),
}));

// ═══════════════════════════════════════
// WEBHOOKS
// ═══════════════════════════════════════

export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  events: text('events').array().notNull(), 
  secret: text('secret').notNull(),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const webhookLogs = pgTable('webhook_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookId: uuid('webhook_id').notNull().references(() => webhooks.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  payload: jsonb('payload').notNull(),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  attempt: integer('attempt').default(1),
  delivered: boolean('delivered').default(false),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  webhookIdx: index('idx_webhook_logs_webhook').on(t.webhookId),
  deliveredIdx: index('idx_webhook_logs_delivered').on(t.delivered),
}));
// ═══════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // new_review
  title: text('title').notNull(),
  body: text('body'),
  formId: uuid('form_id').references(() => forms.id, { onDelete: 'set null' }),
  testimonialId: uuid('testimonial_id').references(() => testimonials.id, { onDelete: 'set null' }),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('idx_notifications_user').on(t.userId),
  unreadIdx: index('idx_notifications_unread').on(t.userId, t.isRead),
}));

// ═══════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  resetAt: timestamp('reset_at').notNull(),
});

// Independent directory data is intentionally separate from owner-curated testimonials.
export const directoryBusinesses = pgTable('directory_businesses', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: text('domain').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default('Other'),
  listed: boolean('listed').notNull().default(true),
  permanentlyClosed: boolean('permanently_closed').notNull().default(false),
  reviewsClosed: boolean('reviews_closed').notNull().default(false),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  claimedAt: timestamp('claimed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, () => ({
  closedReviews: check('directory_business_closed_reviews', sql.raw('NOT "permanently_closed" OR "reviews_closed"')),
}));

export const siteSettings = pgTable('site_settings', {
  id: text('id').primaryKey().default('global'),
  defaultTheme: text('default_theme', { enum: ['ruby-dark', 'ruby-light'] }).notNull().default('ruby-dark'),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, () => ({
  singleton: check('site_settings_singleton', sql.raw("\"id\" = 'global'")),
  theme: check('site_settings_theme', sql.raw("\"default_theme\" IN ('ruby-dark', 'ruby-light')")),
}));

export const directoryMembers = pgTable('directory_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull().references(() => directoryBusinesses.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ membership: unique('directory_members_unique').on(t.businessId, t.userId) }));

export const directoryInvites = pgTable('directory_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull().references(() => directoryBusinesses.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
});

export const directoryClaims = pgTable('directory_claims', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull().references(() => directoryBusinesses.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  method: text('method', { enum: ['dns', 'file'] }).notNull(),
  token: text('token').notNull(),
  status: text('status', { enum: ['pending', 'verified', 'expired', 'conflict'] }).notNull().default('pending'),
  expiresAt: timestamp('expires_at').notNull(),
  verifiedAt: timestamp('verified_at'),
  nextCheckAt: timestamp('next_check_at').notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  proofMissingSince: timestamp('proof_missing_since'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ due: index('directory_claims_due').on(t.status, t.nextCheckAt) }));

export const directoryReviews = pgTable('directory_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull().references(() => directoryBusinesses.id, { onDelete: 'cascade' }),
  reviewerId: uuid('reviewer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  rating: integer('rating').notNull(),
  status: text('status', { enum: ['pending', 'published', 'quarantined', 'rejected'] }).notNull().default('pending'),
  riskScore: integer('risk_score').notNull().default(0),
  riskReasons: jsonb('risk_reasons').$type<string[]>().notNull().default([]),
  networkKey: text('network_key'),
  fingerprint: text('fingerprint').notNull(),
  moderationReason: text('moderation_reason'),
  reply: text('reply'),
  replyBy: uuid('reply_by').references(() => users.id, { onDelete: 'set null' }),
  replyAt: timestamp('reply_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  reviewerBusiness: unique('directory_review_one_per_person').on(t.businessId, t.reviewerId),
  published: index('directory_reviews_business_status').on(t.businessId, t.status),
  network: index('directory_reviews_network').on(t.networkKey),
  fingerprint: index('directory_reviews_fingerprint').on(t.fingerprint),
  ratingValid: check('directory_review_rating_valid', sql.raw('"rating" BETWEEN 1 AND 5')),
  statusValid: check('directory_review_status_valid', sql.raw("status IN ('pending', 'published', 'quarantined', 'rejected')")),
}));

export const directoryReports = pgTable('directory_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id').notNull().references(() => directoryReviews.id, { onDelete: 'cascade' }),
  reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['report', 'appeal'] }).notNull(),
  reason: text('reason').notNull(),
  resolution: text('resolution'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ oneReport: unique('directory_reports_unique').on(t.reviewId, t.reporterId, t.kind) }));

export const directoryAudit = pgTable('directory_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetId: uuid('target_id').notNull(),
  note: text('note').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const directoryMonitors = pgTable('directory_monitors', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull().unique().references(() => directoryBusinesses.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  expectedText: text('expected_text').notNull().default(''),
  enabled: boolean('enabled').notNull().default(false),
  startedAt: timestamp('started_at'),
  lastResult: text('last_result', { enum: ['up', 'down', 'unknown'] }).notNull().default('unknown'),
  lastCheckAt: timestamp('last_check_at'),
  responseMs: integer('response_ms'),
  tlsExpiresAt: timestamp('tls_expires_at'),
  dnsAddresses: text('dns_addresses'),
  lastDnsAlertAt: timestamp('last_dns_alert_at'),
  widgetInstalled: boolean('widget_installed'),
  failureStreak: integer('failure_streak').notNull().default(0),
  recoveryStreak: integer('recovery_streak').notNull().default(0),
  firstFailureAt: timestamp('first_failure_at'),
  nextCheckAt: timestamp('next_check_at').notNull().defaultNow(),
  leaseUntil: timestamp('lease_until'),
  leaseToken: uuid('lease_token'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ due: index('directory_monitors_due').on(t.enabled, t.nextCheckAt) }));

export const directoryChecks = pgTable('directory_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  monitorId: uuid('monitor_id').notNull().references(() => directoryMonitors.id, { onDelete: 'cascade' }),
  result: text('result', { enum: ['up', 'down', 'unknown'] }).notNull(),
  responseMs: integer('response_ms'),
  statusCode: integer('status_code'),
  detail: text('detail').notNull(),
  checkedAt: timestamp('checked_at').notNull().defaultNow(),
}, (t) => ({ history: index('directory_checks_history').on(t.monitorId, t.checkedAt) }));

export const directoryIncidents = pgTable('directory_incidents', {
  id: uuid('id').primaryKey().defaultRandom(),
  monitorId: uuid('monitor_id').notNull().references(() => directoryMonitors.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at').notNull(),
  confirmedAt: timestamp('confirmed_at').notNull(),
  endedAt: timestamp('ended_at'),
  reason: text('reason').notNull(),
}, (t) => ({ monitor: index('directory_incidents_monitor').on(t.monitorId, t.startedAt) }));

export const directoryMail = pgTable('directory_mail', {
  id: uuid('id').primaryKey().defaultRandom(),
  to: text('recipient').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at').notNull().defaultNow(),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const directoryWorkers = pgTable('directory_workers', {
  name: text('name').primaryKey(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
});

// Donation addresses are public receiving addresses only; never wallet keys.
export const donationWallets = pgTable('donation_wallets', {
  currency: text('currency', { enum: ['BTC', 'LTC', 'XMR'] }).primaryKey(),
  address: text('address').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  supported: check('donation_wallets_currency', sql`${t.currency} IN ('BTC', 'LTC', 'XMR')`),
  configured: check('donation_wallets_configured', sql`NOT ${t.enabled} OR length(${t.address}) > 0`),
}));

export const donationSettings = pgTable('donation_settings', {
  id: text('id').primaryKey().default('global'),
  leaderboardEnabled: boolean('leaderboard_enabled').notNull().default(false),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({ singleton: check('donation_settings_singleton', sql`${t.id} = 'global'`) }));

export const donationSupporters = pgTable('donation_supporters', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  nameMode: text('name_mode', { enum: ['account', 'pseudonym'] }).notNull().default('account'),
  pseudonym: text('pseudonym'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  mode: check('donation_supporters_name_mode', sql`${t.nameMode} IN ('account', 'pseudonym')`),
  named: check('donation_supporters_pseudonym_required', sql`${t.nameMode} <> 'pseudonym' OR ${t.pseudonym} IS NOT NULL`),
  pseudonymShape: check('donation_supporters_pseudonym_shape', sql`${t.pseudonym} IS NULL OR
    (length(${t.pseudonym}) BETWEEN 3 AND 40 AND ${t.pseudonym} ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]*[A-Za-z0-9]$')`),
  uniqueName: uniqueIndex('donation_supporters_pseudonym_unique').on(sql`lower(${t.pseudonym})`).where(sql`${t.pseudonym} IS NOT NULL`),
}));

export const donations = pgTable('donations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  currency: text('currency', { enum: ['BTC', 'LTC', 'XMR'] }).notNull(),
  walletAddress: text('wallet_address').notNull(),
  // PostgreSQL numeric returns strings, preserving every satoshi / piconero.
  declaredAtomic: numeric('declared_atomic', { precision: 30, scale: 0 }).notNull(),
  confirmedAtomic: numeric('confirmed_atomic', { precision: 30, scale: 0 }),
  publicCredit: boolean('public_credit').notNull().default(false),
  status: text('status', { enum: ['pending', 'confirmed', 'rejected', 'reversed'] }).notNull().default('pending'),
  transactionId: text('transaction_id'),
  donorNote: text('donor_note').notNull().default(''),
  decisionReason: text('decision_reason'),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  receivedAt: timestamp('received_at'),
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  currencyCheck: check('donations_currency', sql`${t.currency} IN ('BTC', 'LTC', 'XMR')`),
  statusCheck: check('donations_status', sql`${t.status} IN ('pending', 'confirmed', 'rejected', 'reversed')`),
  positive: check('donations_positive', sql`${t.declaredAtomic} > 0 AND (${t.confirmedAtomic} IS NULL OR ${t.confirmedAtomic} > 0)`),
  verified: check('donations_verified', sql`${t.status} NOT IN ('confirmed', 'reversed') OR
    (${t.confirmedAtomic} IS NOT NULL AND ${t.receivedAt} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL AND ${t.transactionId} IS NOT NULL)`),
  txFormat: check('donations_tx_format', sql`${t.transactionId} IS NULL OR ${t.transactionId} ~ '^[a-f0-9]{64}$'`),
  oneReceipt: uniqueIndex('donations_confirmed_transaction').on(t.currency, t.transactionId).where(sql`${t.status} = 'confirmed'`),
  history: index('donations_user_history').on(t.userId, t.createdAt),
  totals: index('donations_confirmed_totals').on(t.currency, t.status, t.receivedAt),
}));

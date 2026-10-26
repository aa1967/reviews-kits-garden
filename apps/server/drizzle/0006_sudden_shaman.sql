CREATE TABLE "directory_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_id" uuid NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'Other' NOT NULL,
	"listed" boolean DEFAULT true NOT NULL,
	"owner_id" uuid,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "directory_businesses_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "directory_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"result" text NOT NULL,
	"response_ms" integer,
	"status_code" integer,
	"detail" text NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"method" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"verified_at" timestamp,
	"next_check_at" timestamp DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"proof_missing_since" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"started_at" timestamp NOT NULL,
	"confirmed_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	CONSTRAINT "directory_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "directory_mail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "directory_members_unique" UNIQUE("business_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "directory_monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"url" text NOT NULL,
	"expected_text" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"started_at" timestamp,
	"last_result" text DEFAULT 'unknown' NOT NULL,
	"last_check_at" timestamp,
	"response_ms" integer,
	"tls_expires_at" timestamp,
	"dns_addresses" text,
	"last_dns_alert_at" timestamp,
	"widget_installed" boolean,
	"failure_streak" integer DEFAULT 0 NOT NULL,
	"recovery_streak" integer DEFAULT 0 NOT NULL,
	"first_failure_at" timestamp,
	"next_check_at" timestamp DEFAULT now() NOT NULL,
	"lease_until" timestamp,
	"lease_token" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "directory_monitors_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "directory_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"resolution" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "directory_reports_unique" UNIQUE("review_id","reporter_id","kind")
);
--> statement-breakpoint
CREATE TABLE "directory_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"rating" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"risk_score" integer DEFAULT 0 NOT NULL,
	"risk_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"network_key" text,
	"fingerprint" text NOT NULL,
	"moderation_reason" text,
	"reply" text,
	"reply_by" uuid,
	"reply_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "directory_review_one_per_person" UNIQUE("business_id","reviewer_id"),
	CONSTRAINT "directory_review_rating_valid" CHECK ("rating" BETWEEN 1 AND 5),
	CONSTRAINT "directory_review_status_valid" CHECK (status IN ('pending', 'published', 'quarantined', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "directory_workers" (
	"name" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory_audit" ADD CONSTRAINT "directory_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_businesses" ADD CONSTRAINT "directory_businesses_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_checks" ADD CONSTRAINT "directory_checks_monitor_id_directory_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."directory_monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_claims" ADD CONSTRAINT "directory_claims_business_id_directory_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."directory_businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_claims" ADD CONSTRAINT "directory_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_incidents" ADD CONSTRAINT "directory_incidents_monitor_id_directory_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."directory_monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_invites" ADD CONSTRAINT "directory_invites_business_id_directory_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."directory_businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_members" ADD CONSTRAINT "directory_members_business_id_directory_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."directory_businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_members" ADD CONSTRAINT "directory_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_monitors" ADD CONSTRAINT "directory_monitors_business_id_directory_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."directory_businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_reports" ADD CONSTRAINT "directory_reports_review_id_directory_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."directory_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_reports" ADD CONSTRAINT "directory_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD CONSTRAINT "directory_reviews_business_id_directory_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."directory_businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD CONSTRAINT "directory_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD CONSTRAINT "directory_reviews_reply_by_users_id_fk" FOREIGN KEY ("reply_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "directory_checks_history" ON "directory_checks" USING btree ("monitor_id","checked_at");--> statement-breakpoint
CREATE INDEX "directory_claims_due" ON "directory_claims" USING btree ("status","next_check_at");--> statement-breakpoint
CREATE INDEX "directory_incidents_monitor" ON "directory_incidents" USING btree ("monitor_id","started_at");--> statement-breakpoint
CREATE INDEX "directory_monitors_due" ON "directory_monitors" USING btree ("enabled","next_check_at");--> statement-breakpoint
CREATE INDEX "directory_reviews_business_status" ON "directory_reviews" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "directory_reviews_network" ON "directory_reviews" USING btree ("network_key");--> statement-breakpoint
CREATE INDEX "directory_reviews_fingerprint" ON "directory_reviews" USING btree ("fingerprint");
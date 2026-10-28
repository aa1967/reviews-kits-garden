CREATE TABLE "profile_avatars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"png" text NOT NULL,
	CONSTRAINT "profile_avatars_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "profile_avatars_size" CHECK (length("profile_avatars"."png") <= 100000)
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"name_mode" text DEFAULT 'account' NOT NULL,
	"pseudonym" text,
	"default_anonymous_reviews" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_profiles_mode" CHECK ("user_profiles"."name_mode" IN ('account', 'pseudonym')),
	CONSTRAINT "user_profiles_pseudonym_required" CHECK ("user_profiles"."name_mode" <> 'pseudonym' OR "user_profiles"."pseudonym" IS NOT NULL),
	CONSTRAINT "user_profiles_pseudonym_shape" CHECK ("user_profiles"."pseudonym" IS NULL OR (length("user_profiles"."pseudonym") BETWEEN 3 AND 40 AND "user_profiles"."pseudonym" ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]*[A-Za-z0-9]$'))
);
--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD COLUMN "anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD COLUMN "resolution_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD COLUMN "resolution_version" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD COLUMN "resolution_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD COLUMN "resolution_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD COLUMN "resolution_responded_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspension_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_sign_in_at" timestamp;--> statement-breakpoint
ALTER TABLE "profile_avatars" ADD CONSTRAINT "profile_avatars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_pseudonym_unique" ON "user_profiles" USING btree (lower("pseudonym")) WHERE "user_profiles"."pseudonym" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD CONSTRAINT "directory_reviews_resolution_requested_by_users_id_fk" FOREIGN KEY ("resolution_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD CONSTRAINT "directory_review_resolution_valid" CHECK ("directory_reviews"."resolution_status" IN ('none', 'requested', 'accepted', 'declined'));--> statement-breakpoint
ALTER TABLE "directory_reviews" ADD CONSTRAINT "directory_review_resolution_complete" CHECK ("directory_reviews"."resolution_status" NOT IN ('requested', 'accepted') OR ("directory_reviews"."resolution_note" IS NOT NULL AND "directory_reviews"."resolution_requested_at" IS NOT NULL));
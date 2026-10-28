CREATE TABLE "donation_settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"leaderboard_enabled" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "donation_settings_singleton" CHECK ("donation_settings"."id" = 'global')
);
--> statement-breakpoint
CREATE TABLE "donation_supporters" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"name_mode" text DEFAULT 'account' NOT NULL,
	"pseudonym" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "donation_supporters_name_mode" CHECK ("donation_supporters"."name_mode" IN ('account', 'pseudonym')),
	CONSTRAINT "donation_supporters_pseudonym_required" CHECK ("donation_supporters"."name_mode" <> 'pseudonym' OR "donation_supporters"."pseudonym" IS NOT NULL),
	CONSTRAINT "donation_supporters_pseudonym_shape" CHECK ("donation_supporters"."pseudonym" IS NULL OR
    (length("donation_supporters"."pseudonym") BETWEEN 3 AND 40 AND "donation_supporters"."pseudonym" ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]*[A-Za-z0-9]$'))
);
--> statement-breakpoint
ALTER TABLE "donation_settings" ADD CONSTRAINT "donation_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_supporters" ADD CONSTRAINT "donation_supporters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "donation_supporters_pseudonym_unique" ON "donation_supporters" USING btree (lower("pseudonym")) WHERE "donation_supporters"."pseudonym" IS NOT NULL;
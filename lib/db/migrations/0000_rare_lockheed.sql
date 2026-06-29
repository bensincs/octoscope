CREATE TABLE "audit_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"owner_login" text NOT NULL,
	"project_number" integer NOT NULL,
	"title" text,
	"encrypted_pat" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"encrypted_pat" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" text NOT NULL,
	"login" text NOT NULL,
	"name" text,
	"email" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_boards" ADD CONSTRAINT "audit_boards_project_id_audit_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."audit_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_projects" ADD CONSTRAINT "audit_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_repos" ADD CONSTRAINT "audit_repos_project_id_audit_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."audit_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_boards_project_idx" ON "audit_boards" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_boards_unique" ON "audit_boards" USING btree ("project_id","owner_login","project_number");--> statement-breakpoint
CREATE INDEX "audit_projects_user_idx" ON "audit_projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_repos_project_idx" ON "audit_repos" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_repos_unique" ON "audit_repos" USING btree ("project_id","owner","name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_github_id_unique" ON "users" USING btree ("github_id");
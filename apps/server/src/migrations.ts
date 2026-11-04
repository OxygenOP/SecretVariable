export const migrations: { name: string; sql: string }[] = [
  {
    name: "001_core",
    sql: `
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_members (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  wrapped_dek text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin','editor','viewer')),
  scope text NOT NULL DEFAULT 'all' CHECK (scope IN ('all','selected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  head_version_id uuid,
  seq bigserial,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  number integer NOT NULL,
  parent_version_id uuid REFERENCES versions(id) ON DELETE SET NULL,
  message text NOT NULL DEFAULT '',
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment_id, number)
);

ALTER TABLE environments
  ADD CONSTRAINT environments_head_fk FOREIGN KEY (head_version_id) REFERENCES versions(id) ON DELETE SET NULL;

CREATE TABLE variables (
  version_id uuid NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  key text NOT NULL,
  encrypted_value text NOT NULL,
  PRIMARY KEY (version_id, key)
);

CREATE TABLE environment_grants (
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access text NOT NULL CHECK (access IN ('read','write')),
  PRIMARY KEY (environment_id, user_id)
);

CREATE TABLE tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('session','personal','service')),
  name text NOT NULL DEFAULT '',
  token_hash text NOT NULL UNIQUE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  environment_id uuid REFERENCES environments(id) ON DELETE CASCADE,
  access text NOT NULL DEFAULT 'write' CHECK (access IN ('read','write')),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tokens_user_idx ON tokens(user_id);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  org_id uuid REFERENCES orgs(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_project_idx ON audit_log(project_id, id DESC);
CREATE INDEX audit_org_idx ON audit_log(org_id, id DESC);
`,
  },
];

create schema if not exists app_auth;
create table if not exists app_auth.users(
 id text primary key,email text not null,display_name text not null default '',email_verified boolean not null default false,
 password jsonb not null,disabled boolean not null default false,token_version integer not null default 0,
 created_at timestamptz not null default now(),last_login_at timestamptz
);
create unique index if not exists auth_email on app_auth.users(lower(email));
create table if not exists app_auth.sessions(
 token_hash text primary key,user_id text not null references app_auth.users(id) on delete cascade,
 expires_at timestamptz not null,persistent boolean not null,last_auth_at timestamptz not null default now(),created_at timestamptz not null default now()
);
create index if not exists auth_sessions_user on app_auth.sessions(user_id);
create table if not exists app_auth.recovery_requests(
 id text primary key default gen_random_uuid()::text,email text not null,user_id text references app_auth.users(id) on delete cascade,
 state text not null default 'open' check(state in ('open','issued','used')),created_at timestamptz not null default now()
);
create unique index if not exists recovery_pending_email on app_auth.recovery_requests(lower(email)) where state='open';
create table if not exists app_auth.reset_tokens(
 token_hash text primary key,user_id text not null references app_auth.users(id) on delete cascade,created_by text not null,
 request_id text references app_auth.recovery_requests(id),expires_at timestamptz not null,used_at timestamptz
);
revoke all on schema app_auth from public,anon,authenticated;
revoke all on all tables in schema app_auth from public,anon,authenticated;
grant usage on schema app_auth to lms_backend;
grant select,insert,update,delete on all tables in schema app_auth to lms_backend;

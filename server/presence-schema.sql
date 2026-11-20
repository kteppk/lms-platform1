-- Native VPS only: aggregate counts, no account IDs, IPs or session identifiers.
create schema if not exists app_metrics;
revoke all on schema app_metrics from public,anon,authenticated,service_role;
create table if not exists app_metrics.online_samples (
 bucket timestamptz primary key,
 observed_at timestamptz not null,
 accounts integer not null check(accounts>=0),
 students integer not null check(students>=0),
 teachers integer not null check(teachers>=0),
 curators integer not null check(curators>=0),
 admins integer not null check(admins>=0),
 guest_connections integer not null check(guest_connections>=0),
 check(accounts=students+teachers+curators+admins)
);
create table if not exists app_metrics.collection_state (
 id text primary key check(id='online'),started_at timestamptz not null default now()
);
insert into app_metrics.collection_state(id) values('online') on conflict do nothing;
revoke all on all tables in schema app_metrics from public,anon,authenticated,service_role;
grant usage on schema app_metrics to lms_backend;
grant select,insert,update,delete on app_metrics.online_samples to lms_backend;
grant select on app_metrics.collection_state to lms_backend;

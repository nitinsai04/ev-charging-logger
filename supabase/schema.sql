-- EV Charging Logger: run this once in your Supabase project
-- (Dashboard → SQL Editor → New query → paste → Run).
-- Personal, two-device-per-person use. No sign-in: access is controlled by
-- the anon key you keep private. Do NOT share the service-role key.

create table if not exists public.vehicle_settings (
  id                      text primary key default 'default',
  model_name              text        not null default '',
  battery_kwh             numeric     not null check (battery_kwh > 0),
  delivery_baseline_km    numeric     not null check (delivery_baseline_km >= 0),
  benchmark_car           text        not null default '',
  benchmark_mileage       numeric     not null check (benchmark_mileage > 0),
  benchmark_petrol_price  numeric     not null check (benchmark_petrol_price > 0),
  updated_at              timestamptz not null default now()
);

create table if not exists public.charge_logs (
  id              uuid        primary key,
  kind            text        not null check (kind in ('charge', 'maintenance')),
  date            date        not null,
  odometer_km     numeric     not null check (odometer_km >= 0),
  charger_type    text        check (charger_type in ('home', 'dc_public', 'ac_public')),
  units_kwh       numeric     check (units_kwh is null or units_kwh >= 0),
  cost_inr        numeric     not null check (cost_inr >= 0),
  start_soc       numeric     check (start_soc is null or (start_soc between 0 and 100)),
  end_soc         numeric     check (end_soc is null or (end_soc between 0 and 100)),
  notes           text,
  deleted         boolean     not null default false,
  updated_at      timestamptz not null default now(),
  constraint charger_required_for_charge
    check (kind = 'maintenance' or charger_type is not null)
);

create index if not exists charge_logs_updated_idx on public.charge_logs (updated_at);

alter table public.vehicle_settings enable row level security;
alter table public.charge_logs      enable row level security;

-- Anyone holding the project URL + anon key can read and write these tables.
-- That is the trade-off for a no-login, personal app: keep the key private.
drop policy if exists "anon full access" on public.vehicle_settings;
create policy "anon full access" on public.vehicle_settings
  for all to anon using (true) with check (true);

drop policy if exists "anon full access" on public.charge_logs;
create policy "anon full access" on public.charge_logs
  for all to anon using (true) with check (true);

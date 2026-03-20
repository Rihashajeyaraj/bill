-- Run this in Supabase SQL Editor to add Payment In TDS tracking fields.

alter table if exists public.payments
add column if not exists amount_received numeric(14,2) not null default 0,
add column if not exists tds_rate numeric(7,3) not null default 0,
add column if not exists is_manual boolean not null default false;

update public.payments
set amount_received = coalesce(nullif(amount_received, 0), amount, 0)
where coalesce(amount_received, 0) = 0;

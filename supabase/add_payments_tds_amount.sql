-- Run this in Supabase SQL Editor to add TDS tracking for payment receipts.

alter table if exists public.payments
add column if not exists tds_amount numeric(14,2) not null default 0;

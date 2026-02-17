# Vyapar-like Frontend (Relaxing Red)

## Run
```bash
npm install
npm run dev
```

## Supabase Setup
1. Copy `.env.example` to `.env` and add your Supabase values.
2. Run `supabase/schema.sql` in Supabase SQL Editor.
3. See full setup guide: `docs/SUPABASE_SETUP.md`.

## Roles and workflow
- `Owner`: registers, creates organization, enters dashboard.
- `Accounter` / `Staff`: register using owner-generated register code.
- Register code generation is available in `Company Settings -> Users & Roles`.

## Local fallback mode
If Supabase env is not configured, the app runs in local demo mode.

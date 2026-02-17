# Supabase Setup (BillJoy)

## 1. Environment

Create `.env` from `.env.example`:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

## 2. Database Schema

Run `supabase/schema.sql` in Supabase SQL Editor.

If organization create/membership save shows `403` (`42501`) or tax profile save shows `500` (`54001 stack depth limit exceeded`), run:

`supabase/fix_organizations_rls.sql`

Main tables are created in this order:

1. `profiles`
2. `organizations`
3. `organization_members`
4. `organization_invite_codes`
5. `organization_tax_profiles`
6. `organization_document_sequences`
7. `parties`
8. `items`
9. `invoices`
10. `invoice_items`
11. `credit_notes`
12. `credit_note_items`
13. `purchase_bills`
14. `purchase_bill_items`
15. `debit_notes`
16. `debit_note_items`
17. `payments`
18. `expenses`
19. `activity_logs`

The SQL includes:

- India GST-first fields (`gstin`, `cgst/sgst/igst`, `hsn_sac`, place of supply)
- Invite-code registration flow
- Role-based access (`owner`, `accounter`, `staff`)
- RLS policies for secure organization-level data isolation
- RPC: `consume_invite_code(...)` for joining org via register code

## 3. Auth Settings in Supabase

In Supabase Authentication settings:

- Enable `Email` provider.
- Optional: disable email confirmation during development for instant login after register.

## 4. Frontend Workflow Implemented

- App opens at `Login`.
- Register supports roles: `Owner`, `Accounter`, `Staff`.
- `Owner` register -> redirect to `Company Setup` -> create organization -> open Owner dashboard.
- `Accounter/Staff` register requires register code -> joins existing organization.
- Company Settings (`Users & Roles`) includes **Generate Register Code** button.
- Dashboard is role-based (Owner / Accounter / Staff).

## 5. Run

```bash
npm install
npm run dev
```


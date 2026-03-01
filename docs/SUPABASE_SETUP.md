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

## 6. Register Invite Email (Edge Function + Gmail)

This project now includes:

`supabase/functions/send-register-invite/index.ts`

It sends register-link emails from **Company Settings -> Users & Roles -> Invite User**.

### 6.1 Gmail requirements

1. Enable 2-Step Verification on your Google account.
2. Create an App Password in Google Account security settings.
3. Use that App Password as `SMTP_PASS` (not your normal Gmail login password).

### 6.2 Set function secrets

After linking your Supabase project:

```bash
supabase secrets set \
SMTP_HOST=smtp.gmail.com \
SMTP_PORT=465 \
SMTP_SECURE=tls \
SMTP_AUTH_METHOD=login \
SMTP_USER=yourgmail@gmail.com \
SMTP_PASS="your-16-char-app-password" \
INVITE_FROM_EMAIL="BillJoy <yourgmail@gmail.com>" \
APP_BASE_URL="https://your-app-domain.com"
```

`APP_BASE_URL` should be the URL where your frontend is hosted (the function builds `/login?...` links from this).

### 6.3 Deploy edge function

```bash
supabase functions deploy send-register-invite
```

### 6.4 Call API from external app/server

Use JWT auth:

1. Get user access token (owner account):

```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: YOUR_ANON_OR_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "OWNER_EMAIL",
    "password": "OWNER_PASSWORD"
  }'
```

2. Call function with `Authorization: Bearer <access_token>`:

```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-register-invite" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_ACCESS_TOKEN_JWT" \
  -d '{
    "organization_id": "86bbfbaa-3ade-48c9-a2f2-ff1c57374a52",
    "email": "vinthushan1121@gmail.com",
    "first_name": "vinthu",
    "last_name": "",
    "role": "Staff",
    "organization_name": "Twite AI Technologies Pvt Ltd",
    "register_code": "BJ-W1MG-1T83ST",
    "link": "http://localhost:5173/login?mode=signup&email=vinthushan1121%40gmail.com&role=Staff&registerCode=BJ-W1MG-1T83ST&name=vinthu"
  }'
```

Do not pass `sb_publishable_...` or `sb_secret_...` in Authorization.


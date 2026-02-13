# Database Structure (Current Frontend Storage)

Data is currently persisted in browser LocalStorage using service keys.

## Primary Keys
- `company_profile`
- `parties`
- `items`
- `invoices`
- `purchases`
- `payments`
- `expenses`
- `creditNotes`
- `invoiceTemplateConfig`

## Auth / Access
- `auth_token`
- `auth_user`
- `auth_users`
- `role`

## Shell / Platform
- `theme_mode`
- `active_branch`
- `app_notifications`
- `activity_logs`
- `auto_backup_reminder`

## Notable Entity Fields
- Company: tax settings, branches, financial year, bank details, branding assets
- Party: type, contact, tax ID, credit controls, audit metadata
- Item: type, pricing, tax rates, SKU/barcode, stock controls
- Invoice/Purchase: line items, tax totals, status and payable/receivable values

## Migration Note
Current storage model is mock-first. Recommended production migration:
1. PostgreSQL (master + transactions)
2. Object storage for files
3. Audit/event tables

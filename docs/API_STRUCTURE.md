# API Structure (Target and Current)

## Current
- Local service wrappers under `src/services/*`
- CRUD-like interfaces around LocalStorage
- Deterministic module stores in `src/modules/*/store.*`

## Recommended Production API Domains

### Auth
- `POST /auth/login`
- `POST /auth/register`
- `POST /auth/logout`
- `GET /auth/me`

### Company
- `GET /company`
- `PUT /company`
- `GET /company/settings`
- `PUT /company/settings`

### Masters
- `GET/POST/PUT/DELETE /parties`
- `GET/POST/PUT/DELETE /items`

### Sales
- `GET/POST/PUT /sales/invoices`
- `GET/POST /sales/credit-notes`
- `GET/POST /sales/payments-in`

### Purchases
- `GET/POST/PUT /purchase/bills`
- `GET/POST /purchase/debit-notes`
- `GET/POST /purchase/payments-out`

### Reports
- `GET /reports/sales`
- `GET /reports/purchases`
- `GET /reports/profit-loss`
- `GET /reports/cash-flow`
- `GET /reports/tax-summary`

### System
- `GET /notifications`
- `GET /activity-logs`
- `POST /backups/export`
- `POST /backups/restore`

## API Standards
- JWT auth
- Branch ID in request context
- Role-based authorization middleware
- Cursor/offset pagination for large tables

# Billing Application

A professional billing and accounting application featuring Tax Invoices, Pro Forma Invoices, Payment In tracking, and Financial Reports.

## Project Architecture

```
                 Billing Application
                         │
             ┌───────────┴───────────┐
             │                       │
         frontend/               backend/
             │                       │
       React + Vite             FastAPI
       Tailwind                 Business Logic
       UI only                  Calculations
             │                  Validation
             │                  Auth
             │                       │
             └───────────┬───────────┘
                         │
                      Supabase
                   PostgreSQL + Auth
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

- **Build**: `npm run build`
- **Tests**: `npm run test:tax`, `npm run test:customer-tax`

## Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

- **API Documentation**: http://127.0.0.1:8000/docs
- **Health Check**: http://127.0.0.1:8000/health

## Database

Supabase/database migrations and SQL schemas are located under:

```
supabase/
```
- Core SQL schema: `supabase/schema.sql`
- Migrations: `supabase/migrations/`

## Documentation

Project documentation is located under:

```
docs/
```
- `docs/BILLING_APPLICATION_AUDIT.md`
- `docs/AUTHENTICATION.md`

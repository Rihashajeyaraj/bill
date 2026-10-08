# Authentication Documentation

## Overview

The Billing application uses **Supabase Auth** for authentication, user session management, and Row-Level Security (RLS) policies.

## Features

1. **User Sign In / Sign Out**: Standard email/password login flow via Supabase Auth.
2. **Organization-Scoped Roles**: Multi-tenant authorization (Owner, Accounter, Staff).
3. **Session Persistence**: JWT tokens stored securely and refreshed automatically.
4. **Row-Level Security (RLS)**: PostgreSQL tables enforce `organization_id` policies.

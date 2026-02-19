# Backend Wiring Audit (Page Link + Data Flow)

Audit date: 2026-02-19

Purpose:
- Verify each routed page is reachable.
- Verify operational pages are linked to backend tables (or clearly marked placeholder).

## Status Legend

- `PASS`: page linked and backend wiring present.
- `PARTIAL`: page works but uses mixed/local behavior.
- `PLACEHOLDER`: page exists but backend workflow is not implemented yet.

## Route + Wiring Results

1. `/login` -> `PASS`  
   Auth flow active.

2. `/company-setup` and `/app/company-setup` -> `PASS`  
   Company profile save uses backend path; invoice existence check now syncs remote invoice state.

3. `/invoice-template-setup` -> `PARTIAL`  
   Template config is local config driven (intended design).

4. `/dashboard` and `/app/dashboard` -> `PASS`  
   Owner/Accounter/Staff dashboards now sync backend transaction data before rendering stats.

5. `/app/parties` -> `PASS`  
   Parties page uses remote sync + upsert/remove flow.

6. `/app/parties/:id/statement` -> `PASS`  
   Ledger built from transaction datasets synced to local cache.

7. `/app/items` -> `PASS`  
   Items page uses remote sync + remote upsert/remove.

8. `/items/new` -> `PASS`  
   Legacy Item Create updated to use remote item save path.

9. `/app/sales/invoice` -> `PASS`  
   Sales Invoice saves to `invoices` + `invoice_items`, with local cache sync.

10. `/app/sales/credit-note` -> `PASS`  
    Credit Note flow saves to `credit_notes` + `credit_note_items`; applied status updates linked invoice balance.

11. `/app/sales/payment-in` -> `PASS`  
    Payment In flow syncs to `payments`; applied allocations update linked invoice balances.

12. `/app/purchase/bill` -> `PASS`  
    Purchase Bill saves to `purchase_bills` + `purchase_bill_items`.

13. `/app/purchase/debit-note` -> `PASS`  
    Debit Note flow saves to `debit_notes` + `debit_note_items`; applied status updates linked purchase bill balance.

14. `/app/purchases/payment-out` -> `PASS`  
    Payment Out flow syncs to `payments`; applied allocations update linked purchase bill balances.

15. `/app/purchase/expense` -> `PASS`  
    Expense entry saves to `expenses`.

16. `/app/reports` -> `PASS`  
    Reports now sync backend datasets and build live report content from transactional data.

17. `/app/company-settings` -> `PARTIAL`  
    Settings page is operational; some settings are local config style by design.

18. `/app/cash-bank` -> `PASS`  
    Route wired to live `payments` + `expenses` sync with merged cash/bank ledger view.

19. `/app/backup` -> `PASS`  
    Route wired to full snapshot export/import utility with remote sync pull + local restore.

20. `/app/help` -> `PASS`  
    Route wired to submit/list support requests via `activity_logs` and display recent activity feed.

21. `*` not-found routes -> `PASS`  
    Correct fallback behavior.

## Navigation Link Check

- Sidebar links include all core operations pages:
  - Dashboard, Parties, Items, Invoices, Purchases, Credit Note, Debit Note, Payment In, Payment Out, Expense, Reports, Company Setup, Invoice Template, Settings.
- Expense link added explicitly to sidebar for direct access.

## Notes

- Some old historical local records may not contain country values. Country-based mapping now safely includes those records unless explicit mismatch is detected.
- Backup restore in current implementation restores local workspace data from JSON snapshot. Remote sync is used for export freshness.

## Build Validation

- Project build completed successfully after audit fixes.

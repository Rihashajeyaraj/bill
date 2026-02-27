# FIFO, Tax, Profit: Internal Notes

## FIFO stock rules
- Purchase posting (`post_purchase_bill_fifo`) creates one `stock_batches` row per purchase line for product items.
- Each batch stores qty purchased, qty remaining, unit cost excl/incl tax, tax rate, and source bill details.
- Sale posting (`post_invoice_fifo`) supports manual batch selling:
  - if `manual_batch_id` is passed for a line, stock is consumed from that selected batch only
  - if no `manual_batch_id` is passed, fallback is FIFO from oldest open batches
- Allocation mapping is stored in `stock_batch_allocations` per invoice line.
- `stock_batches.qty_remaining` is reduced on each allocation.
- If stock is short:
  - block posting by default
  - allow posting only when org setting `allowNegativeStock` is true in settings
  - negative part is stored as allocation row with `stock_batch_id = null`
- Purchase line can store `suggested_sale_rate`, saved on each batch for rate popup on invoice.

## Tax inclusive/exclusive rules
- Purchase line with tax exclusive:
  - taxable = qty * unit_price
  - tax = taxable * rate%
- Purchase line with tax inclusive:
  - line_total = qty * unit_price
  - taxable = line_total / (1 + rate/100)
  - tax = line_total - taxable
- Purchase tax is recorded as `INPUT` in `tax_ledger_entries`.
- Sale tax is recorded as `OUTPUT` in `tax_ledger_entries`.
- GST input/output is reported through `get_tax_summary(date_from, date_to)`:
  - `input_tax`, `output_tax`, `net_payable = output - input`

## Profit (COGS) rules
- Invoice COGS is computed from FIFO allocations:
  - `COGS = sum(allocated_qty * allocated_unit_cost_excl_tax)`
- Line-level COGS/profit is stored on `invoice_items`:
  - `cogs_unit_cost`, `cogs_amount`, `gross_profit_amount`
- Invoice-level summary is stored in `invoice_profit_summaries`.
- APIs:
  - `get_invoice_profit_summary(org_id, invoice_id)`
  - `get_invoice_item_profit(org_id, invoice_id)`

## Where stock/tax/profit are computed
- SQL transactional posting functions:
  - `post_purchase_bill_fifo(jsonb)`
  - `post_invoice_fifo(jsonb)`
- Frontend service wrappers:
  - `src/services/purchases.service.js`
  - `src/services/invoices.service.js`
  - `src/services/inventory.service.js`

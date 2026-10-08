-- Migration 00005: Invoice Stored Functions & Transactions
-- Peek proforma sequence number & transactional Pro Forma to Tax Invoice conversion

-- Peek next sales proforma number
CREATE OR REPLACE FUNCTION public.peek_sales_proforma_no(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prefix TEXT;
  v_next_no BIGINT;
BEGIN
  SELECT sales_proforma_prefix, sales_proforma_next_no
  INTO v_prefix, v_next_no
  FROM public.organization_document_sequences
  WHERE organization_id = p_org_id;

  IF NOT FOUND THEN
    INSERT INTO public.organization_document_sequences (organization_id, sales_proforma_prefix, sales_proforma_next_no)
    VALUES (p_org_id, 'PI', 1)
    RETURNING sales_proforma_prefix, sales_proforma_next_no
    INTO v_prefix, v_next_no;
  END IF;

  RETURN COALESCE(v_prefix, 'PI') || '-' || LPAD(COALESCE(v_next_no, 1)::text, 4, '0');
END;
$$;

-- Convert Pro Forma to Tax Invoice transactionally
CREATE OR REPLACE FUNCTION public.convert_proforma_to_invoice(
  p_proforma_id UUID,
  p_org_id UUID,
  p_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_proforma public.proforma_invoices%ROWTYPE;
  v_inv_prefix TEXT;
  v_inv_next_no BIGINT;
  v_new_invoice_no TEXT;
  v_invoice_id UUID;
BEGIN
  -- 1. Fetch & lock proforma
  SELECT * INTO v_proforma
  FROM public.proforma_invoices
  WHERE id = p_proforma_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pro Forma invoice not found or unauthorized.';
  END IF;

  IF v_proforma.status = 'CONVERTED' THEN
    RAISE EXCEPTION 'Pro Forma invoice is already converted.';
  END IF;

  -- 2. Fetch & lock document sequence
  SELECT invoice_prefix, invoice_next_no
  INTO v_inv_prefix, v_inv_next_no
  FROM public.organization_document_sequences
  WHERE organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.organization_document_sequences (organization_id, invoice_prefix, invoice_next_no)
    VALUES (p_org_id, 'INV', 1)
    RETURNING invoice_prefix, invoice_next_no
    INTO v_inv_prefix, v_inv_next_no;
  END IF;

  v_new_invoice_no := COALESCE(v_inv_prefix, 'INV') || '-' || LPAD(COALESCE(v_inv_next_no, 1)::text, 4, '0');

  -- Increment sequence
  UPDATE public.organization_document_sequences
  SET invoice_next_no = v_inv_next_no + 1,
      updated_at = NOW()
  WHERE organization_id = p_org_id;

  -- 3. Insert Tax Invoice
  INSERT INTO public.invoices (
    organization_id,
    template_id,
    invoice_no,
    invoice_date,
    due_date,
    party_id,
    place_of_supply_state,
    currency_code,
    exchange_rate,
    subtotal,
    discount_total,
    taxable_total,
    cgst_total,
    sgst_total,
    igst_total,
    tax_total,
    round_off,
    grand_total,
    amount_paid,
    balance_due,
    status,
    notes,
    terms,
    created_by
  ) VALUES (
    p_org_id,
    COALESCE(v_proforma.template_id, 'modern_gst'),
    v_new_invoice_no,
    CURRENT_DATE,
    v_proforma.due_date,
    v_proforma.party_id,
    v_proforma.place_of_supply_state,
    v_proforma.currency_code,
    v_proforma.exchange_rate,
    v_proforma.subtotal,
    v_proforma.discount_total,
    v_proforma.taxable_total,
    v_proforma.cgst_total,
    v_proforma.sgst_total,
    v_proforma.igst_total,
    v_proforma.tax_total,
    v_proforma.round_off,
    v_proforma.grand_total,
    0,
    v_proforma.grand_total,
    'issued',
    v_proforma.notes,
    v_proforma.terms,
    p_user_id
  )
  RETURNING id INTO v_invoice_id;

  -- 4. Copy Items
  INSERT INTO public.invoice_items (
    invoice_id,
    item_id,
    line_no,
    description,
    hsn_sac,
    qty,
    unit,
    unit_price,
    discount_percent,
    discount_amount,
    taxable_amount,
    tax_rate,
    cgst_amount,
    sgst_amount,
    igst_amount,
    line_total
  )
  SELECT
    v_invoice_id,
    item_id,
    line_no,
    description,
    hsn_sac,
    qty,
    unit,
    unit_price,
    discount_percent,
    discount_amount,
    taxable_amount,
    tax_rate,
    cgst_amount,
    sgst_amount,
    igst_amount,
    line_total
  FROM public.proforma_invoice_items
  WHERE proforma_id = p_proforma_id;

  -- 5. Update Pro Forma status
  UPDATE public.proforma_invoices
  SET status = 'CONVERTED',
      converted_document_id = v_invoice_id,
      converted_at = NOW(),
      updated_at = NOW()
  WHERE id = p_proforma_id;

  RETURN v_invoice_id;
END;
$$;

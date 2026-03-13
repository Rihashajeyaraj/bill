-- Remove status tracking from Sales Pro Forma invoices.
-- Keep purchase proforma status behavior unchanged.

begin;

drop index if exists public.idx_proforma_invoices_status;

drop trigger if exists trg_proforma_invoices_expiry_status on public.proforma_invoices;

alter table if exists public.proforma_invoices
  drop column if exists status;

create or replace function public.refresh_proforma_expiry_status(
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_updated integer := 0;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if not public.current_user_is_org_member(p_organization_id) then
    raise exception 'Access denied for organization %', p_organization_id;
  end if;

  update public.purchase_proformas
  set status = 'EXPIRED',
      updated_at = now()
  where organization_id = p_organization_id
    and status in ('DRAFT', 'SENT', 'APPROVED')
    and valid_till is not null
    and valid_till < current_date;
  get diagnostics v_purchase_updated = row_count;

  return jsonb_build_object(
    'sales_updated', 0,
    'purchase_updated', v_purchase_updated
  );
end;
$$;

create or replace function public.convert_sales_proforma_to_invoice(
  p_proforma_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_header public.proforma_invoices%rowtype;
  v_payload jsonb;
  v_lines jsonb;
  v_result jsonb;
  v_invoice_id uuid;
  v_invoice_no text;
  v_existing_invoice_no text;
  v_attempt integer;
begin
  if p_proforma_id is null then
    raise exception 'proforma_id is required';
  end if;

  select *
    into v_header
  from public.proforma_invoices
  where id = p_proforma_id
  for update;

  if not found then
    raise exception 'Sales proforma not found: %', p_proforma_id;
  end if;

  if not public.current_user_is_org_member(v_header.organization_id) then
    raise exception 'Access denied for organization %', v_header.organization_id;
  end if;

  if v_header.converted_document_id is not null then
    select inv.invoice_no
      into v_existing_invoice_no
    from public.invoices inv
    where inv.id = v_header.converted_document_id;

    raise exception 'Sales proforma already converted to invoice %',
      coalesce(nullif(trim(v_existing_invoice_no), ''), v_header.converted_document_id::text, 'unknown');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'line_no', i.line_no,
        'item_id', i.item_id,
        'manual_batch_id', null,
        'taxInclusive', false,
        'priceTaxMode', 'WITHOUT_TAX',
        'description', i.description,
        'hsn', i.hsn_sac,
        'qty', i.qty,
        'unit', i.unit,
        'rate', i.unit_price,
        'discount', i.discount_amount,
        'discountPercent', i.discount_percent,
        'tax', i.tax_rate,
        'taxableAmount', i.taxable_amount,
        'cgstAmount', i.cgst_amount,
        'sgstAmount', i.sgst_amount,
        'igstAmount', i.igst_amount,
        'vatAmount', i.vat_amount,
        'cessAmount', i.cess_amount
      )
      order by i.line_no, i.id
    ),
    '[]'::jsonb
  )
    into v_lines
  from public.proforma_invoice_items i
  where i.proforma_id = v_header.id;

  for v_attempt in 1..5 loop
    v_invoice_no := public.allocate_invoice_no_for_conversion(v_header.organization_id, v_header.proforma_date);

    v_payload := jsonb_build_object(
      'organization_id', v_header.organization_id,
      'invoice_no', v_invoice_no,
      'invoice_date', v_header.proforma_date,
      'due_date', coalesce(v_header.due_date, v_header.valid_till, v_header.proforma_date),
      'party_id', v_header.party_id,
      'place_of_supply_state', v_header.place_of_supply_state,
      'currency_code', v_header.currency_code,
      'country', coalesce(v_header.metadata->>'country', ''),
      'tax_mode', coalesce(v_header.metadata->>'taxMode', ''),
      'supply_type', coalesce(v_header.metadata->>'supplyType', ''),
      'party_name', coalesce(v_header.metadata->>'partyName', ''),
      'created_by_name', coalesce(v_header.metadata->>'createdByName', ''),
      'round_off', coalesce(v_header.round_off, 0),
      'lines', v_lines
    );

    begin
      execute 'select public.post_invoice_fifo($1)'
        into v_result
        using v_payload;
      exit;
    exception
      when unique_violation then
        if position('invoices_organization_id_invoice_no_key' in coalesce(SQLERRM, '')) > 0 then
          if v_attempt = 5 then
            raise exception 'Failed to generate a unique invoice number for this Pro Forma Invoice. Please retry.';
          end if;
        else
          raise;
        end if;
    end;
  end loop;

  v_invoice_id := nullif(v_result->>'invoice_id', '')::uuid;
  if v_invoice_id is null then
    raise exception 'Invoice conversion failed for proforma %', p_proforma_id;
  end if;

  update public.proforma_invoices
  set converted_document_id = v_invoice_id,
      converted_at = now(),
      updated_at = now()
  where id = v_header.id;

  return jsonb_build_object(
    'proforma_id', v_header.id,
    'invoice_id', v_invoice_id,
    'invoice_no', coalesce(v_result->>'invoice_no', v_invoice_no)
  );
end;
$$;

grant execute on function public.refresh_proforma_expiry_status(uuid) to authenticated;
grant execute on function public.convert_sales_proforma_to_invoice(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

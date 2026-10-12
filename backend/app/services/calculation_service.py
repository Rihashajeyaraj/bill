from decimal import Decimal, ROUND_HALF_UP, ROUND_HALF_EVEN
from typing import List, Dict, Any, Optional, Tuple
from app.services.tax_service import (
    determine_tax_type,
    get_us_sales_tax_rates,
    get_country_vat_config,
    normalize_country,
    TaxType,
)
from app.utils.num2words import number_to_words_indian

def to_decimal(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))

def round_money(val: Decimal) -> Decimal:
    return val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

def round_tax(val: Decimal) -> Decimal:
    return val.quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)

def round_qty(val: Decimal) -> Decimal:
    return val.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)

class ItemCalculationResult:
    def __init__(
        self,
        qty: Decimal,
        unit_price: Decimal,
        discount_percent: Decimal,
        discount_amount: Decimal,
        taxable_amount: Decimal,
        tax_rate: Decimal,
        cgst_rate: Decimal = Decimal("0.00"),
        sgst_rate: Decimal = Decimal("0.00"),
        igst_rate: Decimal = Decimal("0.00"),
        cgst_amount: Decimal = Decimal("0.00"),
        sgst_amount: Decimal = Decimal("0.00"),
        igst_amount: Decimal = Decimal("0.00"),
        vat_rate: Decimal = Decimal("0.00"),
        vat_amount: Decimal = Decimal("0.00"),
        state_tax_rate: Decimal = Decimal("0.00"),
        local_tax_rate: Decimal = Decimal("0.00"),
        state_tax_amount: Decimal = Decimal("0.00"),
        local_tax_amount: Decimal = Decimal("0.00"),
        tax_amount: Decimal = Decimal("0.00"),
        amount_inr: Decimal = Decimal("0.00"),
        line_total: Decimal = Decimal("0.00"),
        description: str = "",
        item_id: str = None,
        hsn_sac: str = "",
        unit: str = "PCS",
        currency: str = "INR",
        place_of_supply: str = "",
        line_no: int = 1,
        tax_type: str = "INTRA_STATE"
    ):
        self.qty = qty
        self.unit_price = unit_price
        self.discount_percent = discount_percent
        self.discount_amount = discount_amount
        self.taxable_amount = taxable_amount
        self.tax_rate = tax_rate
        self.cgst_rate = cgst_rate
        self.sgst_rate = sgst_rate
        self.igst_rate = igst_rate
        self.cgst_amount = cgst_amount
        self.sgst_amount = sgst_amount
        self.igst_amount = igst_amount
        self.vat_rate = vat_rate
        self.vat_amount = vat_amount
        self.state_tax_rate = state_tax_rate
        self.local_tax_rate = local_tax_rate
        self.state_tax_amount = state_tax_amount
        self.local_tax_amount = local_tax_amount
        self.tax_amount = tax_amount
        self.amount_inr = amount_inr
        self.line_total = line_total
        self.description = description
        self.item_id = item_id
        self.hsn_sac = hsn_sac
        self.unit = unit
        self.currency = currency
        self.place_of_supply = place_of_supply
        self.line_no = line_no
        self.tax_type = tax_type

    def to_dict(self) -> Dict[str, Any]:
        return {
            "item_id": self.item_id,
            "line_no": self.line_no,
            "description": self.description,
            "hsn_sac": self.hsn_sac,
            "qty": float(self.qty),
            "unit": self.unit,
            "unit_price": float(self.unit_price),
            "rate": float(self.unit_price),
            "discount_percent": float(self.discount_percent),
            "discount_amount": float(self.discount_amount),
            "taxable_amount": float(self.taxable_amount),
            "taxable_value": float(self.taxable_amount),
            "net": float(self.taxable_amount),
            "tax_rate": float(self.tax_rate),
            "gst_rate": float(self.tax_rate),
            "cgst_rate": float(self.cgst_rate),
            "sgst_rate": float(self.sgst_rate),
            "igst_rate": float(self.igst_rate),
            "cgst_amount": float(self.cgst_amount),
            "sgst_amount": float(self.sgst_amount),
            "igst_amount": float(self.igst_amount),
            "vat_rate": float(self.vat_rate),
            "vat_amount": float(self.vat_amount),
            "state_tax_rate": float(self.state_tax_rate),
            "local_tax_rate": float(self.local_tax_rate),
            "state_tax_amount": float(self.state_tax_amount),
            "local_tax_amount": float(self.local_tax_amount),
            "tax_amount": float(self.tax_amount),
            "gst_total": float(self.tax_amount),
            "line_tax": float(self.tax_amount),
            "amount_inr": float(self.amount_inr),
            "amountInr": float(self.amount_inr),
            "place_of_supply": self.place_of_supply,
            "currency": self.currency,
            "tax_type": self.tax_type,
            "line_total": float(self.line_total),
            "total": float(self.line_total)
        }

class DocumentCalculationResult:
    def __init__(
        self,
        items: List[ItemCalculationResult],
        subtotal: Decimal,
        discount_total: Decimal,
        taxable_total: Decimal,
        cgst_total: Decimal = Decimal("0.00"),
        sgst_total: Decimal = Decimal("0.00"),
        igst_total: Decimal = Decimal("0.00"),
        vat_total: Decimal = Decimal("0.00"),
        state_tax_total: Decimal = Decimal("0.00"),
        local_tax_total: Decimal = Decimal("0.00"),
        tax_total: Decimal = Decimal("0.00"),
        round_off: Decimal = Decimal("0.00"),
        grand_total: Decimal = Decimal("0.00"),
        grand_total_in_words: str = "",
        amount_paid: Decimal = Decimal("0.00"),
        balance_due: Decimal = Decimal("0.00"),
        tax_type: str = "INTRA_STATE",
        advance_received: Optional[Decimal] = None
    ):
        self.items = items
        self.subtotal = subtotal
        self.discount_total = discount_total
        self.taxable_total = taxable_total
        self.cgst_total = cgst_total
        self.sgst_total = sgst_total
        self.igst_total = igst_total
        self.vat_total = vat_total
        self.state_tax_total = state_tax_total
        self.local_tax_total = local_tax_total
        self.tax_total = tax_total
        self.round_off = round_off
        self.grand_total = grand_total
        self.grand_total_in_words = grand_total_in_words
        self.amount_paid = amount_paid
        self.advance_received = advance_received if advance_received is not None else amount_paid
        self.balance_due = balance_due
        self.balance_payable = balance_due
        self.tax_type = tax_type

        # Compute standard Payment Status
        if self.amount_paid <= Decimal("0.00"):
            self.payment_status = "UNPAID"
        elif self.balance_due <= Decimal("0.00"):
            self.payment_status = "PAID"
        else:
            self.payment_status = "PARTIALLY_PAID"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "items": [item.to_dict() for item in self.items],
            "subtotal": float(self.subtotal),
            "discount_total": float(self.discount_total),
            "taxable_total": float(self.taxable_total),
            "cgst_total": float(self.cgst_total),
            "sgst_total": float(self.sgst_total),
            "igst_total": float(self.igst_total),
            "vat_total": float(self.vat_total),
            "state_tax_total": float(self.state_tax_total),
            "local_tax_total": float(self.local_tax_total),
            "tax_total": float(self.tax_total),
            "round_off": float(self.round_off),
            "grand_total": float(self.grand_total),
            "grand_total_in_words": self.grand_total_in_words,
            "amount_paid": float(self.amount_paid),
            "advance_received": float(self.advance_received),
            "balance_due": float(self.balance_due),
            "balance_payable": float(self.balance_due),
            "payment_status": self.payment_status,
            "tax_type": self.tax_type
        }

def validate_advance_amount(advance: Any, grand_total: Decimal) -> Decimal:
    """
    Validates advance amount using Decimal:
    - Rejects negative advance amounts.
    - Rejects advances exceeding invoice total.
    Returns quantized Decimal(0.01).
    """
    from fastapi import HTTPException
    dec = round_money(to_decimal(advance))
    if dec < Decimal("0.00"):
        raise HTTPException(
            status_code=422,
            detail="Advance amount cannot be negative."
        )
    if dec > grand_total:
        raise HTTPException(
            status_code=422,
            detail=f"Advance amount (₹{float(dec):,.2f}) cannot exceed invoice total (₹{float(grand_total):,.2f})."
        )
    return dec

def calculate_document_totals(
    raw_items: List[Dict[str, Any]],
    company_state: str,
    customer_state: str,
    company_country: str = "India",
    customer_country: str = "India",
    exchange_rate: Any = 1.0,
    amount_paid: Any = 0,
    enable_auto_round_off: bool = False,
    export_type: str = "DOMESTIC",
    overall_discount_type: str = "amount",
    overall_discount_value: Any = 0,
    doc_currency: str = "INR",
    advance_received: Any = None
) -> DocumentCalculationResult:
    if advance_received is not None:
        amount_paid = advance_received
    dec_roe = to_decimal(exchange_rate) or Decimal("1.0")
    norm_export_type = str(export_type or "DOMESTIC").strip().upper()
    
    # Determine base tax type
    if norm_export_type in ["LUT", "TAX_PAYMENT"]:
        tax_type = TaxType.INTER_STATE
    else:
        tax_type = determine_tax_type(company_state, customer_state, company_country, customer_country)

    # Step 1: Compute line item raw amounts and line-level discounts
    pre_doc_items = []
    total_pre_doc_taxable = Decimal("0.00")
    total_raw_subtotal = Decimal("0.00")
    total_line_discount = Decimal("0.00")

    for idx, raw_item in enumerate(raw_items, start=1):
        qty = round_qty(to_decimal(raw_item.get("qty", 1)))
        unit_price = round_money(to_decimal(raw_item.get("unit_price") or raw_item.get("rate") or 0))
        raw_curr = str(raw_item.get("currency") or "").strip().upper()
        if raw_curr and raw_curr != "INR":
            currency = raw_curr
        elif doc_currency and doc_currency.strip().upper() != "INR":
            currency = doc_currency.strip().upper()
        else:
            currency = raw_curr or "INR"

        if currency != "INR" and dec_roe > Decimal("0"):
            amount_inr = round_money(qty * unit_price * dec_roe)
        else:
            amount_inr = round_money(qty * unit_price)

        disc_type = str(raw_item.get("discount_type") or "amount").strip().lower()
        disc_percent = to_decimal(raw_item.get("discount_percent", 0))
        disc_amount = to_decimal(raw_item.get("discount_amount", 0))

        raw_subtotal = qty * unit_price
        if disc_type in ["percent", "percentage"] or (disc_percent > Decimal("0") and disc_amount == Decimal("0")):
            line_disc = round_money(amount_inr * (disc_percent / Decimal("100")))
            if amount_inr > Decimal("0") and disc_amount == Decimal("0"):
                disc_amount = round_money(line_disc / dec_roe) if currency != "INR" and dec_roe > Decimal("0") else line_disc
        else:
            if currency != "INR" and dec_roe > Decimal("0"):
                line_disc = round_money(disc_amount * dec_roe)
            else:
                line_disc = round_money(disc_amount)
            if amount_inr > Decimal("0"):
                disc_percent = (line_disc / amount_inr) * Decimal("100")

        line_taxable = round_money(amount_inr - line_disc)
        total_raw_subtotal += amount_inr
        total_line_discount += line_disc
        total_pre_doc_taxable += line_taxable

        pre_doc_items.append({
            "idx": idx,
            "raw": raw_item,
            "qty": qty,
            "unit_price": unit_price,
            "currency": currency,
            "amount_inr": amount_inr,
            "line_disc": line_disc,
            "disc_percent": disc_percent,
            "pre_doc_taxable": line_taxable
        })

    # Step 2: Compute overall document discount amount
    dec_doc_disc_val = to_decimal(overall_discount_value or 0)
    norm_doc_disc_type = str(overall_discount_type or "amount").strip().lower()
    
    if norm_doc_disc_type in ["percent", "percentage"]:
        doc_discount_total = round_money(total_pre_doc_taxable * (dec_doc_disc_val / Decimal("100")))
    else:
        if doc_currency != "INR" and dec_roe > Decimal("0"):
            doc_discount_total = round_money(dec_doc_disc_val * dec_roe)
        else:
            doc_discount_total = round_money(dec_doc_disc_val)

    doc_discount_total = min(total_pre_doc_taxable, max(Decimal("0.00"), doc_discount_total))

    # Step 3: Proportionally distribute overall document discount across lines
    allocated_discounts = []
    if total_pre_doc_taxable > Decimal("0") and doc_discount_total > Decimal("0"):
        rem_disc = doc_discount_total
        for i, item_info in enumerate(pre_doc_items):
            if i == len(pre_doc_items) - 1:
                alloc = rem_disc
            else:
                ratio = item_info["pre_doc_taxable"] / total_pre_doc_taxable
                alloc = round_money(doc_discount_total * ratio)
                rem_disc -= alloc
            allocated_discounts.append(alloc)
    else:
        allocated_discounts = [Decimal("0.00")] * len(pre_doc_items)

    # Step 4: Compute line taxes on final post-discount taxable amount
    calculated_items: List[ItemCalculationResult] = []
    subtotal = Decimal("0.00")
    discount_total = total_line_discount + doc_discount_total
    taxable_total = Decimal("0.00")
    cgst_total = Decimal("0.00")
    sgst_total = Decimal("0.00")
    igst_total = Decimal("0.00")
    vat_total = Decimal("0.00")
    state_tax_total = Decimal("0.00")
    local_tax_total = Decimal("0.00")

    for idx, item_info in enumerate(pre_doc_items):
        raw_item = item_info["raw"]
        qty = item_info["qty"]
        unit_price = item_info["unit_price"]
        currency = item_info["currency"]
        amount_inr = item_info["amount_inr"]
        
        doc_disc_share = allocated_discounts[idx]
        total_item_disc = item_info["line_disc"] + doc_disc_share
        
        if amount_inr > Decimal("0"):
            item_disc_percent = round_money((total_item_disc / amount_inr) * Decimal("100"))
        else:
            item_disc_percent = Decimal("0.00")

        post_disc_taxable = round_money(amount_inr - total_item_disc)
        
        # Determine effective tax rate
        raw_tax_rate = to_decimal(raw_item.get("tax_rate") or raw_item.get("gst_rate") or 0)
        
        # If Export under LUT (0% IGST), force 0% tax
        if norm_export_type == "LUT":
            tax_rate = Decimal("0.00")
        else:
            tax_rate = raw_tax_rate

        cgst_rate = Decimal("0.00")
        sgst_rate = Decimal("0.00")
        igst_rate = Decimal("0.00")
        cgst_amount = Decimal("0.00")
        sgst_amount = Decimal("0.00")
        igst_amount = Decimal("0.00")
        vat_rate = Decimal("0.00")
        vat_amount = Decimal("0.00")
        state_tax_rate = Decimal("0.00")
        local_tax_rate = Decimal("0.00")
        state_tax_amount = Decimal("0.00")
        local_tax_amount = Decimal("0.00")

        item_pos = str(raw_item.get("place_of_supply") or "").strip()
        item_tax_type = tax_type
        if item_pos and company_country.lower() in ["india", "in"]:
            item_tax_type = determine_tax_type(company_state, item_pos, company_country, "India")

        if norm_export_type == "LUT":
            tax_amount = Decimal("0.00")
        elif item_tax_type == TaxType.INTRA_STATE:
            half_rate = tax_rate / Decimal("2")
            cgst_rate = half_rate
            sgst_rate = half_rate
            cgst_amount = round_tax(post_disc_taxable * (half_rate / Decimal("100")))
            sgst_amount = round_tax(post_disc_taxable * (half_rate / Decimal("100")))
            tax_amount = cgst_amount + sgst_amount
        elif item_tax_type == TaxType.INTER_STATE:
            igst_rate = tax_rate
            igst_amount = round_tax(post_disc_taxable * (tax_rate / Decimal("100")))
            tax_amount = igst_amount
        elif item_tax_type == TaxType.SALES_TAX:
            state_for_lookup = customer_state or company_state
            item_local_rate = raw_item.get("local_tax_rate")
            local_rate_override = (
                Decimal(str(item_local_rate))
                if item_local_rate is not None and str(item_local_rate).strip() != ""
                else None
            )
            us_result = get_us_sales_tax_rates(state_for_lookup, local_rate_override=local_rate_override)
            state_tax_rate = us_result.state_rate
            local_tax_rate = us_result.local_rate
            if tax_rate > Decimal("0") and local_rate_override is None:
                state_tax_rate = tax_rate
                local_tax_rate = Decimal("0.00")
            state_tax_amount = round_money(post_disc_taxable * (state_tax_rate / Decimal("100")))
            local_tax_amount = round_money(post_disc_taxable * (local_tax_rate / Decimal("100")))
            tax_amount = state_tax_amount + local_tax_amount
            tax_rate = state_tax_rate + local_tax_rate
        elif tax_type == TaxType.VAT:
            vat_country = normalize_country(customer_country or company_country)
            if tax_rate > Decimal("0"):
                vat_rate = tax_rate
            else:
                vat_config = get_country_vat_config(vat_country)
                vat_rate = vat_config["standard_rate"]
            tax_rate = vat_rate
            vat_amount = round_money(post_disc_taxable * (vat_rate / Decimal("100")))
            tax_amount = vat_amount
        else:
            tax_amount = round_money(post_disc_taxable * (tax_rate / Decimal("100")))

        line_total = post_disc_taxable + tax_amount

        item_currency_disc = (
            round_money(item_info["line_disc"] / dec_roe)
            if currency != "INR" and dec_roe > Decimal("0")
            else item_info["line_disc"]
        )

        calc_item = ItemCalculationResult(
            qty=qty,
            unit_price=unit_price,
            discount_percent=item_info["disc_percent"],
            discount_amount=item_currency_disc,
            taxable_amount=post_disc_taxable,
            tax_rate=tax_rate,
            cgst_rate=cgst_rate,
            sgst_rate=sgst_rate,
            igst_rate=igst_rate,
            cgst_amount=cgst_amount,
            sgst_amount=sgst_amount,
            igst_amount=igst_amount,
            vat_rate=vat_rate,
            vat_amount=vat_amount,
            state_tax_rate=state_tax_rate,
            local_tax_rate=local_tax_rate,
            state_tax_amount=state_tax_amount,
            local_tax_amount=local_tax_amount,
            tax_amount=tax_amount,
            amount_inr=amount_inr,
            line_total=line_total,
            description=str(raw_item.get("description") or raw_item.get("item_name") or ""),
            item_id=raw_item.get("item_id"),
            hsn_sac=str(raw_item.get("hsn_sac") or ""),
            unit=str(raw_item.get("unit") or "PCS"),
            currency=currency,
            place_of_supply=str(raw_item.get("place_of_supply") or ""),
            line_no=idx + 1,
            tax_type=tax_type.value
        )
        calculated_items.append(calc_item)

        subtotal += amount_inr
        taxable_total += post_disc_taxable
        cgst_total += cgst_amount
        sgst_total += sgst_amount
        igst_total += igst_amount
        vat_total += vat_amount
        state_tax_total += state_tax_amount
        local_tax_total += local_tax_amount

    subtotal = round_money(subtotal)
    discount_total = round_money(discount_total)
    taxable_total = round_money(taxable_total)
    cgst_total = round_money(cgst_total)
    sgst_total = round_money(sgst_total)
    igst_total = round_money(igst_total)
    vat_total = round_money(vat_total)
    state_tax_total = round_money(state_tax_total)
    local_tax_total = round_money(local_tax_total)

    if norm_export_type == "LUT":
        tax_total = Decimal("0.00")
    elif tax_type == TaxType.INTRA_STATE:
        tax_total = cgst_total + sgst_total
    elif tax_type == TaxType.INTER_STATE:
        tax_total = igst_total
    elif tax_type == TaxType.SALES_TAX:
        tax_total = state_tax_total + local_tax_total
    elif tax_type == TaxType.VAT:
        tax_total = vat_total
    else:
        tax_total = cgst_total + sgst_total + igst_total + vat_total + state_tax_total + local_tax_total

    raw_grand_total = taxable_total + tax_total

    if enable_auto_round_off:
        grand_total = raw_grand_total.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        round_off = grand_total - raw_grand_total
    else:
        grand_total = raw_grand_total
        round_off = Decimal("0.00")

    dec_amount_paid = round_money(to_decimal(amount_paid))
    balance_due = round_money(grand_total - dec_amount_paid)
    grand_total_in_words = number_to_words_indian(float(grand_total))

    return DocumentCalculationResult(
        items=calculated_items,
        subtotal=subtotal,
        discount_total=discount_total,
        taxable_total=taxable_total,
        cgst_total=cgst_total,
        sgst_total=sgst_total,
        igst_total=igst_total,
        vat_total=vat_total,
        state_tax_total=state_tax_total,
        local_tax_total=local_tax_total,
        tax_total=tax_total,
        round_off=round_off,
        grand_total=grand_total,
        grand_total_in_words=grand_total_in_words,
        amount_paid=dec_amount_paid,
        balance_due=balance_due,
        tax_type=tax_type.value,
        advance_received=dec_amount_paid
    )


def calculate_item_line(raw_item: Dict[str, Any], tax_type: Any = TaxType.INTRA_STATE) -> ItemCalculationResult:
    str_tax_type = str(getattr(tax_type, "value", tax_type))
    if str_tax_type in ["INTER_STATE", TaxType.INTER_STATE.value]:
        doc = calculate_document_totals([raw_item], company_state="MH", customer_state="KA")
    else:
        doc = calculate_document_totals([raw_item], company_state="MH", customer_state="MH")
    return doc.items[0]


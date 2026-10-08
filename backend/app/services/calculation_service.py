from decimal import Decimal, ROUND_HALF_UP
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
            "discount_percent": float(self.discount_percent),
            "discount_amount": float(self.discount_amount),
            "taxable_amount": float(self.taxable_amount),
            "tax_rate": float(self.tax_rate),
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
            "amount_inr": float(self.amount_inr),
            "place_of_supply": self.place_of_supply,
            "currency": self.currency,
            "tax_type": self.tax_type,
            "line_total": float(self.line_total)
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
        tax_type: str = "INTRA_STATE"
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
        self.balance_due = balance_due
        self.tax_type = tax_type

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
            "balance_due": float(self.balance_due),
            "tax_type": self.tax_type
        }

def calculate_item_line(
    raw_item: Dict[str, Any],
    tax_type: TaxType,
    exchange_rate: Decimal = Decimal("1.0"),
    customer_state: str = "",
    company_state: str = "",
    customer_country: str = "India",
    company_country: str = "India",
    line_no: int = 1
) -> ItemCalculationResult:
    qty = round_qty(to_decimal(raw_item.get("qty", 1)))
    unit_price = round_money(to_decimal(raw_item.get("unit_price") or raw_item.get("rate") or 0))
    currency = str(raw_item.get("currency") or "INR").upper()
    
    if currency != "INR" and exchange_rate > Decimal("0"):
        amount_inr = round_money(qty * unit_price * exchange_rate)
    else:
        amount_inr = round_money(qty * unit_price)

    discount_percent = to_decimal(raw_item.get("discount_percent", 0))
    discount_amount = to_decimal(raw_item.get("discount_amount", 0))
    
    if discount_percent > Decimal("0") and discount_amount == Decimal("0"):
        discount_amount = round_money(amount_inr * (discount_percent / Decimal("100")))
    else:
        discount_amount = round_money(discount_amount)
        if amount_inr > Decimal("0") and discount_percent == Decimal("0") and discount_amount > Decimal("0"):
            discount_percent = round_money((discount_amount / amount_inr) * Decimal("100"))
            
    taxable_amount = round_money(amount_inr - discount_amount)
    tax_rate = to_decimal(raw_item.get("tax_rate", 0))
    
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

    if tax_type == TaxType.INTRA_STATE:
        half_rate = tax_rate / Decimal("2")
        cgst_rate = half_rate
        sgst_rate = half_rate
        cgst_amount = round_money(taxable_amount * (half_rate / Decimal("100")))
        sgst_amount = round_money(taxable_amount * (half_rate / Decimal("100")))
        tax_amount = cgst_amount + sgst_amount
    elif tax_type == TaxType.INTER_STATE:
        igst_rate = tax_rate
        igst_amount = round_money(taxable_amount * (tax_rate / Decimal("100")))
        tax_amount = igst_amount
    elif tax_type == TaxType.SALES_TAX:
        # Resolve the state to look up (prefer customer's state, fall back to company)
        state_for_lookup = customer_state or company_state

        # The caller may have supplied an explicit local rate on the item
        # (e.g. entered by the user in the UI for their specific city/county).
        # We NEVER invent a local rate — only use what is explicitly provided.
        item_local_rate = raw_item.get("local_tax_rate")
        local_rate_override = (
            Decimal(str(item_local_rate))
            if item_local_rate is not None and str(item_local_rate).strip() != ""
            else None
        )

        us_result = get_us_sales_tax_rates(
            state_for_lookup,
            local_rate_override=local_rate_override,
        )
        state_tax_rate = us_result.state_rate
        local_tax_rate = us_result.local_rate

        # If the item has an explicit combined tax_rate override, apply it as the
        # state rate (since we cannot split it without the local breakdown).
        # This preserves backwards-compatibility for legacy data.
        if tax_rate > Decimal("0") and local_rate_override is None:
            # Caller passed tax_rate but no local rate — treat entire amount as state-level
            state_tax_rate = tax_rate
            local_tax_rate = Decimal("0.00")

        state_tax_amount = round_money(taxable_amount * (state_tax_rate / Decimal("100")))
        local_tax_amount = round_money(taxable_amount * (local_tax_rate / Decimal("100")))
        tax_amount = state_tax_amount + local_tax_amount
        tax_rate = state_tax_rate + local_tax_rate
    elif tax_type == TaxType.VAT:
        # Look up the country's statutory VAT rate; use it if no item-level rate given
        vat_country = normalize_country(customer_country or company_country)
        if tax_rate > Decimal("0"):
            vat_rate = tax_rate
        else:
            vat_config = get_country_vat_config(vat_country)
            vat_rate = vat_config["standard_rate"]
        tax_rate = vat_rate
        vat_amount = round_money(taxable_amount * (vat_rate / Decimal("100")))
        tax_amount = vat_amount
    else:
        tax_amount = round_money(taxable_amount * (tax_rate / Decimal("100")))

    line_total = taxable_amount + tax_amount
    
    return ItemCalculationResult(
        qty=qty,
        unit_price=unit_price,
        discount_percent=discount_percent,
        discount_amount=discount_amount,
        taxable_amount=taxable_amount,
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
        line_no=line_no,
        tax_type=tax_type.value
    )

def calculate_document_totals(
    raw_items: List[Dict[str, Any]],
    company_state: str,
    customer_state: str,
    company_country: str = "India",
    customer_country: str = "India",
    exchange_rate: Any = 1.0,
    amount_paid: Any = 0,
    enable_auto_round_off: bool = True
) -> DocumentCalculationResult:
    tax_type = determine_tax_type(company_state, customer_state, company_country, customer_country)
    dec_roe = to_decimal(exchange_rate) or Decimal("1.0")
    
    calculated_items: List[ItemCalculationResult] = []
    subtotal = Decimal("0.00")
    discount_total = Decimal("0.00")
    taxable_total = Decimal("0.00")
    cgst_total = Decimal("0.00")
    sgst_total = Decimal("0.00")
    igst_total = Decimal("0.00")
    vat_total = Decimal("0.00")
    state_tax_total = Decimal("0.00")
    local_tax_total = Decimal("0.00")
    
    for idx, item in enumerate(raw_items, start=1):
        calc_item = calculate_item_line(
            item,
            tax_type,
            exchange_rate=dec_roe,
            customer_state=customer_state,
            company_state=company_state,
            customer_country=customer_country,
            company_country=company_country,
            line_no=idx
        )
        calculated_items.append(calc_item)
        
        subtotal += calc_item.amount_inr
        discount_total += calc_item.discount_amount
        taxable_total += calc_item.taxable_amount
        cgst_total += calc_item.cgst_amount
        sgst_total += calc_item.sgst_amount
        igst_total += calc_item.igst_amount
        vat_total += calc_item.vat_amount
        state_tax_total += calc_item.state_tax_amount
        local_tax_total += calc_item.local_tax_amount
        
    subtotal = round_money(subtotal)
    discount_total = round_money(discount_total)
    taxable_total = round_money(taxable_total)
    cgst_total = round_money(cgst_total)
    sgst_total = round_money(sgst_total)
    igst_total = round_money(igst_total)
    vat_total = round_money(vat_total)
    state_tax_total = round_money(state_tax_total)
    local_tax_total = round_money(local_tax_total)
    
    if tax_type == TaxType.INTRA_STATE:
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
        tax_type=tax_type.value
    )

import pytest
from decimal import Decimal
from app.services.tax_service import determine_tax_type, TaxType, normalize_state
from app.services.calculation_service import (
    calculate_item_line,
    calculate_document_totals,
    to_decimal
)

def test_state_normalization():
    assert normalize_state("MH") == "MAHARASHTRA"
    assert normalize_state("Maharashtra") == "MAHARASHTRA"
    assert normalize_state("KA") == "KARNATAKA"
    assert normalize_state("Karnataka") == "KARNATAKA"

def test_tax_type_determination():
    assert determine_tax_type("MH", "MH") == TaxType.INTRA_STATE
    assert determine_tax_type("Maharashtra", "Maharashtra") == TaxType.INTRA_STATE
    assert determine_tax_type("Maharashtra", "Karnataka") == TaxType.INTER_STATE
    assert determine_tax_type("MH", "KA") == TaxType.INTER_STATE

def test_item_line_calculation_intra_state():
    raw_item = {
        "qty": 2,
        "unit_price": 1000,
        "discount_percent": 10,
        "tax_rate": 18,
        "description": "Widget A"
    }
    calc = calculate_item_line(raw_item, TaxType.INTRA_STATE)
    assert calc.taxable_amount == Decimal("1800.00")
    assert calc.cgst_amount == Decimal("162.00")
    assert calc.sgst_amount == Decimal("162.00")
    assert calc.igst_amount == Decimal("0.00")
    assert calc.line_total == Decimal("2124.00")

def test_item_line_calculation_inter_state():
    raw_item = {
        "qty": 2,
        "unit_price": 1000,
        "discount_percent": 10,
        "tax_rate": 18,
        "description": "Widget A"
    }
    calc = calculate_item_line(raw_item, TaxType.INTER_STATE)
    assert calc.taxable_amount == Decimal("1800.00")
    assert calc.cgst_amount == Decimal("0.00")
    assert calc.sgst_amount == Decimal("0.00")
    assert calc.igst_amount == Decimal("324.00")
    assert calc.line_total == Decimal("2124.00")

def test_document_calculation_totals():
    items = [
        {"qty": 5, "unit_price": 100, "tax_rate": 18, "description": "Item 1"},
        {"qty": 2, "unit_price": 250, "discount_amount": 50, "tax_rate": 18, "description": "Item 2"}
    ]
    doc = calculate_document_totals(items, "Maharashtra", "Karnataka")
    # Item 1: 5 * 100 = 500 taxable. 18% IGST = 90. total = 590
    # Item 2: 2 * 250 - 50 = 450 taxable. 18% IGST = 81. total = 531
    # Grand total: 590 + 531 = 1121
    assert doc.taxable_total == Decimal("950.00")
    assert doc.igst_total == Decimal("171.00")
    assert doc.grand_total == Decimal("1121.00")

def test_dynamic_gst_rates_intra_state():
    # 5% GST rate -> CGST 2.5% + SGST 2.5%
    c5 = calculate_item_line({"qty": 1, "unit_price": 10000, "tax_rate": 5}, TaxType.INTRA_STATE)
    assert c5.taxable_amount == Decimal("10000.00")
    assert c5.cgst_rate == Decimal("2.5")
    assert c5.sgst_rate == Decimal("2.5")
    assert c5.cgst_amount == Decimal("250.00")
    assert c5.sgst_amount == Decimal("250.00")
    assert c5.line_total == Decimal("10500.00")

    # 12% GST rate -> CGST 6% + SGST 6%
    c12 = calculate_item_line({"qty": 1, "unit_price": 10000, "tax_rate": 12}, TaxType.INTRA_STATE)
    assert c12.cgst_rate == Decimal("6")
    assert c12.sgst_rate == Decimal("6")
    assert c12.cgst_amount == Decimal("600.00")
    assert c12.sgst_amount == Decimal("600.00")
    assert c12.line_total == Decimal("11200.00")

    # 18% GST rate -> CGST 9% + SGST 9%
    c18 = calculate_item_line({"qty": 1, "unit_price": 10000, "tax_rate": 18}, TaxType.INTRA_STATE)
    assert c18.cgst_rate == Decimal("9")
    assert c18.sgst_rate == Decimal("9")
    assert c18.cgst_amount == Decimal("900.00")
    assert c18.sgst_amount == Decimal("900.00")
    assert c18.line_total == Decimal("11800.00")

    # 28% GST rate -> CGST 14% + SGST 14%
    c28 = calculate_item_line({"qty": 1, "unit_price": 10000, "tax_rate": 28}, TaxType.INTRA_STATE)
    assert c28.cgst_rate == Decimal("14")
    assert c28.sgst_rate == Decimal("14")
    assert c28.cgst_amount == Decimal("1400.00")
    assert c28.sgst_amount == Decimal("1400.00")
    assert c28.line_total == Decimal("12800.00")

def test_dynamic_gst_rates_inter_state():
    # 18% Inter-State -> IGST 18%
    c18 = calculate_item_line({"qty": 1, "unit_price": 10000, "tax_rate": 18}, TaxType.INTER_STATE)
    assert c18.igst_rate == Decimal("18")
    assert c18.igst_amount == Decimal("1800.00")
    assert c18.cgst_amount == Decimal("0.00")
    assert c18.sgst_amount == Decimal("0.00")
    assert c18.line_total == Decimal("11800.00")

def test_country_aware_tax_jurisdictions():
    # 1. India -> Tamil Nadu (Intra GST)
    tn_doc = calculate_document_totals(
        [{"qty": 2, "unit_price": 10000, "tax_rate": 18}],
        company_state="Tamil Nadu",
        customer_state="Tamil Nadu",
        company_country="India",
        customer_country="India"
    )
    assert tn_doc.tax_type == "INTRA_STATE"
    assert tn_doc.cgst_total == Decimal("1800.00")
    assert tn_doc.sgst_total == Decimal("1800.00")
    assert tn_doc.igst_total == Decimal("0.00")
    assert tn_doc.grand_total == Decimal("23600.00")

    # 2. India -> Karnataka (Inter GST)
    ka_doc = calculate_document_totals(
        [{"qty": 2, "unit_price": 10000, "tax_rate": 18}],
        company_state="Tamil Nadu",
        customer_state="Karnataka",
        company_country="India",
        customer_country="India"
    )
    assert ka_doc.tax_type == "INTER_STATE"
    assert ka_doc.cgst_total == Decimal("0.00")
    assert ka_doc.sgst_total == Decimal("0.00")
    assert ka_doc.igst_total == Decimal("3600.00")
    assert ka_doc.grand_total == Decimal("23600.00")

    # 3. USA -> California — state statutory rate only (no local rate provided, none invented)
    # California statutory state rate: 7.25%; local rate unknown without city/ZIP
    ca_doc = calculate_document_totals(
        [{"qty": 2, "unit_price": 10000}],
        company_state="California",
        customer_state="California",
        company_country="USA",
        customer_country="USA"
    )
    assert ca_doc.tax_type == "SALES_TAX"
    assert ca_doc.state_tax_total == Decimal("1450.00")   # 7.25% of 20000
    assert ca_doc.local_tax_total == Decimal("0.00")       # no local rate invented
    assert ca_doc.tax_total == Decimal("1450.00")
    assert ca_doc.grand_total == Decimal("21450.00")

    # 3b. USA -> California — with explicit user-provided local rate of 1.25%
    ca_doc_with_local = calculate_document_totals(
        [{"qty": 2, "unit_price": 10000, "local_tax_rate": "1.25"}],
        company_state="California",
        customer_state="California",
        company_country="USA",
        customer_country="USA"
    )
    assert ca_doc_with_local.tax_type == "SALES_TAX"
    assert ca_doc_with_local.state_tax_total == Decimal("1450.00")   # 7.25%
    assert ca_doc_with_local.local_tax_total == Decimal("250.00")    # 1.25% (user-provided)
    assert ca_doc_with_local.tax_total == Decimal("1700.00")
    assert ca_doc_with_local.grand_total == Decimal("21700.00")

    # 4. USA -> Texas — state statutory rate only (6.25%; local rate not provided)
    tx_doc = calculate_document_totals(
        [{"qty": 2, "unit_price": 10000}],
        company_state="Texas",
        customer_state="Texas",
        company_country="USA",
        customer_country="USA"
    )
    assert tx_doc.tax_type == "SALES_TAX"
    assert tx_doc.state_tax_total == Decimal("1250.00")   # 6.25% of 20000
    assert tx_doc.local_tax_total == Decimal("0.00")       # no local rate invented
    assert tx_doc.tax_total == Decimal("1250.00")
    assert tx_doc.grand_total == Decimal("21250.00")

    # 5. UAE -> Dubai (VAT 5%)
    uae_doc = calculate_document_totals(
        [{"qty": 2, "unit_price": 10000}],
        company_state="Dubai",
        customer_state="Dubai",
        company_country="UAE",
        customer_country="UAE"
    )
    assert uae_doc.tax_type == "VAT"
    assert uae_doc.vat_total == Decimal("1000.00")
    assert uae_doc.tax_total == Decimal("1000.00")
    assert uae_doc.grand_total == Decimal("21000.00")


def test_calculation_service_foreign_currency_discount_before_after():
    """
    Task 9 Requirement:
    USD item with fixed amount discount:
    Item: qty=2, unit_price=100 USD, discount_amount=20 USD, exchange_rate=80.0
    Old code treated discount_amount as already in INR (20 INR discount on 16000 INR order).
    New code scales discount_amount by exchange_rate (20 USD * 80 = 1600 INR discount).
    Asserts:
    1. New code correctly scales foreign fixed discount by exchange rate.
    2. Proves that existing proforma totals for INR cases (ROE=1.0) remain identical to the paisa.
    """
    items_usd = [{
        "qty": 2,
        "unit_price": 100,
        "currency": "USD",
        "discount_amount": 20,
        "tax_rate": 18
    }]
    # Run calculation with exchange_rate 80.0
    res_usd = calculate_document_totals(
        items_usd,
        company_state="Maharashtra",
        customer_state="Karnataka",
        exchange_rate=80.0,
        doc_currency="USD"
    )
    # Subtotal in INR: 2 * 100 * 80 = 16,000.00
    assert res_usd.subtotal == Decimal("16000.00")
    # Discount in INR: 20 USD * 80 = 1,600.00 (Old bug produced 20.00 INR)
    assert res_usd.discount_total == Decimal("1600.00")
    # Taxable total: 16,000 - 1,600 = 14,400.00
    assert res_usd.taxable_total == Decimal("14400.00")
    # IGST at 18%: 14,400 * 0.18 = 2,592.00
    assert res_usd.igst_total == Decimal("2592.00")
    assert res_usd.grand_total == Decimal("16992.00")

    # Prove existing INR domestic cases are 100% unchanged to the paisa
    items_inr = [
        {"qty": 5, "unit_price": 100, "tax_rate": 18, "description": "Standard Item 1"},
        {"qty": 2, "unit_price": 250, "discount_amount": 50, "tax_rate": 18, "description": "Standard Item 2"}
    ]
    res_inr = calculate_document_totals(items_inr, "Maharashtra", "Karnataka")
    assert res_inr.subtotal == Decimal("1000.00")
    assert res_inr.discount_total == Decimal("50.00")
    assert res_inr.taxable_total == Decimal("950.00")
    assert res_inr.igst_total == Decimal("171.00")
    assert res_inr.grand_total == Decimal("1121.00")


def test_freight_forwarding_reference_invoice_calculation():
    """
    Step 3 Acceptance Test:
    Reference freight-forwarding invoice fixture:
    Lines:
     1. Ocean Freight, SAC 996521, USD 50.00 x1, GST 2.5+2.5 -> INR 4,922.50, GST 246.12
     2. Origin Ex-Works Charges, SAC 996759, USD 495.00 x1, 9+9 -> INR 48,732.75, GST 8,771.90
     3. Dstn. Inland Haulage, 996759, INR 1,400.00, 9+9 -> 1,400.00, GST 252.00
     4. Dstn. Terminal Handling, 996759, INR 1,400.00, 9+9 -> 1,400.00, GST 252.00
     5. Dstn. Delivery Order Fee, 996759, INR 1,000.00, 9+9 -> 1,000.00, GST 180.00
    ROE 98.45, same-state (Maharashtra -> Maharashtra so CGST+SGST).
    Expected:
      taxable total: 57,455.25
      CGST total: 4,851.01
      SGST total: 4,851.01
      IGST: 0.00
      GST total: 9,702.02
      total after tax: 67,157.27
      words: "SIXTY-SEVEN THOUSAND ONE HUNDRED FIFTY-SEVEN AND TWENTY-SEVEN ONLY"
    """
    from app.utils.num2words import number_to_words_indian, amount_to_words_inr

    items = [
        {"description": "Ocean Freight", "hsn_sac": "996521", "currency": "USD", "unit_price": 50.00, "qty": 1, "tax_rate": 5},
        {"description": "Origin Ex-Works Charges", "hsn_sac": "996759", "currency": "USD", "unit_price": 495.00, "qty": 1, "tax_rate": 18},
        {"description": "Dstn. Inland Haulage", "hsn_sac": "996759", "currency": "INR", "unit_price": 1400.00, "qty": 1, "tax_rate": 18},
        {"description": "Dstn. Terminal Handling", "hsn_sac": "996759", "currency": "INR", "unit_price": 1400.00, "qty": 1, "tax_rate": 18},
        {"description": "Dstn. Delivery Order Fee", "hsn_sac": "996759", "currency": "INR", "unit_price": 1000.00, "qty": 1, "tax_rate": 18},
    ]

    res = calculate_document_totals(
        items,
        company_state="Maharashtra",
        customer_state="Maharashtra",
        exchange_rate=98.45,
        enable_auto_round_off=False
    )

    # Per-line assertions
    assert res.items[0].amount_inr == Decimal("4922.50")
    assert res.items[0].cgst_amount == Decimal("123.06")
    assert res.items[0].sgst_amount == Decimal("123.06")
    assert res.items[0].tax_amount == Decimal("246.12")

    assert res.items[1].amount_inr == Decimal("48732.75")
    assert res.items[1].cgst_amount == Decimal("4385.95")
    assert res.items[1].sgst_amount == Decimal("4385.95")
    assert res.items[1].tax_amount == Decimal("8771.90")

    assert res.items[2].amount_inr == Decimal("1400.00")
    assert res.items[2].tax_amount == Decimal("252.00")

    assert res.items[3].amount_inr == Decimal("1400.00")
    assert res.items[3].tax_amount == Decimal("252.00")

    assert res.items[4].amount_inr == Decimal("1000.00")
    assert res.items[4].tax_amount == Decimal("180.00")

    # Document total assertions
    assert res.taxable_total == Decimal("57455.25")
    assert res.cgst_total == Decimal("4851.01")
    assert res.sgst_total == Decimal("4851.01")
    assert res.igst_total == Decimal("0.00")
    assert res.tax_total == Decimal("9702.02")
    assert res.grand_total == Decimal("67157.27")

    # Amount in words
    expected_words = "SIXTY-SEVEN THOUSAND ONE HUNDRED FIFTY-SEVEN AND TWENTY-SEVEN ONLY"
    assert res.grand_total_in_words == expected_words
    assert number_to_words_indian(float(res.grand_total)) == expected_words
    assert amount_to_words_inr(float(res.grand_total)) == expected_words



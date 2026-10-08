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



import os
import sys

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath("backend"))

from app.services.calculation_service import calculate_document_totals

def test_calculation_service():
    items = [
        {
            "description": "Freight & Logistics Services",
            "qty": 2,
            "unit_price": 10000,
            "tax_rate": 18,
            "hsn_sac": "9965"
        },
        {
            "description": "Customs Documentation Fee",
            "qty": 1,
            "unit_price": 5000,
            "tax_rate": 18,
            "hsn_sac": "9965"
        }
    ]

    # Test intra-state (Maharashtra -> Maharashtra)
    res_intra = calculate_document_totals(
        items,
        company_state="Maharashtra",
        customer_state="Maharashtra",
        amount_paid=5000
    )

    print("--- Intra-State Calculation Result ---")
    print("Taxable Total:", res_intra.taxable_total)
    print("CGST Total:", res_intra.cgst_total)
    print("SGST Total:", res_intra.sgst_total)
    print("IGST Total:", res_intra.igst_total)
    print("Grand Total (Invoice Total):", res_intra.grand_total)
    print("Amount Paid:", res_intra.amount_paid)
    print("Balance Due:", res_intra.balance_due)

    assert res_intra.taxable_total == 25000.00
    assert res_intra.cgst_total == 2250.00
    assert res_intra.sgst_total == 2250.00
    assert res_intra.grand_total == 29500.00
    assert res_intra.amount_paid == 5000.00
    assert res_intra.balance_due == 24500.00
    print("SUCCESS: Intra-state assertions passed!")

    # Test inter-state (Maharashtra -> Karnataka)
    res_inter = calculate_document_totals(
        items,
        company_state="Maharashtra",
        customer_state="Karnataka",
        amount_paid=10000
    )

    print("\n--- Inter-State Calculation Result ---")
    print("Taxable Total:", res_inter.taxable_total)
    print("IGST Total:", res_inter.igst_total)
    print("Grand Total (Invoice Total):", res_inter.grand_total)
    print("Amount Paid:", res_inter.amount_paid)
    print("Balance Due:", res_inter.balance_due)

    assert res_inter.taxable_total == 25000.00
    assert res_inter.igst_total == 4500.00
    assert res_inter.grand_total == 29500.00
    assert res_inter.amount_paid == 10000.00
    assert res_inter.balance_due == 19500.00
    print("SUCCESS: Inter-state assertions passed!")

if __name__ == "__main__":
    test_calculation_service()

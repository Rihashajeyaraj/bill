"""
Tax Service — Jurisdiction-Aware Tax Engine

Design principles:
  - India: GST (CGST+SGST for intra-state, IGST for inter-state). Determined by
    comparing seller and buyer state codes derived from GSTIN or state name.
  - USA: Sales Tax (state statutory rate + optional user-provided local rate).
    The state statutory rate is set by law and reliable.
    The local/county/district rate CANNOT be determined without city or ZIP code.
    We NEVER invent a local rate. If the caller does not supply one, local_rate = 0
    and a warning is returned so the UI can prompt the user.
  - UAE: VAT 5% (statutory, zero-rated exports excluded — handled at item level).
  - United Kingdom: VAT 20% (standard), 5% (reduced), 0% (zero-rated).
  - Ireland: VAT 23% (standard), 13.5% (reduced).
  - Sri Lanka: VAT 18% (standard, reinstated 2023).
  - Australia: GST 10%.
  - Canada: Combination of GST/HST/PST — treated as a single combined rate;
    the exact breakdown is province-dependent and should be user-entered.
  - All other countries: Generic VAT; rate must be explicitly provided; if not
    provided it defaults to 0 with a warning.
"""

from enum import Enum
from typing import Tuple, Dict, Any, Optional
from decimal import Decimal


class TaxType(str, Enum):
    INTRA_STATE = "INTRA_STATE"  # CGST + SGST (India same-state)
    INTER_STATE = "INTER_STATE"  # IGST (India different-state / export)
    SALES_TAX = "SALES_TAX"      # USA State + Local Sales Tax
    VAT = "VAT"                  # VAT (UAE / UK / EU / International)
    EXEMPT = "EXEMPT"            # Zero-rated / tax-exempt transaction


# ──────────────────────────────────────────────────────────────────────────────
# India GST — State Code Lookup
# ──────────────────────────────────────────────────────────────────────────────

STATE_CODE_MAP: Dict[str, str] = {
    "AN": "Andaman and Nicobar Islands",
    "AP": "Andhra Pradesh",
    "AR": "Arunachal Pradesh",
    "AS": "Assam",
    "BR": "Bihar",
    "CH": "Chandigarh",
    "CT": "Chhattisgarh",
    "DN": "Dadra and Nagar Haveli and Daman and Diu",
    "DL": "Delhi",
    "GA": "Goa",
    "GJ": "Gujarat",
    "HR": "Haryana",
    "HP": "Himachal Pradesh",
    "JK": "Jammu and Kashmir",
    "JH": "Jharkhand",
    "KA": "Karnataka",
    "KL": "Kerala",
    "LA": "Ladakh",
    "LD": "Lakshadweep",
    "MP": "Madhya Pradesh",
    "MH": "Maharashtra",
    "MN": "Manipur",
    "ML": "Meghalaya",
    "MZ": "Mizoram",
    "NL": "Nagaland",
    "OR": "Odisha",
    "PY": "Puducherry",
    "PB": "Punjab",
    "RJ": "Rajasthan",
    "SK": "Sikkim",
    "TN": "Tamil Nadu",
    "TG": "Telangana",
    "TR": "Tripura",
    "UP": "Uttar Pradesh",
    "UT": "Uttarakhand",
    "WB": "West Bengal",
}

# ──────────────────────────────────────────────────────────────────────────────
# USA Sales Tax — State Statutory Rates
#
# IMPORTANT: These are the STATE-LEVEL statutory minimum rates only.
# They are set by state law and are not subject to local variation.
# Local (city/county/district/MTA) rates add on TOP of the state rate
# and vary by jurisdiction — they CANNOT be determined from state name alone.
#
# Source: Sales Tax Institute state rate table (2024)
# https://www.salestaxinstitute.com/resources/rates
#
# Rule: If the caller does not supply an explicit local_tax_rate, we apply
# ONLY the state rate and surface a warning. We never invent a local rate.
# ──────────────────────────────────────────────────────────────────────────────

US_STATE_STATUTORY_RATES: Dict[str, Dict[str, Any]] = {
    # Key = uppercase state abbreviation
    "AL": {"state_rate": Decimal("4.00"),  "name": "Alabama"},
    "AK": {"state_rate": Decimal("0.00"),  "name": "Alaska"},         # No state sales tax
    "AZ": {"state_rate": Decimal("5.60"),  "name": "Arizona"},
    "AR": {"state_rate": Decimal("6.50"),  "name": "Arkansas"},
    "CA": {"state_rate": Decimal("7.25"),  "name": "California"},
    "CO": {"state_rate": Decimal("2.90"),  "name": "Colorado"},
    "CT": {"state_rate": Decimal("6.35"),  "name": "Connecticut"},
    "DE": {"state_rate": Decimal("0.00"),  "name": "Delaware"},        # No state sales tax
    "FL": {"state_rate": Decimal("6.00"),  "name": "Florida"},
    "GA": {"state_rate": Decimal("4.00"),  "name": "Georgia"},
    "HI": {"state_rate": Decimal("4.00"),  "name": "Hawaii"},
    "ID": {"state_rate": Decimal("6.00"),  "name": "Idaho"},
    "IL": {"state_rate": Decimal("6.25"),  "name": "Illinois"},
    "IN": {"state_rate": Decimal("7.00"),  "name": "Indiana"},
    "IA": {"state_rate": Decimal("6.00"),  "name": "Iowa"},
    "KS": {"state_rate": Decimal("6.50"),  "name": "Kansas"},
    "KY": {"state_rate": Decimal("6.00"),  "name": "Kentucky"},
    "LA": {"state_rate": Decimal("4.45"),  "name": "Louisiana"},
    "ME": {"state_rate": Decimal("5.50"),  "name": "Maine"},
    "MD": {"state_rate": Decimal("6.00"),  "name": "Maryland"},
    "MA": {"state_rate": Decimal("6.25"),  "name": "Massachusetts"},
    "MI": {"state_rate": Decimal("6.00"),  "name": "Michigan"},
    "MN": {"state_rate": Decimal("6.875"), "name": "Minnesota"},
    "MS": {"state_rate": Decimal("7.00"),  "name": "Mississippi"},
    "MO": {"state_rate": Decimal("4.225"), "name": "Missouri"},
    "MT": {"state_rate": Decimal("0.00"),  "name": "Montana"},         # No state sales tax
    "NE": {"state_rate": Decimal("5.50"),  "name": "Nebraska"},
    "NV": {"state_rate": Decimal("6.85"),  "name": "Nevada"},
    "NH": {"state_rate": Decimal("0.00"),  "name": "New Hampshire"},   # No state sales tax
    "NJ": {"state_rate": Decimal("6.625"), "name": "New Jersey"},
    "NM": {"state_rate": Decimal("5.00"),  "name": "New Mexico"},
    "NY": {"state_rate": Decimal("4.00"),  "name": "New York"},
    "NC": {"state_rate": Decimal("4.75"),  "name": "North Carolina"},
    "ND": {"state_rate": Decimal("5.00"),  "name": "North Dakota"},
    "OH": {"state_rate": Decimal("5.75"),  "name": "Ohio"},
    "OK": {"state_rate": Decimal("4.50"),  "name": "Oklahoma"},
    "OR": {"state_rate": Decimal("0.00"),  "name": "Oregon"},          # No state sales tax
    "PA": {"state_rate": Decimal("6.00"),  "name": "Pennsylvania"},
    "RI": {"state_rate": Decimal("7.00"),  "name": "Rhode Island"},
    "SC": {"state_rate": Decimal("6.00"),  "name": "South Carolina"},
    "SD": {"state_rate": Decimal("4.50"),  "name": "South Dakota"},
    "TN": {"state_rate": Decimal("7.00"),  "name": "Tennessee"},
    "TX": {"state_rate": Decimal("6.25"),  "name": "Texas"},
    "UT": {"state_rate": Decimal("4.85"),  "name": "Utah"},
    "VT": {"state_rate": Decimal("6.00"),  "name": "Vermont"},
    "VA": {"state_rate": Decimal("5.30"),  "name": "Virginia"},
    "WA": {"state_rate": Decimal("6.50"),  "name": "Washington"},
    "WV": {"state_rate": Decimal("6.00"),  "name": "West Virginia"},
    "WI": {"state_rate": Decimal("5.00"),  "name": "Wisconsin"},
    "WY": {"state_rate": Decimal("4.00"),  "name": "Wyoming"},
    # DC
    "DC": {"state_rate": Decimal("6.00"),  "name": "District of Columbia"},
}

# Name → abbreviation lookup (for when state name is given instead of code)
_US_STATE_NAME_TO_CODE: Dict[str, str] = {
    v["name"].upper(): k for k, v in US_STATE_STATUTORY_RATES.items()
}
# Extra aliases
_US_STATE_NAME_TO_CODE.update({
    "DISTRICT OF COLUMBIA": "DC",
    "WASHINGTON DC": "DC",
    "WASHINGTON D.C.": "DC",
})


# ──────────────────────────────────────────────────────────────────────────────
# International VAT — Country Statutory Rates (standard rate only)
# Reduced/zero rates are handled at the item level, not document level.
# ──────────────────────────────────────────────────────────────────────────────

COUNTRY_VAT_RATES: Dict[str, Dict[str, Any]] = {
    "UAE":          {"standard_rate": Decimal("5.00"),  "currency": "AED", "label": "UAE VAT"},
    "UK":           {"standard_rate": Decimal("20.00"), "currency": "GBP", "label": "UK VAT"},
    "IRELAND":      {"standard_rate": Decimal("23.00"), "currency": "EUR", "label": "Irish VAT"},
    "SRI LANKA":    {"standard_rate": Decimal("18.00"), "currency": "LKR", "label": "Sri Lanka VAT"},
    "AUSTRALIA":    {"standard_rate": Decimal("10.00"), "currency": "AUD", "label": "Australian GST"},
    "NEW ZEALAND":  {"standard_rate": Decimal("15.00"), "currency": "NZD", "label": "New Zealand GST"},
    "SINGAPORE":    {"standard_rate": Decimal("9.00"),  "currency": "SGD", "label": "Singapore GST"},
    "GERMANY":      {"standard_rate": Decimal("19.00"), "currency": "EUR", "label": "German VAT (MwSt)"},
    "FRANCE":       {"standard_rate": Decimal("20.00"), "currency": "EUR", "label": "French VAT (TVA)"},
    "NETHERLANDS":  {"standard_rate": Decimal("21.00"), "currency": "EUR", "label": "Netherlands VAT (BTW)"},
    "SWEDEN":       {"standard_rate": Decimal("25.00"), "currency": "SEK", "label": "Swedish VAT (Moms)"},
    "NORWAY":       {"standard_rate": Decimal("25.00"), "currency": "NOK", "label": "Norwegian VAT (MVA)"},
    "DENMARK":      {"standard_rate": Decimal("25.00"), "currency": "DKK", "label": "Danish VAT (Moms)"},
    "FINLAND":      {"standard_rate": Decimal("24.00"), "currency": "EUR", "label": "Finnish VAT (ALV)"},
    "ITALY":        {"standard_rate": Decimal("22.00"), "currency": "EUR", "label": "Italian VAT (IVA)"},
    "SPAIN":        {"standard_rate": Decimal("21.00"), "currency": "EUR", "label": "Spanish VAT (IVA)"},
    "PORTUGAL":     {"standard_rate": Decimal("23.00"), "currency": "EUR", "label": "Portuguese VAT (IVA)"},
    "BELGIUM":      {"standard_rate": Decimal("21.00"), "currency": "EUR", "label": "Belgian VAT (BTW/TVA)"},
    "AUSTRIA":      {"standard_rate": Decimal("20.00"), "currency": "EUR", "label": "Austrian VAT (MwSt)"},
    "SWITZERLAND":  {"standard_rate": Decimal("8.10"),  "currency": "CHF", "label": "Swiss VAT (MWST)"},
    "CANADA":       {"standard_rate": Decimal("5.00"),  "currency": "CAD", "label": "Canada GST (federal only; PST/HST varies by province)"},
    "SOUTH AFRICA": {"standard_rate": Decimal("15.00"), "currency": "ZAR", "label": "South Africa VAT"},
    "KENYA":        {"standard_rate": Decimal("16.00"), "currency": "KES", "label": "Kenya VAT"},
    "NIGERIA":      {"standard_rate": Decimal("7.50"),  "currency": "NGN", "label": "Nigeria VAT"},
    "MALAYSIA":     {"standard_rate": Decimal("8.00"),  "currency": "MYR", "label": "Malaysia SST"},
    "THAILAND":     {"standard_rate": Decimal("7.00"),  "currency": "THB", "label": "Thailand VAT"},
    "JAPAN":        {"standard_rate": Decimal("10.00"), "currency": "JPY", "label": "Japan Consumption Tax"},
    "SOUTH KOREA":  {"standard_rate": Decimal("10.00"), "currency": "KRW", "label": "Korea VAT"},
    "CHINA":        {"standard_rate": Decimal("13.00"), "currency": "CNY", "label": "China VAT (standard goods)"},
    "INDONESIA":    {"standard_rate": Decimal("11.00"), "currency": "IDR", "label": "Indonesia VAT (PPN)"},
    "PHILIPPINES":  {"standard_rate": Decimal("12.00"), "currency": "PHP", "label": "Philippines VAT (EVAT)"},
    "BRAZIL":       {"standard_rate": Decimal("17.00"), "currency": "BRL", "label": "Brazil ICMS (avg; federal + state)"},
    "MEXICO":       {"standard_rate": Decimal("16.00"), "currency": "MXN", "label": "Mexico IVA"},
    "ARGENTINA":    {"standard_rate": Decimal("21.00"), "currency": "ARS", "label": "Argentina IVA"},
    "CHILE":        {"standard_rate": Decimal("19.00"), "currency": "CLP", "label": "Chile IVA"},
    "SAUDI ARABIA": {"standard_rate": Decimal("15.00"), "currency": "SAR", "label": "Saudi Arabia VAT"},
    "BAHRAIN":      {"standard_rate": Decimal("10.00"), "currency": "BHD", "label": "Bahrain VAT"},
    "QATAR":        {"standard_rate": Decimal("0.00"),  "currency": "QAR", "label": "Qatar (no VAT yet)"},
    "KUWAIT":       {"standard_rate": Decimal("0.00"),  "currency": "KWD", "label": "Kuwait (no VAT yet)"},
    "OMAN":         {"standard_rate": Decimal("5.00"),  "currency": "OMR", "label": "Oman VAT"},
}


# ──────────────────────────────────────────────────────────────────────────────
# Normalisation helpers
# ──────────────────────────────────────────────────────────────────────────────

def normalize_country(country_name_or_code: str) -> str:
    """Return a canonical uppercase country key."""
    if not country_name_or_code:
        return "INDIA"
    clean = str(country_name_or_code).strip().upper()
    # India variants
    if clean in ("IN", "IND", "INDIA", "🇮🇳 INDIA", "BHARAT"):
        return "INDIA"
    # USA variants
    if clean in ("US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA", "U.S.", "U.S.A."):
        return "USA"
    # UAE variants
    if clean in ("AE", "ARE", "UAE", "UNITED ARAB EMIRATES", "DUBAI", "ABU DHABI", "🇦🇪 UAE"):
        return "UAE"
    # UK variants
    if clean in ("GB", "GBR", "UK", "UNITED KINGDOM", "GREAT BRITAIN", "BRITAIN", "ENGLAND"):
        return "UK"
    # Ireland
    if clean in ("IE", "IRL", "IRELAND", "REPUBLIC OF IRELAND"):
        return "IRELAND"
    # Sri Lanka
    if clean in ("LK", "LKA", "SRI LANKA", "CEYLON"):
        return "SRI LANKA"
    # Australia
    if clean in ("AU", "AUS", "AUSTRALIA"):
        return "AUSTRALIA"
    # Canada
    if clean in ("CA", "CAN", "CANADA"):
        return "CANADA"
    # Singapore
    if clean in ("SG", "SGP", "SINGAPORE"):
        return "SINGAPORE"
    # Japan
    if clean in ("JP", "JPN", "JAPAN"):
        return "JAPAN"
    # Germany
    if clean in ("DE", "DEU", "GERMANY", "DEUTSCHLAND"):
        return "GERMANY"
    # China
    if clean in ("CN", "CHN", "CHINA", "PEOPLE'S REPUBLIC OF CHINA"):
        return "CHINA"
    return clean  # Return normalised form for unknown countries


def normalize_state(state_name_or_code: str) -> str:
    """Return canonical uppercase state name for India (for GST matching)."""
    if not state_name_or_code:
        return ""
    clean = str(state_name_or_code).strip().upper()
    if clean in STATE_CODE_MAP:
        return STATE_CODE_MAP[clean].upper()
    return clean


def resolve_us_state_code(state_input: str) -> Optional[str]:
    """
    Given a US state name or 2-letter code, return the uppercase 2-letter code.
    Returns None if the state cannot be resolved.
    """
    if not state_input:
        return None
    clean = str(state_input).strip().upper()
    # Direct code lookup
    if clean in US_STATE_STATUTORY_RATES:
        return clean
    # Name lookup
    if clean in _US_STATE_NAME_TO_CODE:
        return _US_STATE_NAME_TO_CODE[clean]
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Tax type determination
# ──────────────────────────────────────────────────────────────────────────────

def determine_tax_type(
    company_state: str,
    customer_state: str,
    company_country: str = "India",
    customer_country: str = "India",
) -> TaxType:
    """
    Determine which tax regime applies to a transaction.

    Priority order:
      1. Either party is in the USA → SALES_TAX
      2. Either party is in a known VAT country (non-India) → VAT
      3. Both parties are in India → INTRA_STATE or INTER_STATE based on state
    """
    norm_company_country = normalize_country(company_country)
    norm_customer_country = normalize_country(customer_country)

    if norm_company_country == "USA" or norm_customer_country == "USA":
        return TaxType.SALES_TAX

    non_india_vat_countries = {
        "UAE", "UK", "IRELAND", "SRI LANKA", "AUSTRALIA", "NEW ZEALAND",
        "SINGAPORE", "GERMANY", "FRANCE", "NETHERLANDS", "SWEDEN", "NORWAY",
        "DENMARK", "FINLAND", "ITALY", "SPAIN", "PORTUGAL", "BELGIUM",
        "AUSTRIA", "SWITZERLAND", "CANADA", "SOUTH AFRICA", "KENYA",
        "NIGERIA", "MALAYSIA", "THAILAND", "JAPAN", "SOUTH KOREA", "CHINA",
        "INDONESIA", "PHILIPPINES", "BRAZIL", "MEXICO", "ARGENTINA", "CHILE",
        "SAUDI ARABIA", "BAHRAIN", "QATAR", "KUWAIT", "OMAN",
    }

    if norm_company_country in non_india_vat_countries:
        return TaxType.VAT
    if norm_customer_country in non_india_vat_countries:
        return TaxType.VAT
    if norm_company_country != "INDIA" and norm_customer_country != "INDIA":
        return TaxType.VAT

    # Both India → GST intra vs inter
    norm_co_state = normalize_state(company_state)
    norm_cu_state = normalize_state(customer_state)

    if not norm_co_state or not norm_cu_state:
        # Missing state → default to INTER (IGST safer for cross-state)
        return TaxType.INTER_STATE

    return TaxType.INTRA_STATE if norm_co_state == norm_cu_state else TaxType.INTER_STATE


# ──────────────────────────────────────────────────────────────────────────────
# US Sales Tax lookup
# ──────────────────────────────────────────────────────────────────────────────

class USSalesTaxResult:
    """
    Result of a US sales tax rate lookup.

    Attributes
    ----------
    state_code      : 2-letter US state abbreviation, or None if unresolved.
    state_name      : Full state name.
    state_rate      : Statutory state-level rate (Decimal, always accurate).
    local_rate      : Local/county/district rate supplied by the caller
                      (Decimal). Defaults to 0 if not provided.
    local_rate_source: "user_provided" | "not_provided"
                       NEVER "estimated" or "assumed".
    warning         : Human-readable warning string if local_rate is missing.
    resolved        : True if the state was found in our database.
    """
    def __init__(
        self,
        state_code: Optional[str],
        state_name: str,
        state_rate: Decimal,
        local_rate: Decimal,
        local_rate_source: str,
        warning: str,
        resolved: bool,
    ):
        self.state_code = state_code
        self.state_name = state_name
        self.state_rate = state_rate
        self.local_rate = local_rate
        self.local_rate_source = local_rate_source
        self.warning = warning
        self.resolved = resolved

    @property
    def combined_rate(self) -> Decimal:
        return self.state_rate + self.local_rate


def get_us_sales_tax_rates(
    state_input: str,
    local_rate_override: Optional[Decimal] = None,
) -> USSalesTaxResult:
    """
    Return a USSalesTaxResult for the given US state.

    Parameters
    ----------
    state_input          : State name or 2-letter code.
    local_rate_override  : If the caller knows the local rate (e.g. user entered
                           it in the UI for their specific city/county), pass it
                           here. Otherwise, local_rate will be 0 with a warning.

    Rules
    -----
    - We NEVER invent or estimate a local rate.
    - If state is unknown, we return 0% for both rates plus a warning.
    - The state statutory rate is always authoritative.
    """
    state_code = resolve_us_state_code(state_input)

    if state_code is not None and state_code in US_STATE_STATUTORY_RATES:
        entry = US_STATE_STATUTORY_RATES[state_code]
        state_rate = entry["state_rate"]
        state_name = entry["name"]
        resolved = True

        # States with no sales tax — no local tax either
        if state_rate == Decimal("0.00"):
            return USSalesTaxResult(
                state_code=state_code,
                state_name=state_name,
                state_rate=Decimal("0.00"),
                local_rate=Decimal("0.00"),
                local_rate_source="not_applicable",
                warning=f"{state_name} has no state sales tax.",
                resolved=True,
            )
    else:
        # Unknown state
        return USSalesTaxResult(
            state_code=None,
            state_name=str(state_input or "Unknown State"),
            state_rate=Decimal("0.00"),
            local_rate=Decimal("0.00"),
            local_rate_source="not_provided",
            warning=(
                f"State '{state_input}' is not recognised. "
                "Please enter the applicable state and local tax rates manually."
            ),
            resolved=False,
        )

    # Determine local rate
    if local_rate_override is not None and local_rate_override >= Decimal("0.00"):
        local_rate = local_rate_override
        local_rate_source = "user_provided"
        warning = ""
    else:
        local_rate = Decimal("0.00")
        local_rate_source = "not_provided"
        warning = (
            f"Only the {state_name} state rate ({state_rate}%) has been applied. "
            "Local/county/city tax rates vary by jurisdiction and cannot be determined "
            "from the state name alone. Enter the applicable local rate for your "
            "specific city or county to compute the correct combined rate."
        )

    return USSalesTaxResult(
        state_code=state_code,
        state_name=state_name,
        state_rate=state_rate,
        local_rate=local_rate,
        local_rate_source=local_rate_source,
        warning=warning,
        resolved=resolved,
    )


# ──────────────────────────────────────────────────────────────────────────────
# International VAT lookup
# ──────────────────────────────────────────────────────────────────────────────

def get_country_vat_config(country_input: str) -> Dict[str, Any]:
    """
    Return VAT configuration for the given country.

    Returns a dict with:
      standard_rate : Decimal — the statutory standard VAT rate.
      currency      : str
      label         : str — human-readable name for the tax (e.g. "UAE VAT")
      known         : bool — True if this country has a known entry.
      warning       : str — set if the rate is zero or unknown.
    """
    norm = normalize_country(country_input)
    entry = COUNTRY_VAT_RATES.get(norm)

    if entry:
        rate = entry["standard_rate"]
        warning = ""
        if rate == Decimal("0.00"):
            warning = f"{entry['label']}: No standard VAT/GST applies. Verify applicability."
        return {
            "standard_rate": rate,
            "currency": entry["currency"],
            "label": entry["label"],
            "known": True,
            "warning": warning,
        }

    # Unknown country — do not invent a rate
    return {
        "standard_rate": Decimal("0.00"),
        "currency": "USD",
        "label": f"Tax ({norm})",
        "known": False,
        "warning": (
            f"Tax rate for '{country_input}' is not configured. "
            "Please enter the applicable VAT/tax rate manually."
        ),
    }

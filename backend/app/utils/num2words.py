def number_to_words_indian(amount: float) -> str:
    """
    Converts a numerical amount into Indian currency words representation.
    Example: 67157.27 -> SIXTY-SEVEN THOUSAND ONE HUNDRED FIFTY-SEVEN AND TWENTY-SEVEN ONLY
    """
    if amount is None or amount == 0:
        return "ZERO ONLY"

    units = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
             "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"]
    tens = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"]

    def convert_less_than_thousand(n: int) -> str:
        if n == 0:
            return ""
        if n < 20:
            return units[n]
        if n < 100:
            digit = n % 10
            prefix = tens[n // 10]
            return f"{prefix}-{units[digit]}" if digit > 0 else prefix
        hundreds = units[n // 100]
        remainder = convert_less_than_thousand(n % 100)
        return f"{hundreds} HUNDRED {remainder}".strip()

    def convert_integer(n: int) -> str:
        if n == 0:
            return "ZERO"
        crores = n // 10000000
        n %= 10000000
        lakhs = n // 100000
        n %= 100000
        thousands = n // 1000
        n %= 1000
        remainder = n

        parts = []
        if crores > 0:
            parts.append(f"{convert_less_than_thousand(crores)} CRORE")
        if lakhs > 0:
            parts.append(f"{convert_less_than_thousand(lakhs)} LAKH")
        if thousands > 0:
            parts.append(f"{convert_less_than_thousand(thousands)} THOUSAND")
        if remainder > 0:
            parts.append(convert_less_than_thousand(remainder))

        return " ".join(parts).strip()

    try:
        val = abs(float(amount))
        rupees = int(val)
        paise = int(round((val - rupees) * 100))

        rupees_words = convert_integer(rupees)
        if paise > 0:
            paise_words = convert_less_than_thousand(paise)
            return f"{rupees_words} AND {paise_words} ONLY".upper()
        else:
            return f"{rupees_words} ONLY".upper()
    except Exception:
        return f"{amount:,.2f}"

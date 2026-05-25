function normalizeWhitespace(value) {
  return String(value || "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanLine(value) {
  return normalizeWhitespace(String(value || "").replace(/[|]/g, " ").replace(/\t/g, " "));
}

function normalizeKey(value) {
  return cleanLine(value).toLowerCase();
}

const MONTH_INDEX = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

const INVALID_INVOICE_TOKENS = new Set([
  "date",
  "invoice",
  "bill",
  "tax",
  "gst",
  "gstin",
  "po",
  "order"
]);

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => cleanLine(value)).filter(Boolean))];
}

function extractAmountCandidates(value) {
  const matches =
    String(value || "").match(
      /(?:\()?\b(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{2})\b(?:\))?|\b\d+\.\d{2}\b/g
    ) || [];
  return matches
    .map((match) => {
      const normalized = match.replace(/[(),]/g, "").trim();
      const amount = Number(normalized);
      return Number.isFinite(amount) ? amount : null;
    })
    .filter((amount) => amount !== null);
}

function formatAmount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return numeric.toFixed(2);
}

function looksLikeTableHeader(line) {
  const key = normalizeKey(line);
  if (!key) return false;
  const signals = [
    "qty",
    "quantity",
    "rate",
    "price",
    "amount",
    "hsn",
    "description",
    "item",
    "unit"
  ];
  return signals.filter((signal) => key.includes(signal)).length >= 3;
}

function looksLikeTableRow(line) {
  const key = normalizeKey(line);
  if (!key) return false;
  const numericCount = (line.match(/\d+(?:[.,]\d+)?/g) || []).length;
  return numericCount >= 3 && /\b(qty|pcs|nos|kg|rate|amount|price)\b/i.test(line);
}

function splitLines(rawText) {
  return uniqueNonEmpty(String(rawText || "").split(/\n+/).map(cleanLine));
}

function sanitizeInvoiceNumber(value) {
  const candidate = cleanLine(String(value || "").replace(/^[#: -]+/, "").replace(/[,:;]+$/, ""));
  if (!candidate) return "";
  const normalized = normalizeKey(candidate);
  if (INVALID_INVOICE_TOKENS.has(normalized)) return "";
  if (normalized === "show") return "";
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(candidate)) return "";
  if (!/[a-z0-9]/i.test(candidate)) return "";
  return candidate;
}

function isLikelySupplierLine(line) {
  const key = normalizeKey(line);
  if (!key || key.length < 3) return false;
  if (/\b(invoice|tax invoice|bill|original|duplicate|date|phone|mobile|gst|gstin|state|code|email|website)\b/i.test(line)) {
    return false;
  }
  if (looksLikeTableHeader(line) || looksLikeTableRow(line)) return false;
  if (extractAmountCandidates(line).length) return false;
  return /[a-z]/i.test(line);
}

function toDisplayDate(day, month, year) {
  const yyyy = Number(year);
  const mm = Number(month);
  const dd = Number(day);
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return "";
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  return `${String(dd).padStart(2, "0")}-${String(mm).padStart(2, "0")}-${String(yyyy).padStart(4, "0")}`;
}

function toDisplayDateFromMonthName(day, monthName, year) {
  const normalizedMonth = String(monthName || "").trim().toLowerCase();
  const month = MONTH_INDEX[normalizedMonth];
  if (!month) return "";
  return toDisplayDate(day, month, year);
}

function isValidDateString(value) {
  const match = String(value || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return false;
  const [_, dd, mm, yyyy] = match;
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCDate() === Number(dd) && date.getUTCMonth() + 1 === Number(mm);
}

function extractInvoiceNumber(lines, rawText) {
  const strictGlobalPatterns = [
    /\bINVOICE\s*#\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{0,})\b/i,
    /\bINVOICE\s*(?:NO|NUMBER)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{0,})\b/i,
    /\bBILL\s*(?:NO|NUMBER)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{0,})\b/i
  ];

  for (const pattern of strictGlobalPatterns) {
    const match = String(rawText || "").match(pattern);
    const sanitized = sanitizeInvoiceNumber(match?.[1] || "");
    if (sanitized) return sanitized;
  }

  const labelPatterns = [
    /\b(?:invoice\s*(?:no|number|#)|bill\s*(?:no|number|#)|inv\s*(?:no|#))\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/_-]{0,})/i
  ];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of labelPatterns) {
      const match = line.match(pattern);
      const sanitized = sanitizeInvoiceNumber(match?.[1] || "");
      if (sanitized) return sanitized;
    }

    if (/\bINVOICE\s*#\s*DATE\b/i.test(line) || /\bINVOICE\s*(?:NO|NUMBER)\s*[:#-]?\s*DATE\b/i.test(line)) {
      const nextLine = cleanLine(lines[index + 1] || "");
      const nextMatch = nextLine.match(/\b([A-Z0-9][A-Z0-9/_-]{0,})\b(?:\s+\d{1,2}[-/.]\d{1,2}[-/.]\d{4})?/i);
      const sanitized = sanitizeInvoiceNumber(nextMatch?.[1] || "");
      if (sanitized) return sanitized;
    }

    const splitMatch = line.match(/\b(invoice|bill)\b/i);
    if (splitMatch && /(?:no|number|#)/i.test(line)) {
      const tokens = line.split(/\s+/).map((token) => token.replace(/[,:;]/g, "").trim()).filter(Boolean);
      for (let index = 0; index < tokens.length; index += 1) {
        if (!/^invoice|bill$/i.test(tokens[index])) continue;
        for (let next = index + 1; next < Math.min(tokens.length, index + 5); next += 1) {
          const sanitized = sanitizeInvoiceNumber(tokens[next]);
          if (sanitized) return sanitized;
        }
      }
    }
  }

  const fallbackToken = String(rawText || "").match(/\b#\s*([A-Z0-9][A-Z0-9/_-]{0,})\b/);
  return sanitizeInvoiceNumber(fallbackToken?.[1] || "");
}

function extractDate(lines, rawText) {
  const preferredPatterns = [
    /\b(?:invoice\s*date|bill\s*date|date)\s*[:#-]?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/i,
    /\b(?:invoice\s*date|bill\s*date|statement\s*dt|statement\s*date|due\s*date|date)\s*[:#-]?\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/i,
    /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/
  ];

  for (const line of lines) {
    for (const pattern of preferredPatterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const formatted =
        /^[A-Za-z]{3,9}$/.test(match[2] || "")
          ? toDisplayDateFromMonthName(match[1], match[2], match[3])
          : toDisplayDate(match[1], match[2], match[3]);
      if (formatted && isValidDateString(formatted)) return formatted;
    }
  }

  const fallbackNumeric = String(rawText || "").match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);
  if (fallbackNumeric) {
    const formatted = toDisplayDate(fallbackNumeric[1], fallbackNumeric[2], fallbackNumeric[3]);
    if (isValidDateString(formatted)) return formatted;
  }

  const fallbackNamed = String(rawText || "").match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/);
  if (!fallbackNamed) return "";
  const formatted = toDisplayDateFromMonthName(fallbackNamed[1], fallbackNamed[2], fallbackNamed[3]);
  return isValidDateString(formatted) ? formatted : "";
}

function extractSupplier(lines) {
  const directLabel = lines.find((line) => /\b(?:supplier|vendor|bill from)\b\s*[:#-]/i.test(line));
  if (directLabel) {
    const labeledValue = cleanLine(directLabel.replace(/^.*?(supplier|vendor|bill from)\s*[:#-]?\s*/i, ""));
    if (labeledValue) return labeledValue;
  }

  const huesLine = lines.find((line) => /hues\s+granites/i.test(line));
  if (huesLine) {
    const match = huesLine.match(/(HUES\s+GRANITES(?:\s+(?!PO\b)[A-Z]+){0,4})/i);
    if (match?.[1]) return cleanLine(match[1]);
  }

  return lines.find(isLikelySupplierLine) || "";
}

function extractPhone(rawText) {
  const labeledMatch =
    String(rawText || "").match(/\b(?:ph\s*no|phone\s*no|mobile)\s*[:#-]?\s*(\d{10})\b/i) ||
    String(rawText || "").match(/\b(\d{10})\b/);
  return cleanLine(labeledMatch?.[1] || "");
}

function extractContactBlock(lines, phone) {
  if (!phone) return [];
  const phoneIndex = lines.findIndex((line) => line.includes(phone));
  if (phoneIndex < 0) return [];
  const start = Math.max(0, phoneIndex - 3);
  return lines.slice(start, phoneIndex + 1).filter(Boolean);
}

function extractAddressDetails(lines, rawText) {
  const phone = extractPhone(rawText);
  const block = extractContactBlock(lines, phone);
  const joinedBlock = block.join("\n");
  const locationLine =
    block.find((line) => /,\s*[A-Za-z][A-Za-z.\s]+,\s*\d{6}\b/.test(line)) ||
    lines.find((line) => /,\s*[A-Za-z][A-Za-z.\s]+,\s*\d{6}\b/.test(line)) ||
    "";
  const locationMatch = locationLine.match(/([A-Za-z][A-Za-z.\s]+),\s*([A-Za-z][A-Za-z.\s]+)\s*,\s*(\d{6})\b/);
  const city = cleanLine(locationMatch?.[1] || "");
  const state = cleanLine(locationMatch?.[2] || "");

  const addressLines = block
    .filter((line) => {
      const key = normalizeKey(line);
      if (!key) return false;
      if (line.includes(phone)) return false;
      if (/^(westone|consignee|buyer)/i.test(line)) return false;
      return true;
    });

  const address = cleanLine(addressLines.join(", "));
  const country = /\bindia\b/i.test(joinedBlock) || /\bindia\b/i.test(rawText) ? "India" : "";

  return {
    city,
    state,
    address,
    country
  };
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function round3(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;
}

function parseNumber(value) {
  const cleaned = String(value || "").replace(/,/g, "").replace(/[^\d.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = JSON.stringify([item.description, item.qty, item.unit, item.rate, item.tax]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractInvoiceLevelGst(lines) {
  const gstLine = lines.find((line) => /\b[isc]?\s*gst\b/i.test(line) && /%/.test(line));
  const match = gstLine?.match(/(\d+(?:\.\d+)?)\s*%/);
  const rate = Number(match?.[1] || 0);
  return Number.isFinite(rate) ? rate : 0;
}

function parseHuesGranitesItems(lines) {
  const items = [];
  const gstRate = extractInvoiceLevelGst(lines);
  let tableStarted = false;

  for (const line of lines) {
    if (/S\.NO\s+DESCRIPTION OF GOODS/i.test(line)) {
      tableStarted = true;
      continue;
    }
    if (!tableStarted) continue;
    if (/\bSUB TOTAL\b/i.test(line)) break;

    const match = line.match(
      /^\s*(\d+)\s+\d+\s+(.+?)\s+(\d+)\s+(\d+(?:,\d{2,3})*(?:\.\d+)?)\s+(\d+(?:,\d{2,3})*(?:\.\d+)?)\s+(\d+(?:,\d{2,3})*(?:\.\d+)?)\s*$/
    );
    if (!match) continue;

    const description = cleanLine(match[2]);
    const slabCount = parseNumber(match[3]);
    const qtySqm = parseNumber(match[4]);
    const rate = parseNumber(match[5]);
    const amount = parseNumber(match[6]);
    if (!description || !qtySqm || !rate) continue;

    items.push({
      description,
      qty: round3(qtySqm),
      unit: "sqm",
      rate: round2(rate),
      amount: round2(amount || qtySqm * rate),
      tax: gstRate,
      metadata: {
        slabs: slabCount || 0
      }
    });
  }

  return dedupeItems(items);
}

function scoreTotalLine(line, amount, index, totalLineIndexes) {
  const key = normalizeKey(line);
  let score = amount;
  if (/\bgrand total\b/.test(key)) score += 5000;
  if (/\bnet total\b/.test(key)) score += 3500;
  if (/\btotal amount\b/.test(key)) score += 3200;
  if (/\bamount payable\b/.test(key)) score += 3000;
  if (/\btotal\b/.test(key)) score += 2500;
  if (/\bsubtotal\b|\bsub total\b/.test(key)) score -= 4000;
  if (/\b(cgst|sgst|igst|vat|tax|cess|discount|round off|freight|packing|loading|balance)\b/.test(key)) score -= 2500;
  if (looksLikeTableRow(line)) score -= 5000;
  if (/^\s*total\b/i.test(line)) score += 4000;
  score += index * 25;
  if (totalLineIndexes.includes(index)) score += 1000;
  return score;
}

function extractTotal(lines) {
  const candidateLines = [];
  const totalLineIndexes = lines
    .map((line, index) => (/\btotal\b/i.test(line) ? index : -1))
    .filter((index) => index >= 0);

  lines.forEach((line, index) => {
    if (looksLikeTableHeader(line)) return;
    const amounts = extractAmountCandidates(line);
    if (!amounts.length) return;
    amounts.forEach((amount) => {
      candidateLines.push({
        line,
        index,
        amount,
        score: scoreTotalLine(line, amount, index, totalLineIndexes)
      });
    });
  });

  const strongCandidates = candidateLines
    .filter((entry) => entry.amount > 0)
    .sort((left, right) => right.score - left.score || right.index - left.index || right.amount - left.amount);

  if (strongCandidates.length) {
    return formatAmount(strongCandidates[0].amount);
  }

  const fallbackAmounts = lines
    .flatMap((line, index) =>
      extractAmountCandidates(line).map((amount) => ({
        amount,
        index,
        line
      }))
    )
    .filter((entry) => !looksLikeTableRow(entry.line))
    .sort((left, right) => right.index - left.index || right.amount - left.amount);

  return formatAmount(fallbackAmounts[0]?.amount || 0);
}

function parseHuesGranites(lines) {
  const text = lines.join("\n");
  const explicitInvoice = sanitizeInvoiceNumber(
    text.match(/\bINVOICE\s*#\s*([A-Z0-9][A-Z0-9/_-]{0,})\b/i)?.[1] || ""
  );
  const splitInvoiceLineIndex = lines.findIndex((line) => /\bINVOICE\s*#\s*DATE\b/i.test(line));
  const splitInvoiceNumber =
    splitInvoiceLineIndex >= 0
      ? sanitizeInvoiceNumber(
          cleanLine(lines[splitInvoiceLineIndex + 1] || "").match(/\b([A-Z0-9][A-Z0-9/_-]{0,})\b/i)?.[1] || ""
        )
      : "";
  const lastLargeAmount = lines
    .flatMap((line, index) =>
      extractAmountCandidates(line)
        .filter((amount) => amount >= 100)
        .map((amount) => ({ amount, index, line }))
    )
    .filter((entry) => !looksLikeTableRow(entry.line))
    .sort((left, right) => right.index - left.index || right.amount - left.amount)[0];

  return {
    supplier: extractSupplier(lines),
    invoiceNumber: explicitInvoice || splitInvoiceNumber || extractInvoiceNumber(lines, text),
    date: extractDate(lines, text),
    total: formatAmount(lastLargeAmount?.amount || 0) || extractTotal(lines),
    supplierPhone: extractPhone(text),
    items: parseHuesGranitesItems(lines),
    ...extractAddressDetails(lines, text)
  };
}

function extractAirtelStatementReference(lines, fallbackDate) {
  const patterns = [
    /\b(?:account\s*(?:no|number)|customer\s*(?:id|no|number)|relationship\s*(?:no|number)|bill\s*(?:no|number))\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{5,})\b/i,
    /\b(?:your\s*number\s*of\s*connections|service\s*id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{5,})\b/i
  ];
  const text = lines.join("\n");
  for (const pattern of patterns) {
    const direct = sanitizeInvoiceNumber(text.match(pattern)?.[1] || "");
    if (direct) return direct;
  }

  const parsedDate = cleanLine(fallbackDate || "");
  if (/^\d{2}-\d{2}-\d{4}$/.test(parsedDate)) {
    const [dd, mm, yyyy] = parsedDate.split("-");
    return `AIRTEL-${yyyy}${mm}${dd}`;
  }
  return "AIRTEL-STATEMENT";
}

function extractAirtelStatementTotal(lines) {
  const priorityPatterns = [
    /\bthis month'?s charges\b.*?(\d{1,3}(?:,\d{2,3})*(?:\.\d{2})|\d+\.\d{2})\b/i,
    /\btotal\s*\(incl\.?\s*taxes\)\b.*?(\d{1,3}(?:,\d{2,3})*(?:\.\d{2})|\d+\.\d{2})\b/i,
    /\bplan change\b.*?(\d{1,3}(?:,\d{2,3})*(?:\.\d{2})|\d+\.\d{2})\b/i,
    /\bamount payable\b.*?(\d{1,3}(?:,\d{2,3})*(?:\.\d{2})|\d+\.\d{2})\b/i
  ];

  for (const line of lines) {
    for (const pattern of priorityPatterns) {
      const amount = parseNumber(line.match(pattern)?.[1] || "");
      if (amount !== null && amount > 0) return formatAmount(amount);
    }
  }

  return extractTotal(lines);
}

function parseAirtelStatementItems(lines) {
  const items = [];
  let inChargesSection = false;
  const skipAirtelItemLine = (value) =>
    /^(services|service|no\. of connections|plan\/pack charges|other charges|total)$/i.test(value) ||
    /^(taxes\s*\(gst\)|this month'?s charges|last bill amount|total\s*\(incl\.?\s*taxes\)|check invoices for more details)$/i.test(value);
  const isLikelyAirtelServiceDescription = (value) =>
    /\bfiber\b|\bbroadband\b|\bwifi\b|\bwi-fi\b|\bconnection\b|\bairtel black\b/i.test(value);

  for (const line of lines) {
    if (/^this month'?s charges summary\b/i.test(normalizeKey(line))) {
      inChargesSection = true;
      continue;
    }
    if (!inChargesSection) continue;
    if (/^changes this month\b/i.test(normalizeKey(line))) break;
    if (skipAirtelItemLine(cleanLine(line))) {
      continue;
    }

    const match = line.match(
      /^(.+?)\s+(\d+)\s+(\d{1,3}(?:,\d{2,3})*(?:\.\d{2})|\d+\.\d{2})\s+(\d{1,3}(?:,\d{2,3})*(?:\.\d{2})|\d+\.\d{2})\s+(\d{1,3}(?:,\d{2,3})*(?:\.\d{2})|\d+\.\d{2})$/i
    );
    if (!match) continue;

    const description = cleanLine(match[1]);
    const qty = parseNumber(match[2]) || 1;
    const rate = parseNumber(match[3]) || parseNumber(match[5]) || 0;
    const amount = parseNumber(match[5]) || 0;
    if (!description || amount <= 0 || !isLikelyAirtelServiceDescription(description)) continue;

    items.push({
      description,
      qty: round3(qty),
      unit: "service",
      rate: round2(rate),
      amount: round2(amount),
      tax: 0
    });
  }

  if (items.length) {
    return dedupeItems(items);
  }

  for (const line of lines) {
    if (/^this month'?s charges summary\b/i.test(normalizeKey(line))) {
      inChargesSection = true;
      continue;
    }
    if (!inChargesSection) continue;
    if (/^changes this month\b/i.test(normalizeKey(line))) break;

    const normalized = cleanLine(line);
    if (!normalized) continue;
    if (skipAirtelItemLine(normalized)) {
      continue;
    }

    if (isLikelyAirtelServiceDescription(normalized)) {
      const amounts = extractAmountCandidates(normalized);
      const amount = amounts.length ? amounts[amounts.length - 1] : 0;
      const description = cleanLine(
        normalized.replace(/\s+\d+(?:\.\d+)?(?:\s+\d+(?:,\d{2,3})*(?:\.\d{2})?){1,4}\s*$/i, "")
      );
      if (!description) continue;
      items.push({
        description,
        qty: 1,
        unit: "service",
        rate: round2(amount || 0),
        amount: round2(amount || 0),
        tax: 0
      });
    }
  }

  if (items.length) {
    return dedupeItems(items).slice(0, 1);
  }

  return [
    {
      description: "Fiber Monthly Statement",
      qty: 1,
      unit: "service",
      rate: round2(extractAirtelServiceCharge(lines) || parseNumber(extractAirtelStatementTotal(lines)) || 0),
      amount: round2(extractAirtelServiceCharge(lines) || parseNumber(extractAirtelStatementTotal(lines)) || 0),
      tax: 0
    }
  ];
}

function extractAirtelServiceCharge(lines) {
  const preferredLine = lines.find((line) => {
    const normalized = cleanLine(line);
    return /\bfiber\b|\bwifi\b|\bwi-fi\b|\bbroadband\b/i.test(normalized) && !/plan change/i.test(normalized);
  });

  if (preferredLine) {
    const amounts = extractAmountCandidates(preferredLine).filter((amount) => amount > 0);
    if (amounts.length) {
      return amounts[amounts.length - 1];
    }
  }

  const planChangeLine = lines.find((line) => /plan change/i.test(cleanLine(line)));
  if (planChangeLine) {
    const amounts = extractAmountCandidates(planChangeLine).filter((amount) => amount > 0);
    if (amounts.length) {
      return amounts[amounts.length - 1];
    }
  }

  const changeDetailLine = lines.find((line) => /advance rental plan activated/i.test(cleanLine(line)));
  if (changeDetailLine) {
    const amounts = extractAmountCandidates(changeDetailLine).filter((amount) => amount > 0);
    if (amounts.length) {
      return amounts[amounts.length - 1];
    }
  }

  return 0;
}

function parseAirtelStatement(lines) {
  const text = lines.join("\n");
  const date = extractDate(lines, text);
  return {
    supplier: "Airtel",
    invoiceNumber: extractAirtelStatementReference(lines, date),
    date,
    total: extractAirtelStatementTotal(lines),
    supplierPhone: "",
    items: parseAirtelStatementItems(lines),
    city: "",
    state: "",
    address: "",
    country: "India"
  };
}

function isZohoItemRow(line) {
  return /^[A-Z0-9]+(?:[A-Z])?\s+\d+(?:,\d{2,3})*(?:\.\d+)?\s+\d+(?:,\d{2,3})*(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:,\d{2,3})*(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:,\d{2,3})*(?:\.\d+)?\s+\d+(?:,\d{2,3})*(?:\.\d+)?$/i.test(
    cleanLine(line)
  );
}

function parseZohoInvoice(lines) {
  const joinedText = lines.join("\n");
  const labeledDateText = cleanLine(
    joinedText.match(/\bDATE\s*:\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/i)?.[1] || ""
  );
  const invoiceNumber =
    cleanLine(
      joinedText.match(/\bINVOICE#\s*:\s*([A-Z0-9][A-Z0-9/_-]*)\b/i)?.[1] ||
        joinedText.match(/\bINVOICE\s*(?:NO|NUMBER)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]*)\b/i)?.[1] ||
        ""
    ) || extractInvoiceNumber(lines, joinedText);
  const date = labeledDateText
    ? toDisplayDateFromMonthName(
        labeledDateText.match(/^(\d{1,2})\s+/i)?.[1] || "",
        labeledDateText.match(/^\d{1,2}\s+([A-Za-z]{3,9})\s+/i)?.[1] || "",
        labeledDateText.match(/(\d{4})$/)?.[1] || ""
      )
    : extractDate(lines, joinedText);

  const supplier = lines.find((line) => /zoho\s+corporation\s+private\s+limited/i.test(line)) || "ZOHO Corporation Private Limited";
  const supplierPhone = cleanLine(joinedText.match(/\bPhone\s*:\s*([+\d\s-]{8,})/i)?.[1] || extractPhone(joinedText));

  const supplierBlockStart = lines.findIndex((line) => /zoho\s+corporation\s+private\s+limited/i.test(line));
  const supplierBlockEnd = lines.findIndex((line) => /\bphone\s*:/i.test(line));
  const supplierAddress =
    supplierBlockStart >= 0 && supplierBlockEnd > supplierBlockStart
      ? cleanLine(lines.slice(supplierBlockStart + 1, supplierBlockEnd).join(", "))
      : "";

  const items = [];
  const tableHeaderIndex = lines.findIndex((line) => /item\s*&\s*description/i.test(line) && /\bqty\b/i.test(line));
  const summaryIndex = lines.findIndex((line, index) => index > tableHeaderIndex && /\bsub total\b/i.test(line));
  if (tableHeaderIndex >= 0) {
    let index = tableHeaderIndex + 1;
    while (index < lines.length && (summaryIndex < 0 || index < summaryIndex)) {
      const line = cleanLine(lines[index]);
      if (!isZohoItemRow(line)) {
        index += 1;
        continue;
      }

      const rowMatch = line.match(
        /^([A-Z0-9]+(?:[A-Z])?)\s+(\d+(?:,\d{2,3})*(?:\.\d+)?)\s+(\d+(?:,\d{2,3})*(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:,\d{2,3})*(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:,\d{2,3})*(?:\.\d+)?)\s+(\d+(?:,\d{2,3})*(?:\.\d+)?)$/i
      );
      if (!rowMatch) {
        index += 1;
        continue;
      }

      const descriptionLines = [];
      let nextIndex = index + 1;
      while (nextIndex < lines.length) {
        const nextLine = cleanLine(lines[nextIndex]);
        if (!nextLine) {
          nextIndex += 1;
          continue;
        }
        if (isZohoItemRow(nextLine) || /\bsub total\b/i.test(nextLine)) break;
        if (/^sac\s*:/i.test(nextLine)) {
          nextIndex += 1;
          continue;
        }
        if (/^start\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s+end\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/i.test(nextLine)) {
          nextIndex += 1;
          continue;
        }
        descriptionLines.push(nextLine);
        nextIndex += 1;
      }

      const description = cleanLine(descriptionLines.join(" "));
      items.push({
        description: description || rowMatch[1],
        qty: round3(parseNumber(rowMatch[2]) || 0),
        unit: "pcs",
        rate: round2(parseNumber(rowMatch[3]) || 0),
        amount: round2(parseNumber(rowMatch[8]) || 0),
        tax: round2(parseNumber(rowMatch[4]) || 0),
        metadata: {
          itemCode: rowMatch[1]
        }
      });
      index = nextIndex;
    }
  }

  return {
    supplier: cleanLine(supplier),
    invoiceNumber,
    date,
    total: extractTotal(lines),
    supplierPhone,
    items: dedupeItems(items),
    city: "Chennai",
    state: "Tamil Nadu",
    address: supplierAddress,
    country: "India"
  };
}

const VENDOR_PARSERS = [
  {
    id: "hues_granites",
    match: (text) => /hues\s+granites/i.test(text),
    parse: parseHuesGranites
  },
  {
    id: "airtel_statement",
    match: (text) => /\bairtel\b/i.test(text) && /\bfiber monthly statement\b/i.test(text),
    parse: parseAirtelStatement
  },
  {
    id: "zoho_invoice",
    match: (text) => /\bzoho\s+corporation\s+private\s+limited\b/i.test(text) && /\btax\s+invoice\b/i.test(text),
    parse: parseZohoInvoice
  }
];

export function parseInvoiceScan(rawText) {
  const normalizedText = normalizeWhitespace(rawText);
  const lines = splitLines(normalizedText);
  const joinedText = lines.join("\n");
  const vendorParser = VENDOR_PARSERS.find((entry) => entry.match(joinedText));

  const baseResult = {
    invoiceNumber: "",
    date: "",
    supplier: "",
    total: "",
    confidence: 0,
    warnings: [],
    vendorParser: vendorParser?.id || ""
  };

  if (!lines.length) {
    return {
      ...baseResult,
      warnings: ["No readable text was extracted from the document."]
    };
  }

  const vendorResult = vendorParser ? vendorParser.parse(lines) : null;
  const result = {
    invoiceNumber: cleanLine(vendorResult?.invoiceNumber || extractInvoiceNumber(lines, joinedText)),
    date: cleanLine(vendorResult?.date || extractDate(lines, joinedText)),
    supplier: cleanLine(vendorResult?.supplier || extractSupplier(lines)),
    supplierPhone: cleanLine(vendorResult?.supplierPhone || extractPhone(joinedText)),
    city: cleanLine(vendorResult?.city || extractAddressDetails(lines, joinedText).city),
    state: cleanLine(vendorResult?.state || extractAddressDetails(lines, joinedText).state),
    address: cleanLine(vendorResult?.address || extractAddressDetails(lines, joinedText).address),
    country: cleanLine(vendorResult?.country || extractAddressDetails(lines, joinedText).country),
    items: Array.isArray(vendorResult?.items) ? vendorResult.items : [],
    total: cleanLine(vendorResult?.total || extractTotal(lines)),
    confidence: 0,
    warnings: [],
    vendorParser: vendorParser?.id || ""
  };

  let confidence = 0;
  if (result.invoiceNumber) confidence += 25;
  if (result.supplier) confidence += 25;
  if (result.date && isValidDateString(result.date)) confidence += 20;
  if (Number(result.total) > 0) confidence += 30;

  if (!result.invoiceNumber) result.warnings.push("Invoice number could not be detected confidently.");
  if (!result.date || !isValidDateString(result.date)) result.warnings.push("Invoice date could not be validated.");
  if (!result.supplier) result.warnings.push("Supplier name could not be detected confidently.");
  if (!(Number(result.total) > 0)) result.warnings.push("Final total could not be detected confidently.");

  result.confidence = Math.max(0, Math.min(100, confidence));
  return result;
}

export function validateInvoiceScan(parsed) {
  const issues = [];
  if (!parsed?.invoiceNumber) issues.push("invoiceNumber");
  if (!parsed?.supplier) issues.push("supplier");
  if (!parsed?.date || !isValidDateString(parsed.date)) issues.push("date");
  if (!(Number(parsed?.total) > 0)) issues.push("total");
  return {
    valid: issues.length === 0,
    issues
  };
}

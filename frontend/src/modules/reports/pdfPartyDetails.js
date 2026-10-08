import { getParty } from "../parties/store";

function cleanText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolvePdfPartyDetails(input = {}) {
  const party = getParty(input.partyId) || null;
  const name = cleanText(party?.name || input.partyName || input.customerName || input.supplierName || "");
  const address = cleanText(party?.address || input.address || "");
  const phone = cleanText(party?.phone || input.phone || "");
  const email = cleanText(party?.email || input.email || "");

  return {
    name,
    address,
    phone,
    email
  };
}

export function drawPdfPartyDetails(doc, input = {}, options = {}) {
  const x = Number(options.x || 14);
  let y = Number(options.y || 14);
  const maxWidth = Number(options.maxWidth || 80);
  const title = cleanText(options.title || "Party Details");
  const nameLabel = cleanText(options.nameLabel || "Name");
  const details = resolvePdfPartyDetails(input);

  doc.setFontSize(10);
  doc.text(title, x, y);
  y += 5;

  const lines = [];
  if (details.name) lines.push(`${nameLabel}: ${details.name}`);
  if (details.address) lines.push(`Address: ${details.address}`);
  if (details.phone) lines.push(`Phone: ${details.phone}`);
  if (details.email) lines.push(`Email: ${details.email}`);
  if (!lines.length) lines.push(`${nameLabel}: -`);

  doc.setFontSize(9);
  lines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, maxWidth);
    doc.text(wrapped, x, y);
    y += wrapped.length * 4.2;
  });

  return y;
}

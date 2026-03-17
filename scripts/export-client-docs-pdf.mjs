import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = process.cwd();

const DOCUMENTS = [
  {
    input: "CLIENT_QA_SIGNOFF.md",
    output: "CLIENT_QA_SIGNOFF.pdf",
    title: "Client QA Signoff"
  },
  {
    input: "RELEASE_NOTES_CLIENT.md",
    output: "RELEASE_NOTES_CLIENT.pdf",
    title: "Release Notes"
  }
];

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInline(text = "") {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function markdownToHtml(markdown = "") {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let listItems = [];
  let orderedItems = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${formatInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushUnordered = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  const flushOrdered = () => {
    if (!orderedItems.length) return;
    blocks.push(`<ol>${orderedItems.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ol>`);
    orderedItems = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushUnordered();
    flushOrdered();
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushAll();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushAll();
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${formatInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    const unorderedMatch = line.match(/^-\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      flushOrdered();
      listItems.push(unorderedMatch[1]);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      flushUnordered();
      orderedItems.push(orderedMatch[1]);
      continue;
    }

    flushUnordered();
    flushOrdered();
    paragraph.push(line);
  }

  flushAll();
  return blocks.join("\n");
}

function buildHtml({ title, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page {
        size: A4;
        margin: 18mm 16mm 18mm 16mm;
      }

      :root {
        --ink: #172033;
        --muted: #5b667d;
        --line: #d9e1ec;
        --accent: #0f5f46;
        --paper: #ffffff;
        --panel: #f6f8fb;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Segoe UI", Calibri, Arial, sans-serif;
        color: var(--ink);
        background: var(--paper);
        line-height: 1.55;
        font-size: 11.5pt;
      }

      .sheet {
        width: 100%;
      }

      h1 {
        font-size: 24pt;
        line-height: 1.2;
        margin: 0 0 18px;
        color: var(--accent);
        border-bottom: 2px solid var(--line);
        padding-bottom: 10px;
      }

      h2 {
        font-size: 15pt;
        margin: 22px 0 10px;
        color: var(--ink);
      }

      h3 {
        font-size: 12.5pt;
        margin: 16px 0 8px;
        color: var(--ink);
      }

      p {
        margin: 0 0 10px;
      }

      ul, ol {
        margin: 8px 0 12px 20px;
        padding: 0;
      }

      li {
        margin: 0 0 6px;
      }

      strong {
        color: #0f172a;
      }

      code {
        font-family: "Consolas", "Courier New", monospace;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 4px;
        padding: 1px 5px;
        font-size: 10pt;
      }

      .footer {
        margin-top: 24px;
        padding-top: 10px;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 9.5pt;
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      ${body}
      <div class="footer">Prepared for client release communication.</div>
    </main>
  </body>
</html>`;
}

async function exportDocument(browser, doc) {
  const inputPath = path.join(ROOT, doc.input);
  const outputPath = path.join(ROOT, doc.output);
  const markdown = await fs.readFile(inputPath, "utf8");
  const body = markdownToHtml(markdown);
  const html = buildHtml({ title: doc.title, body });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({
    path: outputPath,
    format: "A4",
    printBackground: true,
    margin: {
      top: "18mm",
      right: "16mm",
      bottom: "18mm",
      left: "16mm"
    }
  });
  await page.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const doc of DOCUMENTS) {
      await exportDocument(browser, doc);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

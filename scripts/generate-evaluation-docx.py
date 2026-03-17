from __future__ import annotations

from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "PRODUCTION_READINESS_EVALUATION.docx"


SECTIONS = [
    ("TITLE", "Production Readiness Evaluation"),
    ("SUBTITLE", f"Billing App Assessment - {date.today().isoformat()}"),
    (
        "HEADING1",
        "Overall Evaluation",
    ),
    (
        "PARAGRAPH",
        "The system is performing well in the core workflows that were tested and fixed. "
        "It is suitable for real local business use in the verified scope, but it is not yet "
        "complete enough to be described as fully ready for every international or compliance-heavy billing scenario.",
    ),
    (
        "PARAGRAPH",
        "The main business flows now work correctly in the tested environment: Sales Invoice, Sales Proforma, "
        "Purchase Bill, Payment In, Payment Out, Reports, Backup, Settings, and core navigation. "
        "However, some areas still need strengthening before a broader international production rollout.",
    ),
    ("HEADING1", "Core Business Readiness"),
    (
        "HEADING2",
        "Invoice, Proforma, Purchase, and Payments",
    ),
    (
        "BULLET",
        "Sales Invoice flow is working correctly in the tested scenarios.",
    ),
    (
        "BULLET",
        "Sales Proforma flow is working correctly, including payment application and conversion to invoice.",
    ),
    (
        "BULLET",
        "Purchase Bill flow is working correctly in the tested scenarios.",
    ),
    (
        "BULLET",
        "Payment In and Payment Out flows are working correctly, including allocation and advance handling.",
    ),
    (
        "PARAGRAPH",
        "Conclusion: the core transaction workflows are ready for normal operational use in the validated scope.",
    ),
    ("HEADING2", "Reports and Totals"),
    (
        "BULLET",
        "Reports and export features passed the tested workflows.",
    ),
    (
        "BULLET",
        "The corrected proforma paid and balance logic is now consistent with payment application behavior.",
    ),
    (
        "BULLET",
        "Existing automated tax, validation, and FIFO/profit tests also passed.",
    ),
    (
        "PARAGRAPH",
        "Conclusion: totals and reporting appear reliable for the tested cases, but they are not yet proven across every possible real-world combination of tax, currency, and data volume.",
    ),
    ("HEADING2", "Financial Calculation Risk"),
    (
        "PARAGRAPH",
        "Risk is low for the tested local workflows. Residual risk remains for untested combinations, especially broader international use, mixed-currency operation, and country-specific tax edge cases.",
    ),
    ("HEADING1", "Missing Features or Limitations"),
    ("HEADING2", "Multi-Currency Support"),
    (
        "PARAGRAPH",
        "Multi-currency support is only partial. The system stores currencies and can display currency context, "
        "but it does not yet behave like a full multi-currency accounting system with strong exchange-rate handling, "
        "foreign receivable/payable control, and comprehensive currency-aware reporting.",
    ),
    ("HEADING2", "Tax / GST / VAT Handling"),
    (
        "PARAGRAPH",
        "India GST support is the strongest area. VAT and sales-tax support exist, but more validation is needed before treating the system as broadly compliant for multiple international jurisdictions.",
    ),
    ("HEADING2", "PDF Invoice Generation"),
    (
        "PARAGRAPH",
        "PDF and print-related document generation is present and usable. This area is not missing and is suitable for normal operational use.",
    ),
    ("HEADING2", "User Roles and Permissions"),
    (
        "PARAGRAPH",
        "Role-based access is present for Owner, Accounter, and Staff. The permissions are appropriate for a small-to-medium business system, but they are not yet at enterprise-grade segregation and approval depth.",
    ),
    ("HEADING2", "Backup and Restore"),
    (
        "PARAGRAPH",
        "Backup and restore features are present and working. They are suitable for operational protection, but they should not be treated as a complete enterprise disaster-recovery solution without further hardening.",
    ),
    ("HEADING1", "Reliability and Safety"),
    ("HEADING2", "Edge Cases Still Risky"),
    (
        "BULLET",
        "Untested report combinations with larger real-world datasets.",
    ),
    (
        "BULLET",
        "Mixed-currency invoicing and reporting scenarios.",
    ),
    (
        "BULLET",
        "Country-specific tax exceptions outside the currently modeled flows.",
    ),
    (
        "BULLET",
        "Operational risk if used in local/demo storage mode instead of a properly configured backend.",
    ),
    ("HEADING2", "Data Loss or Incorrect Calculation Possibility"),
    (
        "PARAGRAPH",
        "There is no active known defect in the tested core flows. However, if the system is used without a proper backend configuration, or used for advanced international accounting scenarios beyond current coverage, there is still meaningful risk of incomplete operational handling.",
    ),
    ("HEADING1", "Final Recommendation"),
    ("HEADING2", "Local Business Use"),
    (
        "PARAGRAPH",
        "Yes. With the backend properly configured, the system is ready for local business production use in the tested core workflow scope.",
    ),
    ("HEADING2", "International Clients"),
    (
        "PARAGRAPH",
        "Not fully yet. It is acceptable only for simpler single-country or single-primary-currency usage where the implemented tax logic matches the client's operating model. It is not yet recommended as a fully mature international billing platform.",
    ),
    ("HEADING2", "Recommended Before Wider Production Release"),
    (
        "BULLET",
        "Strengthen true multi-currency document and reporting support.",
    ),
    (
        "BULLET",
        "Expand international tax validation and jurisdiction-specific testing.",
    ),
    (
        "BULLET",
        "Add larger dataset reconciliation tests for reports and totals.",
    ),
    (
        "BULLET",
        "Further strengthen backup, recovery, and operational safeguards for multi-client deployment.",
    ),
    ("HEADING2", "Final Decision"),
    (
        "PARAGRAPH",
        "Ready for local production use: Yes. Ready for broad international production use: Not yet. "
        "The correct next step before wider release is to improve multi-currency depth and international tax/reporting coverage.",
    ),
]


def paragraph_xml(text: str, style: str | None = None) -> str:
    escaped = escape(text)
    if style:
        return (
            f"<w:p><w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>"
            f"<w:r><w:t xml:space=\"preserve\">{escaped}</w:t></w:r></w:p>"
        )
    return f"<w:p><w:r><w:t xml:space=\"preserve\">{escaped}</w:t></w:r></w:p>"


def build_document_xml() -> str:
    body_parts: list[str] = []
    for kind, text in SECTIONS:
        if kind == "TITLE":
            body_parts.append(paragraph_xml(text, "Title"))
        elif kind == "SUBTITLE":
            body_parts.append(paragraph_xml(text, "Subtitle"))
        elif kind == "HEADING1":
            body_parts.append(paragraph_xml(text, "Heading1"))
        elif kind == "HEADING2":
            body_parts.append(paragraph_xml(text, "Heading2"))
        elif kind == "BULLET":
            body_parts.append(paragraph_xml(f"• {text}", None))
        else:
            body_parts.append(paragraph_xml(text, None))

    body_parts.append("<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/></w:sectPr>")
    body = "".join(body_parts)
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:v="urn:schemas-microsoft-com:vml"
 xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:w10="urn:schemas-microsoft-com:office:word"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
 xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
 xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
 xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
 xmlns:wne="http://schemas.microsoft.com/office/2006/wordml"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
 mc:Ignorable="w14 w15 wp14">
  <w:body>{body}</w:body>
</w:document>"""


def build_styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:sz w:val="22"/>
      <w:szCs w:val="22"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:color w:val="0F5F46"/>
      <w:sz w:val="36"/>
      <w:szCs w:val="36"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:color w:val="666666"/>
      <w:sz w:val="22"/>
      <w:szCs w:val="22"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:color w:val="1F2937"/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:color w:val="374151"/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
    </w:rPr>
  </w:style>
</w:styles>"""


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""


ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""


DOCUMENT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""


CORE_XML = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Production Readiness Evaluation</dc:title>
  <dc:creator>OpenAI Codex</dc:creator>
  <cp:lastModifiedBy>OpenAI Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{date.today().isoformat()}T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{date.today().isoformat()}T00:00:00Z</dcterms:modified>
</cp:coreProperties>"""


APP_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Office Word</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <Company></Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>"""


def main() -> None:
    with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", CONTENT_TYPES)
        docx.writestr("_rels/.rels", ROOT_RELS)
        docx.writestr("word/document.xml", build_document_xml())
        docx.writestr("word/styles.xml", build_styles_xml())
        docx.writestr("word/_rels/document.xml.rels", DOCUMENT_RELS)
        docx.writestr("docProps/core.xml", CORE_XML)
        docx.writestr("docProps/app.xml", APP_XML)


if __name__ == "__main__":
    main()

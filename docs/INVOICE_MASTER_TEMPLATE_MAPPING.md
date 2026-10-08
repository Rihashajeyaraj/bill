# Invoice Master Template Mapping: PDF → Database → API → React UI

**Document Version:** 1.0.0  
**Audit Date:** October 6, 2026  
**Master Template Source:** `I031066_TI.pdf` (Allcargo Global Limited Billing Format)  
**Scope:** Comprehensive schema design, API contract, and template rendering mapping for Pro Forma Invoices and Tax Invoices.

---

## 1. Architecture & System Flow

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   FASTAPI BACKEND                                      │
│                                                                                        │
│  [ Input Request ] ──> [ GST Calculation Engine ] ──> [ Num2Words Engine ]             │
│                                │                                                       │
│                                ├──> Calculates: Line totals, ROE conversion, Tax totals│
│                                ├──> Generates: Invoice / Pro Forma Numbering, IRN, QR  │
│                                └──> Formats: Amount in Words, Bank & Logistics Payload │
└───────────────────────────┬────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌───────────────────────────┐   ┌────────────────────────────────────────────────────────┐
│    SUPABASE DATABASE      │   │                  REACT FRONTEND UI                     │
│  (PostgreSQL Multi-Tenant)│   │                                                        │
│  - `organizations`        │   │  [ API Response ] ──> [ Master Template Renderer ]     │
│  - `parties`              │   │                           - Render exact PDF layout    │
│  - `invoices`             │   │                           - Print & PDF download engine│
│  - `proforma_invoices`    │   │                           - Zero hardcoded business data│
└───────────────────────────┘   └────────────────────────────────────────────────────────┘
```

---

## 2. Comprehensive Field Mapping Matrix

### 2.1. Company / Biller Details (Header Section)

| PDF Template Field | Database Table | Database Column | API Field (JSON) | React Template Field |
| :--- | :--- | :--- | :--- | :--- |
| **Biller Name** | `organizations` | `company_name` | `company.name` | `company_name` |
| **Biller Address** | `organizations` | `address_line1`, `address_line2`, `city`, `postal_code` | `company.address` | `company_address` |
| **Biller State & Code**| `organizations` | `state_name`, `state_code` | `company.state`, `company.state_code` | `company_state` |
| **Biller Country** | `organizations` | `country_code` | `company.country` | `company_country` |
| **Biller Phone** | `organizations` | `phone` | `company.phone` | `company_phone` |
| **Biller PAN** | `organizations` | `pan` | `company.pan` | `company_pan` |
| **Biller IEC No** | `organizations` | `iec_number` | `company.iec_number` | `company_iec` |
| **Biller GSTIN / GSTN**| `organizations` | `gstin` | `company.gstin` | `company_gstin` |
| **Biller CIN No** | `organizations` | `cin` | `company.cin` | `company_cin` |
| **Biller Logo** | `organizations` | `logo_base64` / `logo_url` | `company.logo_url` | `company_logo` |
| **QR Code Data** | `invoices` | `qr_code_data` | `qr_code_data` | `qr_code_image` |

---

### 2.2. Document & Invoice Header Metadata

| PDF Template Field | Database Table | Database Column | API Field (JSON) | React Template Field |
| :--- | :--- | :--- | :--- | :--- |
| **Document Title** | Computed | N/A (`"TAX INVOICE"` or `"PRO FORMA INVOICE"`) | `document_type` | `document_title` |
| **IRN No** | `invoices` | `irn_number` | `irn_number` | `irn_no` |
| **Invoice / ProForma No**| `invoices` / `proforma_invoices` | `invoice_no` / `proforma_no` | `invoice_no` | `invoice_no` |
| **Date** | `invoices` / `proforma_invoices` | `invoice_date` / `proforma_date` | `invoice_date` | `invoice_date` |
| **House BL (BL)** | `invoices` / `proforma_invoices` | `bl_number` | `bl_number` | `bl_number` |
| **Through BL (ThBL)** | `invoices` / `proforma_invoices` | `thbl_number` | `thbl_number` | `thbl_number` |
| **Master BL (MBL)** | `invoices` / `proforma_invoices` | `mbl_number` | `mbl_number` | `mbl_number` |
| **Customer Reference** | `invoices` / `proforma_invoices` | `customer_ref` | `customer_ref` | `customer_ref` |

---

### 2.3. Customer / Billed-To Details

| PDF Template Field | Database Table | Database Column | API Field (JSON) | React Template Field |
| :--- | :--- | :--- | :--- | :--- |
| **Customer Name** | `parties` | `display_name` / `legal_name` | `customer.name` | `customer_name` |
| **Customer Address** | `parties` | `billing_address_line1`, `billing_address_line2`, `city`, `postal_code` | `customer.address` | `customer_address` |
| **Customer State & Code**| `parties` | `state_name`, `state_code` | `customer.state`, `customer.state_code` | `customer_state` |
| **Customer Country** | `parties` | `country_code` | `customer.country` | `customer_country` |
| **Customer GSTIN** | `parties` | `gstin` | `customer.gstin` | `customer_gstin` |

---

### 2.4. Shipment & Logistics Parameters

| PDF Template Field | Database Table | Database Column | API Field (JSON) | React Template Field |
| :--- | :--- | :--- | :--- | :--- |
| **Shipper Name** | `invoices` / `proforma_invoices` | `shipper_name` | `shipper_name` | `shipper_name` |
| **Consignee Name** | `invoices` / `proforma_invoices` | `consignee_name` | `consignee_name` | `consignee_name` |
| **Origin** | `invoices` / `proforma_invoices` | `origin` | `origin` | `origin` |
| **Destination** | `invoices` / `proforma_invoices` | `destination` | `destination` | `destination` |
| **Packs / Quantity** | `invoices` / `proforma_invoices` | `packs_qty` | `packs_qty` | `packs_qty` |
| **Weight (Kgs)** | `invoices` / `proforma_invoices` | `weight_kgs` | `weight_kgs` | `weight_kgs` |
| **Volume (CBM)** | `invoices` / `proforma_invoices` | `volume_cbm` | `volume_cbm` | `volume_cbm` |
| **Freight Terms** | `invoices` / `proforma_invoices` | `freight_terms` | `freight_terms` | `freight_terms` |
| **Rate of Exchange (ROE)**| `invoices` / `proforma_invoices` | `exchange_rate` | `exchange_rate` | `roe` |
| **Currency Symbol/Code**| `invoices` / `proforma_invoices` | `currency_code` | `currency_code` | `currency_code` |
| **Vessel** | `invoices` / `proforma_invoices` | `vessel_name` | `vessel_name` | `vessel` |
| **Voyage No** | `invoices` / `proforma_invoices` | `voyage_no` | `voyage_no` | `voyage_no` |
| **Ocean BL No** | `invoices` / `proforma_invoices` | `ocean_bl_no` | `ocean_bl_no` | `ocean_bl_no` |
| **ETD Date** | `invoices` / `proforma_invoices` | `etd_date` | `etd_date` | `etd` |
| **ETA Date** | `invoices` / `proforma_invoices` | `eta_date` | `eta_date` | `eta` |
| **IGM No & Date** | `invoices` / `proforma_invoices` | `igm_no` | `igm_no` | `igm_no` |
| **Item No** | `invoices` / `proforma_invoices` | `igm_item_no` | `igm_item_no` | `item_no` |
| **File No** | `invoices` / `proforma_invoices` | `file_no` | `file_no` | `file_no` |
| **Sales Rep** | `invoices` / `proforma_invoices` | `sales_rep` | `sales_rep` | `sales_rep` |
| **Reverse Charge (RCM)** | `invoices` / `proforma_invoices` | `rcm_applicable` | `rcm_applicable` | `rcm` |
| **Container & Vehicle No**| `invoices` / `proforma_invoices` | `container_details` | `container_details` | `container_details` |
| **Remarks** | `invoices` / `proforma_invoices` | `notes` | `notes` | `remarks` |

---

### 2.5. Line Items Table

| PDF Template Field | Database Table | Database Column | API Field (JSON) | React Template Field |
| :--- | :--- | :--- | :--- | :--- |
| **Line No (No)** | `invoice_items` / `proforma_invoice_items` | `line_no` | `line_no` | `no` |
| **Description** | `invoice_items` / `proforma_invoice_items` | `description` | `description` | `description` |
| **SAC / HSN** | `invoice_items` / `proforma_invoice_items` | `hsn_sac` | `hsn_sac` | `sac` |
| **CGST Rate %** | `invoice_items` / `proforma_invoice_items` | `cgst_rate` | `cgst_rate` | `cgst_rate` |
| **TNGST / SGST Rate %** | `invoice_items` / `proforma_invoice_items` | `sgst_rate` | `sgst_rate` | `sgst_rate` |
| **IGST Rate %** | `invoice_items` / `proforma_invoice_items` | `igst_rate` | `igst_rate` | `igst_rate` |
| **Place of Supply** | `invoice_items` / `proforma_invoice_items` | `place_of_supply` | `place_of_supply` | `place_of_supply` |
| **Currency** | `invoice_items` / `proforma_invoice_items` | `currency` | `currency` | `curr` |
| **Per Unit (Foreign/Base Rate)**| `invoice_items` / `proforma_invoice_items` | `unit_price` | `unit_price` | `per_unit` |
| **Unit / Qty** | `invoice_items` / `proforma_invoice_items` | `qty` | `qty` | `unit` |
| **Amount in INR** | `invoice_items` / `proforma_invoice_items` | `amount_inr` | `amount_inr` | `amount_inr` |
| **Taxable Amount** | `invoice_items` / `proforma_invoice_items` | `taxable_amount` | `taxable_amount` | `taxable_amount` |
| **GST Total (Line GST)** | `invoice_items` / `proforma_invoice_items` | `tax_amount` | `tax_amount` | `gst_total` |

---

### 2.6. Financial Summary & Totals

| PDF Template Field | Database Table | Database Column | API Field (JSON) | React Template Field |
| :--- | :--- | :--- | :--- | :--- |
| **Total Amount in INR** | `invoices` / `proforma_invoices` | `subtotal` | `subtotal` | `total_inr` |
| **Total Before Tax** | `invoices` / `proforma_invoices` | `taxable_total` | `taxable_total` | `total_before_tax` |
| **CGST Total** | `invoices` / `proforma_invoices` | `cgst_total` | `cgst_total` | `cgst_total` |
| **TNGST / SGST Total** | `invoices` / `proforma_invoices` | `sgst_total` | `sgst_total` | `sgst_total` |
| **IGST Total** | `invoices` / `proforma_invoices` | `igst_total` | `igst_total` | `igst_total` |
| **Total After Tax** | `invoices` / `proforma_invoices` | `grand_total` | `grand_total` | `total_after_tax` |
| **Amount in Words** | Computed by Backend | N/A (`num2words(grand_total)`) | `grand_total_in_words` | `amount_in_words` |
| **TDS Note** | Hardcoded/Setting | `company_settings.tds_note` | `tds_note` | `tds_note` |

---

### 2.7. Footer & Legal Disclaimers

| PDF Template Field | Database Table | Database Column | API Field (JSON) | React Template Field |
| :--- | :--- | :--- | :--- | :--- |
| **Terms & Conditions** | `invoices` / `company_settings` | `terms` | `terms` | `terms` |
| **Bank Account Name** | `company_settings` / `organizations` | `bank_account_name` | `bank_details.account_name` | `bank_account_name` |
| **Bank Name** | `company_settings` / `organizations` | `bank_name` | `bank_details.bank_name` | `bank_name` |
| **Bank Address** | `company_settings` / `organizations` | `bank_address` | `bank_details.address` | `bank_address` |
| **Bank Account No** | `company_settings` / `organizations` | `bank_account_no` | `bank_details.account_no` | `bank_account_no` |
| **Bank IFSC Code** | `company_settings` / `organizations` | `bank_ifsc` | `bank_details.ifsc` | `bank_ifsc` |
| **Payment Modes Statement**| `company_settings` | `payment_modes_text` | `payment_modes_text` | `payment_modes_text` |
| **E. & O.E** | Hardcoded | Constant | `e_and_oe` | `e_and_oe` |
| **System Generated Note** | Hardcoded | Constant | `system_generated_note` | `system_generated_note` |
| **Authorized Signatory Header**| `organizations` | `company_name` | `company.name` | `authorized_signatory_title` |

---

## 3. Field Properties & Classification Matrix

| Field Name | Category | Applicable Scope | Origin / Authority | Requirement Level |
| :--- | :--- | :--- | :--- | :--- |
| `document_type` | Document Metadata | Both (Pro Forma / Tax) | Backend Generated | Mandatory |
| `invoice_no` / `proforma_no` | Document Metadata | Both (PI / INV) | Backend Generated | Mandatory |
| `invoice_date` | Document Metadata | Both | User Input / Default Today | Mandatory |
| `irn_number` | e-Invoice | Tax Invoice Only | Backend / e-Way API | Optional |
| `qr_code_data` | e-Invoice | Tax Invoice Only | Backend / e-Way API | Optional |
| `customer_id` | Master Data | Both | User Input | Mandatory |
| `shipper_name` | Logistics | Both | User Input | Optional |
| `consignee_name` | Logistics | Both | User Input | Optional |
| `origin` | Logistics | Both | User Input | Optional |
| `destination` | Logistics | Both | User Input | Optional |
| `packs_qty` | Logistics | Both | User Input | Optional |
| `weight_kgs` | Logistics | Both | User Input | Optional |
| `volume_cbm` | Logistics | Both | User Input | Optional |
| `freight_terms` | Logistics | Both | User Input | Optional ("Collect" / "Prepaid") |
| `exchange_rate` (ROE) | Forex | Both | User Input / Default 1.0 | Mandatory |
| `vessel_name` | Shipping | Both | User Input | Optional |
| `voyage_no` | Shipping | Both | User Input | Optional |
| `ocean_bl_no` | Shipping | Both | User Input | Optional |
| `bl_number` | Shipping | Both | User Input | Optional |
| `etd_date` / `eta_date` | Shipping | Both | User Input | Optional |
| `igm_no` / `igm_item_no` | Customs | Both | User Input | Optional |
| `file_no` / `sales_rep` | Sales Ops | Both | User Input | Optional |
| `rcm_applicable` | GST Compliance | Tax Invoice Only | User Input | Optional (Y/N) |
| `container_details` | Logistics | Both | User Input | Optional |
| `items[].qty` | Financial Line | Both | User Input | Mandatory |
| `items[].unit_price` | Financial Line | Both | User Input | Mandatory |
| `items[].tax_rate` | GST | Both | User Input / Item Master | Mandatory |
| `items[].cgst_amount` | GST Breakdown | Both | Backend Calculated | Mandatory |
| `items[].sgst_amount` | GST Breakdown | Both | Backend Calculated | Mandatory |
| `items[].igst_amount` | GST Breakdown | Both | Backend Calculated | Mandatory |
| `items[].taxable_amount` | Financial Summary | Both | Backend Calculated | Mandatory |
| `items[].line_total` | Financial Summary | Both | Backend Calculated | Mandatory |
| `subtotal` | Document Summary | Both | Backend Calculated | Mandatory |
| `taxable_total` | Document Summary | Both | Backend Calculated | Mandatory |
| `cgst_total` | Document Summary | Both | Backend Calculated | Mandatory |
| `sgst_total` | Document Summary | Both | Backend Calculated | Mandatory |
| `igst_total` | Document Summary | Both | Backend Calculated | Mandatory |
| `grand_total` | Document Summary | Both | Backend Calculated | Mandatory |
| `grand_total_in_words` | Verbal Representation | Both | Backend Generated | Mandatory |

---

## 4. Proposed Database Schema Enhancements

To support all logistics and template fields from `I031066_TI.pdf`, the following columns will be added to the Supabase schema in a clean, non-destructive migration:

### 4.1. `organizations` / `company_settings` Additions:
```sql
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS iec_number text,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_address text,
  ADD COLUMN IF NOT EXISTS bank_account_no text,
  ADD COLUMN IF NOT EXISTS bank_ifsc text;
```

### 4.2. `invoices` & `proforma_invoices` Additions:
```sql
-- Logistics and Master Template metadata for invoices & proforma_invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS irn_number text,
  ADD COLUMN IF NOT EXISTS qr_code_data text,
  ADD COLUMN IF NOT EXISTS bl_number text,
  ADD COLUMN IF NOT EXISTS thbl_number text,
  ADD COLUMN IF NOT EXISTS mbl_number text,
  ADD COLUMN IF NOT EXISTS customer_ref text,
  ADD COLUMN IF NOT EXISTS shipper_name text,
  ADD COLUMN IF NOT EXISTS consignee_name text,
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS destination text,
  ADD COLUMN IF NOT EXISTS packs_qty text,
  ADD COLUMN IF NOT EXISTS weight_kgs numeric(14,3),
  ADD COLUMN IF NOT EXISTS volume_cbm numeric(14,3),
  ADD COLUMN IF NOT EXISTS freight_terms text DEFAULT 'Collect',
  ADD COLUMN IF NOT EXISTS vessel_name text,
  ADD COLUMN IF NOT EXISTS voyage_no text,
  ADD COLUMN IF NOT EXISTS ocean_bl_no text,
  ADD COLUMN IF NOT EXISTS etd_date date,
  ADD COLUMN IF NOT EXISTS eta_date date,
  ADD COLUMN IF NOT EXISTS igm_no text,
  ADD COLUMN IF NOT EXISTS igm_item_no text,
  ADD COLUMN IF NOT EXISTS file_no text,
  ADD COLUMN IF NOT EXISTS sales_rep text,
  ADD COLUMN IF NOT EXISTS rcm_applicable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS container_details text;

-- Mirror columns on proforma_invoices
ALTER TABLE public.proforma_invoices
  ADD COLUMN IF NOT EXISTS bl_number text,
  ADD COLUMN IF NOT EXISTS thbl_number text,
  ADD COLUMN IF NOT EXISTS mbl_number text,
  ADD COLUMN IF NOT EXISTS customer_ref text,
  ADD COLUMN IF NOT EXISTS shipper_name text,
  ADD COLUMN IF NOT EXISTS consignee_name text,
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS destination text,
  ADD COLUMN IF NOT EXISTS packs_qty text,
  ADD COLUMN IF NOT EXISTS weight_kgs numeric(14,3),
  ADD COLUMN IF NOT EXISTS volume_cbm numeric(14,3),
  ADD COLUMN IF NOT EXISTS freight_terms text DEFAULT 'Collect',
  ADD COLUMN IF NOT EXISTS vessel_name text,
  ADD COLUMN IF NOT EXISTS voyage_no text,
  ADD COLUMN IF NOT EXISTS ocean_bl_no text,
  ADD COLUMN IF NOT EXISTS etd_date date,
  ADD COLUMN IF NOT EXISTS eta_date date,
  ADD COLUMN IF NOT EXISTS igm_no text,
  ADD COLUMN IF NOT EXISTS igm_item_no text,
  ADD COLUMN IF NOT EXISTS file_no text,
  ADD COLUMN IF NOT EXISTS sales_rep text,
  ADD COLUMN IF NOT EXISTS rcm_applicable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS container_details text;
```

---

## 5. Number-to-Words Python Implementation Specs

FastAPI will compute the Indian numbering format words (Lakhs & Crores) for `grand_total`.

**Example Output:**  
Input: `67157.27`  
Output: `SIXTY-SEVEN THOUSAND ONE HUNDRED FIFTY-SEVEN AND TWENTY-SEVEN ONLY`

---

## 6. Next Steps & Confirmation

This mapping document has been saved to [`docs/INVOICE_MASTER_TEMPLATE_MAPPING.md`](file:///c:/Users/RIHASHA/OneDrive/Desktop/bill/docs/INVOICE_MASTER_TEMPLATE_MAPPING.md).

Please review the field mappings and proposed database schema additions above. Once confirmed, I will:
1. Apply the non-destructive SQL migrations to Supabase.
2. Update FastAPI Pydantic schemas, calculation engines, and service payloads.
3. Update the React invoice rendering component to mirror the exact `I031066_TI.pdf` layout.

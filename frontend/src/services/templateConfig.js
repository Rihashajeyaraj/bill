export const TEMPLATE_FIELD_CONFIGS = {
  new_globe_export: {
    sections: {
      invoiceDetails: true,
      customerDetails: true,
      shipmentLogistics: true,
      shippingDetails: true,
      operationsCustoms: true,
      lineItems: true,
      notesTerms: true
    },
    fields: {
      place_of_supply_state: true,
      customer_gstin: true,
      shipper_name: true,
      consignee_name: true,
      origin: true,
      destination: true,
      packs_qty: true,
      weight_kgs: true,
      volume_cbm: true,
      freight_terms: true,
      mbl_number: true,
      thbl_number: true,
      bl_number: true,
      ocean_bl_no: true,
      vessel_name: true,
      voyage_no: true,
      etd_date: true,
      eta_date: true,
      igm_no: true,
      igm_item_no: true,
      file_no: true,
      sales_rep: true,
      rcm_applicable: true,
      container_details: true,
      cgst_rate: true,
      sgst_rate: true,
      igst_rate: true
    }
  },
  anvase_exim_import: {
    sections: {
      invoiceDetails: true,
      customerDetails: true,
      shipmentLogistics: true,
      shippingDetails: true,
      operationsCustoms: true,
      lineItems: true,
      notesTerms: true
    },
    fields: {
      place_of_supply_state: true,
      customer_gstin: true,
      shipper_name: true,
      consignee_name: true,
      origin: true,
      destination: true,
      packs_qty: true,
      weight_kgs: true,
      volume_cbm: true,
      freight_terms: true,
      mbl_number: true,
      thbl_number: true,
      bl_number: true,
      ocean_bl_no: true,
      vessel_name: true,
      voyage_no: true,
      etd_date: true,
      eta_date: true,
      igm_no: true,
      igm_item_no: true,
      file_no: true,
      sales_rep: true,
      rcm_applicable: true,
      container_details: true,
      cgst_rate: true,
      sgst_rate: true,
      igst_rate: true
    }
  },
  uprichard_international: {
    sections: {
      invoiceDetails: true,
      customerDetails: true,
      shipmentLogistics: true,
      shippingDetails: false,
      operationsCustoms: false,
      lineItems: true,
      notesTerms: true
    },
    fields: {
      place_of_supply_state: false,
      customer_gstin: false,
      shipper_name: true,
      consignee_name: true,
      origin: true,
      destination: true,
      packs_qty: true,
      weight_kgs: true,
      volume_cbm: true,
      freight_terms: true,
      mbl_number: false,
      thbl_number: false,
      bl_number: false,
      ocean_bl_no: false,
      vessel_name: false,
      voyage_no: false,
      etd_date: false,
      eta_date: false,
      igm_no: false,
      igm_item_no: false,
      file_no: false,
      sales_rep: false,
      rcm_applicable: false,
      container_details: false,
      cgst_rate: false,
      sgst_rate: false,
      igst_rate: true
    }
  },
  pga_shipping_draft: {
    sections: {
      invoiceDetails: true,
      customerDetails: true,
      shipmentLogistics: true,
      shippingDetails: true,
      operationsCustoms: true,
      lineItems: true,
      notesTerms: true
    },
    fields: {
      place_of_supply_state: true,
      customer_gstin: true,
      shipper_name: true,
      consignee_name: true,
      origin: true,
      destination: true,
      packs_qty: true,
      weight_kgs: true,
      volume_cbm: true,
      freight_terms: true,
      mbl_number: true,
      thbl_number: true,
      bl_number: true,
      ocean_bl_no: true,
      vessel_name: true,
      voyage_no: true,
      etd_date: true,
      eta_date: true,
      igm_no: true,
      igm_item_no: true,
      file_no: true,
      sales_rep: true,
      rcm_applicable: true,
      container_details: true,
      cgst_rate: true,
      sgst_rate: true,
      igst_rate: true
    }
  }
};

export const DEFAULT_TEMPLATE_CONFIG = TEMPLATE_FIELD_CONFIGS.new_globe_export;

export function getTemplateConfig(templateKey) {
  if (!templateKey) return DEFAULT_TEMPLATE_CONFIG;
  const normalizedKey = String(templateKey || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (TEMPLATE_FIELD_CONFIGS[normalizedKey]) {
    return TEMPLATE_FIELD_CONFIGS[normalizedKey];
  }
  return DEFAULT_TEMPLATE_CONFIG;
}

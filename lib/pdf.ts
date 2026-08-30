/**
 * lib/pdf.ts
 * Server-side PDF processing using pdf-lib.
 * Extracts AcroForm fields from uploaded PDF files.
 */
import { PDFDocument, PDFField, PDFTextField, PDFRadioGroup, PDFCheckBox, PDFDropdown, PDFOptionList } from "pdf-lib";
import type { FormField, FieldType } from "./types";
import { resolveMemoryKey } from "./memory-keys";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function inferSection(fieldName: string, index: number): string {
  const lower = fieldName.toLowerCase();
  if (lower.includes("name") || lower.includes("dob") || lower.includes("birth") || lower.includes("gender") || lower.includes("nationality")) {
    return "Personal Information";
  }
  if (lower.includes("address") || lower.includes("phone") || lower.includes("email") || lower.includes("mobile") || lower.includes("contact")) {
    return "Contact Details";
  }
  if (lower.includes("occupation") || lower.includes("employ") || lower.includes("income") || lower.includes("salary") || lower.includes("company")) {
    return "Employment Information";
  }
  if (lower.includes("passport") || lower.includes("document") || lower.includes("issue") || lower.includes("expire") || lower.includes("visa")) {
    return "Document Details";
  }
  if (lower.includes("sign") || lower.includes("declare") || lower.includes("agree") || lower.includes("date")) {
    return "Declaration";
  }
  // Group remaining fields into buckets of 4
  const bucket = Math.floor(index / 4) + 1;
  return `Section ${bucket}`;
}

function getFieldType(field: PDFField): FieldType {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return "dropdown";
  return "text";
}

function getFieldOptions(field: PDFField): string[] | undefined {
  if (field instanceof PDFRadioGroup) {
    return field.getOptions();
  }
  if (field instanceof PDFDropdown) {
    return field.getOptions();
  }
  return undefined;
}

function getFieldValue(field: PDFField): string {
  try {
    if (field instanceof PDFTextField) return field.getText() ?? "";
    if (field instanceof PDFRadioGroup) return field.getSelected() ?? "";
    if (field instanceof PDFCheckBox) return field.isChecked() ? "true" : "";
    if (field instanceof PDFDropdown) return field.getSelected().join(", ");
  } catch {
    // ignore
  }
  return "";
}

function getFieldCoordinates(field: PDFField, page: { width: number; height: number }) {
  try {
    const widgets = field.acroField.getWidgets();
    if (widgets.length === 0) return undefined;
    const widget = widgets[0];
    const rect = widget.getRectangle();
    // Normalise to 0-1 range relative to page dimensions
    return {
      x: rect.x / page.width,
      y: 1 - (rect.y + rect.height) / page.height, // flip Y axis (PDF is bottom-up)
      width: rect.width / page.width,
      height: rect.height / page.height,
    };
  } catch {
    return undefined;
  }
}

export interface ExtractedPdfData {
  formName: string;
  totalPages: number;
  fields: FormField[];
}

export async function extractPdfFields(
  pdfBytes: Uint8Array,
  fileName: string
): Promise<ExtractedPdfData> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const totalPages = pages.length;

  // Build a map: widget → page index & dimensions
  const pageInfoMap = new Map<number, { width: number; height: number }>();
  pages.forEach((p, idx) => {
    const { width, height } = p.getSize();
    pageInfoMap.set(idx, { width, height });
  });

  // Get all AcroForm fields
  let pdfFields: PDFField[] = [];
  try {
    const form = pdfDoc.getForm();
    pdfFields = form.getFields();
  } catch {
    // No AcroForm — return empty
    pdfFields = [];
  }

  const formFields: FormField[] = pdfFields.map((field, index) => {
    const rawName = field.getName();
    const id = toSlug(rawName) || `field-${index}`;
    const label = rawName.replace(/[_\-.]/g, " ").trim();
    const type = getFieldType(field);
    const value = getFieldValue(field);
    const options = getFieldOptions(field);
    const section = inferSection(rawName, index);

    // Determine which page this field is on (check widget rect against page)
    let page = 1;
    let coordinates: FormField["coordinates"];
    try {
      const widgets = field.acroField.getWidgets();
      if (widgets.length > 0) {
        // Find page index by checking page refs
        for (let pi = 0; pi < pages.length; pi++) {
          const pageRef = pages[pi].ref;
          const widgetPage = widgets[0].P();
          if (widgetPage && pageRef && JSON.stringify(pageRef) === JSON.stringify(widgetPage)) {
            page = pi + 1;
            const dims = pageInfoMap.get(pi)!;
            coordinates = getFieldCoordinates(field, dims);
            break;
          }
        }
        if (page === 1 && !coordinates) {
          const dims = pageInfoMap.get(0) ?? { width: 595, height: 842 };
          coordinates = getFieldCoordinates(field, dims);
        }
      }
    } catch {
      // fallback to page 1
    }

    const status = value ? "filled" : "missing";

    return {
      id,
      label,
      type,
      value,
      status,
      section,
      page,
      coordinates,
      options,
      required: false,
      source: value ? "pdf-default" : undefined,
      memoryKey: resolveMemoryKey(label, rawName)?.key ?? null,
    };
  });

  // Derive form name from file name
  const formName = fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "Uploaded Form";

  return {
    formName,
    totalPages,
    fields: formFields,
  };
}

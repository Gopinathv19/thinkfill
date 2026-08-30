// ============================================================
// Shared TypeScript types for ThinkFill
// ============================================================

export type FieldStatus =
  | "filled"
  | "missing"
  | "needs-review"
  | "needs-confirmation";

export type FieldType = "text" | "radio" | "checkbox" | "date" | "dropdown";

// A single form field extracted from the PDF
export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  value: string;
  status: FieldStatus;
  section: string;
  page: number;
  // Normalised coordinates (0-1 relative to page dimensions)
  coordinates?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  options?: string[]; // For radio / dropdown fields
  required?: boolean;
  source?: "memory" | "user" | "ai" | "pdf-default";
  /**
   * Canonical key this field's value is stored under in user memory, so the
   * same fact transfers between forms that name the field differently.
   * Null for document-specific fields (signatures, dates, OTPs) that must
   * never be remembered. See lib/memory-keys.ts.
   */
  memoryKey?: string | null;
}

// A grouped section of form fields (for the navigator)
export interface FormSection {
  id: string;
  title: string;
  fields: FormField[];
}

// The full state of a form-filling session
export interface FormState {
  sessionId: string;
  formName: string;
  pdfUrl?: string; // Object URL for browser-side rendering
  totalPages: number;
  fields: FormField[];
  sections: FormSection[];
  activeFieldId?: string;
  status: "idle" | "in-progress" | "complete";
  completionPercent: number;
}

// A message in the AI assistant chat
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
  toolName?: string;
  toolResult?: unknown;
}

// A request from the agent to save a value to the user's profile.
// Created by the agent, resolved by the user via POST /api/approvals.
export interface PendingApproval {
  id: string;
  /** What allowing it will do — the card's copy and risk differ per action. */
  kind: "memory_save" | "clear_all_fields";
  fieldKey: string;
  value: string;
  label: string;
}

// User memory record
export interface UserMemoryRecord {
  id: string;
  userId: string;
  fieldKey: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

// PDF extraction result from the server
export interface PdfExtractionResult {
  sessionId: string;
  formName: string;
  totalPages: number;
  fields: FormField[];
}

// MCP tool request shape (what TrueForge sends us)
export interface MCPToolRequest {
  tool: string;
  params: Record<string, unknown>;
  sessionId?: string;
  userId?: string;
}

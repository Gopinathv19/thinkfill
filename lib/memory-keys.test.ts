/**
 * Tests for cross-form memory key resolution.
 *
 * Run with: npm test
 *
 * The rules in memory-keys.ts are matched against punctuation-stripped text,
 * which is easy to get subtly wrong (a pattern containing "'" or "-" silently
 * never matches). These cases pin the behaviour that makes memory transfer
 * between differently-named forms.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMemoryKey, canonicalizeKey, labelForMemoryKey, normalizeLabel } from "./memory-keys";

function keyOf(label: string, fieldName?: string): string | null {
  return resolveMemoryKey(label, fieldName)?.key ?? null;
}

test("normalizeLabel strips punctuation and collapses whitespace", () => {
  assert.equal(normalizeLabel("Applicant_Full-Name"), "applicant full name");
  assert.equal(normalizeLabel("  E-MAIL   Address "), "e mail address");
  assert.equal(normalizeLabel("Father's Name"), "father s name");
});

test("differently-named fields for the same fact share one key", () => {
  // This is the property that makes memory reusable across forms.
  for (const variant of ["Full Name", "Applicant Full Name", "Name", "CANDIDATE NAME", "legal_name"]) {
    assert.equal(keyOf(variant), "full_name", `${variant} should resolve to full_name`);
  }
  for (const variant of ["Date of Birth", "DOB", "D.O.B.", "Birth Date", "birthdate"]) {
    assert.equal(keyOf(variant), "date_of_birth", `${variant} should resolve to date_of_birth`);
  }
  for (const variant of ["Email", "E-mail Address", "e mail id"]) {
    assert.equal(keyOf(variant), "email", `${variant} should resolve to email`);
  }
  for (const variant of ["Mobile No", "Phone Number", "Cell", "Telephone", "Contact No"]) {
    assert.equal(keyOf(variant), "phone", `${variant} should resolve to phone`);
  }
});

test("name parts stay distinct from the applicant's full name", () => {
  assert.equal(keyOf("First Name"), "first_name");
  assert.equal(keyOf("Given Names"), "first_name");
  assert.equal(keyOf("Last Name"), "last_name");
  assert.equal(keyOf("Surname"), "last_name");
  assert.equal(keyOf("Middle Initial"), "middle_name");
});

test("a name belonging to someone else is not the applicant's name", () => {
  assert.equal(keyOf("Father's Name"), "father_name");
  assert.equal(keyOf("Mothers Name"), "mother_name");
  assert.equal(keyOf("Spouse Name"), "spouse_name");
  assert.equal(keyOf("Company Name"), "employer");
  assert.equal(keyOf("Emergency Contact Name"), "emergency_contact_name");
  assert.equal(keyOf("Bank Name"), "bank_name");
});

test("emergency contact phone is not confused with the applicant's phone", () => {
  assert.equal(keyOf("Emergency Contact Phone"), "emergency_contact_phone");
  assert.equal(keyOf("Emergency Contact Number"), "emergency_contact_phone");
});

test("alternate phone is not confused with the primary phone", () => {
  assert.equal(keyOf("Alternate Phone Number"), "alternate_phone");
  assert.equal(keyOf("Secondary Mobile"), "alternate_phone");
});

test("email is not swallowed by the address rule", () => {
  // "E-mail Address" contains the word "address"; the email rule must win.
  assert.equal(keyOf("E-mail Address"), "email");
  assert.equal(keyOf("Street Address"), "address_line1");
  assert.equal(keyOf("Address Line 2"), "address_line2");
});

test("passport date fields are distinct from the passport number", () => {
  assert.equal(keyOf("Passport Number"), "passport_number");
  assert.equal(keyOf("Passport Issue Date"), "passport_issue_date");
  assert.equal(keyOf("Passport Expiry Date"), "passport_expiry_date");
});

test("document-specific fields are never remembered", () => {
  for (const label of [
    "Signature",
    "Date",
    "Today's Date",
    "OTP",
    "Password",
    "Captcha",
    "Application Number",
    "Reference No",
    "Amount",
    "I agree to the terms",
  ]) {
    assert.equal(resolveMemoryKey(label), null, `${label} must not be stored in memory`);
  }
});

test("unrecognised fields fall back to a slug and are flagged non-canonical", () => {
  const resolved = resolveMemoryKey("Preferred Campus Building");
  assert.ok(resolved);
  assert.equal(resolved.key, "preferred_campus_building");
  assert.equal(resolved.canonical, false);
});

test("recognised fields are flagged canonical", () => {
  assert.equal(resolveMemoryKey("Occupation")?.canonical, true);
});

test("the field name is used when the label is unhelpful", () => {
  assert.equal(keyOf("", "applicant_email_address"), "email");
  assert.equal(keyOf("Field 7", "date_of_birth"), "date_of_birth");
});

test("canonicalizeKey collapses a model-supplied key onto the stored key", () => {
  // The model may pass a raw field id or a near-miss key; all must reach the
  // same memory row that fill/lookup used.
  assert.equal(canonicalizeKey("applicant-full-name"), "full_name");
  assert.equal(canonicalizeKey("full_name"), "full_name");
  assert.equal(canonicalizeKey("Full Name"), "full_name");
  assert.equal(canonicalizeKey("emailAddress"), "email");
});

test("labelForMemoryKey produces a readable name for approval prompts", () => {
  assert.equal(labelForMemoryKey("date_of_birth"), "Date of Birth");
  assert.equal(labelForMemoryKey("preferred_campus_building"), "Preferred Campus Building");
});

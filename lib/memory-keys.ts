/**
 * lib/memory-keys.ts
 *
 * Cross-form memory key resolution.
 *
 * PDF form fields are named inconsistently across documents — the same piece of
 * information may appear as "Applicant Full Name", "name_1", or "CANDIDATE NAME".
 * Storing memory under the raw field slug means a value saved while filling form A
 * can never be found while filling form B, which defeats the whole point of
 * persistent user memory.
 *
 * This module maps a field's label/name onto a small set of stable canonical keys.
 * Memory is always read and written under the canonical key, so it transfers.
 */

export interface ResolvedMemoryKey {
  /** The key to store/lookup memory under. */
  key: string;
  /** Human-readable name for the value, used in approval prompts. */
  label: string;
  /** True when the field matched a known canonical key (so it transfers across forms). */
  canonical: boolean;
}

interface CanonicalKeyDef {
  key: string;
  label: string;
  /** Any match promotes the field to this canonical key. */
  patterns: RegExp[];
  /** Any match disqualifies the field, even if `patterns` matched. */
  exclude?: RegExp[];
}

/**
 * Ordered most-specific first — the first definition that matches wins.
 * "First Name" must be tested before the generic "Name" rule, or every name
 * field on the form would collapse into `full_name`.
 */
/**
 * All patterns below are matched against the output of `normalizeLabel`, which
 * strips every non-alphanumeric character to a single space. That means a
 * pattern can never contain punctuation: "Father's Name" arrives as
 * "father s name" and "E-mail" as "e mail". These two helpers build the
 * punctuation-tolerant forms so individual rules stay readable.
 */

/** Matches "<owner> <noun>", "<owner>s <noun>" and the stripped possessive "<owner> s <noun>". */
function POSSESSIVE(owner: string, noun: string): RegExp {
  return new RegExp(`\\b(?:${owner})(?:s| s)? ${noun}\\b`);
}

/** "email", "e-mail" and "e mail" all normalise into this. */
const EMAIL = /\be ?mail\b/;

const CANONICAL_KEYS: CanonicalKeyDef[] = [
  // ─── Name parts (must precede the generic name rule) ──────────────────────
  { key: "first_name", label: "First Name", patterns: [/\bfirst name\b/, /\bgiven names?\b/, /\bforename\b/] },
  { key: "middle_name", label: "Middle Name", patterns: [/\bmiddle (name|initial)\b/] },
  { key: "last_name", label: "Last Name", patterns: [/\b(last|family) name\b/, /\bsurname\b/] },
  { key: "father_name", label: "Father's Name", patterns: [POSSESSIVE("father", "name"), /\bname of father\b/] },
  { key: "mother_name", label: "Mother's Name", patterns: [POSSESSIVE("mother", "name"), /\bname of mother\b/] },
  { key: "spouse_name", label: "Spouse's Name", patterns: [POSSESSIVE("spouse|husband|wife", "name")] },
  {
    key: "full_name",
    label: "Full Name",
    patterns: [/\b(full|complete|legal) name\b/, /\bname\b/],
    // A bare "name" is only the applicant's own name when it isn't qualified by
    // some other entity (a company, a referee, an emergency contact, ...).
    exclude: [
      /\b(company|employer|organi[sz]ation|business|bank|branch|school|college|university|institution)\b/,
      /\b(father|mother|spouse|husband|wife|guardian|referee|reference|witness|nominee|emergency|next of kin)\b/,
      /\bcontact person\b/,
      /\b(user|file|form|document|field|product) name\b/,
    ],
  },

  // ─── Identity ─────────────────────────────────────────────────────────────
  { key: "date_of_birth", label: "Date of Birth", patterns: [/\bdate of birth\b/, /\bdob\b/, /\bd o b\b/, /\bbirth ?date\b/] },
  { key: "place_of_birth", label: "Place of Birth", patterns: [/\bplace of birth\b/, /\bbirth place\b/] },
  { key: "gender", label: "Gender", patterns: [/\bgender\b/, /\bsex\b/] },
  { key: "nationality", label: "Nationality", patterns: [/\bnationality\b/, /\bcitizenship\b/] },
  { key: "marital_status", label: "Marital Status", patterns: [/\bmarital status\b/] },

  // ─── Contact ──────────────────────────────────────────────────────────────
  { key: "email", label: "Email Address", patterns: [EMAIL] },
  {
    key: "alternate_phone",
    label: "Alternate Phone",
    patterns: [/\b(alternate|alternative|secondary|other) (phone|mobile|telephone|number|no)\b/],
  },
  {
    key: "phone",
    label: "Phone Number",
    patterns: [/\b(phone|mobile|cell|telephone|contact number|contact no)\b/],
    exclude: [/\b(fax|emergency|work|office)\b/],
  },

  // ─── Emergency contact (before the generic address/phone rules) ───────────
  {
    key: "emergency_contact_phone",
    label: "Emergency Contact Phone",
    patterns: [/\bemergency\b[\s\S]*\b(phone|mobile|telephone|number|no)\b/],
  },
  { key: "emergency_contact_name", label: "Emergency Contact", patterns: [/\bemergency\b/, /\bnext of kin\b/] },

  // ─── Address ──────────────────────────────────────────────────────────────
  { key: "address_line2", label: "Address Line 2", patterns: [/\baddress (line )?2\b/, /\bapt\b/, /\bapartment\b/, /\bunit\b/, /\bsuite\b/] },
  {
    key: "address_line1",
    label: "Address",
    patterns: [/\baddress (line )?1\b/, /\bstreet\b/, /\baddress\b/],
    exclude: [EMAIL, /\b(ip|web|url|website)\b/],
  },
  { key: "city", label: "City", patterns: [/\bcity\b/, /\btown\b/] },
  { key: "state", label: "State", patterns: [/\bstate\b/, /\bprovince\b/], exclude: [/\bstatement\b/, /\bmarital\b/] },
  { key: "postal_code", label: "Postal Code", patterns: [/\b(zip|postal|pin) ?(code)?\b/, /\bpostcode\b/] },
  { key: "country", label: "Country", patterns: [/\bcountry\b/] },

  // ─── Employment ───────────────────────────────────────────────────────────
  { key: "occupation", label: "Occupation", patterns: [/\boccupation\b/, /\bjob title\b/, /\bdesignation\b/, /\bprofession\b/, /\bposition\b/] },
  { key: "employer", label: "Employer", patterns: [/\bemployer\b/, /\bcompany\b/, /\borgani[sz]ation\b/, /\bworkplace\b/] },
  { key: "annual_income", label: "Annual Income", patterns: [/\bannual income\b/, /\bincome\b/, /\bsalary\b/, /\bctc\b/] },

  // ─── Documents ────────────────────────────────────────────────────────────
  { key: "passport_issue_date", label: "Passport Issue Date", patterns: [/\bpassport\b[\s\S]*\bissue\b/] },
  { key: "passport_expiry_date", label: "Passport Expiry Date", patterns: [/\bpassport\b[\s\S]*\b(expiry|expiration|expire[sd]?|valid until)\b/] },
  { key: "passport_number", label: "Passport Number", patterns: [/\bpassport\b/], exclude: [/\b(place|authority)\b/] },
  { key: "national_id", label: "National ID", patterns: [/\baadha?ar\b/, /\bssn\b/, /\bs s n\b/, /\bsocial security\b/, /\bnational id\b/, /\bnric\b/] },
  { key: "tax_id", label: "Tax ID", patterns: [/\bpan\b/, /\btax id\b/, /\btin\b/, /\bgstin\b/] },
  { key: "driver_license", label: "Driver's Licence", patterns: [POSSESSIVE("driver|driving", "licen[cs]e"), /\bdl no\b/] },

  // ─── Banking ──────────────────────────────────────────────────────────────
  { key: "bank_name", label: "Bank Name", patterns: [/\bbank name\b/, /\bname of bank\b/] },
  { key: "bank_account_number", label: "Bank Account Number", patterns: [/\baccount (number|no)\b/, /\bbank account\b/] },
  { key: "bank_ifsc", label: "IFSC / Routing Code", patterns: [/\bifsc\b/, /\brouting (number|code)\b/, /\bswift\b/, /\bsort code\b/] },
];

/**
 * Fields whose value is specific to a single document and must never be
 * carried into another form, even if they would otherwise slug consistently.
 */
const NEVER_REMEMBER: RegExp[] = [
  /\bsignature\b/,
  POSSESSIVE("today", "date"),
  /^date$/,
  /\bcaptcha\b/,
  /\botp\b/,
  /\bo t p\b/,
  /\bpassword\b/,
  /\bdeclaration\b/,
  /\bi (agree|confirm|declare)\b/,
  /\bamount\b/,
  /\b(reference|application|receipt|invoice) (number|no|id)\b/,
];

/**
 * Lowercase and collapse punctuation to single spaces, splitting camelCase on
 * the way so that field names arriving in any casing convention normalise the
 * same: "Applicant_Full-Name", "applicantFullName" and "APPLICANT FULL NAME"
 * all become "applicant full name".
 */
export function normalizeLabel(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")   // emailAddress → email Address
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // PINCode      → PIN Code
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(raw: string): string {
  return normalizeLabel(raw).replace(/ /g, "_");
}

/**
 * Resolve a form field onto the key its value should be stored under.
 *
 * Tries the human label first (usually more descriptive), then the raw field
 * name. Returns null when the field holds document-specific data that must not
 * be reused across forms.
 */
export function resolveMemoryKey(
  label: string,
  fieldName?: string
): ResolvedMemoryKey | null {
  const candidates = [label, fieldName].filter(
    (c): c is string => typeof c === "string" && c.trim().length > 0
  );
  if (candidates.length === 0) return null;

  const normalized = candidates.map(normalizeLabel);

  if (normalized.some((n) => NEVER_REMEMBER.some((re) => re.test(n)))) {
    return null;
  }

  for (const def of CANONICAL_KEYS) {
    for (const n of normalized) {
      if (def.exclude?.some((re) => re.test(n))) continue;
      if (def.patterns.some((re) => re.test(n))) {
        return { key: def.key, label: def.label, canonical: true };
      }
    }
  }

  // No canonical match. Fall back to a slug of the label so the value is at
  // least reusable across forms that name the field the same way, but flag it
  // as non-canonical so callers can treat it with less confidence.
  const fallback = slugify(candidates[0]);
  if (!fallback) return null;
  return { key: fallback, label: candidates[0].trim(), canonical: false };
}

/** Human-readable label for a canonical key, for use in approval prompts. */
export function labelForMemoryKey(key: string): string {
  const def = CANONICAL_KEYS.find((d) => d.key === key);
  if (def) return def.label;
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Normalise an arbitrary key supplied by the model into the canonical form.
 * The model may pass a field id ("applicant-full-name") or a near-miss key
 * ("fullName"); both should reach the same memory row as `full_name`.
 */
export function canonicalizeKey(key: string): string {
  const resolved = resolveMemoryKey(key);
  return resolved ? resolved.key : slugify(key);
}

/** All canonical keys, for surfacing the memory schema to the agent or UI. */
export function listCanonicalKeys(): Array<{ key: string; label: string }> {
  return CANONICAL_KEYS.map((d) => ({ key: d.key, label: d.label }));
}

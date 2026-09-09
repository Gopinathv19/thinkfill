# 🧠 ThinkFill

Fill any PDF form by having a conversation — with an agent that runs inside **TrueForge**, TrueFoundry's open-source agent harness, and calls back into this app through a **Model Context Protocol** tool server.

![Next.js](https://img.shields.io/badge/Next.js-16.3.3-black)
![React](https://img.shields.io/badge/React-19.2-149eca)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![TrueForge](https://img.shields.io/badge/TrueForge-v0.1.4-6d28d9)
![MCP](https://img.shields.io/badge/MCP-JSON--RPC%202.0-orange)
![Postgres](https://img.shields.io/badge/Neon-Postgres-00e599)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Table of Contents

1. [Hackathon](#1-hackathon)
2. [Hackathon Checklist](#2-hackathon-checklist)
3. [The Problem](#3-the-problem)
4. [Our Solution](#4-our-solution)
5. [System Architecture](#5-system-architecture)
6. [TrueForge — The Agent Harness](#6-trueforge--the-agent-harness)
7. [The MCP Tool Server](#7-the-mcp-tool-server)
8. [Human-in-the-Loop Approvals](#8-human-in-the-loop-approvals)
9. [Cross-Form Memory Engine](#9-cross-form-memory-engine)
10. [The Agent Turn, Step by Step](#10-the-agent-turn-step-by-step)
11. [Application Features](#11-application-features)
12. [Technical Stack](#12-technical-stack)
13. [Project Structure](#13-project-structure)
14. [Getting Started](#14-getting-started)
15. [Environment Variables](#15-environment-variables)
16. [Running the Project](#16-running-the-project)
17. [API Reference](#17-api-reference)
18. [Design Invariants](#18-design-invariants)
19. [Reliability & Failure Handling](#19-reliability--failure-handling)
20. [Model Selection Notes](#20-model-selection-notes)
21. [Testing](#21-testing)
22. [Screenshots & Visual Walkthrough](#22-screenshots--visual-walkthrough)
23. [AI Usage Disclosure](#23-ai-usage-disclosure)
24. [Known Limits & Future Improvements](#24-known-limits--future-improvements)
25. [Team / Author](#25-team--author)
26. [License](#26-license)

---

## 1. Hackathon

| Field | Detail |
|---|---|
| Hackathon | The Agent Harness Hackathon|
| Organizers | Trueforge x WeMakeDevs|
| Dates | Aug-24-31 2026|
| Track | Agent harness / code quality |
| Challenge | Build a real-world application on top of an open-source agent harness, where the harness — not the app — owns the agent loop, tool routing, and human-approval gates. |

This project was built from scratch to demonstrate a specific architectural idea: **the agent should not live inside your application.** ThinkFill runs its agent loop entirely inside TrueForge, and exposes its own domain as a set of MCP tools the harness calls back into. Everything else in this README follows from that split.

---

## 2. Hackathon Checklist

| # | Requirement | Status | Evidence |
|---|---|---|---|
| ✅ | Agent loop owned by the harness, not the app | Done | ThinkFill never calls a model directly. `lib/trueforge.ts` creates a harness session and streams turn events; model calls, iteration limits, context compaction and tool routing all happen inside TrueForge. |
| ✅ | Application exposes tools to the harness | Done | `app/api/mcp/[sessionId]/route.ts` is a hand-rolled, dependency-free MCP server (JSON-RPC 2.0 over streamable HTTP) exposing 9 domain tools. |
| ✅ | Human-in-the-loop approval on irreversible actions | Done | `save_user_memory` and `clear_all_form_fields` are registered with the harness as approval-required. TrueForge **physically pauses** the tool call; nothing proceeds until a person clicks Allow or Deny. |
| ✅ | Real persistence, not in-memory demo state | Done | Neon Postgres — 6 tables, idempotent schema in `lib/db.ts#createSchema`, migration via `npm run db:migrate`. |
| ✅ | Works end-to-end from a fresh clone | Done | With no cloud account: local disk PDF store, local TrueForge, one Postgres URL. See [Getting Started](#14-getting-started). |
| ✅| PR reviewed by Qodo | Done| Required for the code-quality track — direct pushes to `main` do not count. Link the PR here. |

---

## 3. The Problem

Filling the same details into form after form is tedious, slow, and error-prone.

### The Repetition Problem

- **You retype the same facts forever.** Name, date of birth, address, passport number, employer, bank details — the same twenty values, re-entered by hand into every visa form, onboarding pack, loan application and government document you ever touch.
- **Fatigue causes real errors.** A transposed digit in an account number or a mistyped date of birth on a legal form is not a typo, it is a rejected application.
- **You keep no record.** After submitting, you have no idea what you told whom, or whether the address on form A matches the one on form B.

### Why Existing Autofill Doesn't Help

- **Browser autofill only works on web forms.** The moment the form arrives as a PDF attachment, autofill is gone.
- **PDF field names are meaningless and inconsistent.** The same fact is `full_name` on one form, `Applicant Full Name` on the next, `CANDIDATE NAME` on a third, and `name_1` on a fourth. Keying stored values off the raw field name means a value saved on form A can never be found on form B — which defeats the entire point of remembering it.
- **Some fields must never be reused.** A signature, today's date, a one-time code, a per-application reference number. A naive "remember everything" autofill will happily carry yesterday's OTP into tomorrow's form.

### The Trust Problem

A filled form is an identity document. Any system that stores your passport number, national ID and bank details has to be explicit about **what it saved, when, and with whose permission** — and it must not silently accumulate a profile behind your back.

---

## 4. Our Solution

**ThinkFill turns form-filling into a conversation with a memory.**

You upload a fillable PDF. An agent reads its fields, fills everything it already knows from your saved profile, then asks — one question at a time, in chat — for whatever is genuinely left. When you supply a new value worth keeping, it asks whether to remember it, so the *next* form fills itself. You review every field, edit anything inline on the rendered document, and export the completed PDF.

### The compounding bet

| Form | Experience |
|---|---|
| #1 | Roughly as much work as filling it by hand — you're teaching the profile. |
| #2 | Most of it is already filled before the first question. |
| #5 | The only questions asked are the ones actually specific to *that* document. |

### What makes it more than autofill

1. **Cross-form memory with canonical keys.** `"Full Name"`, `"Applicant Full Name"`, `"CANDIDATE NAME"` and `"legal_name"` all resolve to `full_name`. Memory is always read and written under the canonical key, so a value transfers to a form that names it completely differently. This is the whole reason form #2 is faster than form #1.
2. **A never-remember list.** Signatures, today's date, CAPTCHAs, OTPs, passwords, declarations, amounts and per-application reference numbers resolve to a **null** memory key, and the save path skips them entirely.
3. **Nothing reaches your profile without explicit consent** — enforced by a paused tool call in the harness, not by the model politely asking in chat.
4. **Deterministic work stays deterministic.** Matching the profile against empty fields involves no judgment, so it is computed server-side and applied in one operation — and there are plain UI buttons that do it with no agent in the loop at all.

### Where TrueForge fits

TrueForge owns the agent loop: model calls, tool routing, iteration limits, context compaction, and pausing for human approval. ThinkFill supplies the interface, the data, and the MCP tool server that the harness calls back into. **That split is the architecture.**

---

## 5. System Architecture

### Components

| Component | Technology | Role |
|---|---|---|
| ThinkFill Web App | Next.js 16.3.3 (App Router) | Chat surface, three-panel workspace, PDF render + export |
| ThinkFill API | Next.js Route Handlers | Session lifecycle, PDF extraction, turn orchestration, approvals |
| **MCP Tool Server** | Hand-rolled JSON-RPC 2.0 | The 9 domain tools TrueForge calls back into |
| **TrueForge Harness** | `@truefoundry/trueforge` v0.1.4 | Owns the agent loop, tool routing and approval pauses |
| Model Provider | NVIDIA NIM (via TrueForge) | LLM inference — `nemotron-3-nano` by default |
| Database | Neon Postgres | Profile, sessions, fields, chat history, approvals |
| Document Store | Vercel Blob (private) or local disk | The uploaded PDF bytes |

### The single most important fact: **traffic runs in both directions.**

```
                          Browser
                             │
                             ▼
              ┌──────────────────────────────┐
              │      ThinkFill (Next.js)     │
              │       /chat   /workspace     │
              └───────────────┬──────────────┘
                              │
                              │  ① SDK: create session, run turn (SSE)
                              ▼
              ┌──────────────────────────────┐
              │      TrueForge  :8790        │
              │  ▸ owns the agent loop       │───②──▶  NVIDIA NIM
              │  ▸ routes tool calls         │◀────    (model inference)
              │  ▸ pauses for approval       │
              └───────────────┬──────────────┘
                              │
                              │  ③ MCP (JSON-RPC 2.0 over HTTP)
                              ▼
              ┌──────────────────────────────┐
              │   ThinkFill MCP Server       │
              │   /api/mcp/[sessionId]       │
              │   reads + writes Neon        │
              └───────────────┬──────────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │  Neon Postgres  │
                     └─────────────────┘
```

ThinkFill calls TrueForge to run a turn; TrueForge calls ThinkFill back for every tool the agent uses. **Both sides must be reachable from the other** — which is why a wrong `NEXT_PUBLIC_APP_URL` breaks every tool call while the chat itself still looks like it is working.

---

## 6. TrueForge — The Agent Harness

### 6.1 Why a harness instead of a bare model loop

Writing your own agent loop means writing — and then maintaining — retry logic, tool-call parsing, context compaction, iteration caps, cancellation, and a way to pause mid-execution for a human decision. TrueForge provides all of that as a standalone server, so ThinkFill contains **zero** model-calling code.

The decisive feature is the last one. A prose "are you sure?" in chat is something a model can simply skip. A paused tool call is not.

### 6.2 The two agents

Both are defined in `lib/trueforge.ts`.

| Agent | Where | Tools | Purpose |
|---|---|---|---|
| **Lobby agent** (`createLobbySession`) | `/chat`, before any PDF exists | **None** | Answers questions and gets the user to upload. There is no form session yet, so there is nothing to act on. Its transcript is browser-local and ephemeral. |
| **Form agent** (`buildFormAgentSpec`) | Per form session | 9 MCP tools | Reads form state, fills from profile, asks for the rest, offers to remember. Bound to that session's MCP connector only. |

The form agent is created with `parallel_tool_calls: false`, and with sandbox, sub-agents, generative UI and ask-user-questions all **disabled** — this workload needs none of them, and disabling them keeps a small model on the rails.

### 6.3 Spec versioning

The agent spec is **snapshotted at session creation**. A change to the instructions or the approval policy would otherwise reach only sessions created after it shipped — meaning "clearing a form now requires confirmation" would silently not apply to any existing session.

So `form_sessions.tf_model` stores a fingerprint, `"<model>@v<AGENT_SPEC_VERSION>"`. On every turn, `ensureTrueForgeSession` compares it against the current fingerprint and, on a mismatch, `PATCH`es the new spec onto the existing harness session — keeping its context.

> **Bump `AGENT_SPEC_VERSION` whenever the instructions or the tool-approval policy change.**

### 6.4 Deterministic work stays deterministic

Filling known fields from the profile involves no judgment — the matches are already computed server-side. Originally the model was asked to call `fill_form_field` once per match, which made a routine step depend on it remembering to issue nine sequential calls. As a session's context grows, a small model stops doing that: it calls `find_memory_matches`, sees *"8 values found"*, and **reports success without filling anything.**

Three defences, in order of reliability:

1. **`fill_from_memory`** does the whole fill in one call (`lib/db.ts#fillFieldsFromMemory`), so the model makes one decision and cannot report work it did not do.
2. **Compaction at 12k tokens**, not the 50k default — the default assumes a model that still follows instructions at 50k. This one does not.
3. **UI buttons that bypass the agent entirely** — "Fill from profile" and "Clear all" in the field navigator, hitting the same shared code as the tools.

> **A deterministic action should never be reachable *only* through a model.**

---

## 7. The MCP Tool Server

`app/api/mcp/[sessionId]/route.ts` — a hand-rolled, dependency-free **Model Context Protocol** endpoint. JSON-RPC 2.0 over streamable HTTP.

TrueForge connects as an MCP client and performs the standard handshake:

```
initialize  →  notifications/initialized (202, no body)  →  tools/list  →  tools/call
```

Protocol versions accepted: `2025-06-18`, `2025-03-26`, `2024-11-05`.

### 7.1 Session scoping *is* the security model

One connector is registered per form session, and **the session id lives in the URL, never in a tool argument.** The model cannot name a session, therefore it cannot reach another one. `userId` is read from the session row, never from the model.

### 7.2 The nine tools

| Tool | R/W | Approval | What it does |
|---|---|---|---|
| `get_form_state` | read | — | Every field with its value, status, and the `memory_key` it can be saved under. The agent's starting point. |
| `find_memory_matches` | read | — | Which missing fields can be filled *right now* from the profile, and which genuinely need the user. |
| `fill_from_memory` | write | — | Fills **every** profile match in one call and reports what still needs the user. |
| `get_user_memory` | read | — | One saved value, by key. |
| `list_user_memory` | read | — | Everything in the profile. |
| `fill_form_field` | write | — | Sets one field. Resolves `field_id` leniently — by id, memory key, or label, preferring an unfilled match. |
| `save_user_memory` | write | 🔒 **Yes** | The **only** write path into the profile. Pauses for human approval. |
| `clear_form_field` | write | — | Empties one field back to `missing`. Not gated — trivially undone by refilling. |
| `clear_all_form_fields` | write | 🔒 **Yes** | Empties the whole form. Destructive and not undoable. Scoped to the form; the profile is untouched. |

### 7.3 Policy is code, not prompt

When the user supplies a value and it is worth keeping, `fill_form_field`'s **result** carries a deterministic `suggestion` telling the agent to offer saving it. The "should this be remembered?" decision is computed in the tool — from the canonical-key resolution and the never-remember list — rather than left to the model's judgment.

### 7.4 Errors are legible

Tool failures are returned **in-band** (`isError: true`) so the model can read and recover from them. Only protocol failures become JSON-RPC errors, and those carry the real message rather than a bare "Internal error" — so a failure is readable in TrueForge's log *and* by the model. The session lookup retries once, so a single transient Postgres blip no longer breaks a form mid-fill.

---

## 8. Human-in-the-Loop Approvals

This is the project's central safety property and its most visible harness feature.

### 8.1 The flow

```
Agent calls  save_user_memory  or  clear_all_form_fields
          ↓
TrueForge PAUSES the tool call and ends the turn with  tool.approval_required
          ↓
App records it in  memory_approvals  with  tf_thread_id + tf_tool_call_id
          ↓
UI renders an approval card  (red, with different copy, for the destructive one)
          ↓
POST /api/approvals  →  allow | deny
          ↓
   allow → harness executes the tool through MCP
   deny  → agent is told why and carries on
          ↓
The agent's TURN RESUMES  — it can now change anything a normal turn can
```

### 8.2 Resolving an approval resumes the turn

This is the subtle part. Approving a clear empties every field; the turn following a save often goes on to fill the next one. So `resolveApproval` in `context/FormContext.tsx` re-reads **messages, fields *and* approvals**. Refreshing only messages — which was enough while approvals were memory-only — left the form looking untouched after it had in fact been cleared.

### 8.3 The two kinds are not interchangeable

`memory_approvals.kind` distinguishes them:

- `resolveMemoryApproval` writes to `user_memory` **only** for `memory_save` — approving a clear must not store a junk row.
- The card renders red, with different copy and buttons, for the destructive one.

### 8.4 Typing instead of clicking is a valid answer

A thread with a pending approval returns **HTTP 422** on any user message, which would wedge the session — especially on `/chat`, where the card may not even be visible. So before every message, the app clears what is pending by **declining** it.

Declining is the deliberate default: nothing reaches the profile without consent, and if the message *was* consent ("yes, save it"), the agent reads it next turn and offers again. The app asks the **harness** what is blocking, rather than trusting the local table — a paused call missing from the database still blocks the thread.

---

## 9. Cross-Form Memory Engine

`lib/memory-keys.ts` — the feature that makes the second form faster than the first.

### 9.1 Canonical keys

Field labels vary wildly between documents; a canonical key does not.

```
"Full Name" · "Applicant Full Name" · "CANDIDATE NAME" · "legal_name"   →  full_name
"Date of Birth" · "DOB" · "D.O.B." · "Birth Date"                       →  date_of_birth
"E-mail" · "Email Address" · "emailAddress"                             →  email
```

Roughly 35 canonical keys are defined across six groups:

| Group | Keys |
|---|---|
| Name parts | `first_name` `middle_name` `last_name` `full_name` `father_name` `mother_name` `spouse_name` |
| Identity | `date_of_birth` `place_of_birth` `gender` `nationality` `marital_status` |
| Contact | `email` `phone` `alternate_phone` `emergency_contact_name` `emergency_contact_phone` |
| Address | `address_line1` `address_line2` `city` `state` `postal_code` `country` |
| Employment | `occupation` `employer` `annual_income` |
| Documents & banking | `passport_number` `passport_issue_date` `passport_expiry_date` `national_id` `tax_id` `driver_license` `bank_name` `bank_account_number` `bank_ifsc` |

### 9.2 How matching works

`normalizeLabel` splits camelCase, lowercases, and collapses every non-alphanumeric character to a single space — so `Applicant_Full-Name`, `applicantFullName` and `APPLICANT FULL NAME` all normalise identically. Definitions are then tested **most-specific-first**: `"First Name"` must be tested before the generic `"Name"` rule, or every name field on the form would collapse into `full_name`.

Each definition can also carry `exclude` patterns. A bare `"name"` is only the applicant's own name when it is *not* qualified by some other entity:

```ts
{
  key: "full_name",
  patterns: [/\b(full|complete|legal) name\b/, /\bname\b/],
  exclude: [
    /\b(company|employer|organi[sz]ation|business|bank|school|university)\b/,
    /\b(father|mother|spouse|guardian|referee|witness|nominee|emergency|next of kin)\b/,
    /\bcontact person\b/,
  ],
}
```

No canonical match falls back to a slug of the label — still reusable across forms that name the field the same way — but flagged `canonical: false` so callers treat it with less confidence.

### 9.3 The never-remember list

Some values are specific to a single document and must never be carried into another form, even when they would slug consistently:

```
signature · today's date · a bare "date" · captcha · otp · password
declaration · "I agree/confirm/declare" · amount
reference / application / receipt / invoice number
```

These resolve to a **null** memory key, and the save path skips them.

> This logic is easy to break subtly, so it is covered by `lib/memory-keys.test.ts`.

---

## 10. The Agent Turn, Step by Step

`POST /api/agent/chat` with `{ message, sessionId }`:

```
1. PROVISION  (first message only — ensureTrueForgeSession)
   register the per-session MCP connector · create the harness session
   persist tf_session_id, mcp_server_name, tf_model
   → on later turns, a fingerprint mismatch migrates the spec in place
          ↓
2. CLEAR PENDING  (declinePendingApprovals)
   typing instead of clicking the card is treated as declining
          ↓
3. PERSIST the user message
   a resend of a turn that never got a reply is a retry, not a second message
   (lib/chat-history.ts#isResendOfUnansweredTurn)
          ↓
4. RUN THE TURN  (runTurn, over SSE)
   fold events into chat rows, a tool-call log, and any approvals paused on
          ↓
5. PERSIST THE OUTCOME  (persistTurnOutcome)
   respond { message, toolCalls, pendingApprovals, finishReason }
```

### Two event-stream subtleties that are easy to get wrong

- **`model.message` arrives as an empty shell.** Its content and tool calls come as `model.message.delta` events that must be merged with the SDK's `mergeEventDelta`. Reading `content` off the bare event yields nothing.
- **The model reaches tools two different ways and picks per call** — directly by name, or wrapped by the harness's deferred-tools mechanism as `call_tool({ mcp_server, tool_name, input })`. `unwrapToolCall` normalises both, so **nothing downstream should ever match on `tc.function.name` directly.** A wrapped `save_user_memory` reads as `call_tool`, its approval goes unrecorded, no card appears, and the thread stays paused forever.

> Chat history in Postgres exists **for the UI**, so a reload restores the thread. The agent's own working context lives inside the TrueForge session.

---

## 11. Application Features

### Conversation & Intake
- [x] Chat-first entry point — ask questions before any PDF exists
- [x] Tool-less "lobby" agent for pre-upload conversation
- [x] In-conversation upload: button **or** drag-and-drop anywhere on the page
- [x] Automatic hand-off from `/chat` into the form workspace

### Form Understanding
- [x] AcroForm field extraction into a structured schema
- [x] Labels, sections, field types, page numbers and normalised coordinates
- [x] Field types: `text` · `radio` · `checkbox` · `date` · `dropdown`
- [x] Field statuses: `filled` · `missing` · `needs-review` · `needs-confirmation`
- [x] Provenance per field: `memory` · `user` · `ai` · `pdf-default`

### Agentic Filling
- [x] 9 MCP tools with lenient field-id matching (id, label, or memory key)
- [x] One-shot bulk fill from profile (`fill_from_memory`)
- [x] One question at a time for what genuinely needs the user
- [x] Deterministic "offer to remember" suggestions computed in the tool layer

### Memory
- [x] ~35 canonical keys across identity, contact, address, employment, documents, banking
- [x] Cross-form transfer under canonical keys
- [x] Never-remember list for document-specific values
- [x] Non-canonical slug fallback, flagged as lower confidence

### Safety
- [x] Harness-enforced approval on profile writes
- [x] Harness-enforced approval on clearing a whole form
- [x] Decline-by-default when the user types instead of clicking
- [x] `parallel_tool_calls: false` — at most one approval pending at a time

### Workspace
- [x] Three-panel layout: field navigator · live PDF · assistant
- [x] Fields grouped by section with per-field status
- [x] Inline editing directly on the rendered document
- [x] Readable agent activity — one sentence per tool call, raw payload one click away
- [x] "Fill from profile" and "Clear all" buttons that bypass the agent entirely

### Export & Persistence
- [x] Filled-PDF export with AcroForm writing
- [x] Coordinate-drawing fallback for fields AcroForm cannot fill
- [x] Checkbox widget support
- [x] Private document storage — Vercel Blob or local disk
- [x] Session history sidebar with per-form progress
- [x] Full rehydration on reload
- [x] Two-step delete removing the form, its PDF and its harness session together

### Not Yet Implemented
- [ ] Authentication / multi-user
- [ ] Scanned (non-AcroForm) PDF support via OCR
- [ ] Production deployment of the harness
- [ ] Client-side direct upload for files over 4 MB
- [ ] A profile management UI (view / edit / delete saved values)
- [ ] Multi-page form polish

---

## 12. Technical Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 16.3.3 (App Router, Turbopack) | Routing, SSR, route handlers |
| UI | React 19.2 + TypeScript 5 | Components and state |
| Styling | Tailwind CSS 4 | Utility-first styling |
| Icons | `lucide-react` | Iconography |
| **Agent runtime** | **TrueForge v0.1.4** (`npx @truefoundry/trueforge`) | Owns the agent loop; runs on `:8790` |
| **Harness client** | `@truefoundry/trueforge-sdk` 0.1.3 | REST + SSE, camelCase types |
| Harness UI | `@truefoundry/trueforge-ui` 0.2.2 | Harness-side inspection |
| **Tool protocol** | **MCP** — JSON-RPC 2.0 over streamable HTTP | Hand-rolled, zero dependencies |
| Model provider | NVIDIA NIM, via TrueForge's `nvidia-nim` provider | Inference |
| Database | Neon Postgres (`@neondatabase/serverless`) | Application state |
| Document store | Vercel Blob (private) · local disk fallback | Uploaded PDF bytes |
| PDF render/extract | `pdfjs-dist` 4.10 · `react-pdf` 9.1 | Viewer and field extraction |
| PDF write | `pdf-lib` 1.17 | Filled-PDF export |
| Tests | `node:test` via `tsx` | Unit tests, no network required |

---

## 13. Project Structure

```
thinkfill/
│
├── app/                                  ← Next.js App Router
│   ├── page.tsx                          ← Redirects to /chat
│   ├── layout.tsx                        ← Root layout
│   ├── globals.css                       ← Tailwind entry + design tokens
│   │
│   ├── chat/                             ← The front door
│   │   ├── page.tsx                      ← Lobby chat + upload
│   │   └── layout.tsx
│   │
│   ├── workspace/                        ← Three-panel form workspace
│   │   ├── page.tsx                      ← /workspace?session=…
│   │   └── layout.tsx
│   │
│   └── api/
│       ├── mcp/[sessionId]/route.ts      ★ MCP SERVER — the 9 tools (534 lines)
│       │
│       ├── agent/
│       │   ├── chat/route.ts             ← Form-agent turn (provision → run → persist)
│       │   └── lobby/route.ts            ← Pre-upload, tool-less conversation
│       │
│       ├── approvals/route.ts            ← List pending · resolve allow/deny
│       ├── pdf/extract/route.ts          ← multipart PDF → session + fields + document
│       │
│       ├── session/
│       │   ├── fields/route.ts           ← GET fields · PATCH one · DELETE all
│       │   ├── fill-from-memory/route.ts ← Agent-free bulk fill (the UI button)
│       │   ├── messages/route.ts         ← Conversation history for the UI
│       │   └── pdf/route.ts              ← Streams the original upload
│       │
│       └── sessions/
│           ├── route.ts                  ← Session list for the sidebar
│           └── [sessionId]/route.ts      ← Delete session + PDF + harness session
│
├── lib/
│   ├── trueforge.ts                      ★ HARNESS CLIENT — agent specs, runTurn,
│   │                                       SSE folding, idle watchdog, error mapping
│   ├── db.ts                             ★ Schema + every query (640 lines)
│   ├── memory-keys.ts                    ★ CANONICAL KEY ENGINE + never-remember list
│   ├── agent-turns.ts                    ← persistTurnOutcome · declinePendingApprovals
│   ├── chat-history.ts                   ← Provider message shaping · resend detection
│   ├── tool-summary.ts                   ← One readable sentence per tool call
│   ├── pdf.ts                            ← AcroForm field extraction
│   ├── pdf-store.ts                      ← savePdf/readPdf/deletePdf · Blob | disk
│   ├── types.ts                          ← Shared TypeScript contracts
│   ├── db-migrate.ts                     ← npm run db:migrate
│   │
│   ├── memory-keys.test.ts               ← Canonicalisation coverage
│   ├── chat-history.test.ts              ← Resend / message-shaping coverage
│   ├── tool-summary.test.ts              ← Summary rendering coverage
│   └── trueforge.test.ts                 ← Failure-message mapping coverage
│
├── components/
│   ├── ChatInterface.tsx                 ← /chat surface: lobby, drag-drop, hand-off
│   ├── ChatSidebar.tsx                   ← Session history, progress, two-step delete
│   ├── FormNavigator.tsx                 ← Fields by section · Fill from profile · Clear all
│   ├── FormDocument.tsx                  ← PDF render, inline editing, exportPdf
│   ├── AIAssistant.tsx                   ← Workspace chat + agent activity + approval card
│   └── TopBar.tsx                        ← Progress, form name, New form
│
├── context/
│   └── FormContext.tsx                   ← Client state; re-reads server after every turn
│
├── scripts/
│   └── smoke-test.ts                     ← E2E against a running dev server + real DB
│
├── docs/
│   └── ARCHITECTURE.md                   ← Deep reference for developers and AI agents
│
├── .data/                                ← Local PDF store (gitignored)
├── AGENTS.md · CLAUDE.md                 ← Instructions for AI coding agents
└── package.json
```

---

## 14. Getting Started

### Prerequisites

- **Node.js 18+** and npm
- A **Neon Postgres** database (or any Postgres connection string)
- An **NVIDIA NIM API key** (free tier is sufficient)
- No Vercel account required for local development

### 1. Clone and install

```bash
git clone https://github.com/Gopinathv19/thinkfill.git
cd thinkfill
npm install
```

### 2. Configure environment

Create `.env.local` (it takes precedence over `.env`):

```bash
DATABASE_URL="postgresql://…"          # Neon connection string
TRUEFORGE_URL="http://localhost:8790"
TRUEFORGE_MODEL="nvidia-nim/nemotron-3-nano"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
DEMO_USER_ID="demo-user-001"
```

### 3. Start the harness

```bash
npx @truefoundry/trueforge
```

Then open the TrueForge UI at `http://localhost:8790` and add the **`nvidia-nim`** model provider under *Settings → Models*:

| Field | Value |
|---|---|
| Type | `custom` |
| Base URL | `https://integrate.api.nvidia.com/v1` |
| API key | your NVIDIA NIM key |
| Models | `nemotron-3-nano` (and any others you verify — see [§20](#20-model-selection-notes)) |

> A startup warning about a missing local sandbox (`socat`, `rg` not installed) is expected. This app does not use the sandbox — ignore it, or `sudo apt install socat ripgrep`.

### 4. Migrate the database

```bash
npm run db:migrate      # idempotent; safe to re-run
```

### 5. Run the app

```bash
npm run dev
```

Open **`http://localhost:3000`** — it redirects to `/chat`. Drag a fillable PDF onto the page and start talking.

---

## 15. Environment Variables

`.env.local` wins over `.env`.

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Neon Postgres connection string | ✅ Yes |
| `TRUEFORGE_URL` | Harness base URL (default `http://localhost:8790`) | ✅ Yes |
| `NEXT_PUBLIC_APP_URL` | **The URL TrueForge uses to reach this app's MCP server.** Wrong value → every tool call fails while chat still appears to work | ✅ Yes |
| `TRUEFORGE_MODEL` | Model FQN `provider/model` from `GET :8790/api/v1/models`. Unset → first configured model. Changing it migrates existing sessions | Recommended |
| `DEMO_USER_ID` | The single demo user (`demo-user-001`). There is no auth in this MVP | ✅ Yes |
| `TRUEFORGE_IDLE_TIMEOUT_MS` | Abort a turn whose event stream is silent this long (default `90000`) | Optional |
| `BLOB_READ_WRITE_TOKEN` | Set → PDFs go to Vercel Blob (private); unset → local disk. **Required when deployed** | Optional |
| `THINKFILL_DATA_DIR` | Root of the local PDF store (default `.data`, gitignored) | Optional |
| `NVIDIA_API_KEY` | Used only by helper scripts. The runtime path uses TrueForge's stored provider key | Optional |

> Never commit real keys. `.env*` is gitignored.

---

## 16. Running the Project

### Two terminals

```bash
# Terminal 1 — the agent harness
npx @truefoundry/trueforge          # :8790

# Terminal 2 — the app
npm run dev                         # :3000
```

### All scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server with Turbopack |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Create/upgrade the schema (idempotent) |
| `npm test` | Unit tests — no network, no harness, no database |
| `npm run smoke` | E2E against a running dev server + real DB (**writes rows**) |

### Inspecting the harness side

```bash
curl :8790/api/v1/models                              # configured models
curl :8790/api/v1/settings/mcp-servers                # registered connectors
curl :8790/api/v1/mcp-servers/<name>/tools            # forces a live MCP handshake
curl :8790/api/v1/sessions/<tf_session_id>/events     # raw turn events
```

---

## 17. API Reference

### Agent

#### `POST /api/agent/chat`
Run one form-agent turn.

**Request**
```json
{ "message": "my email is a@b.com", "sessionId": "uuid" }
```

**Response**
```json
{
  "message": "Filled your email address. Would you like me to remember it for future forms?",
  "toolCalls": [
    { "name": "fill_form_field", "summary": "Filled email address", "result": { } }
  ],
  "pendingApprovals": [
    { "id": "uuid", "kind": "memory_save", "fieldKey": "email",
      "value": "a@b.com", "label": "Email Address" }
  ],
  "finishReason": "stop"
}
```

> **This contract is stable.** The UI has no TrueForge awareness at all.

#### `POST /api/agent/lobby`
Pre-upload conversation, no tools.

```
{ message, lobbySessionId? }  →  { message, lobbySessionId }
```

### MCP

#### `POST /api/mcp/[sessionId]`
JSON-RPC 2.0. **Called by TrueForge only.** The session id is a URL segment and is never accepted as a tool argument.

### Session

| Method | Route | Contract |
|---|---|---|
| `POST` | `/api/pdf/extract` | multipart PDF → creates the session, fields, stored document, and opening message |
| `GET` | `/api/session/fields` | Fields + metadata (`hasDocument`); `404` when the session is gone |
| `PATCH` | `/api/session/fields` | `{ sessionId, fieldId, value }` — manual edit from the document view |
| `DELETE` | `/api/session/fields` | `{ sessionId }` — empties every field ("Clear all") |
| `POST` | `/api/session/fill-from-memory` | Agent-free bulk fill from the profile |
| `GET` | `/api/session/pdf` | Streams the original upload as `application/pdf` |
| `GET` | `/api/session/messages` | Conversation history for the UI |
| `GET` | `/api/sessions` | Session list for the sidebar |
| `DELETE` | `/api/sessions/[sessionId]` | Deletes the session, its PDF, and its harness session |

### Approvals

| Method | Route | Contract |
|---|---|---|
| `GET` | `/api/approvals` | List pending approvals for a session |
| `POST` | `/api/approvals` | `{ approvalId, decision: "allow" \| "deny" }` — resumes the paused tool call |

### Database — Neon Postgres

Schema lives in `lib/db.ts#createSchema`, is fully idempotent (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), and runs on demand as well as via `npm run db:migrate`.

| Table | Purpose and notable columns |
|---|---|
| `users` | Single demo user for the MVP |
| `user_memory` | **The profile.** `(user_id, field_key)` unique; keys are canonical |
| `form_sessions` | One per uploaded form. Harness bindings `tf_session_id`, `mcp_server_name`, `tf_model` (a `model@vN` fingerprint); document metadata `document_filename`, `document_size` |
| `form_fields` | Extracted fields with value, status, source, page and coordinates |
| `chat_messages` | Provider-shaped history — role, content, tool_calls, tool_call_id, tool_name |
| `memory_approvals` | The approval gate. `kind` (`memory_save` / `clear_all_fields`), plus `tf_thread_id` / `tf_tool_call_id` identifying the paused call |

Children cascade on delete, so removing a session clears its fields, chat and approvals in one statement.

---

## 18. Design Invariants

These are the rules that keep the architecture honest. Breaking one is a bug even if the tests pass.

1. **No tool schema ever takes a session id or user id.** Scoping is server-side — URL segment for the session, session row for the user. A model that cannot name a session cannot reach another one.
2. **Nothing is written to `user_memory` without explicit user approval.** The only write paths are the harness-approved `save_user_memory` execution and `resolveMemoryApproval` on an approved row.
3. **Policy is code, not prompt, where possible.** The "offer to remember" decision is computed in `fill_form_field`, not left to the model's judgment.
4. **Destructive actions are gated by the harness, not by asking in chat.** A model can skip a prose "are you sure?"; it cannot skip a paused tool call.
5. **`parallel_tool_calls: false`.** Keeps at most one approval pending, which is what the single-card UI expects.
6. **The frontend contract of `/api/agent/chat` stays stable.** The UI has no TrueForge awareness, and should not gain any.
7. **A deterministic action is never reachable only through a model.** Every bulk operation has a UI button hitting the same shared code.
8. **The local-disk PDF store keeps working.** A fresh `git clone && npm run dev` must work with no cloud account.

---

## 19. Reliability & Failure Handling

A hung or throttled provider is the most likely runtime failure, so it is handled explicitly rather than left to surface as raw plumbing.

### 19.1 Idle watchdog — not a turn deadline

A whole-turn deadline is the wrong tool: a legitimate turn filling a dozen fields runs for minutes, while a wedged provider goes silent immediately.

So the watchdog in `lib/trueforge.ts#runTurn` measures the gap **between** SSE events and rearms on each one. If nothing arrives for `TRUEFORGE_IDLE_TIMEOUT_MS` (default 90s):

1. The stream is aborted.
2. The turn is **cancelled server-side** — otherwise the harness keeps executing a turn nobody is reading, and would cancel the user's *next* turn instead.
3. `TurnStalledError` is thrown and mapped to a readable message.

This replaced a five-minute silent hang in the browser.

### 19.2 A runaway completion is a behaviour problem, not a capacity one

A small model handed a request it has no tool for can reason until it hits the provider's output cap, surfacing as `max_tokens breached`. **Raising `max_output_tokens` only buys a longer spiral.** The fixes are giving the agent the missing tool, and instructing it to refuse plainly.

### 19.3 Provider errors become actionable advice

`describeTurnFailure` maps raw errors to something a person can act on:

| Cause | Message |
|---|---|
| `429` | Rate limited — wait, or switch model |
| Timeout | Provider overloaded |
| `ECONNREFUSED` | Start TrueForge |
| `401` / `403` | Fix the provider key |

Covered by `lib/trueforge.test.ts` — keep those tests passing when editing the strings.

### 19.4 Other guards

- **`maxRetries: 0` on turn calls.** The SDK retries twice by default, which on a hanging provider multiplies the wait instead of failing fast.
- **MCP errors carry their cause** rather than a bare "Internal error", so failures are legible in TrueForge's log and to the model.
- **The MCP session lookup retries once**, so a single transient Postgres blip no longer breaks a form mid-fill.
- **Resend detection** — a resend of a turn that never got a reply is treated as a retry, not a second message.
- **`listTurns` is oldest-first and paginated** — `data[0]` is the *first* turn of the session, not the latest. Reading it for `state.requiredActions` finds long-resolved approvals and misses the one actually blocking the thread.

---

## 20. Model Selection Notes

State as of 2026-08-30, verified against this account.

| Provider / model | Status |
|---|---|
| `nvidia-nim/nemotron-3-nano` | ✅ **Default.** Verified with tool calls |
| `nvidia-nim/gpt-oss-120b` | ✅ Works |
| `nvidia-nim/deepseek-v4-flash` | ✅ Works |
| `nvidia-nim/kimi-k3` | ⚠️ Rate limited (HTTP 429) on this account. Under a streaming request the throttle presents as a connection that never sends response headers, so TrueForge waited out its full 300s provider timeout and failed the turn |
| `nvidia-nim/meta-llama-3-2-11b-vision` | ❌ **Do not use for the agent.** NIM's stream omits the final `finish_reason` chunk when the model emits a **zero-argument** tool call (e.g. `get_form_state`), and TrueForge's client then fails the turn with *"Response stream ended without a finish reason"* |
| `openai` | ❌ Invalid API key (401) |
| `google-gemini` | ❌ Invalid/placeholder API key (400) |

### Time-to-first-response-header

The number that decides whether chat feels alive. Measured on a realistic payload — a long tool-using conversation with 11 tools:

| Model | TTFH |
|---|---|
| `nemotron-3-nano` | **0.3s** (3/3 runs) |
| `gpt-oss-120b` | 28s |
| `deepseek-v4-flash` | 26s |
| `kimi-k3` | 429 / hang |

> **Prefer the small fast model.** NIM free-tier availability shifts, so re-measure before changing the default rather than assuming the largest model is the best one.

### Adding a NIM model

1. Verify it streams a **zero-argument tool call** with a `finish_reason`.
2. Verify it returns response headers promptly.
3. `PUT :8790/api/v1/settings/model-providers` with the full manifest — type `custom`, `base_url https://integrate.api.nvidia.com/v1`, `auth.api_key`, `models[]`.
4. Reference it as `nvidia-nim/<name>`.

---

## 21. Testing

```bash
npm test           # unit tests — no network, no TrueForge, no database
                   # chat-history · memory-keys · tool-summary · trueforge
npx tsc --noEmit   # typecheck
npm run build      # production build
npm run smoke      # E2E against a running dev server + real DB (writes rows)
```

### Manual E2E with curl

With both servers running:

```bash
# 1. Create a session
curl -F "file=@form.pdf" localhost:3000/api/pdf/extract

# 2. Run a turn
curl -X POST localhost:3000/api/agent/chat \
  -H 'content-type: application/json' \
  -d '{"sessionId":"…","message":"fill what you can from my profile"}'

# 3. Resolve an approval
curl -X POST localhost:3000/api/approvals \
  -H 'content-type: application/json' \
  -d '{"approvalId":"…","decision":"allow"}'
```

Then inspect the harness side with the endpoints in [§16](#16-running-the-project).

> Stale `.next/` types can fail `tsc` after route files move — `rm -rf .next` and retry.

---

## 22. Screenshots & Visual Walkthrough

_TODO: add `screen_shots/` and link them here._

| View | Screenshot |
|---|---|
| Chat front door with drag-and-drop upload | _TODO_ |
| Three-panel workspace | _TODO_ |
| Approval card — save to profile | _TODO_ |
| Approval card — clear all fields (destructive) | _TODO_ |
| Agent activity, summarised | _TODO_ |
| Second form auto-filling from memory | _TODO_ |
| TrueForge harness — registered MCP connector and its tools | _TODO_ |
| TrueForge harness — a paused tool call awaiting approval | _TODO_ |

---

## 23. AI Usage Disclosure

- **At runtime**, ThinkFill uses an LLM (NVIDIA NIM, `nemotron-3-nano` by default) as the reasoning engine of the form-filling agent, orchestrated entirely by TrueForge. The model decides which tools to call and what to ask the user; it never writes to the user's profile without a human approving the paused tool call.
- **During development**, AI coding assistants were used. `AGENTS.md` and `CLAUDE.md` in the repo root are instruction files for those agents, and `docs/ARCHITECTURE.md` is written to be read by both humans and coding agents.
- All architectural decisions, the MCP protocol implementation, the canonical-key engine and the approval model were designed and reviewed by the author.

---

## 24. Known Limits & Future Improvements

Honest scope, roughly in the order these would matter.

| Limit | Detail |
|---|---|
| **No authentication** | One hard-coded demo user; every session belongs to it. The MCP endpoint authenticates nothing — safe on loopback, **not safe on a public URL.** |
| **Not deployed** | The app is Vercel-ready, but TrueForge cannot run on Vercel — it is a stateful long-running server needing Postgres + Redis in hosted mode. Deploying also needs a runtime-safe callback URL (`NEXT_PUBLIC_APP_URL` is frozen at build time by Next), `maxDuration` on the turn routes (turns take 16–45s), a bearer token for an authenticated harness, and recovery when the harness no longer knows a stored `tf_session_id`. |
| **AcroForm PDFs only** | A flat scanned PDF extracts no fields. Handling scans needs OCR plus layout inference. |
| **4 MB upload cap** | Vercel Functions reject a request body over 4.5 MB and the upload passes through this app. Raising it means switching to client uploads (browser → Blob directly). |
| **Multi-page polish** | Coordinate export is page-aware, but the viewer and navigator have had little testing beyond one page. |
| **MCP connectors accumulate** | Per-session connectors pile up in TrueForge settings — v0.1.4 has no delete API. Cosmetic. |
| **A poisoned session cannot be rescued by config** | A session whose history already contains *"I filled those fields"* keeps concluding the work is done, because compaction preserves that meaning. Use the UI buttons, or start a new session — the profile carries over. |

### Roadmap

- [ ] Authentication and multi-user profiles
- [ ] OCR + layout inference for scanned forms
- [ ] Profile management UI — view, edit, and delete saved values
- [ ] Direct browser → Blob upload to lift the 4 MB cap
- [ ] Deploy the harness with a bearer token and session recovery
- [ ] Field-level provenance in the UI ("filled from memory, saved 3 forms ago")
- [ ] Export a filled form as structured data, not just a PDF

---

## 25. Team / Author

**Gopinath V** — [@Gopinathv19](https://github.com/Gopinathv19)

---

## 26. License

MIT — see [LICENSE](LICENSE).

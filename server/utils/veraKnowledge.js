// VERA knowledge base — the single source of truth for the Virtual Environmental
// Response Assistant that helps SLF Portal users.
//
// This replaces the old static FAQ (front-end SUPPORT_FAQ_ITEMS). Every entry is
// PUBLIC, portal-workflow guidance only — it contains NO secrets, credentials,
// environment values, internal prompts, or live record data. VERA answers strictly
// from this material (grounding), so keep it in step with the real portal workflow:
// locked baseline unit, required vehicle capacity, Review-and-Submit gating, and
// the Organize Cells rules for approved submissions with unassigned waste.
//
// Shape of each entry:
//   { id, category, question, keywords: [], answer, related: [ids] }
//
// `keywords` drive the lightweight retrieval scorer in veraAssistant.js and the
// rule-based fallback used when no AI model is configured.

const { SUPPORT_EMAIL } = require("../config/contact");
const ASSISTANT_NAME = "VERA";
const ASSISTANT_FULL_NAME = "Virtual Environmental Response Assistant";

// Human-friendly labels for the portal sections VERA can be made page-aware about.
const PAGE_LABELS = {
  dashboard: "Assigned SLF Dashboard",
  overview: "Overview",
  "data-entry": "Data Entry",
  dataentry: "Data Entry",
  baseline: "Baseline / Accredited Haulers",
  history: "Submission History",
  "organize-cells": "Organize Cells",
  organizecells: "Organize Cells",
  requests: "My Requests",
  drafts: "Drafts & Scheduled",
  profile: "Profile",
};

const KNOWLEDGE_BASE = [
  {
    id: "required-to-submit",
    category: "submission",
    question: "What information is required to submit?",
    keywords: [
      "required", "requirement", "need", "needed", "mandatory", "submit", "submission",
      "what do i need", "fields", "information", "complete",
    ],
    answer:
      "A submission needs: your Waste Generator (company) information, saved Baseline Data, the Date of Disposal, and at least one transport entry. Each transport entry requires a disposal ticket no., hauler, plate number, actual volume, waste type, and a disposal cell. A Hazardous Waste Code is required for every Treated Hazardous Waste entry. All volumes use your declared baseline unit.",
    related: ["how-to-submit", "review-submit-disabled", "validation-errors"],
  },
  {
    id: "how-to-submit",
    category: "submission",
    question: "How do I submit disposal data?",
    keywords: [
      "how to submit", "submit disposal", "send data", "file", "encode", "data entry",
      "review and submit", "review & submit", "steps to submit", "submission steps",
    ],
    answer:
      "Go to Data Entry, complete the Basic Information, Baseline, and Waste Generator Information tabs, add your transport entries, then use Review & Submit. The button stays disabled until every requirement is met — hover it to see exactly what is still missing. The server re-validates everything again when you submit.",
    related: ["required-to-submit", "review-submit-disabled"],
  },
  {
    id: "add-haulers",
    category: "haulers",
    question: "How do I add and select accredited haulers?",
    keywords: [
      "hauler", "haulers", "accredited", "add hauler", "select hauler", "vehicle",
      "plate number", "transport", "trucking",
    ],
    answer:
      "Add your accredited haulers (with their vehicles) on the Baseline / Accredited Haulers tab before your first submission. When encoding a transport entry, pick the hauler and plate number from your accredited list so the portal can validate the truck against its registered capacity.",
    related: ["hauler-clients", "vehicle-capacity", "upload-formats"],
  },
  {
    id: "hauler-clients",
    category: "haulers",
    question: "What are Hauler Clients and where do they show?",
    keywords: [
      "hauler client", "hauler clients", "client", "clients", "private sector",
      "waste generator information", "column",
    ],
    answer:
      "Hauler Clients are the private-sector clients associated with an accredited hauler. They appear in a Hauler Clients column right after the Hauler Name in your Waste Generator Information and in the admin submission view. Leave it blank if a hauler has no clients — it shows as “—”.",
    related: ["add-haulers"],
  },
  {
    id: "vehicle-capacity",
    category: "haulers",
    question: "Is Vehicle Capacity required?",
    keywords: [
      "vehicle capacity", "truck capacity", "capacity", "required capacity", "zero",
      "greater than 0", "capacity required",
    ],
    answer:
      "Every accredited-hauler vehicle must have a Vehicle Capacity greater than 0. For Truck Capacity: it is REQUIRED on every uploaded disposal row (the parser and server reject a missing or zero value), and OPTIONAL when you add a transport entry manually — any missing historical truck capacity is completed later in Organize Cells. A present value must always be greater than 0.",
    related: ["add-haulers", "organize-cells", "validation-errors"],
  },
  {
    id: "review-submit-disabled",
    category: "submission",
    question: "Why is Review & Submit disabled?",
    keywords: [
      "review submit disabled", "button disabled", "cannot submit", "can't submit",
      "greyed out", "grayed out", "why disabled", "blocked", "submit disabled",
    ],
    answer:
      "Review & Submit is disabled while any requirement is unmet — incomplete company/baseline/disposal info, a missing disposal cell or hazardous code, a vehicle without capacity, an unresolved reverted submission, or past submissions still needing Organize Cells. Hover the button for the exact checklist. The server re-validates everything again on submit.",
    related: ["required-to-submit", "validation-errors", "approved-unassigned", "edit-submitted"],
  },
  {
    id: "organize-cells",
    category: "cells",
    question: "How do I organize and assign SLF cells?",
    keywords: [
      "organize cells", "assign cell", "assign cells", "disposal cell", "cell",
      "placement", "place waste", "bulk assign", "save placement", "unassigned",
    ],
    answer:
      "Open Organize Cells from the menu. For each unassigned waste record, pick an open (active, not full) disposal cell; you can also complete any missing historical truck capacity there. Use the checkboxes and the bulk-assign bar to place many rows at once, then Save Placement.",
    related: ["approved-unassigned", "vehicle-capacity"],
  },
  {
    id: "approved-unassigned",
    category: "cells",
    question: "I have approved submissions with unassigned waste — what now?",
    keywords: [
      "approved unassigned", "approved submission", "unassigned waste", "blocked new",
      "still need cells", "cannot submit new", "organize past",
    ],
    answer:
      "Approved submissions that still contain waste not placed into a cell appear in Organize Cells. Assign the remaining records to cells (already-assigned records stay as they are, and the approved status is not reverted). Once every record is assigned, the submission drops off the list. New submissions are blocked until this is done.",
    related: ["organize-cells", "review-submit-disabled"],
  },
  {
    id: "update-baseline",
    category: "baseline",
    question: "How do I update baseline data?",
    keywords: [
      "update baseline", "baseline data", "baseline locked", "request update", "change baseline",
      "edit baseline", "locked", "my requests",
    ],
    answer:
      "Baseline data locks after your first submission. Use Request Update on the Baseline tab; an admin reviews and approves or rejects it. Track the request under My Requests.",
    related: ["edit-submitted", "statuses"],
  },
  {
    id: "edit-submitted",
    category: "submission",
    question: "How do I edit a submitted entry?",
    keywords: [
      "edit submitted", "edit submission", "change submission", "request edit", "correct",
      "reverted", "revert", "resubmit", "modify entry",
    ],
    answer:
      "Open Submission History, select the record, and send a Request Edit. The admin team approves or rejects it. If a submission is reverted, correct and resubmit it — an unresolved revert older than 24 hours blocks new submissions.",
    related: ["statuses", "review-submit-disabled", "update-baseline"],
  },
  {
    id: "statuses",
    category: "status",
    question: "How do I read Submission History and statuses?",
    keywords: [
      "status", "statuses", "history", "pending", "acknowledged", "approved", "rejected",
      "reverted", "revert requested", "submission history", "track", "what does status mean",
    ],
    answer:
      "Pending = awaiting admin review. Acknowledged/Approved = accepted (may still need cells organized). Revert Requested / Reverted = sent back for correction. Rejected = not accepted and locked. Use History to see each record's status and cell-placement progress. VERA reports what each status means but cannot confirm the live status of your specific record — check Submission History for that.",
    related: ["edit-submitted", "organize-cells"],
  },
  {
    id: "validation-errors",
    category: "errors",
    question: "Common validation errors and how to fix them",
    keywords: [
      "error", "errors", "validation", "invalid", "fix", "cannot proceed", "warning",
      "disposal cell required", "unit must be", "capacity exceeds", "vehicle capacity required",
      "organize past submissions", "red", "message",
    ],
    answer:
      "“Disposal Cell required” — pick a cell for the entry. “Unit must be <baseline>” — every entry uses your declared baseline unit. “Capacity exceeds +10%” — the entered capacity is too high versus the registered vehicle. “Vehicle Capacity required” — fill capacity on Accredited Haulers. “Organize past submissions first” — complete Organize Cells before submitting.",
    related: ["review-submit-disabled", "vehicle-capacity", "organize-cells"],
  },
  {
    id: "units-and-conversion",
    category: "errors",
    question: "What units does the portal use, and how are tons and m³ related?",
    keywords: [
      "unit", "units", "tons", "ton", "tonnes", "m3", "m³", "cubic meter", "cubic metre",
      "convert", "conversion", "volume unit", "which unit", "unit must be", "change unit",
    ],
    answer:
      "The portal works in two volume units: tons and m³ (cubic meters). Every entry must use your SLF's declared baseline unit — that is why you may see “Unit must be <baseline>”. If you need to convert between them the system uses a fixed factor: m³ = tons ÷ 0.50, and tons = m³ × 0.50. You do not convert by hand — enter the value in your declared unit and the system stores your original value and shows the converted figure where needed, so your number is never altered. If your declared unit looks wrong, ask an admin to update it with Set Field Units; a value with no unit cannot be counted and will be flagged.",
    related: ["validation-errors", "update-baseline", "vehicle-capacity"],
  },
  {
    id: "submission-not-saved",
    category: "errors",
    question: "My submission failed or didn't save — what should I do?",
    keywords: [
      "failed", "failed submission", "did not save", "didn't save", "not saved", "disappeared",
      "missing submission", "lost", "server error", "submit failed", "no confirmation",
      "double submit", "submitted twice", "duplicate",
    ],
    answer:
      "First check Submission History — it reflects what the server actually saved, so if your entry is there it was recorded (even if the confirmation was slow). If it is not there, submit again: the portal uses an idempotency key, so a retry of the same submission will not create a duplicate. If it still fails, the error is recorded for the admin team automatically; open a support ticket here in VERA with the date and SLF so an admin can check. Do not keep re-clicking Submit — wait for the result or the error message.",
    related: ["statuses", "edit-submitted", "contact-support"],
  },
  {
    id: "upload-formats",
    category: "upload",
    question: "What file formats can I upload?",
    keywords: [
      "upload", "file format", "excel", "xlsx", "xls", "csv", "import", "bulk upload",
      "spreadsheet", "attach file",
    ],
    answer:
      "The portal accepts Excel (.xlsx, .xls) and CSV files for bulk accredited-hauler and transport-entry uploads. Rows are validated on import; fix any flagged rows before adding them. Every uploaded disposal row must include a Truck Capacity greater than 0.",
    related: ["add-haulers", "vehicle-capacity", "validation-errors", "system-generated-upload"],
  },
  {
    id: "system-generated-upload",
    category: "upload",
    question:
      "My system-generated disposal file is rejected — every row says the hauler is not assigned. Why?",
    keywords: [
      "system generated", "system-generated", "generated file", "weighbridge", "gate system",
      "machine generated", "export from our system", "hauler is not assigned",
      "not assigned under this slf", "client is not assigned", "every row fails",
      "all rows rejected", "upload rejected", "same name", "hauler and client the same",
      "alignment", "matched", "does not match baseline",
    ],
    answer:
      "That is the usual symptom of a file exported from your own weighbridge or gate system rather than typed into the portal template. Those systems record ONE party per trip — whoever the ticket was issued to — and write that single value into both the Hauler and the Client column. The portal records a trip as Hauler → Client, so neither column matches your baseline as written and every row fails with the same message.\n\nThe upload preview now resolves this for you. When the file is uploaded it is checked against your accredited haulers and their clients, and a row is matched automatically when the answer is unambiguous — a combined \"HAULER - CLIENT\" value that can be split into a hauler and one of its own clients, or a client name served by exactly one of your accredited haulers. (A company that hauls its own waste needs nothing special: if it is on your baseline as a hauler listing itself as a client, the repeated name matches on its own.) Matched rows are tagged in the preview's Match column; hover the tag to see what the file said and what it was read as, and confirm it before you import.\n\nRows that still cannot be matched name a record your baseline does not have. The preview lists those names, and I list them grouped by hauler with the number of trips waiting on each. Add them under Baseline / Accredited Haulers — the hauler itself, or the client under its hauler — save the baseline update, then re-upload the same file unchanged.\n\nNothing is guessed: where two readings are equally possible the row is left blocked rather than attributed to the wrong hauler, because that would misstate that hauler's volumes and the served-LGU counts.",
    related: ["upload-formats", "hauler-clients", "baseline-completeness", "add-haulers"],
  },
  {
    id: "client-name-mismatch",
    category: "upload",
    question:
      "The upload says my client is not on the hauler, but I can see it there. What is a client name mismatch?",
    keywords: [
      "client name mismatch", "mismatch", "not one of its clients", "i can see it there",
      "client is not assigned", "client not on hauler", "spelled differently",
      "different spelling", "same client twice", "duplicate client", "rename client",
      "use the stored name", "closest match", "did you mean",
    ],
    answer:
      "It means the baseline HAS that client, under a different spelling from the one in your file — for example \"GREEN RESCUE - MUNICIPALITY OF PULILAN\" stored against \"GREEN RESCUE - MUNICIPALITY OF PULILAN, BULACAN\" in the file. That is a different problem from a client the baseline is missing, and it has a different fix: adding it again would create a DUPLICATE that splits that client's disposal volumes across two records.\n\nThe upload preview detects this and offers you the choice, because only you know which spelling is right:\n\n• **Use the stored name** — rewrites this file's rows to the name already on the baseline. Your baseline is not changed; only this import.\n• **Rename it on the hauler** — corrects the client on the hauler, keeping its type, province and municipality. This is a baseline edit, so click Save Baseline Update afterwards.\n• **They are different — add as a new client** — only if the two names really are two different clients.\n\nOne choice settles every row in the file carrying that hauler and client, so a name repeated on forty trips is one decision. Nothing is applied automatically: a candidate must be the other name plus a qualifier, or share every word with it, and even then it is only ever offered for you to accept — attributing a trip to the wrong LGU is exactly what an import must not do on a guess.",
    related: ["system-generated-upload", "upload-preview-columns", "hauler-clients"],
  },
  {
    id: "upload-preview-columns",
    category: "upload",
    question: "What do the Match and Validation columns in the upload preview mean?",
    keywords: [
      "match column", "validation column", "preview column", "preview table",
      "what does match mean", "exact", "matched", "name mismatch", "not on baseline",
      "ambiguous", "issues", "preview", "upload preview", "waste type colour",
      "waste type color", "capacity volume column", "hauler client column",
    ],
    answer:
      "The preview grid shows, for every row, what will be imported and what is stopping it.\n\n• **Match** — how the row was resolved against your baseline. *Exact* means the file's hauler and client matched as written. *Matched* (gold) means the row was resolved for you — hover it to see exactly what the file said and what it was read as, and confirm before importing. *Name mismatch* means the baseline has that client under a different spelling, and the panel above the table offers the fix. *Not on baseline* means the record has to be encoded first.\n• **Validation** — every problem with the row, one per line, in words: what is wrong and what to do about it. A row with issues cannot be imported until they are cleared.\n\nHauler and Client share one column because a trip is attributed through Hauler → Client and they are validated as a pair. Truck Capacity, Volume and Unit share one because the unit applies to both figures and the plausibility check needs all three together. Waste types carry the same colours used on the cell gauges — Residual green, Hazardous red, Treated Hazardous orange — and are chosen from a list, since only those three values can be stored.",
    related: ["system-generated-upload", "upload-formats", "validation-errors"],
  },
  {
    id: "cell-placement-inheritance",
    category: "submission",
    question: "Why do I still have to choose a disposal cell for each vehicle?",
    keywords: [
      "choose a cell", "select a cell", "assign a disposal cell", "cell for each vehicle",
      "already placed", "cell already", "why do i have to pick a cell", "per vehicle cell",
      "assign to cell", "cell placement", "placed cell", "disposal cell required",
    ],
    answer:
      "You should not have to, if the entry is already placed. When a transport entry has a disposal cell — set through **Assign to Cell**, carried in from an upload, or chosen on the entry itself — every vehicle on that entry now inherits that placement, and the form no longer asks you to choose one again.\n\nThe inheritance is real, not just a relaxed check: the placement is written onto each vehicle when you save. That matters because EMB's side reads the cell from each vehicle and ignores the entry-level one when vehicles are present — so a vehicle left without a cell was counted as unplaced waste, and the entry came back to you in Organize Cells even though you had already placed it.\n\nYou are still asked for a cell when nothing is placed yet. If a vehicle genuinely went to a different cell from the rest of the entry, set that vehicle's own cell — a placement of its own always wins over the inherited one. And if your facility currently has no cell that can accept waste, you are not blocked on choosing one; there is nothing to choose, and the Organize Cells step will ask once a cell reopens.",
    related: ["organize-cells", "approved-unassigned", "required-to-submit"],
  },
  {
    id: "baseline-completeness",
    category: "haulers",
    question:
      "Which of my haulers or clients are incomplete — missing an address, a province, or clients?",
    keywords: [
      "incomplete", "missing address", "no address", "office address", "hauler address",
      "client address", "missing province", "missing municipality", "no clients",
      "hauler has no clients", "complete the baseline", "update addresses",
      "which haulers", "data completeness", "encode address",
    ],
    answer:
      "Ask me and I check your own baseline live and name the records, not just the count. I look at four things:\n\n• Haulers with no clients — the most disruptive. Every disposal row is attributed through Hauler → Client, so a hauler with an empty client list cannot have a single trip uploaded against it.\n• Haulers with no Office Address — fix in Baseline Data → Accredited Haulers → Edit → Office Address. Note that Office Address is an OPTIONAL column of the hauler bulk upload and a blank cell means \"keep what is stored\", so re-uploading a file that leaves it empty will not fill it in; the value has to be supplied in the file or typed in.\n• Clients with no Client Type, Province or City/Municipality — the province is what classifies a client within or outside Region 3, so these reach EMB as incomplete records and are left out of the regional figures.\n• Clients with no address.\n\nFor bulk work: open a hauler, use Export Client List, correct the file in Excel and upload it back through Upload Client List — the export and the uploader are the same format by construction. A blank cell never clears a stored value, so you can fill in just the column you are correcting.",
    related: ["hauler-clients", "add-haulers", "special-economic-zones", "upload-formats"],
  },
  {
    id: "special-economic-zones",
    category: "haulers",
    question:
      "My client is inside Clark Freeport Zone — how do I encode a special economic zone as the municipality?",
    keywords: [
      "clark", "clark freeport", "freeport", "freeport zone", "subic", "subic bay",
      "special economic zone", "ecozone", "economic zone", "peza", "sbma", "afab",
      "freeport area of bataan", "apeco", "new clark city", "cannot find municipality",
      "municipality not in the list", "zone", "cdc", "bcda",
    ],
    answer:
      "Pick the zone itself. Special economic zones and freeports are listed in the client's City/Municipality picker under their host province, alongside the ordinary municipalities and labelled \"special economic zone\".\n\nThey have to be listed separately because they are not political subdivisions: Clark Freeport Zone straddles Angeles City, Mabalacat and Porac in Pampanga plus Bamban and Capas in Tarlac and is administered by a zone authority rather than by any of them, so it appears nowhere in the national PSGC list the picker is otherwise built from. A zone that spans two provinces is offered under both — pick the province the client is actually in.\n\nThe zones available include Clark Freeport Zone, Clark Special Economic Zone, New Clark City, Subic Bay Freeport Zone, the Freeport Area of Bataan, Bataan Economic Zone and the Aurora Pacific Economic Zone and Freeport, plus the major zones outside Region III. Do NOT substitute a neighbouring municipality for a client inside a zone: it puts the trip against an LGU that has no responsibility for the waste and distorts the served-LGU counts. If the zone you need is genuinely missing, email eswmr3@emb.gov.ph and EMB Region III can encode it.",
    related: ["baseline-completeness", "hauler-clients"],
  },
  {
    id: "my-backlogs",
    category: "submission",
    question: "Do I have any backlogs / what is still pending before I can submit?",
    keywords: [
      "backlog", "backlogs", "pending", "outstanding", "incomplete", "remaining",
      "what do i need", "still need", "left to do", "blocked", "blocker",
      "why can't i submit", "cannot submit", "review submit disabled", "greyed out",
      "not ready", "requirements", "to do", "unfinished",
    ],
    answer:
      "Ask me “do I have any backlogs?” or “why can't I submit?” and I check your own account live: unresolved reverted submissions, past submissions still needing Organize Cells (unassigned disposal cells or missing Truck Capacity), your account/verification status, whether submission access is enabled, and whether your assigned SLF is operational. I name each outstanding item and the exact action to clear it. One thing I cannot see is the form you are typing into right now — Date of Disposal, transport entries, each entry's disposal cell and hazardous waste code are checked in your browser, so hover the disabled Review & Submit button for that live checklist.",
    related: ["review-submit-disabled", "organize-cells", "edit-submitted"],
  },
  {
    id: "account-access",
    category: "support",
    question: "I can't log in / I forgot my password — what do I do?",
    keywords: [
      "password", "forgot password", "reset password", "change password", "login",
      "log in", "sign in", "cannot login", "can't log in", "locked out", "locked",
      "account", "username", "credentials", "access", "wrong password", "invalid",
    ],
    answer:
      "Use the “Forgot password” link on the portal login page — a reset link is sent to your registered email, so check spam if it does not arrive within a few minutes. If your email address has changed, or the account is locked or deactivated, only an EMB Region III admin can restore it: email eswmr3@emb.gov.ph with your facility name and the account's registered email. For security, nobody — including me — can retrieve or read your existing password; it can only be reset. Never share your password with anyone.",
    related: ["contact-support"],
  },
  {
    id: "contact-support",
    category: "support",
    question: "Who do I contact for help?",
    keywords: [
      "contact", "help", "support", "ticket", "email", "who to contact", "assistance",
      "human", "agent", "report", "problem",
    ],
    answer:
      `Open a support ticket right here in VERA for portal, account, or submission concerns — use the “Open a support ticket” action below. You can also email ${SUPPORT_EMAIL}. Track existing tickets under “My tickets”.`,
    related: ["statuses"],
  },
  {
    id: "what-is-vera",
    category: "meta",
    question: "What can VERA help me with?",
    keywords: [
      "what can you do", "who are you", "vera", "help me", "capabilities", "assistant",
      "what is vera", "how can you help",
    ],
    answer:
      `I'm ${ASSISTANT_NAME} (${ASSISTANT_FULL_NAME}), the SLF Portal assistant. I can explain portal features and workflows, guide you through forms, submissions, status tracking, cell organization, uploads, and common errors, and warn you about missing or risky inputs before you submit. I only cover the SLF Portal — for anything else, or to reach a person, open a support ticket.`,
    related: ["required-to-submit", "how-to-submit", "contact-support"],
  },
  // ── Bulk hauler & client maintenance ──────────────────────────────────────
  // Added with the release the portal's feature tour announces. VERA is offered
  // as a way to walk through that change, so these have to be here: without
  // them VERA would answer "what's new?" from the OLD workflow entries above
  // and confidently describe a process that no longer exists.
  {
    id: "hauler-upload-columns",
    category: "haulers",
    question: "What columns does the Accredited Haulers Excel upload accept?",
    keywords: [
      "hauler upload", "upload haulers", "hauler columns", "excel columns", "csv columns",
      "accredited hauler upload", "hauler template", "required columns", "client region",
      "client province", "client city", "client municipality", "upload format",
    ],
    answer:
      "Thirteen columns: Hauler Name and Number of Trucks (both required), Office Address, Plate Number, Vehicle Type, Capacity, Capacity Unit, Clients, Client Type, Client Address, Client Region, Client Province and Client City/Municipality. The three client location columns let a bulk update record everything the Add Hauler form asks for — Client Province is what classifies a client inside or outside Region 3, so supply it for every new client. A blank optional cell keeps the value already saved; it never clears one. Download Sample Template writes exactly these columns with a worked example.",
    related: ["hauler-upload-rows", "hauler-export-roundtrip", "add-haulers"],
  },
  {
    id: "hauler-upload-rows",
    category: "haulers",
    question: "How many rows does a hauler need if it serves several clients?",
    keywords: [
      "how many rows", "multiple clients", "several clients", "many clients", "one row",
      "rows per hauler", "client group", "clients only row", "no plate number",
      "hauler rows", "layout",
    ],
    answer:
      "One row describes one vehicle, and clients belong to the hauler rather than to the truck on their row — so you never match clients to trucks. A hauler needs as many rows as the LARGER of: its number of vehicles, or its number of client groups (at least one). A client group is a set of clients sharing the same Client Type, Client Address, Client Region, Client Province and Client City/Municipality — those can be listed together in one Clients cell, separated by commas. If a hauler has more client groups than vehicles, the extra rows simply carry no Plate Number; they add no vehicle. Repeat the Hauler Name and Number of Trucks on every row of the same hauler.",
    related: ["hauler-upload-columns", "hauler-client-list-upload"],
  },
  {
    id: "hauler-export-roundtrip",
    category: "haulers",
    question: "How do I use Export Hauler Data to update haulers in bulk?",
    keywords: [
      "export hauler data", "export haulers", "edit in excel", "round trip", "re-upload",
      "bulk edit", "bulk update haulers", "download my haulers",
    ],
    answer:
      "Export Hauler Data writes your current haulers in exactly the columns the uploader reads, so it is an editable worksheet rather than a report: download it, correct or add rows in Excel, then upload it back through Upload Excel/CSV. Starting from the export is the safer path, because the hauler and client names then match what is stored letter for letter — and matching is by name, so a retyped name creates a second hauler instead of updating the first. Inside Edit Accredited Hauler there is also an Export Hauler Data button for that one hauler on its own.",
    related: ["hauler-upload-columns", "hauler-upload-rows"],
  },
  {
    id: "hauler-client-list-upload",
    category: "haulers",
    question: "How do I upload a client list for just one hauler?",
    keywords: [
      "client list", "upload client list", "export client list", "clients per hauler",
      "one hauler clients", "client upload", "bulk clients", "client template",
    ],
    answer:
      "Each row in the Accredited Haulers table has a client-list action that opens that hauler with Export Client List and Upload Client List. The sheet has six columns — Client Name and Client Type (required), plus Client Address, Region, Province and City/Municipality — and deliberately NO Hauler Name column, because the hauler is the one you opened, so a bulk client update cannot land on the wrong hauler. Clients are matched by name: an existing name updates that client, a new one adds it. A client being ADDED needs a Client Type and a Province, the same details the Add Client form asks for; a client being updated can fill one field and leave the rest blank. Nothing is ever removed by an upload — delete a client in the Clients table instead.",
    related: ["hauler-upload-rows", "vera-upload-assessment", "hauler-clients"],
  },
  {
    id: "vera-upload-assessment",
    category: "haulers",
    question: "What does VERA check when I upload haulers or a client list?",
    keywords: [
      "vera assessment", "vera check", "vera review", "assess upload", "before import",
      "risky rows", "near match", "duplicate hauler", "second opinion",
    ],
    answer:
      "When an upload preview validates cleanly, I review it before you import and report what is legal but probably wrong: a hauler or client name that closely resembles one you already have without matching it (which would ADD a second record instead of updating the first), a truck capacity or truck count that looks implausible, a fleet count that disagrees with the plate numbers supplied, a new client with no province, and an LGU recorded as Private or the reverse. I am a second opinion, never a gate — I cannot block your import, and if I am unavailable your file is still valid and can be imported. You can also re-assess after editing rows in the preview.",
    related: ["hauler-client-list-upload", "hauler-upload-columns"],
  },
  {
    id: "whats-new-haulers",
    category: "haulers",
    question: "What changed in the Accredited Haulers section?",
    keywords: [
      "what changed", "what's new", "whats new", "new feature", "new features", "update",
      "changes today", "new process", "recent changes", "tour",
    ],
    answer:
      "Five changes to bulk hauler maintenance. (1) The Accredited Haulers upload now carries Client Region, Client Province and Client City/Municipality. (2) Export Hauler Data writes the exact columns the uploader reads, so an export can be corrected in Excel and uploaded straight back. (3) The upload format guide now explains ROW LAYOUT with a worked example — how many rows a hauler needs when it serves several clients. (4) Each hauler row has a new client-list action for exporting and uploading that one hauler's clients on a six-column sheet with no Hauler Name column. (5) I now review a validated upload before you import it and flag rows that look wrong without blocking you. You can replay the guided tour any time from What's New Tour.",
    related: [
      "hauler-upload-columns", "hauler-upload-rows", "hauler-export-roundtrip",
      "hauler-client-list-upload", "vera-upload-assessment",
    ],
  },
];

// Suggested starter questions shown in the chat when a conversation begins.
const STARTER_QUESTIONS = [
  "What information is required to submit?",
  "Why is Review & Submit disabled?",
  "How do I organize and assign SLF cells?",
  "What do the submission statuses mean?",
  "How do I fix a common validation error?",
];

// Canned, model-independent responses used by the scope guard / fallbacks.
const OUT_OF_SCOPE_REPLY =
  `I can only help with the SLF Portal — submissions, baseline data, haulers, cells, statuses, uploads, and support. I can't help with that topic. If you think this is a portal issue I've misread, rephrase it, or open a support ticket and the team will assist.`;

const CANNOT_VERIFY_REPLY =
  `I can explain how the portal works, but I can't verify live details of your specific records or account. Please check Submission History / My Requests in the portal, or open a support ticket (or email ${SUPPORT_EMAIL}) so the team can confirm.`;

const GREETING_REPLY =
  `Hi! I'm ${ASSISTANT_NAME}, your ${ASSISTANT_FULL_NAME}. Ask me about submitting disposal data, baseline updates, haulers, organizing cells, statuses, uploads, or common errors. How can I help?`;

module.exports = {
  SUPPORT_EMAIL,
  ASSISTANT_NAME,
  ASSISTANT_FULL_NAME,
  PAGE_LABELS,
  KNOWLEDGE_BASE,
  STARTER_QUESTIONS,
  OUT_OF_SCOPE_REPLY,
  CANNOT_VERIFY_REPLY,
  GREETING_REPLY,
};

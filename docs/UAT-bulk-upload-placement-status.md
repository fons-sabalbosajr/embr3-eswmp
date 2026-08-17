# UAT — Bulk Upload, Cell Waste Placement, Submission Status, Portal Tour

Acceptance script for the four fixes in this change. The automated suites
(`cd server && npm test`) already gate correctness; this covers what only a real
browser against real data can show — perceived speed, behaviour across a logout,
and that nothing in the existing workflow moved.

Run **section 0** before deploying and **sections 1–4** on the VPS after.

| | Area | Fixed |
|---|---|---|
| 1 | SLF Portal → Organize Cells → Bulk Upload | one `bulkWrite` per batch instead of one `save()` per submission |
| 2 | Admin → Portal & Submission → Cell Waste Placement | indexed sort + projected list query; Refresh no longer throws |
| 3 | Admin → Portal & Submission → Submission | approval answers before its derived work; broadcasts the change |
| 4 | SLF Portal → What's New tour + announcement banner | both dismissals persisted server-side; the banner's is keyed to the announcement |

---

## 0. Pre-deploy gate (local)

```bash
cd server     && npm test          # expect: 360 pass, 0 fail
cd front-end && npm test           # expect:  60 pass, 0 fail
cd front-end  && npm run build     # expect: built, chunk-size warning only
```

All three must be green before pushing. Then on the VPS:

```bash
git pull && cd server && npm ci --omit=dev
cd ../front-end && npm ci && npm run build
pm2 restart <app>            # or your process manager
pm2 logs <app> --lines 50    # no boot errors, Mongo connected
```

**Index note.** Two indexes are declared in this change
(`Transaction.meta.batchId`, sparse). Mongoose builds them on boot in the
background. On a large `transactions` collection give it a minute before
section 1, and confirm:

```
mongosh> db.transactions.getIndexes().filter(i => i.key['meta.batchId'])
```

---

## 1. Bulk Organize Cells

Sign in as a portal user with an assigned SLF that has **open cells with room**.

### 1.1 Happy path — the workflow is unchanged

1. Open **Organize Cells → Bulk Organize**.
2. **Download Template.** → Opens with one row per placement needing a cell.
   Columns are exactly: Row ID, Submission Ticket No, Submission ID, Reference
   No, Disposal Date, Hauler, Plate No, Waste Type, Volume, Unit, Truck
   Capacity, Current Cell, Target Cell, Remarks. A second sheet lists the
   available cells.
3. Fill **Target Cell** on 10 rows using names from the *Available Cells* sheet.
   Leave one row's **Truck Capacity** blank, fill the rest.
4. Upload → **Validate**.
   - [ ] The blank-capacity row is reported **Invalid** with *"missing its Truck
         Capacity"*.
   - [ ] Every other row is **Valid**.
   - [ ] **Apply Assignments** is disabled while any row is invalid.
5. Fill the missing capacity, re-upload, **Validate**, **Apply**.
   - [ ] Success message names the number applied.
   - [ ] The modal closes and the submissions list refreshes.
   - [ ] Reopening **Organize Cells** shows those placements now carrying their
         cell **and** their capacity — the submission is no longer blocked.

### 1.2 Errors stay visible (must NOT be swallowed)

| Do this | Expect |
|---|---|
| Type a cell name that is closed / full | row **Invalid**, *Cell Unavailable* or *Capacity Exceeded* |
| Edit a **Row ID** to something invented | row **Invalid**, *Unknown Submission* |
| Change a **Submission Ticket No** but keep its Row ID | row **Invalid**, *Ticket Mismatch* |
| Duplicate a row | second one **Invalid**, *Duplicate* |
| Enter Truck Capacity `0` or `-4` | row **Invalid**, *Bad Truck Capacity* |
| **Download Error Report** with failures present | .xlsx listing only failed rows + reasons |

- [ ] **All-or-nothing holds:** with one invalid row among many valid ones,
      click Apply → *"No changes were applied"*, and **no** placement changed.

### 1.3 Scale — the actual fix

Fill the template for **500+ rows** (both Target Cell and Truck Capacity).

- [ ] Validate returns in a few seconds, not minutes.
- [ ] Apply completes and reports the full count.
- [ ] Spot-check 5 submissions: each shows its chosen cell and capacity.
- [ ] **Unrelated records untouched** — pick 3 submissions you left blank and
      confirm their cells are exactly as before.
- [ ] Server log shows one `organize_cells_bulk` entry with the applied count.

> A file over **5,000 rows** is rejected at upload with a message telling you to
> split it. That is intended: the batch is applied all-or-nothing in one
> transaction, and splitting it silently would break that guarantee.

### 1.4 Validated table + VERA assessment

**Table density.** After Validate, the results table appears.

- [ ] Roughly 25 rows fit per page (was 10). Status tags, ticket numbers and cell
      names are all still comfortably readable.
- [ ] A long server message is truncated with `…` rather than stretching the
      table; hovering it shows the full text in a tooltip.
- [ ] The page-size selector (25/50/100) works, and the row count reads
      "1–25 of N".

**VERA assessment (valid file).**

1. Upload a file where **every** row is valid, then **Validate**.
   - [ ] The blue **"How bulk organization works"** card disappears.
   - [ ] A **VERA Assessment** panel takes its place, with the flame icon
         animating and *"VERA is reviewing the N validated placement(s)…"*.
   - [ ] The validated table stays visible underneath the whole time.
   - [ ] **Apply Assignments** is usable — VERA never blocks it.
2. Wait for VERA.
   - [ ] A written assessment appears in its own bordered box, tagged
         **Assessed**. Long answers scroll inside the box rather than being cut off.
   - [ ] The comment refers to **your actual data** (cell names, counts) — not
         generic advice. That confirms the validated snapshot reached it.
   - [ ] No page refresh was needed at any point.

**VERA on an invalid file.**

- [ ] Upload a file with at least one bad row → Validate. The **instructions card
      stays**, no VERA panel appears, and the validation errors are listed.
- [ ] Fix the file, re-upload, Validate → now the card gives way to VERA.

**Re-upload (stale-result check).**

1. Validate File A, let VERA finish and read its comment.
2. Without closing the modal, upload a **different** File B.
   - [ ] A's VERA comment disappears immediately — it is never shown next to B's
         data.
3. Validate File B.
   - [ ] VERA assesses B, and the comment matches B.

**VERA unavailable.**

- [ ] Simulate failure (stop the API, or set `VERA_ENABLED=false` and restart).
      Validate a good file.
- [ ] The panel shows **"VERA assessment could not be completed"** with the
      reason, plus *"Your file is still validated and can be applied."*
- [ ] **Apply Assignments** still works, and applying still succeeds.
- [ ] A **Retry assessment** button is offered and works once VERA is back —
      without re-uploading the file.
- [ ] No invented or placeholder assessment text is ever shown.

### 1.5 Retry safety

- [ ] Apply a batch, then click Apply again without re-uploading →
      *"This bulk assignment was already applied."* and **nothing is applied
      twice**. Volumes and cell fills are unchanged by the second click.

---

## 2. Cell Waste Placement

**Admin → Portal & Submission → Cell Waste Placement.**

### 2.1 Load

- [ ] The tab renders the submissions list without a long blank pause.
- [ ] Selecting a submission fills the **Cell Status** panel (donuts, fills)
      shortly after — the list does not wait for it.
- [ ] Browser devtools → Network: the list request returns in well under a
      second and its payload is modest (no `accreditedHaulers` in the JSON).

### 2.2 The Refresh button (was broken)

- [ ] Open devtools **Console**, click **Refresh**.
- [ ] The list and cell panel reload. **No `ReferenceError: fetchReference is
      not defined`** appears. *(Before this change, Refresh always threw.)*

### 2.3 Nothing regressed

- [ ] **Search** by ID No / company narrows the list; clearing restores it.
- [ ] Toggling **For Cell Assignment ↔ Assigned Records** shows the right sets:
      a fully-placed submission appears only under *Assigned Records*.
- [ ] **Pagination** works, including changing page size (12/24/48). Page 2 shows
      different records than page 1 — no repeats, no skips.
- [ ] Select placements → choose a cell → **Apply to Selected** → **Save
      Placement**. Saves, and the cell fill figures update.
- [ ] **Correct Cell** with a reason ≥5 chars moves the waste; the correction
      appears under **Corrections (n)** with from → to, volume and reason.
- [ ] A read-only admin (no cell-placement edit right) sees the selects and
      buttons disabled.

### 2.4 Duplicate requests

- [ ] Network tab, filter to `data-slf`. Click **Save Placement** once.
      Expect roughly **two** list/overview calls total, not four.
      *(One save previously fired the page's own refresh plus an unthrottled
      socket echo of both the `submissions` and `facility` events.)*

---

## 3. Submission status after approval

**Admin → Portal & Submission → Submissions.**

### 3.1 The defect

1. Find a **pending** submission.
2. Click **Acknowledge** and start counting.
   - [ ] The status tag flips to **Acknowledged** essentially immediately —
         no multi-second wait, no manual refresh, no page reload.
   - [ ] The success toast appears with it.
3. Reload the page.
   - [ ] It is still Acknowledged (the response was not just optimistic).

### 3.2 It reaches other sessions

1. Open the Submissions tab in **two** browser windows (or two admin accounts).
2. Acknowledge a submission in window A.
   - [ ] Window B updates on its own within a second or two, **without** being
         refreshed. *(This previously never happened — the route did not
         broadcast at all.)*
3. If the portal user is signed in elsewhere:
   - [ ] Their submission history reflects the new status without a reload.

### 3.3 Grouped rows

- [ ] Acknowledge a **grouped** row covering several entries. The progress bar
      still advances in steps and the whole group ends Acknowledged.
- [ ] Network tab: the number of `bulk-status` calls is **at most 5**, however
      many entries the group holds. *(It was previously one call per entry.)*

### 3.4 Cell Placement / Remarks / Status must all fill in at once

The three columns are on the same row as the status you just changed.

1. Pick a pending submission that has **some trucks placed and some not** (so
   Cell Placement reads *Partial (n/m)* and Remarks carries a tag or two). Note
   what all three columns say.
2. **Acknowledge it.**
   - [ ] Status flips to Acknowledged **and** Cell Placement and Remarks keep
         showing the same values, in the same instant. *(They used to blank out —
         "No Waste Data" / "—" — and only come back on the next full refresh.)*
   - [ ] No flicker of empty values in between.
3. **Reload the page.**
   - [ ] All three columns read exactly what they read before the reload. This is
         the check that the merged row and a freshly fetched row agree.
4. Repeat on a submission with **no** cell placements at all.
   - [ ] It legitimately shows *No Cells Assigned* / *No Waste Data* both before
         and after approving — a real empty value, not a stuck loading state.

### 3.5 One row at a time

- [ ] Approve one submission out of a page of many. Every **other** row's Cell
      Placement, Remarks and Status are untouched.
- [ ] Approve two different submissions in quick succession. Both end correct;
      neither overwrites the other.

### 3.6 The side effects still happen

Approval now answers first and finishes its derived work immediately after.
Confirm none of it was lost:

- [ ] The submitter receives the **acknowledgement email** (check inbox or mail
      log) — one per submission, not one per entry.
- [ ] A submission only triggers its email once **every** entry in it is
      acknowledged. Acknowledge half a submission → no email yet; finish it →
      email arrives.
- [ ] **Cell fill / capacity gauges** update for the affected SLF (Cell
      Infrastructure or the SLF dashboard).
- [ ] The **audit trail** shows a `status_change` entry per submission.
- [ ] Rejecting a submission also flips promptly, broadcasts, and sends **no**
      acknowledgement email.
- [ ] `pm2 logs` shows no `submission.bulk-status.followup_failed` warnings.

---

## 4. Portal tour + announcement banner

Sign in as a portal user. If neither appears, this account already dismissed
them — reset first with:

```
mongosh> db.user_portal.updateOne(
  { email: "<tester>" },
  { $unset: { portalTourDismissedAt: "", portalAnnouncementDismissedVersion: "", portalAnnouncementDismissedAt: "" } }
)
```

### 4.1 The defect — dismissal must survive logout

1. Sign in. The guided tour opens over the announcement banner.
2. Close it with the **X**.
3. **Log out, then log back in.**
   - [ ] The tour does **not** reappear. *(This is the bug: it always came back,
         because logout wipes localStorage and that was the only place the
         dismissal lived.)*
4. Repeat, but this time step through to the last card and click
   **"Got it — don't show again"**.
   - [ ] Log out / log back in → still gone.

### 4.2 It follows the user, not the browser

- [ ] Dismiss the tour in one browser, then sign in as the same portal user in a
      **different browser** (or a private window). The tour does not appear.

### 4.3 Reopening on purpose still works

- [ ] After dismissing, the announcement banner's **What's New Tour** button
      still opens the tour when clicked. *(A dismissal must not disable the
      user's own way back in.)*
- [ ] Closing it again does not re-prompt on the next login.

### 4.4 The announcement banner — Dismiss must stick

1. With an active announcement showing, click **Dismiss** on the banner.
   - [ ] It disappears.
2. **Reload the page.**
   - [ ] It stays gone. *(It used to come back on every reload — Dismiss was
         React state only.)*
3. **Log out and back in.**
   - [ ] Still gone.

### 4.5 …but a NEW announcement must still get through

**This is the most important check in this section.** A dismissal that muted all
future announcements would be worse than the bug it replaces — the banner is how
portal users are told about maintenance and rollouts.

1. As admin, edit the portal announcement (change its text, or publish a new
   one) so its `updatedAt` changes.
2. Reload the portal user's page.
   - [ ] The banner **reappears** with the new content, even though the user
         dismissed the previous one.
   - [ ] Dismissing this one hides it, and does **not** resurrect the old one.

### 4.6 Non-dismissible announcements

- [ ] Publish an announcement with **Dismissible** turned off in admin. The
      portal shows it with **no Dismiss button**, and it survives reloads.

### 4.7 Interaction between the two

- [ ] Dismiss the banner, then click **What's New Tour**. The banner reappears
      for the duration of the tour (its first step points at it).
- [ ] Close/finish the tour → the banner hides again. Your dismissal was not
      silently undone by taking the tour.

### 4.8 Degraded cases

- [ ] Stop the API (or go offline) and reload the portal. The page still loads;
      the banner and tour show or stay hidden without crashing, and nothing gets
      stuck on a spinner.
- [ ] In **Developer Portal Mode**, viewing a portal user's account and closing
      the tour or dismissing the banner does **not** change that user's stored
      preference (they still get both on their next real login).

---

## Sign-off

| Section | Result | Tester | Date |
|---|---|---|---|
| 0 Pre-deploy gate | ☐ Pass ☐ Fail | | |
| 1 Bulk Organize Cells | ☐ Pass ☐ Fail | | |
| 2 Cell Waste Placement | ☐ Pass ☐ Fail | | |
| 3 Submission status | ☐ Pass ☐ Fail | | |
| 4 Portal tour + announcement | ☐ Pass ☐ Fail | | |

**Rollback.** All three fixes are self-contained in `server/routes/dataSLF.js`,
`server/models/Transaction.js` and three front-end files. `git revert` the commit
and rebuild — no data migration was performed, and no stored document shape
changed, so a revert needs no cleanup. The added `meta.batchId` index is
additive and harmless if left in place.

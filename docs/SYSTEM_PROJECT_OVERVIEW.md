# EMBR3 ESWMP — System Project Overview

**Ecological Solid Waste Management Pipeline (ESWMP)**
*Sanitary Landfill Monitoring System for EMB Region III*

> This document is written for presentations, project briefings, demonstrations, and non-technical stakeholders. For technical details see [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md).

---

## Executive Overview

The **Ecological Solid Waste Management Pipeline (ESWMP)** is a web-based system that helps the **Environmental Management Bureau (EMB) Region III** monitor how solid waste is disposed of at **Sanitary Landfill Facilities (SLFs)**.

- **What it is:** a centralized platform with two connected sides — a public-facing **SLF Generators Portal** where landfill operators and waste generators report their disposal activity, and an **Admin dashboard** where EMB personnel review, acknowledge, and monitor that activity.
- **The problem it addresses:** disposal reporting was previously fragmented, manual, and hard to consolidate. Records were difficult to track, verify, and analyze across many facilities, municipalities, and reporting periods.
- **Who uses it:** EMB Region III administrators and personnel on the admin side, and SLF operators, LGU clients, and private-sector clients on the portal side.
- **How it supports EMB Region III operations:** it gives EMB a single, always-current view of what waste is being disposed of, where, by whom, and in what quantities — replacing scattered spreadsheets and manual follow-ups with a structured, reviewable pipeline.
- **How it improves monitoring, reporting, submissions, and oversight:** submissions flow directly from the portal into the admin review queue; dashboards, maps, and calendars update as data changes; and pending or problem records are surfaced automatically so nothing is missed.

---

## Meaning and Scope

The system's name describes its purpose: it is a **pipeline** for **ecological solid waste management** data. Information enters at one end (a portal submission from an SLF operator) and moves through a reviewable process (validation, acknowledgment, correction) until it becomes part of EMB's monitoring record at the other end.

The scope covers the **operational data lifecycle** of sanitary landfill disposal:

- Capturing disposal submissions from waste generators and haulers.
- Organizing that waste into specific landfill **cells**.
- Reviewing, acknowledging, or returning submissions for correction.
- Monitoring capacity, activity, and compliance across facilities and time.
- Communicating between EMB and portal users.

The system focuses on **monitoring and reporting**. It is a record-keeping and oversight tool, not an automated enforcement or billing system.

---

## Main Functions

The following functions are **implemented** in the current codebase:

- **SLF Portal submissions** — landfill operators submit disposal records (dates, waste types, volumes, haulers, trucks) through a guided data-entry workflow.
- **Group submissions** — records uploaded together in one batch are grouped and tracked as a single submission group on both the portal and admin sides.
- **Drafts and scheduled submissions** — a submission can be saved as a draft and finished later, or scheduled to be sent automatically at a chosen date and time.
- **Disposal monitoring** — admins view disposal activity across facilities, statuses, and periods.
- **Submission acknowledgment, reversion, and resubmission** — admins acknowledge valid submissions or return them for correction; users then edit and resubmit.
- **SLF location mapping** — facilities are shown on an interactive map with status indicators.
- **Disposal calendar** — an interactive calendar view of disposal activity with day-level detail.
- **Cell infrastructure monitoring** — landfill cell capacity, fill levels, and status are tracked and displayed.
- **LGU and private-sector client monitoring** — waste sources are categorized (LGU vs. private) and their relationships to facilities are visualized.
- **Portal messaging** — EMB can send messages to specific portal users, shown directly inside the portal.
- **Announcements** — EMB manages announcements shown on the portal login page and dashboard, with scheduling and optional email delivery.
- **Notifications** — the admin side receives grouped, real-time notifications about relevant activity.
- **Application settings** — developers and admins configure system, portal, email, and integration behavior.
- **SLF Portal sensitive-value masking** — a developer-controlled privacy toggle that hides sensitive figures (volumes, capacity, contact/account details, fees) across the portal.
- **Automation Agent** — a read-only AI operations assistant that summarizes and explains system data for administrators (see *Current Status*).

> Additional supporting modules exist in the codebase (e.g., 10-Year SWM Plan, MRF records, trash traps, transfer stations, open dumpsites, technical assistance). These are part of the broader EMB data set and are managed through the admin dashboard.

Features that are only planned are labeled as such and are not documented here as available.

---

## Purpose

The system exists to strengthen how EMB Region III manages sanitary-landfill information. Its purpose spans:

- **Environmental data management** — keeping disposal data organized, consistent, and centralized.
- **Sanitary landfill operations** — tracking what each facility and cell receives over time.
- **Monitoring and compliance** — giving EMB visibility into activity, pending items, and inconsistencies.
- **Digital reporting** — replacing manual paperwork with structured online submissions.
- **Administrative decision support** — dashboards, maps, calendars, and summaries that inform oversight.
- **Communication** — a direct channel between EMB Region III and portal users through messaging and announcements.

---

## General Objective

To provide EMB Region III with a centralized, reliable, and easy-to-use digital platform for monitoring sanitary-landfill disposal activity and improving oversight of solid waste management across the region.

---

## Specific Objectives

- Enable SLF operators to submit disposal records online through a guided portal.
- Consolidate submissions into a single reviewable pipeline for EMB personnel.
- Allow EMB to acknowledge valid submissions and return incorrect ones for correction.
- Track landfill cell capacity, fill levels, and utilization.
- Visualize facilities, waste sources, and disposal activity through maps, charts, and calendars.
- Keep every view current through real-time updates.
- Support communication between EMB and portal users via messaging and announcements.
- Improve data consistency through shared units of measurement and validation rules.

---

## Target Users

| User group | Role in the system |
|---|---|
| **Developer** | Full technical and configuration access; manages system-level settings. |
| **Admin** | EMB administrators who review submissions, monitor activity, and manage records. |
| **EMB personnel** | Staff who use the admin dashboard for monitoring and reporting. |
| **SLF portal users** | Sanitary landfill operators / waste generators who submit disposal data. |
| **LGU clients** | Local government waste sources, categorized in the monitoring data. |
| **Private-sector clients** | Private waste generators, categorized in the monitoring data. |

---

## Major Benefits

- **Centralized records** — one source of truth for SLF disposal data.
- **Improved monitoring** — real-time visibility of activity, capacity, and pending items.
- **Faster submission processing** — submissions flow straight into the review queue.
- **Better visibility of pending records** — items needing attention are highlighted automatically.
- **Reduced manual reporting** — online submissions replace paperwork and re-encoding.
- **Improved data consistency** — shared units of measurement and validation reduce errors.
- **Better operational decision-making** — dashboards, maps, and summaries support oversight.

---

## System Workflow

A simplified high-level flow:

1. **Portal login** — an SLF operator signs in to the SLF Generators Portal.
2. **Data submission** — the operator encodes (or uploads) disposal records and submits them, optionally saving a draft or scheduling the submission.
3. **Admin review** — EMB personnel see the submission in their dashboard and review it.
4. **Acknowledgment, reversion, or resubmission** — the admin acknowledges a valid submission, or returns it for correction; the operator edits and resubmits.
5. **Dashboard and calendar updates** — maps, charts, cell capacity, and the disposal calendar update as records change.
6. **Monitoring and reporting** — EMB monitors activity across facilities and periods and uses the consolidated data for oversight.

---

## Current Status

**Implemented**

- SLF Portal submissions, group submissions, drafts and scheduled submissions.
- Admin review workflow (acknowledge, revert, resubmit).
- SLF location mapping, disposal calendar, cell infrastructure monitoring.
- LGU / private-sector client monitoring and relationship visualization.
- Portal messaging, announcements (with scheduling and email), and grouped admin notifications.
- Application settings and the developer-controlled sensitive-value masking toggle.
- Real-time updates across admin and portal views.
- **Automation Agent** — implemented as a **read-only** assistant. It is disabled by default and only operates when an administrator enables it and provides a valid AI provider API key. Without a key it stays inactive.

**Partially implemented / configuration-dependent**

- Email delivery, Google Drive file storage, and the Automation Agent depend on external services being configured (`To be verified` per deployment environment).

**Planned / future**

- Any capability not listed above under *Implemented* should be treated as **Planned** or **Not yet implemented** until confirmed in the codebase.

> **Production readiness:** deployment specifics vary by environment. This document does not assert production readiness; that determination should be made by the maintainers against their own deployment.

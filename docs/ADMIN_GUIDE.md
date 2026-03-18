# EMBR3 ESWMP — Admin User Guide

> **Ecological Solid Waste Management Pipeline**
> Environmental Management Bureau Region III

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Logging In](#logging-in)
3. [Dashboard](#dashboard)
4. [SWM Programs](#swm-programs)
5. [Sanitary Landfill Management](#sanitary-landfill-management)
6. [Monitoring Modules](#monitoring-modules)
7. [Settings & Administration](#settings--administration)
8. [SLF Portal User Management](#slf-portal-user-management)
9. [Common Tasks](#common-tasks)

---

## Getting Started

The EMBR3 ESWMP admin panel is a web-based application used by EMB Region III staff to manage solid waste data submissions, monitor SLF facilities, and oversee waste management programs across the region.

### Access Levels

| Role | Description |
|------|-------------|
| **Developer** | Full access to all modules, system settings, app configuration, and portal user management. |
| **Admin** | Access to all data modules, user management, and reporting. Cannot modify app-wide settings. |
| **User** | Restricted access. Can only view modules granted by an Admin or Developer. |

---

## Logging In

1. Navigate to the admin login page (e.g., `https://your-domain.com/login`).
2. Enter your **Email/Username** and **Password**.
3. Click **Login**. You will be redirected to the admin dashboard.
4. If you don't have an account, click **Create an Account** and wait for admin or developer approval.

> **Note:** Your session is stored locally. You will remain logged in until you explicitly log out or the session token expires.

---

## Dashboard

The dashboard provides an at-a-glance overview of the system:

- **Statistics Cards** — Total submissions, generators, trucks, etc.
- **Interactive Maps** — Leaflet-based province maps for:
  - 10-Year SWM Plan coverage
  - Funded MRF locations
  - LGU-Initiated MRF
  - Trash Traps
  - SWM Equipment
  - SLF Facilities
- **Map Controls** — Switch between Street, Satellite, Terrain, and Dark tile layers. Filter by province and status.
- **Recent Submissions** — Quick view of the latest SLF data entries.

---

## SWM Programs

### Trash Traps
View and manage trash trap installations across the region. Supports Excel export.

### 10-Year SWM Plan
Monitor LGU compliance with their 10-year SWM plan submissions.

### Funded MRF
Track funded Materials Recovery Facilities — their locations, status, and LGU assignments.

### LGU-Initiated MRF
Similar to Funded MRF but for LGU self-initiated facilities.

### SWM Equipments
Inventory of solid waste management equipment distributed across the region.

---

## Sanitary Landfill Management

### SLF Data Table (SLF Monitoring)
Main data table of all SLF facilities. View, add, edit, and export facility records.

### SLF Waste Generators

This module has two tabs:

#### Submissions Tab
- View all disposal data submitted by portal users.
- **Search** by ID number, company name, or submitter email.
- **Filter** by status: Pending, Acknowledged, Rejected.
- **Actions per entry:**
  - 👁 **View** — Open a detail modal with full entry information and truck breakdown.
  - ✅ **Acknowledge** — Mark a pending entry as acknowledged. An email notification is sent to the submitter.
  - ❌ **Reject** — Mark as rejected.
  - 🗑 **Delete** — Permanently remove the entry (with confirmation).
- **Bulk Acknowledge** — Select multiple entries using the checkboxes, then click the **"Acknowledge Selected (N)"** button. All selected pending entries will be acknowledged at once and grouped email notifications will be sent to each submitter.
- **Export** — Download the filtered table as an Excel file.

#### Reports Tab
View aggregated reports and analytics for waste generators.

---

## Monitoring Modules

| Module | Description |
|--------|-------------|
| **Technical Assistance (Barangay)** | Track technical assistance requests and activities at the barangay level. |
| **Transfer Stations** | Monitor transfer station operations and data. |
| **Open Dump Sites** | Record and track open dumpsite closures and rehabilitation. |
| **PDS (Project Description Scoping)** | Manage project scoping documents. |
| **Residual Containment** | Monitor residual containment area compliance. |
| **LGU Assistance & Diversion** | Track LGU diversion rates and assistance programs. |

---

## Settings & Administration

### Accounts & Roles
- View all registered admin users.
- Search by name, email, or username.
- **Change roles** — Assign Developer, Admin, or User role.
- **Edit user** — Modify username, position, designation.
- **Manage access** (Developers only) — Toggle module-level permissions per user.
- **Delete user** — Remove a user with confirmation.
- **Export** — Download user list to Excel.

### Portal Fields
Customize the form fields visible on the SLF portal data entry form.

### Data References
Manage dropdown/lookup values used across the system (e.g., waste types, provinces, municipality lists).

---

## SLF Portal User Management

Portal users are SLF generators/LGU representatives who submit disposal data through the public portal.

### Approval Workflow

1. A user registers at the portal signup page.
2. They receive a confirmation email that their registration is **pending approval**.
3. An Admin/Developer navigates to **App Settings → Portal Users** tab.
4. Review the pending user:
   - **Approve** — Assign an SLF facility from the dropdown, then approve. An approval email with login instructions is sent automatically.
   - **Reject** — Provide an optional reason. A rejection email is sent.
5. Once approved, the portal user can log in and submit disposal data.

### Managing Portal Users
- View all portal users with their status (Pending, Approved, Rejected).
- Change the assigned SLF facility.
- Delete portal user accounts.

---

## Common Tasks

### Acknowledging a Submission
1. Go to **SLF Waste Generators → Submissions**.
2. Find the entry (use search/filter if needed).
3. Click the ✅ icon, or open it with 👁 and click **Acknowledge** in the modal.
4. The entry status changes to "Acknowledged" and the submitter receives an email notification.

### Bulk Acknowledging Submissions
1. Go to **SLF Waste Generators → Submissions**.
2. Use the checkboxes on the left to select multiple entries.
3. A green **"Acknowledge Selected (N)"** button appears in the toolbar.
4. Click it and confirm the action.
5. All selected pending entries are acknowledged and grouped emails are sent per submitter.

### Exporting Data
Most tables include an **Export Excel** button. Click it to download the current filtered view as an `.xlsx` file.

---

*© 2026 EMBR3 — Environmental Management Bureau Region III. All rights reserved.*

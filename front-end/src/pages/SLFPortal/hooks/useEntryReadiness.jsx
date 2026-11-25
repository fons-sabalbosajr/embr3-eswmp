import { Form, Spin } from "antd";
import { Text } from "../portalShared";
import { useMemo } from "react";
import { validateWasteGeneration } from "../wasteGenValidation";

export default function useEntryReadiness({
  activeTab, baselineForm, baselineLoading, baselineTotalVolume, companyForm, entryForm, haulers,
  portalUser, slfInfoLoading, trucks,
}) {
  // `preserve: true` is REQUIRED here, not an optimisation.
  //
  // The Data Entry tabs render with `destroyOnHidden`, so only the open pane is
  // mounted. Without this option useWatch reads `getFieldsValue()`, which returns
  // values for CURRENTLY REGISTERED fields only — so the moment a user leaves the
  // Basic Information tab, all four company fields read `undefined`, and leaving
  // the Baseline tab makes Total Volume Accepted read `undefined`. Since exactly
  // one tab can be open at a time, at least one "incomplete" blocker was ALWAYS
  // present and Review & Submit could never enable, no matter how much the user
  // filled in. `preserve: true` reads `getFieldsValue(true)` — the whole store,
  // including fields whose pane is currently unmounted (antd preserves those
  // values by default), which is the state the user actually entered.
  const watchOptions = (form) => ({ form, preserve: true });
  const watchedDisposalDate = Form.useWatch("dateOfDisposal", watchOptions(entryForm));
  const watchedTotalVolumeAccepted = Form.useWatch(
    "totalVolumeAccepted",
    watchOptions(baselineForm),
  );
  const watchedCompanyName = Form.useWatch("lguCompanyName", watchOptions(companyForm));
  const watchedCompanyRegion = Form.useWatch("companyRegion", watchOptions(companyForm));
  const watchedCompanyProvince = Form.useWatch("companyProvince", watchOptions(companyForm));
  const watchedCompanyMunicipality = Form.useWatch("companyMunicipality", watchOptions(companyForm));
  const isTreatedHazardousWaste = (value) =>
    String(value || "")
      .trim()
      .toLowerCase() === "treated hazardous waste";
  const hasHazardousWasteCode = (value) =>
    Array.isArray(value) ? value.length > 0 : !!String(value || "").trim();
  const missingHazardousCodeTrucks = trucks.filter(
    (truck) =>
      isTreatedHazardousWaste(truck.wasteType) &&
      !hasHazardousWasteCode(truck.hazWasteCode),
  );
  const TAB_DEPENDENCIES = {
    // Cell options + the declared unit come from the facility; the baseline drives
    // the unit and the saved cell entries.
    baseline: () => slfInfoLoading || baselineLoading,
    disposal: () => slfInfoLoading || baselineLoading,
    "basic-info": () => false, // only address reference data, loaded on demand
  };

  const tabLoadingMessage = (key) =>
    key === "disposal"
      ? "Loading cell infrastructure and unit configuration…"
      : "Loading baseline and cell infrastructure…";

  // Wrap each pane in its own loader. Applied to the items array so the (very
  // large) tab bodies below stay untouched.
  //
  // Each pane's `children` is a THUNK, and only the open tab's thunk is called.
  // `destroyOnHidden` already keeps hidden panes out of the DOM, but the JSX for
  // all three was still evaluated on every render — building the full element
  // tree for the hauler/vehicle tables and both cell grids even while you were
  // on another tab. That work is what made Data Entry slow to open and sluggish
  // to type in. Now a hidden tab costs nothing until you switch to it.
  const withTabLoading = (items) =>
    items.map((item) => {
      const isLoading = TAB_DEPENDENCIES[item.key]?.() ?? false;
      if (isLoading) {
        return {
          ...item,
          children: (
            <div style={{ padding: "48px 0", textAlign: "center" }}>
              <Spin size="large" />
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">{tabLoadingMessage(item.key)}</Text>
              </div>
            </div>
          ),
        };
      }
      if (typeof item.children !== "function") return item;
      // Build the open pane only. A hidden pane renders nothing — antd keeps the
      // tab itself, and the forms live above this component, so nothing entered
      // is lost by not rendering the pane.
      return { ...item, children: item.key === activeTab ? item.children() : null };
    });

  const isDeveloperContext = !!(portalUser?.developerContext || portalUser?.devImpersonation);
  // Planning Unit access: the same privileged context, but VIEW-ONLY (the server
  // refuses every write from it) and time-limited.
  const isPlanningUnitView = !!portalUser?.planningUnit;
  const haulerVehiclesMissingCapacity = useMemo(() => {
    const issues = [];
    (haulers || []).forEach((h) => {
      (h.vehicles || []).forEach((v, vi) => {
        const cap = v?.capacity;
        const invalid =
          cap === null || cap === undefined || cap === "" || !(Number(cap) > 0);
        if (invalid) {
          issues.push({
            haulerName: h.haulerName || "Unnamed hauler",
            plateNumber: v?.plateNumber || `Vehicle ${vi + 1}`,
          });
        }
      });
    });
    return issues;
  }, [haulers]);

  // Mirrors the server's required-submission gate (routes/dataSLF.js →
  // hasPositiveRequiredNumber): a submission is rejected unless Total Volume
  // Accepted is a POSITIVE number. Testing only for "not empty" let a locked
  // baseline holding 0 / a non-numeric value pass the Review & Submit blockage and
  // then fail at the server with "Baseline Data is incomplete".
  // A watched value is only reliable once its field has been RENDERED. Edit &
  // Resubmit loads a reverted submission and lands the user on the Disposal tab,
  // so General Information is never mounted — every watch read `undefined` and
  // the blockage claimed the company details were missing while the record (and
  // the form store) held them all along. Reading the STORE as the fallback fixes
  // that without losing reactivity: the watches still drive the re-render, the
  // store supplies the value.
  const companyStore = companyForm.getFieldsValue(true) || {};
  const baselineStore = baselineForm.getFieldsValue(true) || {};
  const resolveField = (watched, store, field) =>
    watched !== undefined && watched !== null ? watched : store?.[field];

  // THE Total Volume Accepted this session is working with, in one place.
  //
  // Order matters. The form comes first (an operator editing an unlocked baseline
  // must see their own typing win), and the SERVER's resolved figure backs it —
  // because the form can legitimately be blank while the facility has a value:
  // Edit & Resubmit hydrates from a submission, and a submission's copy is a
  // SNAPSHOT that may be absent or stale. Live example: reverted SLF-LGU-PA-0016
  // stores 0 while Prime Waste Solution's baseline holds 596,981.38 — so opening
  // it put 0 in a DISABLED field and the submit gate reported the baseline
  // incomplete, with no way to fix it from that screen.
  //
  // A stored 0 from the form is still honoured; it is only the ABSENCE of a form
  // value that falls through to the facility's figure.
  const effectiveTotalVolumeAccepted = (() => {
    const fromForm = resolveField(
      watchedTotalVolumeAccepted,
      baselineStore,
      "totalVolumeAccepted",
    );
    if (fromForm !== undefined && fromForm !== null && fromForm !== "") return fromForm;
    return baselineTotalVolume;
  })();
  const missingBaselineInfo = !(Number(effectiveTotalVolumeAccepted) > 0);
  const missingGeneralInfo = [
    resolveField(watchedCompanyName, companyStore, "lguCompanyName"),
    resolveField(watchedCompanyRegion, companyStore, "companyRegion"),
    resolveField(watchedCompanyProvince, companyStore, "companyProvince"),
    resolveField(watchedCompanyMunicipality, companyStore, "companyMunicipality"),
  ].some((value) => value == null || String(value).trim() === "");
  // Every Waste Generation Information field (incl. Truck Capacity) is required
  // for FINAL submission. Reuses the same rule set the backend enforces, so the
  // tab's required-dot and the submit block can never disagree with the server.
  // Drafts are not gated by this.
  const wasteGenValidationIssues = validateWasteGeneration(trucks);
  const missingDisposalInfo =
    !watchedDisposalDate || trucks.length === 0 || wasteGenValidationIssues.length > 0;
  const hasReviewMissing =
    missingGeneralInfo ||
    missingBaselineInfo ||
    missingDisposalInfo ||
    missingHazardousCodeTrucks.length > 0;

  return {
    hasHazardousWasteCode, hasReviewMissing, haulerVehiclesMissingCapacity, isDeveloperContext,
    isPlanningUnitView, isTreatedHazardousWaste, missingBaselineInfo, missingDisposalInfo,
    missingGeneralInfo, missingHazardousCodeTrucks, wasteGenValidationIssues, watchedDisposalDate,
    withTabLoading,
  };
}

import {
  Card,
  Result,
  Button,
  Alert,
  Space,
  Tag,
  Select,
  Row,
  Col,
  Tabs,
  Form,
  InputNumber,
  Tooltip,
} from "antd";
import {
  CheckCircleOutlined,
  EnvironmentOutlined,
  InfoCircleOutlined,
  DatabaseOutlined,
  SendOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  BarChartOutlined,
  PlusOutlined,
  CloseCircleOutlined,
  TeamOutlined,
  RightOutlined,
  ExclamationCircleOutlined,
  SaveOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { Text } from "./portalShared";
import AssignedSlfDashboard from "./AssignedSlfDashboard";
import RequiredDot from "./RequiredDot";
import BasicInfoTab from "./BasicInfoTab";
import { formatEntryVolumeSummary } from "./helpers";
import SectionMovButton from "../../components/SectionMovButton";
import WasteGeneratorPane from "./WasteGeneratorPane";

import DataEntryGuide from "./DataEntryGuide";
import HaulersBaselineCard from "./HaulersBaselineCard";
import ClosedCellsTable from "./ClosedCellsTable";
import ActiveCellsTable from "./ActiveCellsTable";
export default function DataEntryTab({
  activeCellEntries, activeCellOptions, activeSlfName, activeTab, assignSelectedTrucksToCell,
  backlogSummary, barangays, baselineActionRef, baselineDirtyGuard, baselineForm, baselineGaps,
  baselineGapsRef, baselineMov, baselinePanelRef, baselineRefreshLoading, baselineRemoteChanged,
  baselineSaved, baselineSavingLoading, baselineStatusRef, baselineUnit, baselineUpdateLoading,
  baselineUpdatePending, cellVolumeTotalIsAuthoritative, closedCellEntries, collapsedBaselineCards,
  companyForm, confirmDiscardBaseline, dataEntryTabsRef, declaredCellUnit, downloadHaulerTemplate,
  draftAutosave, editingDraft, editingRevertedId, entryForm, exportHaulerData, facilityCells, fl,
  handleBaselineUpdateRequest, handleSaveBaselinePortal, hasReviewMissing, haulerColumns,
  haulerExportRef, haulerTableRef, haulerUploadRef, haulerVehiclesMissingCapacity, haulers,
  isMobile, isRequired, loading, loadingAddress, missingBaselineInfo, missingDisposalInfo,
  missingGeneralInfo, missingHazardousCodeTrucks, municipalities, openCellEntryForEdit,
  openFeatureTour, openHaulerModal, openTruckModal, openUploadGuide, portalUser, provinces,
  refreshBaselineStatus, regions, removeTruck, renderGuideItems, resubmittingIdNo,
  revealBaselineCard, savingDraft, selectedSlfIdx, selectedTruckKeys, setActiveCellDraft,
  setActiveCellEntries, setActiveCellModalOpen, setActiveTab, setBaselineMov, setBaselineRefresh,
  setBaselineRemoteChanged, setBaselineSaved, setClosedCellDraft, setClosedCellEntries,
  setClosedCellModalOpen, setCompletionModalOpen, setEditingActiveCellKey, setEditingClosedCellKey,
  setHaulers, setSelectedSlfIdx, setSelectedTruckKeys, setSlfInfo, setSubmitted, setTruckBulkCell,
  setTruckPage, setTruckPageSize, setTrucks, slfCardExpanded, slfInfo, slfInfoLoading,
  slfSelectorRef, slfUnit, stableEditRevertedRow, stableFetchBarangays, stableFetchMunicipalities,
  stableFetchProvinces, stableOpenWasteReceived, stableReviewOpen, stableSaveDraft,
  stopEditingDraft, submitBlockers, submitted, truckBulkCell, truckPage, truckPageSize,
  truckTableRef, truckUploadRef, trucks, unresolvedRevert, updateFoldedCards, withTabLoading,
}) {
  // ── Data Entry Content ──
  const renderUnitMeasurementControl = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", border: "1px solid #91caff", borderRadius: 8, background: "#e6f4ff", maxWidth: "100%" }}>
      <DatabaseOutlined style={{ color: "#1677ff" }} />
      {!isMobile && <Text strong style={{ fontSize: 12, color: "#003eb3", whiteSpace: "nowrap" }}>Unit of Measurement</Text>}
      {/* READ-ONLY. The unit is declared by EMB on the SLF record and is the
          same on every admin and portal screen. Operators could switch it here,
          which is how one facility came to show m³ on the portal and tons on the
          admin side. Ask EMB to change it if it is wrong. */}
      <Tooltip title="Declared by EMB Region III for this SLF. All figures in the portal and admin use this unit.">
        <Tag color="blue" style={{ margin: 0, fontWeight: 600 }}>
          {slfUnit}
        </Tag>
      </Tooltip>
    </div>
  );

  if (submitted) {
    return (
      <Card
        className="slf-result-card"
        style={{ maxWidth: 560, margin: "40px auto" }}
      >
        <Result
          status="success"
          icon={<CheckCircleOutlined style={{ color: "#1a3353" }} />}
          title="Submission Successful!"
          subTitle="Your SLF disposal data has been recorded."
          extra={
            <Button
              type="primary"
              size="large"
              onClick={() => setSubmitted(false)}
              className="slf-primary-btn"
            >
              Submit More Data
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div style={{ maxWidth: 1680, margin: "0 auto" }}>
      {/* Accredited-hauler vehicles missing a capacity BLOCK submission, so warn
          here — up front and persistently — rather than only at submit time.
          Records encoded before Vehicle Capacity became required land here. */}
      {haulerVehiclesMissingCapacity.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12, borderRadius: 8 }}
          message="Vehicle Capacity is required on your Accredited Haulers"
          description={
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              <Text style={{ fontSize: 13 }}>
                {haulerVehiclesMissingCapacity.length} vehicle
                {haulerVehiclesMissingCapacity.length === 1 ? "" : "s"} still
                {haulerVehiclesMissingCapacity.length === 1 ? " has" : " have"} no
                capacity recorded. You will not be able to submit until
                {haulerVehiclesMissingCapacity.length === 1 ? " it is" : " they are"}{" "}
                updated.
              </Text>
              <Space size={4} wrap>
                {haulerVehiclesMissingCapacity.slice(0, 8).map((i, idx) => (
                  <Tag key={`${i.haulerName}-${i.plateNumber}-${idx}`} color="orange">
                    {i.haulerName} · {i.plateNumber}
                  </Tag>
                ))}
                {haulerVehiclesMissingCapacity.length > 8 && (
                  <Tag>+{haulerVehiclesMissingCapacity.length - 8} more</Tag>
                )}
              </Space>
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  setActiveTab("baseline");
                  revealBaselineCard("haulers");
                }}
              >
                Request Now to update
              </Button>
            </Space>
          }
        />
      )}
      {/* SLF selector for users with multiple assigned SLFs */}
      {Array.isArray(portalUser?.assignedSlfName) &&
        portalUser.assignedSlfName.length > 1 && (
          <div ref={slfSelectorRef}>
            <Card
            size="small"
            style={{
              marginBottom: 12,
              borderRadius: 10,
              border: "1px solid #91caff",
              background: "#e6f4ff",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <EnvironmentOutlined
                style={{ color: "#1a3353", fontSize: 16 }}
              />
              <Text strong style={{ fontSize: 13 }}>
                Select SLF Facility:
              </Text>
              <Select
                value={selectedSlfIdx}
                onChange={async (val) => {
                  // Switching SLF loads the other facility's baseline over
                  // this one — unsaved edits would be lost.
                  if (!(await confirmDiscardBaseline("Switching SLF"))) return;
                  setSelectedSlfIdx(val);
                  setBaselineSaved(false);
                  setSlfInfo(null);
                  setHaulers([]);
                  setTrucks([]);
                  setActiveCellEntries([]);
                  setClosedCellEntries([]);
                  baselineForm.resetFields();
                  companyForm.resetFields();
                  entryForm.resetFields();
                }}
                style={{ minWidth: 280 }}
                options={portalUser.assignedSlfName.map((name, i) => ({
                  label: name,
                  value: i,
                }))}
              />
            </div>
            </Card>
          </div>
        )}
      <Row gutter={[16, 16]} align="top">
        <Col xs={24} xl={19}>
          {/* SLF Name (read-only, from assigned SLF) */}
          <AssignedSlfDashboard
            activeSlfName={activeSlfName}
            slfInfo={slfInfo}
            slfInfoLoading={slfInfoLoading}
            baselineUnit={baselineUnit || slfUnit}
            baselineSaved={baselineSaved}
            baselineForm={baselineForm}
            activeCellEntries={activeCellEntries}
            closedCellEntries={closedCellEntries}
            haulers={haulers}
            isMobile={isMobile}
            hasReviewMissing={hasReviewMissing}
            submitBlockers={submitBlockers}
            loading={loading}
            slfCardExpanded={slfCardExpanded}
            handleReviewOpen={stableReviewOpen}
            handleSaveDraft={stableSaveDraft}
            savingDraft={savingDraft}
            autosaveStatus={draftAutosave.status}
            autosavedAt={draftAutosave.savedAt}
            handleOpenWasteReceived={stableOpenWasteReceived}
            revertToResolve={editingRevertedId ? null : unresolvedRevert}
            onResolveRevert={stableEditRevertedRow}
            resubmittingIdNo={resubmittingIdNo}
            editingDraftLabel={editingDraft?.label || null}
            onStopEditingDraft={stopEditingDraft}
            backlogSummary={backlogSummary}
          />

          {/* Disposal Data Form */}
          <Card className="slf-section" style={{ marginTop: 20 }}>
            <div ref={dataEntryTabsRef}>
              <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              tabBarExtraContent={renderUnitMeasurementControl()}
              // Only the open Data Entry tab stays mounted. antd otherwise keeps
              // every tab you have visited alive, so the hauler/vehicle tables,
              // cell grids and their derived arrays from other tabs all sat in
              // memory behind the one on screen.
              //
              // The forms themselves are antd Form instances owned by this
              // component (companyForm / entryForm / …), so unmounting a PANE does
              // not discard entered values — the draft state lives above the tab.
              destroyOnHidden
              // Localized per-tab spinner while that tab's source data loads.
              items={withTabLoading([
                {
                  key: "basic-info",
                  label: (
                    <span>
                      <InfoCircleOutlined />{" "}
                      {isMobile ? "Basic Info" : "Basic Information"}
                      <RequiredDot show={missingGeneralInfo} />
                    </span>
                  ),
                  children: () => (
                    <BasicInfoTab
                      companyForm={companyForm}
                      entryForm={entryForm}
                      regions={regions}
                      provinces={provinces}
                      municipalities={municipalities}
                      barangays={barangays}
                      loadingAddress={loadingAddress}
                      fetchProvinces={stableFetchProvinces}
                      fetchMunicipalities={stableFetchMunicipalities}
                      fetchBarangays={stableFetchBarangays}
                      addressLocked={baselineSaved}
                    />
                  ),
                },
                {
                  key: "baseline",
                  label: (
                    <span>
                      <DatabaseOutlined />{" "}
                      {isMobile ? "Baseline" : "Baseline Data"}
                      <RequiredDot show={missingBaselineInfo} />
                      {baselineSaved && (
                        <CheckCircleOutlined
                          style={{ color: "#52c41a", marginLeft: 6 }}
                        />
                      )}
                    </span>
                  ),
                  children: () => (
                    <div ref={baselinePanelRef}>
                      {baselineSaved && (
                        <div
                          ref={baselineStatusRef}
                          style={{
                            background: baselineUpdatePending
                              ? "#e6f7ff"
                              : "#fff7e6",
                            border: `1px solid ${baselineUpdatePending ? "#91d5ff" : "#ffe58f"}`,
                            borderRadius: 6,
                            padding: "10px 14px",
                            marginBottom: 16,
                            display: "flex",
                            alignItems: isMobile ? "flex-start" : "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 8,
                          }}
                        >
                          <div>
                            <InfoCircleOutlined
                              style={{
                                color: baselineUpdatePending
                                  ? "#1890ff"
                                  : "#faad14",
                                marginRight: 8,
                              }}
                            />
                            <Text
                              style={{
                                color: baselineUpdatePending
                                  ? "#096dd9"
                                  : "#ad6800",
                              }}
                            >
                              {baselineUpdatePending
                                ? "Your baseline update request is pending admin approval. Please wait for a response."
                                : "Baseline data is locked after your first submission. To request changes, click the button."}
                            </Text>
                          </div>
                          <div ref={baselineActionRef}>
                            <Space wrap>
                              {!baselineUpdatePending && (
                                <Button
                                  type="primary"
                                  size="small"
                                  icon={<SendOutlined />}
                                  loading={baselineUpdateLoading}
                                  onClick={handleBaselineUpdateRequest}
                                  style={{
                                    background: "#fa8c16",
                                    borderColor: "#fa8c16",
                                  }}
                                >
                                  Request Update
                                </Button>
                              )}
                              {baselineUpdatePending && (
                                <Tag
                                  color="processing"
                                  icon={<ClockCircleOutlined />}
                                >
                                  Awaiting Approval
                                </Tag>
                              )}
                              <Button
                                size="small"
                                icon={<ReloadOutlined />}
                                loading={baselineRefreshLoading}
                                onClick={refreshBaselineStatus}
                              >
                                Refresh
                              </Button>
                            </Space>
                          </div>
                        </div>
                      )}
                      <Form
                        form={baselineForm}
                        layout="vertical"
                        requiredMark={false}
                        disabled={baselineSaved}
                      >
                        {/* ── Unit of Measurement ── */}
                        <div
                          style={{
                            background:
                              "linear-gradient(135deg, #e6f4ff 0%, #f0f5ff 100%)",
                            border: "1px solid #91caff",
                            borderRadius: 10,
                            padding: "12px 16px",
                            marginBottom: 16,
                            marginLeft: "auto",
                            width: "min(100%, 420px)",
                            display: "none",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                          }}
                        >
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 8,
                              background: "#1677ff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <DatabaseOutlined
                              style={{ color: "#fff", fontSize: 15 }}
                            />
                          </div>
                          <div style={{ flex: 1, minWidth: 130 }}>
                            <Text
                              strong
                              style={{
                                fontSize: 12,
                                color: "#003eb3",
                                display: "block",
                              }}
                            >
                              Unit of Measurement
                            </Text>
                            <Text type="secondary" style={{ fontSize: 10 }}>
                              Declared by EMB Region III — the same unit on every admin and portal screen
                            </Text>
                          </div>
                          {/* Read-only: see renderUnitMeasurementControl. */}
                          <Tag color="blue" style={{ margin: 0, fontSize: 13, padding: "2px 10px", fontWeight: 600 }}>
                            {slfUnit === "m³" ? "m³ (cubic meters)" : slfUnit}
                          </Tag>
                        </div>

                        {/* ── Volume of Waste Accepted ── */}
                        <div
                          style={{
                            background: "#fff",
                            border: "1px solid #e8e8e8",
                            borderRadius: 10,
                            overflow: "hidden",
                            marginBottom: 14,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "10px 16px",
                              background:
                                "linear-gradient(90deg, #1a3353 0%, #244b7a 100%)",
                            }}
                          >
                            <BarChartOutlined
                              style={{ color: "#fff", fontSize: 13 }}
                            />
                            <Text
                              strong
                              style={{ color: "#fff", fontSize: 13 }}
                            >
                              Volume of Waste Accepted
                            </Text>
                            <Text
                              style={{
                                color: "rgba(255,255,255,0.55)",
                                fontSize: 11,
                                marginLeft: 2,
                              }}
                            >
                              (since start of operation)
                            </Text>
                          </div>
                          <div style={{ padding: "14px 16px 8px" }}>
                            <Row gutter={[12, 0]}>
                              <Col xs={24} sm={14} md={10}>
                                <Form.Item
                                  name="totalVolumeAccepted"
                                  label="Total Volume Accepted"
                                  required
                                  rules={[
                                    { required: true, message: "Required" },
                                  ]}
                                >
                                  <InputNumber
                                    placeholder="0.00"
                                    style={{ width: "100%" }}
                                    min={0}
                                    step={0.01}
                                    precision={2}
                                    // Editable only when cell entries aren't
                                    // driving the total; a facility declaring a
                                    // lump baseline (no cell rows) must be able to
                                    // type it, or it stays 0. `baselineSaved` is
                                    // kept so the explicit prop doesn't override
                                    // the Form-level lock.
                                    disabled={baselineSaved || cellVolumeTotalIsAuthoritative}
                                    addonAfter={
                                      (baselineUnit || slfUnit) === "m³" ? "m³" : "tons"
                                    }
                                    // #2: 0 is a VALID Total Volume Accepted —
                                    // the previous `v ? … : ""` formatter blanked
                                    // out a saved zero (and any falsy-but-valid
                                    // value), making real data look missing. Only
                                    // an empty/null/undefined value renders blank.
                                    formatter={(v) =>
                                      v === "" || v === null || v === undefined
                                        ? ""
                                        : Number(v).toLocaleString(undefined, {
                                            maximumFractionDigits: 2,
                                          })
                                    }
                                    parser={(v) => {
                                      const cleaned = String(v ?? "").replace(
                                        /,/g,
                                        "",
                                      );
                                      return cleaned === "" ? null : cleaned;
                                    }}
                                  />
                                </Form.Item>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  {cellVolumeTotalIsAuthoritative
                                    ? "Auto-calculated from Active Cell Volume plus Closed / Used-Completed Cell Volume."
                                    : "Enter the total volume accepted, or add Active / Closed cell entries below to calculate it automatically."}
                                </Text>
                              </Col>
                            </Row>
                          </div>
                        </div>

                        {/* Active Cells, Closed Cells and Accredited Haulers as
                            always-open CARDS (they were collapsed dropdowns that
                            hid the data). Each card's title carries its actions on
                            the right — Add Entry and the section's Upload MOV. */}
                        {[
                            {
                              key: "active",
                              movKey: "activeCells",
                              movTitle: "Active Cells",
                              accent: "#52c41a",
                              label: (
                                <Space>
                                  <CheckCircleOutlined
                                    style={{ color: "#52c41a" }}
                                  />
                                  <Text strong style={{ color: "#135200" }}>
                                    Active Cells
                                    {activeCellEntries.length > 0
                                      ? ` (${activeCellEntries.length})`
                                      : ""}
                                  </Text>
                                  {activeCellEntries.length > 0 && (
                                    <Text
                                      type="secondary"
                                      style={{ fontSize: 11 }}
                                    >
                                      Total:{" "}
                                      {formatEntryVolumeSummary(
                                        activeCellEntries,
                                        baselineUnit || slfUnit,
                                      )}
                                    </Text>
                                  )}
                                </Space>
                              ),
                              extra: !baselineSaved && (
                                <Button
                                  size="small"
                                  icon={<PlusOutlined />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingActiveCellKey(null);
                                    setActiveCellDraft({
                                      cellName: "",
                                      cellIndex: null,
                                      wasteType: "Residual",
                                      volume: null,
                                      unit: slfUnit,
                                      movAttachments: [],
                                    });
                                    setActiveCellModalOpen(true);
                                  }}
                                >
                                  Add Entry
                                </Button>
                              ),
                              children: (
                                <ActiveCellsTable
                                  activeCellEntries={activeCellEntries}
                                  baselineSaved={baselineSaved}
                                  declaredCellUnit={declaredCellUnit}
                                  facilityCells={facilityCells}
                                  openCellEntryForEdit={openCellEntryForEdit}
                                  setActiveCellDraft={setActiveCellDraft}
                                  setActiveCellEntries={setActiveCellEntries}
                                  setActiveCellModalOpen={setActiveCellModalOpen}
                                  setEditingActiveCellKey={setEditingActiveCellKey}
                                />
                              ),
                            },
                            {
                              key: "closed",
                              movKey: "closedCells",
                              movTitle: "Closed Cells",
                              accent: "#722ed1",
                              label: (
                                <Space>
                                  <CloseCircleOutlined
                                    style={{ color: "#722ed1" }}
                                  />
                                  <Text strong style={{ color: "#391085" }}>
                                    Closed Cells
                                    {closedCellEntries.length > 0
                                      ? ` (${closedCellEntries.length})`
                                      : ""}
                                  </Text>
                                  {closedCellEntries.length > 0 && (
                                    <Text
                                      type="secondary"
                                      style={{ fontSize: 11 }}
                                    >
                                      Total:{" "}
                                      {formatEntryVolumeSummary(
                                        closedCellEntries,
                                        baselineUnit || slfUnit,
                                      )}
                                    </Text>
                                  )}
                                </Space>
                              ),
                              extra: !baselineSaved && (
                                <Button
                                  size="small"
                                  icon={<PlusOutlined />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingClosedCellKey(null);
                                    setClosedCellDraft({
                                      cellName: "",
                                      cellIndex: null,
                                      wasteType: "Residual",
                                      volume: null,
                                      unit: slfUnit,
                                      dateClosed: null,
                                      movAttachments: [],
                                    });
                                    setClosedCellModalOpen(true);
                                  }}
                                >
                                  Add Entry
                                </Button>
                              ),
                              children: (
                                <ClosedCellsTable
                                  baselineSaved={baselineSaved}
                                  closedCellEntries={closedCellEntries}
                                  declaredCellUnit={declaredCellUnit}
                                  facilityCells={facilityCells}
                                  openCellEntryForEdit={openCellEntryForEdit}
                                  setClosedCellDraft={setClosedCellDraft}
                                  setClosedCellEntries={setClosedCellEntries}
                                  setClosedCellModalOpen={setClosedCellModalOpen}
                                  setEditingClosedCellKey={setEditingClosedCellKey}
                                />
                              ),
                            },
                            {
                              key: "haulers",
                              movKey: "haulers",
                              movTitle: "Accredited Haulers",
                              accent: "#d4b106",
                              label: (
                                <Space>
                                  <TeamOutlined
                                    style={{ color: "#614700" }}
                                  />
                                  <Text strong style={{ color: "#614700" }}>
                                    Accredited Haulers
                                    {haulers.length > 0
                                      ? ` (${haulers.length})`
                                      : ""}
                                  </Text>
                                </Space>
                              ),
                              children: (
                                <HaulersBaselineCard
                                  baselineSaved={baselineSaved}
                                  downloadHaulerTemplate={downloadHaulerTemplate}
                                  exportHaulerData={exportHaulerData}
                                  haulerColumns={haulerColumns}
                                  haulerExportRef={haulerExportRef}
                                  haulerTableRef={haulerTableRef}
                                  haulerUploadRef={haulerUploadRef}
                                  haulers={haulers}
                                  openFeatureTour={openFeatureTour}
                                  openHaulerModal={openHaulerModal}
                                  openUploadGuide={openUploadGuide}
                                />
                              ),
                            },
                        ].map((section) => {
                          const folded = collapsedBaselineCards.includes(section.key);
                          const toggle = () =>
                            updateFoldedCards((prev) =>
                              prev.includes(section.key)
                                ? prev.filter((k) => k !== section.key)
                                : [...prev, section.key],
                            );
                          return (
                          <Card
                            key={section.key}
                            id={`slf-baseline-${section.key}`}
                            size="small"
                            className={`slf-baseline-section-card${folded ? " is-folded" : ""}`}
                            title={
                              // The whole title folds / unfolds the card; the
                              // actions on the right stay usable either way.
                              <div
                                role="button"
                                tabIndex={0}
                                aria-expanded={!folded}
                                aria-controls={`slf-baseline-${section.key}-body`}
                                onClick={toggle}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggle();
                                  }
                                }}
                                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
                              >
                                <RightOutlined
                                  style={{
                                    fontSize: 11,
                                    color: "#8c8c8c",
                                    transition: "transform 0.2s",
                                    transform: folded ? "rotate(0deg)" : "rotate(90deg)",
                                  }}
                                />
                                {section.label}
                              </div>
                            }
                            extra={
                              <Space size={8} wrap style={{ justifyContent: "flex-end" }}>
                                {section.extra}
                                <SectionMovButton
                                  title={section.movTitle}
                                  attachments={baselineMov[section.movKey]}
                                  editable={!baselineSaved}
                                  uploaderEmail={portalUser?.email}
                                  onChange={(updater) =>
                                    setBaselineMov((prev) => ({
                                      ...prev,
                                      [section.movKey]:
                                        typeof updater === "function" ? updater(prev[section.movKey]) : updater,
                                    }))
                                  }
                                />
                              </Space>
                            }
                            style={{
                              marginBottom: 14,
                              borderRadius: 10,
                              borderLeft: `4px solid ${section.accent}`,
                            }}
                            styles={{
                              header: {
                                flexWrap: "wrap",
                                gap: 8,
                                padding: "8px 12px",
                                ...(folded ? { borderBottom: "none" } : {}),
                              },
                              // Folded = hidden, not unmounted: the feature tour
                              // anchors into these cards, and the tables keep
                              // their page / sort state across a fold.
                              body: folded ? { display: "none" } : { padding: 12 },
                            }}
                          >
                            <div id={`slf-baseline-${section.key}-body`}>{section.children}</div>
                          </Card>
                          );
                        })}

                        {/* ── Save Baseline Update Button (visible when admin approved editing) ── */}
                        {!baselineSaved && baselineRemoteChanged && (
                          <Alert
                            type="warning"
                            showIcon
                            style={{ marginTop: 16 }}
                            message="EMB Region III updated your baseline while you were editing"
                            description="Your unsaved edits are still here. Save Baseline Update to keep them, or reload EMB's version (your unsaved edits will be discarded)."
                            action={
                              <Space direction="vertical" size={4}>
                                <Button
                                  size="small"
                                  danger
                                  onClick={() => {
                                    setBaselineRemoteChanged(false);
                                    setBaselineRefresh((n) => n + 1);
                                  }}
                                >
                                  Reload EMB&apos;s version
                                </Button>
                                <Button size="small" onClick={() => setBaselineRemoteChanged(false)}>
                                  Keep editing
                                </Button>
                              </Space>
                            }
                          />
                        )}
                        {!baselineSaved && (
                          <div
                            ref={baselineActionRef}
                            style={{
                              marginTop: 24,
                              paddingTop: 16,
                              borderTop: "1px solid #e8e8e8",
                              display: "flex",
                              justifyContent: "flex-end",
                              alignItems: "center",
                              gap: 12,
                            }}
                          >
                            {baselineDirtyGuard.dirty && (
                              <Tooltip title="Baseline changes are not saved automatically. Use Save Baseline Update to keep them — you will be asked before leaving the page.">
                                <Tag color="orange" icon={<ExclamationCircleOutlined />} style={{ marginInlineEnd: 0 }}>
                                  Unsaved changes
                                </Tag>
                              </Tooltip>
                            )}
                            <Button
                              type="primary"
                              size="large"
                              icon={<SaveOutlined />}
                              loading={baselineSavingLoading}
                              onClick={handleSaveBaselinePortal}
                              style={{
                                background: "#1a3353",
                                borderColor: "#1a3353",
                                paddingLeft: 28,
                                paddingRight: 28,
                              }}
                            >
                              Save Baseline Update
                            </Button>
                          </div>
                        )}
                      </Form>
                    </div>
                  ),
                },
                {
                  key: "disposal",
                  label: (
                    <span>
                      <FileTextOutlined />{" "}
                      {isMobile
                        ? "Waste Generator Info"
                        : "Waste Generator Information"}
                      <RequiredDot
                        show={
                          missingDisposalInfo ||
                          missingHazardousCodeTrucks.length > 0
                        }
                      />
                    </span>
                  ),
                  children: () => (
                    <WasteGeneratorPane
                      entryForm={entryForm}
                      trucks={trucks}
                      haulers={haulers}
                      slfUnit={slfUnit}
                      activeCellOptions={activeCellOptions}
                      isMobile={isMobile}
                      isRequired={isRequired}
                      fl={fl}
                      missingDisposalInfo={missingDisposalInfo}
                      missingHazardousCodeTrucks={missingHazardousCodeTrucks}
                      truckPage={truckPage}
                      setTruckPage={setTruckPage}
                      truckPageSize={truckPageSize}
                      setTruckPageSize={setTruckPageSize}
                      selectedTruckKeys={selectedTruckKeys}
                      setSelectedTruckKeys={setSelectedTruckKeys}
                      truckBulkCell={truckBulkCell}
                      setTruckBulkCell={setTruckBulkCell}
                      openTruckModal={openTruckModal}
                      removeTruck={removeTruck}
                      assignSelectedTrucksToCell={assignSelectedTrucksToCell}
                      openUploadGuide={openUploadGuide}
                      setActiveTab={setActiveTab}
                      truckUploadRef={truckUploadRef}
                      truckTableRef={truckTableRef}
                    />
                  ),
                },
              ])}
              />
            </div>
          </Card>
        </Col>
        <DataEntryGuide
          baselineGaps={baselineGaps}
          baselineGapsRef={baselineGapsRef}
          baselineUnit={baselineUnit}
          isMobile={isMobile}
          renderGuideItems={renderGuideItems}
          setActiveTab={setActiveTab}
          setCompletionModalOpen={setCompletionModalOpen}
          slfUnit={slfUnit}
        />
      </Row>
    </div>
  );
}

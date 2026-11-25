import { Col, Alert, Space, Button, Card, Collapse } from "antd";
import { Text } from "./portalShared";
import { QuestionCircleOutlined } from "@ant-design/icons";

export default function DataEntryGuide({
  baselineGaps, baselineGapsRef, baselineUnit, isMobile, renderGuideItems, setActiveTab,
  setCompletionModalOpen, slfUnit,
}) {
  return (
    <Col xs={24} xl={5}>
      {/* Incomplete baseline warning — derived from the already-loaded
          haulers (no extra fetch), recalculated whenever they change.
          Non-blocking; distinct from validation errors.

          It covers the HAULER as well as its clients. It used to look only
          at clients, so a hauler with no office address or with no clients
          at all read as complete — the second of which is the reason a
          disposal upload rejects every one of that hauler's trips.

          The rule itself lives in baselineCompleteness so this panel, the
          hauler table and VERA's server-side view of the same facility
          cannot drift apart on what "incomplete" means. */}
      {(() => {
        const completeness = baselineGaps;
        if (!completeness.total) return null;
        const onlyAddresses = completeness.requiredCount === 0;
        return (
          <div ref={baselineGapsRef}>
          <Alert
            type={onlyAddresses ? "info" : "warning"}
            showIcon
            style={{ marginBottom: 12, borderRadius: 8 }}
            message={
              <Text strong style={{ fontSize: 12 }}>
                {completeness.total} incomplete baseline record
                {completeness.total === 1 ? "" : "s"}
              </Text>
            }
            description={
              <div style={{ fontSize: 12 }}>
                <div style={{ marginBottom: 6 }}>
                  {onlyAddresses
                    ? "Everything needed for reporting is present. These records are only missing contact details EMB Region III asks for:"
                    : "Complete these details for accurate regional reporting and to keep disposal uploads from being rejected:"}
                </div>
                {completeness.haulersMissingAddress > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    <Text type="secondary">
                      {completeness.haulersMissingAddress} hauler
                      {completeness.haulersMissingAddress === 1 ? " has" : "s have"} no office
                      address
                      {completeness.clientsMissingAddress > 0
                        ? `, and ${completeness.clientsMissingAddress} client${completeness.clientsMissingAddress === 1 ? " has" : "s have"} no address.`
                        : "."}
                    </Text>
                  </div>
                )}
                <ul style={{ margin: 0, paddingLeft: 16, maxHeight: 168, overflowY: "auto" }}>
                  {completeness.rows.slice(0, 12).map((row, i) => (
                    <li key={i} style={{ marginBottom: 3 }}>
                      <Text strong>{row.hauler}</Text>
                      {row.client ? (
                        <>
                          {" → "}
                          <Text>{row.client}</Text>
                        </>
                      ) : null}
                      {": "}
                      {row.required.length > 0 && (
                        <Text type="danger">missing {row.required.join(", ")}</Text>
                      )}
                      {row.required.length > 0 && row.recommended.length > 0 && "; "}
                      {row.recommended.length > 0 && (
                        <Text type="secondary">no {row.recommended.join(", ")}</Text>
                      )}
                    </li>
                  ))}
                </ul>
                {completeness.total > 12 && (
                  <Text type="secondary">+{completeness.total - 12} more record(s)…</Text>
                )}
                <div style={{ marginTop: 8 }}>
                  <Space size={6} wrap>
                    {/* Fix them HERE. Sending the operator to the Accredited
                        Haulers tab meant finding each record by hand — open
                        the hauler, find the client inside it, fill one field,
                        close, repeat — which with eighty haulers is why the
                        gaps never closed. */}
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => setCompletionModalOpen(true)}
                    >
                      Complete {completeness.total} record
                      {completeness.total === 1 ? "" : "s"}
                    </Button>
                    <Button size="small" onClick={() => setActiveTab("baseline")}>
                      Open Baseline Data
                    </Button>
                  </Space>
                </div>
              </div>
            }
          />
          </div>
        );
      })()}
      <Card
        className="slf-section"
        title={
          <Space>
            <QuestionCircleOutlined style={{ color: "#1a3353" }} />
            <Text strong style={{ color: "#1a3353" }}>
              Data Entry Guide
            </Text>
          </Space>
        }
        style={{ position: isMobile ? "static" : "sticky", top: 76 }}
      >
        <Collapse
          size="small"
          bordered={false}
          style={{ background: "transparent" }}
          items={[
            {
              key: "baseline",
              label: (
                <Text strong style={{ fontSize: 12 }}>
                  Baseline Data
                </Text>
              ),
              children: renderGuideItems(
                [
                  "Encode the Total Volume Accepted since the start of operation.",
                  "Add Active and Closed Cell entries by choosing one of the cells EMB declared for your SLF. Each cell's Status (Active, Reserved, Under Construction, …) is shown as EMB set it.",
                  `Cell volumes use the unit EMB declared for that cell (${(baselineUnit || slfUnit).replace("m3", "m³")} unless EMB set another) — it is filled in for you.`,
                  "You may give a cell your own name; it stays linked to EMB's cell and EMB's name is shown under it.",
                  "Attach the MOV (Means of Verification) for each section with its Upload MOV button. Every file you submit is also in My Documents.",
                  "Add accredited haulers with their vehicles and clients (name, type, province, city) before the first submission. Clients EMB has checked show Verified by EMB.",
                  "Use Save Baseline Update to keep baseline changes.",
                ],
                "#1677ff",
              ),
            },
            {
              key: "generator",
              label: (
                <Text strong style={{ fontSize: 12 }}>
                  Waste Generator Info
                </Text>
              ),
              children: renderGuideItems(
                [
                  "Choose the Date of Disposal (future dates cannot be chosen) and add each transport entry.",
                  "Trucks weighed in tons at an m³ SLF (or the reverse): use “Weighed in tons? Enter the weight” — it is converted with 1 m³ = 0.5 tons and the weight is kept for EMB.",
                  "Missed days? One upload file can cover up to one month back; each disposal date becomes its own submission with its own ID No.",
                  "Use Treated Hazardous Waste only for treated hazardous loads. Hazardous waste is shown in red.",
                  "Hazardous Waste Code is required for every Treated Hazardous Waste entry.",
                  "Review truck plate, hauler, capacity, actual volume, and unit before submitting.",
                ],
                "#52c41a",
              ),
            },
            {
              key: "submission-rules",
              label: (
                <Text strong style={{ fontSize: 12 }}>
                  Submission Rules
                </Text>
              ),
              children: renderGuideItems(
                [
                  `All transport entries are saved in your declared baseline unit ${(baselineUnit || slfUnit).replace("m3", "m³")}; a value weighed in the other unit is converted, never mixed.`,
                  "Upload names are matched ignoring capital letters, periods, commas and extra spaces. A real difference (a letter or word) asks you “Did you mean …?”.",
                  "Vehicle Capacity is required for every accredited-hauler vehicle (the over-capacity check needs it).",
                  "Truck Capacity is required for uploaded rows; when entered it must be greater than 0.",
                  "A truck's capacity may not exceed its registered capacity by more than 10%.",
                  "Complete past submissions with unassigned waste in Organize Cells before submitting new entries.",
                ],
                "#eb2f96",
              ),
            },
            {
              key: "notes",
              label: (
                <Text strong style={{ fontSize: 12 }}>
                  Reminders
                </Text>
              ),
              children: renderGuideItems(
                [
                  "Your entry is saved to Drafts & Scheduled automatically as you type — the facility card shows when it was last saved.",
                  "Baseline data locks after submission unless an admin approves an update request.",
                  "Use My Requests to track update and edit requests, Submission History for status, and My Documents to download your files.",
                ],
                "#fa8c16",
              ),
            },
          ]}
        />
      </Card>
    </Col>
  );
}

import { Alert, Button, Space, Table, Tabs, Tag, Typography } from "antd";
import { DownloadOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { UPLOAD_COLUMNS } from "./uploadHelpers";
import {
  HAULER_UPLOAD_EXAMPLE_ROWS,
  HAULER_UPLOAD_EXAMPLE_RESULT,
} from "./haulerUploadExample";

const { Text, Paragraph } = Typography;

// ── Accredited Haulers — upload format guide ────────────────────────────────
//
// Shown before the file picker. It has to answer the question portal users
// actually get stuck on — "my hauler serves five clients, how many rows is
// that?" — so the ROW LAYOUT comes first and the column reference second.
//
// Everything here is derived from UPLOAD_COLUMNS.hauler, the same definitions
// the parser, the row validators, the sample template and Export Hauler Data
// read. A column can therefore never be described here in terms the uploader
// does not accept, and a column added to the schema shows up in this guide and
// in the worked example without touching this file.

const BLANK = (
  <Text type="secondary" style={{ fontSize: 11 }}>
    —
  </Text>
);

const RULES = [
  {
    title: "Haulers are matched by name",
    body: "A Hauler Name already on your baseline updates that hauler; a new name adds one. Letter case and extra spaces are ignored — but a different spelling creates a second hauler, so copy names rather than retyping them.",
  },
  {
    title: "Clients are matched by name too",
    body: "Naming a client that already exists updates it. Only the columns you filled change — that client's other details, and every other client of the hauler, are left alone.",
  },
  {
    title: "A blank cell keeps what is stored",
    body: 'An empty optional cell means "leave what is already saved". It never clears a field. To empty something, edit the hauler directly instead.',
  },
  {
    title: "Repeated rows are merged, not imported twice",
    body: "Two rows with the same Hauler Name and Plate Number become one, the later non-blank value winning. The preview flags them as Duplicate so an unintended repeat is visible. Rows with no plate are compared by their client list instead, so continuation rows are never false duplicates.",
  },
  {
    title: "Only the first sheet is read",
    body: "Keep your data on sheet 1 of the workbook. Both .xlsx and .csv are accepted.",
  },
  {
    title: "Importing is not saving",
    body: 'The import fills the on-screen Accredited Haulers table only. Nothing is stored until you click "Save Baseline Update".',
  },
];

export default function HaulerUploadGuide({
  downloadHaulerTemplate,
  exportHaulerData,
  haulerCount = 0,
  isNarrow = false,
}) {
  const wrapCell = () => ({
    style: {
      whiteSpace: "normal",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
      verticalAlign: "top",
    },
  });

  // Headers wrap on SPACES only. `overflow-wrap: anywhere` would split a column
  // label mid-word ("Municipa / lity"), which is unreadable at this size and is
  // the one place breaking a word buys nothing — the labels are short enough to
  // fit on two or three lines.
  const headerCell = () => ({
    style: {
      whiteSpace: "normal",
      overflowWrap: "normal",
      wordBreak: "normal",
      fontSize: 10.5,
      lineHeight: 1.2,
      verticalAlign: "bottom",
    },
  });

  // ── Worked-example columns ────────────────────────────────────────────────
  // Widths are PERCENTAGES, not pixels, and the table carries no horizontal
  // scroll: the whole point of this figure is that the reader takes in the SHAPE
  // of three rows across thirteen columns at once, which a sideways scroll
  // destroys — you can never see the clients-only row and the vehicle rows
  // together. So the grid is fitted to the modal and every cell wraps instead.
  //
  // Shares are apportioned by what each cell actually holds: the two columns
  // carrying comma-separated lists and real sentences get the most, the coded
  // and numeric ones the least. They total 100.
  const EXAMPLE_WIDTH_PCT = {
    haulerName: 11,
    numberOfTrucks: 6,
    officeAddress: 9,
    plateNumber: 6,
    vehicleType: 6,
    capacity: 5,
    capacityUnit: 5,
    privateSectorClients: 12,
    clientType: 6,
    clientAddress: 9,
    clientRegion: 8,
    clientProvince: 6,
    clientMunicipality: 8,
  };

  const exampleColumns = [
    {
      title: "#",
      dataIndex: "_sheetRow",
      key: "_sheetRow",
      width: "3%",
      onHeaderCell: headerCell,
      render: (value, row) => (
        <Text
          style={{
            fontSize: 10.5,
            color: row._clientsOnly ? "#ad6800" : "#8c8c8c",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </Text>
      ),
    },
    ...UPLOAD_COLUMNS.hauler.map((column) => ({
      title: column.label,
      dataIndex: column.field,
      key: column.field,
      width: `${EXAMPLE_WIDTH_PCT[column.field] ?? 8}%`,
      onCell: wrapCell,
      onHeaderCell: headerCell,
      render: (value) => {
        if (!value) return BLANK;
        if (column.field === "clientType") {
          return (
            <Tag
              color={value === "LGU" ? "blue" : "green"}
              style={{ fontSize: 10, marginInlineEnd: 0 }}
            >
              {value}
            </Tag>
          );
        }
        return <Text style={{ fontSize: 10.5 }}>{value}</Text>;
      },
    })),
  ];

  // ── The same example, one card per row ────────────────────────────────────
  // On a phone thirteen columns fitted to the viewport come out at roughly
  // twenty pixels each — a grid nobody can read. Rather than reintroduce a
  // sideways scroll that hides the very contrast the figure is making, each
  // sheet row becomes a labelled card. The shape survives: you still see that
  // row 4 fills the client fields and leaves every vehicle field blank.
  const exampleCards = (
    <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
      {HAULER_UPLOAD_EXAMPLE_ROWS.map((row) => (
        <div
          key={row.key}
          style={{
            border: `1px solid ${row._clientsOnly ? "#ffe58f" : "#f0f0f0"}`,
            background: row._clientsOnly ? "#fffbe6" : "#fafafa",
            borderRadius: 6,
            padding: "8px 10px",
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <Text strong style={{ fontSize: 11.5, color: "#1a3353" }}>
              Sheet row {row._sheetRow}
            </Text>
            {row._clientsOnly && (
              <Tag
                color="warning"
                style={{ fontSize: 10, marginInlineStart: 6 }}
              >
                clients only — no vehicle
              </Tag>
            )}
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            {UPLOAD_COLUMNS.hauler.map((column) => (
              <div
                key={column.field}
                style={{
                  display: "grid",
                  gridTemplateColumns: "44% 1fr",
                  gap: 8,
                  fontSize: 11,
                  lineHeight: 1.4,
                }}
              >
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {column.label}
                </Text>
                {row[column.field] ? (
                  <Text style={{ fontSize: 11, overflowWrap: "anywhere" }}>
                    {row[column.field]}
                  </Text>
                ) : (
                  BLANK
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const columnReference = (
    <Table
      size="small"
      pagination={false}
      tableLayout="fixed"
      style={{ width: "100%" }}
      scroll={{ x: 808 }}
      rowKey="col"
      dataSource={UPLOAD_COLUMNS.hauler.map((column) => ({
        col: column.label,
        desc: column.description,
        format: column.format,
        sample: column.sample,
        required: column.required,
      }))}
      columns={[
        {
          title: "Column Header",
          dataIndex: "col",
          width: 150,
          onCell: wrapCell,
          render: (value) => (
            <Text
              code
              style={{
                whiteSpace: "normal",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
              }}
            >
              {value}
            </Text>
          ),
        },
        {
          title: "Description",
          dataIndex: "desc",
          width: 260,
          onCell: wrapCell,
        },
        {
          title: "Accepted Format",
          dataIndex: "format",
          width: 190,
          onCell: wrapCell,
        },
        {
          title: "Sample",
          dataIndex: "sample",
          width: 140,
          onCell: wrapCell,
          render: (value) => (
            <Text
              code
              style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}
            >
              {value}
            </Text>
          ),
        },
        {
          title: "Required",
          dataIndex: "required",
          width: 88,
          align: "center",
          render: (value) =>
            value ? <Tag color="red">Yes</Tag> : <Tag>No</Tag>,
        },
      ]}
    />
  );

  // Starting from the current data is the safer path — the hauler and client
  // names are then guaranteed to match what is stored, which is what decides
  // whether a row updates a record or creates a second one.
  const downloadActions = (
    <Space size="small" wrap>
      {haulerCount > 0 && (
        <Button
          icon={<DownloadOutlined />}
          size="small"
          onClick={exportHaulerData}
        >
          Export current data ({haulerCount})
        </Button>
      )}
      <Button
        icon={<DownloadOutlined />}
        size="small"
        type="primary"
        onClick={downloadHaulerTemplate}
      >
        Sample Template
      </Button>
    </Space>
  );

  return (
    <>
      {/* Above the tabs on a narrow screen: the tab bar has no room for extra
          content there, and these are the two things a first-time uploader
          needs before anything else. */}
      {isNarrow && <div style={{ marginBottom: 12 }}>{downloadActions}</div>}
      <Tabs
        defaultActiveKey="layout"
        size="small"
        items={[
          {
            key: "layout",
            label: "Row layout",
            children: (
              <div>
                {/* The single rule the whole format turns on. Stated before
                  anything else because every layout mistake traces back to it. */}
                <Alert
                  type="info"
                  showIcon
                  icon={<InfoCircleOutlined />}
                  style={{ marginBottom: 14 }}
                  message="One row describes one vehicle. Clients belong to the hauler, not to the truck on their row."
                  description={
                    <span style={{ fontSize: 12.5 }}>
                      Rows sharing a <Text code>Hauler Name</Text> are gathered
                      into one hauler. A client named on the row for plate
                      ABC-1234 is <b>not</b> recorded as that truck's client —
                      it is recorded as the hauler's. So you never have to match
                      clients to trucks; you only need enough rows to hold
                      whichever list is longer.
                    </span>
                  }
                />

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    alignItems: "stretch",
                    marginBottom: 14,
                  }}
                >
                  {[
                    {
                      k: "Vehicles",
                      v: "One row each — the Plate Number identifies it",
                    },
                    {
                      k: "Client groups",
                      v: "Clients sharing a type and location travel together in one cell",
                    },
                    {
                      k: "Rows for this hauler",
                      v: "Whichever of the two is larger (at least 1)",
                      out: true,
                    },
                  ].map((item) => (
                    <div
                      key={item.k}
                      style={{
                        flex: "1 1 200px",
                        minWidth: 0,
                        background: item.out ? "#fffbe6" : "#fafafa",
                        border: `1px solid ${item.out ? "#ffe58f" : "#f0f0f0"}`,
                        borderRadius: 6,
                        padding: "10px 12px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          letterSpacing: 0.6,
                          textTransform: "uppercase",
                          color: item.out ? "#ad6800" : "#8c8c8c",
                          marginBottom: 4,
                        }}
                      >
                        {item.k}
                      </div>
                      <div
                        style={{
                          fontSize: 12.5,
                          lineHeight: 1.45,
                          color: "#1a3353",
                        }}
                      >
                        {item.v}
                      </div>
                    </div>
                  ))}
                </div>

                <Paragraph style={{ fontSize: 12.5, marginBottom: 10 }}>
                  A <b>client group</b> is a set of clients sharing the same
                  Client Type, Client Address, Client Region, Client Province
                  and Client City/Municipality — those five columns apply to
                  every name in that row's <Text code>Clients</Text> cell.
                  Clients that differ in any of them need their own row.
                </Paragraph>

                <Text
                  strong
                  style={{
                    fontSize: 12.5,
                    color: "#1a3353",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  {/* Counts come from the constant the test suite asserts the real
                    merge against, so this caption cannot drift from what the
                    example rows actually import as. */}
                  Example — one hauler, {HAULER_UPLOAD_EXAMPLE_RESULT.vehicles}{" "}
                  trucks, {HAULER_UPLOAD_EXAMPLE_RESULT.clients} clients
                </Text>
                {isNarrow ? (
                  exampleCards
                ) : (
                  <Table
                    className="slf-guide-example-table"
                    size="small"
                    pagination={false}
                    tableLayout="fixed"
                    rowKey="key"
                    dataSource={HAULER_UPLOAD_EXAMPLE_ROWS}
                    columns={exampleColumns}
                    // No `scroll.x` on purpose — the percentage widths fit the
                    // grid to the modal so all three rows and all thirteen
                    // columns are visible together, which is the whole point of
                    // the figure.
                    rowClassName={(row) =>
                      row._clientsOnly ? "slf-guide-continuation-row" : ""
                    }
                    style={{ marginBottom: 10 }}
                  />
                )}

                <div
                  style={{
                    padding: "8px 12px",
                    background: "#fffbe6",
                    borderRadius: 6,
                    border: "1px solid #ffe58f",
                    fontSize: 12,
                    lineHeight: 1.6,
                  }}
                >
                  <div>
                    <b>Row 1</b> — two clients share one cell because both are
                    Private and both are in San Fernando, Pampanga.
                  </div>
                  <div>
                    <b>Row 4</b> — no Plate Number at all. This is a{" "}
                    <b>clients-only row</b>, carrying a third client group. It
                    adds no third truck.
                  </div>
                  <div>
                    <b>Every row</b> repeats the Hauler Name and Number of
                    Trucks — they identify the hauler and are checked row by
                    row.
                  </div>
                </div>
              </div>
            ),
          },
          {
            key: "columns",
            label: `Columns (${UPLOAD_COLUMNS.hauler.length})`,
            children: (
              <div>
                <Paragraph
                  type="secondary"
                  style={{ fontSize: 12.5, marginBottom: 12 }}
                >
                  Your file must carry these headers, in any order. Extra
                  columns are ignored. <b>Export Hauler Data</b> and{" "}
                  <b>Download Sample Template</b> both write exactly this
                  layout.
                </Paragraph>
                {columnReference}
              </div>
            ),
          },
          {
            key: "rules",
            label: "Rules & limits",
            children: (
              <div>
                <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                  {RULES.map((rule) => (
                    <div
                      key={rule.title}
                      style={{ fontSize: 12.5, lineHeight: 1.6 }}
                    >
                      <Text strong style={{ color: "#1a3353" }}>
                        {rule.title}
                      </Text>
                      <div style={{ color: "rgba(0,0,0,0.65)" }}>
                        {rule.body}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Both of these are things a user WILL try and be quietly
                  defeated by, so they are stated as limits rather than left to
                  be discovered after an import that looked successful. */}
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 10 }}
                  message="An upload never removes anything"
                  description={
                    <span style={{ fontSize: 12.5 }}>
                      It only adds and updates. A hauler or client left out of
                      your file is kept exactly as it is — omitting a row is not
                      how you delete it. To remove a <b>client</b>, open the
                      hauler's Edit (pencil) in the Accredited Haulers table and
                      delete it under Clients. To remove a <b>hauler</b>, use
                      the delete button on its row — once the baseline is locked
                      this raises a deletion request for EMB Region III to
                      review.
                    </span>
                  }
                />
                <Alert
                  type="warning"
                  showIcon
                  message="A client name containing a comma cannot be uploaded"
                  description={
                    <span style={{ fontSize: 12.5 }}>
                      The comma separates client names, so{" "}
                      <Text code>ABC Corp, Inc.</Text> is read as two clients —{" "}
                      <Text code>ABC Corp</Text> and <Text code>Inc.</Text>{" "}
                      Rewrite the name without the comma, or add that client
                      through <b>Edit hauler → Add Client</b>, where the name is
                      taken exactly as typed.
                    </span>
                  }
                />
              </div>
            ),
          },
        ]}
        tabBarExtraContent={isNarrow ? null : downloadActions}
      />
    </>
  );
}

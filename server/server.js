const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const os = require("os");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const slfGeneratorRoutes = require("./routes/slfGenerators");
const dataSLFRoutes = require("./routes/dataSLF");
const settingsRoutes = require("./routes/settings");
const usersRoutes = require("./routes/users");
const logsRoutes = require("./routes/logs");
const transactionsRoutes = require("./routes/transactions");

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

// Middleware
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

// Connect to MongoDB
mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log("MongoDB connected successfully");
    // Auto-backfill transaction history for existing submissions
    try {
      const Transaction = require("./models/Transaction");
      const DataSLF = require("./models/DataSLF");
      const existing = await Transaction.distinct("submissionId");
      const untracked = await DataSLF.countDocuments({
        submissionId: { $nin: existing },
      });
      if (untracked > 0) {
        console.log(`Backfilling transactions for ${untracked} untracked entries...`);
        // Trigger the seed via internal logic
        const entries = await DataSLF.find({ submissionId: { $nin: existing } });
        const groups = {};
        for (const e of entries) {
          const sid = e.submissionId || e._id.toString();
          if (!groups[sid]) groups[sid] = [];
          groups[sid].push(e);
        }
        const toInsert = [];
        for (const [sid, items] of Object.entries(groups)) {
          toInsert.push({
            submissionId: sid,
            dataEntry: items[0]._id,
            companyName: items[0].lguCompanyName,
            companyType: items[0].companyType,
            submittedBy: items[0].submittedBy || "",
            type: "submission",
            description: `${items.length} entr${items.length === 1 ? "y" : "ies"} submitted by ${items[0].submittedBy || "unknown"}`,
            performedBy: items[0].submittedBy || "portal",
            meta: { entryCount: items.length, ids: items.map((e) => e.idNo) },
            createdAt: items[0].createdAt,
            updatedAt: items[0].createdAt,
          });
          if (items[0].submittedBy) {
            toInsert.push({
              submissionId: sid,
              companyName: items[0].lguCompanyName,
              submittedBy: items[0].submittedBy,
              type: "email_ack_sent",
              description: `Acknowledgement email sent to ${items[0].submittedBy}`,
              performedBy: "system",
              meta: { email: items[0].submittedBy },
              createdAt: new Date(items[0].createdAt.getTime() + 2000),
              updatedAt: new Date(items[0].createdAt.getTime() + 2000),
            });
          }
          for (const e of items) {
            if (e.status && e.status !== "pending") {
              toInsert.push({
                submissionId: sid,
                dataEntry: e._id,
                companyName: e.lguCompanyName,
                companyType: e.companyType,
                submittedBy: e.submittedBy || "",
                type: "status_change",
                description: `Entry ${e.idNo} marked as ${e.status}`,
                performedBy: "admin",
                meta: { status: e.status, idNo: e.idNo },
                createdAt: e.updatedAt || e.createdAt,
                updatedAt: e.updatedAt || e.createdAt,
              });
            }
          }
        }
        if (toInsert.length > 0) {
          await Transaction.insertMany(toInsert);
          console.log(`Backfilled ${toInsert.length} transaction records.`);
        }
      }
    } catch (err) {
      console.error("Transaction backfill error:", err.message);
    }
  })
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running" });
});
app.use("/api/auth", authRoutes);
app.use("/api/slf-generators", slfGeneratorRoutes);
app.use("/api/data-slf", dataSLFRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/logs", logsRoutes);
app.use("/api/transactions", transactionsRoutes);

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

// Listen on 0.0.0.0 so the server is accessible over the network
app.listen(PORT, "0.0.0.0", () => {
  const localIP = getLocalIP();
  console.log(`\nServer is running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}\n`);
});

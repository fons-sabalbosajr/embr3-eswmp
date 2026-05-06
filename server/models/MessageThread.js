const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    url: { type: String, trim: true, default: "" },
    fileId: { type: String, trim: true, default: "" },
    mimeType: { type: String, trim: true, default: "" },
    source: { type: String, enum: ["local", "app"], default: "local" },
  },
  { _id: false }
);

const appLinkSchema = new mongoose.Schema(
  {
    module: { type: String, trim: true, default: "" },
    label: { type: String, trim: true, default: "" },
    recordId: { type: String, trim: true, default: "" },
    url: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    body: { type: String, trim: true, default: "" },
    attachments: [attachmentSchema],
    appLinks: [appLinkSchema],
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

const draftSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    body: { type: String, trim: true, default: "" },
    attachments: [attachmentSchema],
    appLinks: [appLinkSchema],
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const messageThreadSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true },
    type: { type: String, enum: ["direct", "group"], default: "direct", index: true },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    messages: [messageSchema],
    drafts: [draftSchema],
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    lastMessageAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, collection: "message_threads" }
);

messageThreadSchema.index({ participants: 1, lastMessageAt: -1 });
messageThreadSchema.index({ "messages.sender": 1, lastMessageAt: -1 });
messageThreadSchema.index({ "drafts.author": 1, updatedAt: -1 });

module.exports = mongoose.model("MessageThread", messageThreadSchema);

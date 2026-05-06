const express = require("express");
const MessageThread = require("../models/MessageThread");
const User = require("../models/User");
const { authMiddleware } = require("../middleware/auth");
const { writeLog } = require("../utils/logger");
const { emitToRoom } = require("../utils/socketEmit");
const { sendInternalMessageEmail } = require("../utils/email");

const router = express.Router();
router.use(authMiddleware);

const userSelect = "firstName lastName username email role position designation";
const populateUsers = [
  { path: "participants", select: userSelect },
  { path: "createdBy", select: userSelect },
  { path: "messages.sender", select: userSelect },
  { path: "drafts.author", select: userSelect },
];

function userId(req) {
  return String(req.user.id);
}

function idOf(value) {
  return String(value?._id || value);
}

function asIdList(values) {
  return [...new Set((Array.isArray(values) ? values : values ? [values] : []).map(String).filter(Boolean))];
}

function isParticipant(thread, id) {
  return (thread.participants || []).some((participant) => idOf(participant) === String(id));
}

function visibleMessages(thread, id) {
  return (thread.messages || []).filter((message) => !(message.deletedFor || []).some((deletedId) => idOf(deletedId) === String(id)));
}

function getDraft(thread, id) {
  return (thread.drafts || []).find((draft) => idOf(draft.author) === String(id));
}

function serializeThread(thread, id) {
  const visible = visibleMessages(thread, id);
  const lastMessage = visible[visible.length - 1] || null;
  const draft = getDraft(thread, id) || null;
  const unreadCount = visible.filter((message) => (
    idOf(message.sender) !== String(id) && !(message.readBy || []).some((readerId) => idOf(readerId) === String(id))
  )).length;
  return {
    _id: thread._id,
    subject: thread.subject,
    type: thread.type,
    participants: thread.participants,
    createdBy: thread.createdBy,
    messages: visible,
    draft,
    deletedFor: thread.deletedFor || [],
    lastMessage,
    unreadCount,
    lastMessageAt: thread.lastMessageAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

async function getThreadForUser(threadId, currentUserId) {
  const thread = await MessageThread.findById(threadId).populate(populateUsers);
  if (!thread || !isParticipant(thread, currentUserId)) return null;
  return thread;
}

async function notifyRecipients(req, thread, message, sender, recipientIds) {
  const recipients = await User.find({ _id: { $in: recipientIds } }).select(userSelect);
  const senderName = `${sender.firstName || ""} ${sender.lastName || ""}`.trim() || sender.email || "A user";
  const preview = (message.body || "New message").slice(0, 240);

  for (const recipient of recipients) {
    const payload = {
      type: "internal_message",
      threadId: thread._id,
      title: `New message from ${senderName}`,
      message: thread.subject,
    };
    emitToRoom(req, `admin-${recipient.email}`, "internal-message", payload);
    emitToRoom(req, `admin-${recipient._id}`, "internal-message", payload);
    emitToRoom(req, "admin-room", "message-refresh", { threadId: thread._id });
    sendInternalMessageEmail(recipient.email, recipient.firstName, senderName, thread.subject, preview).catch(() => {});
  }
}

router.get("/users", async (_req, res) => {
  try {
    const users = await User.find({ $or: [{ isApproved: true }, { role: "developer" }] }).select(userSelect).sort({ firstName: 1, lastName: 1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.get("/conversations", async (req, res) => {
  try {
    const currentUserId = userId(req);
    const folder = req.query.folder || "inbox";
    const base = { participants: currentUserId };
    let filter = base;

    if (folder === "sent") filter = { ...base, "messages.sender": currentUserId };
    if (folder === "drafts") filter = { ...base, "drafts.author": currentUserId };
    if (folder === "deleted") filter = { ...base, deletedFor: currentUserId };
    if (folder === "inbox") filter = { ...base, deletedFor: { $ne: currentUserId }, "messages.0": { $exists: true } };

    const threads = await MessageThread.find(filter)
      .populate(populateUsers)
      .sort(folder === "drafts" ? { updatedAt: -1 } : { lastMessageAt: -1, updatedAt: -1 });

    const serialized = threads
      .map((thread) => serializeThread(thread, currentUserId))
      .filter((thread) => {
        if (folder === "sent") return thread.messages.some((message) => idOf(message.sender) === currentUserId);
        if (folder === "drafts") return !!thread.draft;
        if (folder === "deleted") return thread.deletedFor.some((deletedId) => idOf(deletedId) === currentUserId);
        return true;
      });

    res.json(serialized);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.get("/conversations/:id", async (req, res) => {
  try {
    const currentUserId = userId(req);
    const thread = await getThreadForUser(req.params.id, currentUserId);
    if (!thread) return res.status(404).json({ message: "Conversation not found" });
    res.json(serializeThread(thread, currentUserId));
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post("/conversations", async (req, res) => {
  try {
    const currentUserId = userId(req);
    const sender = await User.findById(currentUserId).select(userSelect);
    if (!sender) return res.status(404).json({ message: "Sender not found" });

    const { subject, participantIds, body, attachments, appLinks, draft } = req.body || {};
    if (!subject?.trim()) return res.status(400).json({ message: "Subject is required" });

    const recipients = asIdList(participantIds).filter((id) => id !== currentUserId);
    if (recipients.length === 0) return res.status(400).json({ message: "Select at least one recipient" });

    const existingRecipients = await User.find({ _id: { $in: recipients }, $or: [{ isApproved: true }, { role: "developer" }] }).select("_id");
    if (existingRecipients.length !== recipients.length) {
      return res.status(400).json({ message: "One or more recipients are invalid" });
    }

    if (!draft && !body?.trim() && !(attachments || []).length && !(appLinks || []).length) {
      return res.status(400).json({ message: "Message, attachment, or app data is required" });
    }

    const participants = [currentUserId, ...recipients];
    const thread = new MessageThread({
      subject: subject.trim(),
      type: participants.length > 2 ? "group" : "direct",
      participants,
      createdBy: currentUserId,
      messages: draft ? [] : [{
        sender: currentUserId,
        body: body || "",
        attachments: attachments || [],
        appLinks: appLinks || [],
        readBy: [currentUserId],
      }],
      drafts: draft ? [{
        author: currentUserId,
        body: body || "",
        attachments: attachments || [],
        appLinks: appLinks || [],
        updatedAt: new Date(),
      }] : [],
      lastMessageAt: new Date(),
    });
    await thread.save();
    await thread.populate(populateUsers);

    if (!draft) {
      await notifyRecipients(req, thread, thread.messages[0], sender, recipients);
      writeLog("info", "messages.send", { message: `Message sent: ${thread.subject}`, user: sender.email, meta: { threadId: thread._id } });
    }

    res.status(201).json({ message: draft ? "Draft saved" : "Message sent", data: serializeThread(thread, currentUserId) });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post("/conversations/:id/messages", async (req, res) => {
  try {
    const currentUserId = userId(req);
    const sender = await User.findById(currentUserId).select(userSelect);
    const thread = await MessageThread.findById(req.params.id);
    if (!thread || !isParticipant(thread, currentUserId)) return res.status(404).json({ message: "Conversation not found" });

    const { body, attachments, appLinks } = req.body || {};
    if (!body?.trim() && !(attachments || []).length && !(appLinks || []).length) {
      return res.status(400).json({ message: "Message, attachment, or app data is required" });
    }

    thread.deletedFor = (thread.deletedFor || []).filter((id) => idOf(id) !== currentUserId);
    thread.messages.push({
      sender: currentUserId,
      body: body || "",
      attachments: attachments || [],
      appLinks: appLinks || [],
      readBy: [currentUserId],
    });
    thread.lastMessageAt = new Date();
    await thread.save();
    await thread.populate(populateUsers);

    const newMessage = thread.messages[thread.messages.length - 1];
    const recipientIds = (thread.participants || []).map(idOf).filter((id) => id !== currentUserId);
    await notifyRecipients(req, thread, newMessage, sender, recipientIds);

    res.json({ message: "Message sent", data: serializeThread(thread, currentUserId) });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.put("/conversations/:id/draft", async (req, res) => {
  try {
    const currentUserId = userId(req);
    const thread = await MessageThread.findById(req.params.id);
    if (!thread || !isParticipant(thread, currentUserId)) return res.status(404).json({ message: "Conversation not found" });

    const { body, attachments, appLinks } = req.body || {};
    const draftIndex = (thread.drafts || []).findIndex((draft) => idOf(draft.author) === currentUserId);
    const draft = { author: currentUserId, body: body || "", attachments: attachments || [], appLinks: appLinks || [], updatedAt: new Date() };
    if (draftIndex >= 0) thread.drafts[draftIndex] = { ...thread.drafts[draftIndex].toObject(), ...draft };
    else thread.drafts.push(draft);
    await thread.save();
    await thread.populate(populateUsers);
    res.json({ message: "Draft saved", data: serializeThread(thread, currentUserId) });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post("/conversations/:id/send-draft", async (req, res) => {
  try {
    const currentUserId = userId(req);
    const sender = await User.findById(currentUserId).select(userSelect);
    const thread = await MessageThread.findById(req.params.id);
    if (!thread || !isParticipant(thread, currentUserId)) return res.status(404).json({ message: "Conversation not found" });

    const draftIndex = (thread.drafts || []).findIndex((draft) => idOf(draft.author) === currentUserId);
    if (draftIndex < 0) return res.status(404).json({ message: "Draft not found" });
    const draft = thread.drafts[draftIndex];
    if (!draft.body?.trim() && !(draft.attachments || []).length && !(draft.appLinks || []).length) {
      return res.status(400).json({ message: "Draft is empty" });
    }

    thread.messages.push({
      sender: currentUserId,
      body: draft.body,
      attachments: draft.attachments || [],
      appLinks: draft.appLinks || [],
      readBy: [currentUserId],
    });
    thread.drafts.splice(draftIndex, 1);
    thread.deletedFor = (thread.deletedFor || []).filter((id) => idOf(id) !== currentUserId);
    thread.lastMessageAt = new Date();
    await thread.save();
    await thread.populate(populateUsers);

    const newMessage = thread.messages[thread.messages.length - 1];
    const recipientIds = (thread.participants || []).map(idOf).filter((id) => id !== currentUserId);
    await notifyRecipients(req, thread, newMessage, sender, recipientIds);

    res.json({ message: "Draft sent", data: serializeThread(thread, currentUserId) });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.delete("/conversations/:id/draft", async (req, res) => {
  try {
    const currentUserId = userId(req);
    const thread = await MessageThread.findById(req.params.id);
    if (!thread || !isParticipant(thread, currentUserId)) return res.status(404).json({ message: "Conversation not found" });
    thread.drafts = (thread.drafts || []).filter((draft) => idOf(draft.author) !== currentUserId);
    await thread.save();
    res.json({ message: "Draft discarded" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.patch("/conversations/:id/read", async (req, res) => {
  try {
    const currentUserId = userId(req);
    const thread = await MessageThread.findById(req.params.id);
    if (!thread || !isParticipant(thread, currentUserId)) return res.status(404).json({ message: "Conversation not found" });
    thread.messages.forEach((message) => {
      if (!message.readBy.some((readerId) => idOf(readerId) === currentUserId)) message.readBy.push(currentUserId);
    });
    await thread.save();
    res.json({ message: "Conversation marked as read" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.patch("/conversations/:id/delete", async (req, res) => {
  try {
    const currentUserId = userId(req);
    const thread = await MessageThread.findById(req.params.id);
    if (!thread || !isParticipant(thread, currentUserId)) return res.status(404).json({ message: "Conversation not found" });
    if (!thread.deletedFor.some((deletedId) => idOf(deletedId) === currentUserId)) thread.deletedFor.push(currentUserId);
    await thread.save();
    res.json({ message: "Conversation moved to deleted messages" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.patch("/conversations/:id/restore", async (req, res) => {
  try {
    const currentUserId = userId(req);
    const thread = await MessageThread.findById(req.params.id);
    if (!thread || !isParticipant(thread, currentUserId)) return res.status(404).json({ message: "Conversation not found" });
    thread.deletedFor = (thread.deletedFor || []).filter((deletedId) => idOf(deletedId) !== currentUserId);
    await thread.save();
    res.json({ message: "Conversation restored" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;

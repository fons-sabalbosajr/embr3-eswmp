const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASS,
  },
});

function getVerificationEmailHTML(firstName, verifyLink) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0; padding:0; background-color:#f0f2f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5; padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a3353 0%, #2d5f8a 100%); padding:36px 40px; text-align:center;">
              <h1 style="margin:0; color:#ffffff; font-size:28px; font-weight:800; letter-spacing:2px;">EMBR3 ESWMP</h1>
              <p style="margin:8px 0 0; color:rgba(255,255,255,0.8); font-size:14px;">Enhanced Solid Waste Management Pipeline</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 8px; color:#1a3353; font-size:22px;">Verify Your Email</h2>
              <p style="margin:0 0 24px; color:#666; font-size:15px; line-height:1.6;">
                Hi <strong>${firstName}</strong>,
              </p>
              <p style="margin:0 0 24px; color:#666; font-size:15px; line-height:1.6;">
                Thank you for creating an account. Please verify your email address by clicking the button below to complete your registration.
              </p>
              
              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${verifyLink}" target="_blank" style="display:inline-block; background:#1a3353; color:#ffffff; text-decoration:none; padding:14px 40px; border-radius:8px; font-size:16px; font-weight:600; letter-spacing:0.5px;">
                      Verify Email Address
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px; color:#666; font-size:14px; line-height:1.6;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px; padding:12px 16px; background:#f5f7fa; border-radius:6px; word-break:break-all; font-size:13px; color:#2d5f8a;">
                ${verifyLink}
              </p>

              <div style="border-top:1px solid #eee; padding-top:20px; margin-top:8px;">
                <p style="margin:0; color:#999; font-size:13px; line-height:1.5;">
                  This link will expire in <strong>24 hours</strong>. If you did not create an account, you can safely ignore this email.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb; padding:20px 40px; text-align:center; border-top:1px solid #eee;">
              <p style="margin:0; color:#999; font-size:12px;">
                &copy; 2026 EMBR3 ESWMP. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendVerificationEmail(email, firstName, token) {
  const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173/eswm-pipeline";
  const verifyLink = `${CLIENT_URL}/admin/verify-email?token=${token}`;

  const mailOptions = {
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Verify Your Email - EMBR3 ESWMP",
    html: getVerificationEmailHTML(firstName, verifyLink),
  };

  await transporter.sendMail(mailOptions);
}

function getAcknowledgementEmailHTML(data) {
  const { submissionId, totalEntries, entries } = data;

  const truckRows = (trucks) =>
    (trucks || [])
      .map(
        (t) =>
          `<tr><td style="padding:6px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${t.disposalTicketNo || "—"}</td><td style="padding:6px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${t.hauler || "—"}</td><td style="padding:6px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${t.plateNumber || "—"}</td><td style="padding:6px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${t.truckCapacity ? t.truckCapacity + " " + (t.truckCapacityUnit || "m3") : "—"}</td><td style="padding:6px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${t.actualVolume != null ? t.actualVolume + " " + (t.actualVolumeUnit || "tons") : "—"}</td><td style="padding:6px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${t.wasteType || "—"}</td></tr>`
      )
      .join("");

  const entryBlocks = entries
    .map(
      (e) => `
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;overflow:hidden;border:1px solid #eee;margin-bottom:16px;">
        <tr><td colspan="2" style="background:#1a3353;padding:10px 16px;color:#fff;font-size:13px;font-weight:700;">Entry — ${e.idNo}</td></tr>
        <tr><td style="padding:8px 16px;color:#666;font-size:13px;border-bottom:1px solid #f0f0f0;width:40%;font-weight:600;">Date</td><td style="padding:8px 16px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.dateOfDisposal || "—"}</td></tr>
        <tr><td style="padding:8px 16px;color:#666;font-size:13px;border-bottom:1px solid #f0f0f0;font-weight:600;">LGU/Company</td><td style="padding:8px 16px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.lguCompanyName || "—"}</td></tr>
        <tr><td style="padding:8px 16px;color:#666;font-size:13px;border-bottom:1px solid #f0f0f0;font-weight:600;">Company Type</td><td style="padding:8px 16px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.companyType || "—"}</td></tr>
        ${
          e.trucks && e.trucks.length > 0
            ? `<tr><td colspan="2" style="padding:8px 16px;color:#1a3353;font-size:13px;font-weight:700;background:#eef3f7;">Trucks (${e.trucks.length})</td></tr>
               <tr><td colspan="2" style="padding:0;">
                 <table width="100%" cellpadding="0" cellspacing="0">
                   <tr><th style="padding:6px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #eee;">Ticket No.</th><th style="padding:6px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #eee;">Hauler</th><th style="padding:6px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #eee;">Plate No.</th><th style="padding:6px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #eee;">Capacity</th><th style="padding:6px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #eee;">Volume</th><th style="padding:6px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #eee;">Waste Type</th></tr>
                   ${truckRows(e.trucks)}
                 </table>
               </td></tr>`
            : ""
        }
      </table>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1a3353 0%,#2d5f8a 100%);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;letter-spacing:2px;">EMBR3 ESWMP</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Ecological Solid Waste Management Pipeline</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="display:inline-block;background:#e6f7ee;border-radius:50%;padding:16px;">
                <span style="font-size:32px;">&#10003;</span>
              </div>
            </div>
            <h2 style="margin:0 0 8px;color:#1a3353;font-size:20px;text-align:center;">Submission Acknowledged</h2>
            <p style="margin:0 0 8px;color:#666;font-size:14px;line-height:1.6;text-align:center;">
              Your SLF disposal data has been received. <strong>${totalEntries}</strong> entr${totalEntries === 1 ? "y" : "ies"} recorded.
            </p>
            <p style="margin:0 0 24px;color:#999;font-size:12px;text-align:center;">Submission ID: ${submissionId}</p>

            ${entryBlocks}

            <div style="margin-top:24px;padding:16px;background:#fffbe6;border-radius:8px;border:1px solid #ffe58f;">
              <p style="margin:0;color:#ad6800;font-size:13px;line-height:1.5;">
                <strong>Note:</strong> This is an automated acknowledgement. If any information above is incorrect, please contact the ESWMP administration.
              </p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;color:#999;font-size:12px;">&copy; 2026 EMBR3 ESWMP. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendAcknowledgementEmail(email, data) {
  const mailOptions = {
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Submission Acknowledged — ${data.submissionId} | EMBR3 ESWMP`,
    html: getAcknowledgementEmailHTML(data),
  };

  await transporter.sendMail(mailOptions);
}

// ─── Portal Email Templates ───────────────────────────────────────────────────

function portalEmailWrapper(bodyContent) {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background-color:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1a3353 0%,#2d5f8a 100%);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;letter-spacing:2px;">EMBR3 ESWMP</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">SLF Generators Portal</p>
          </td>
        </tr>
        <tr><td style="padding:40px;">${bodyContent}</td></tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;color:#999;font-size:12px;">&copy; 2026 EMBR3 ESWMP. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// 1. Signup confirmation – account pending approval
async function sendPortalSignupEmail(email, firstName) {
  const body = `
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;">Registration Received</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Hi <strong>${firstName}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Thank you for registering on the SLF Generators Portal. Your account is currently
      <strong style="color:#fa8c16;">pending approval</strong> by the administrator.
    </p>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      You will receive another email once your account has been reviewed. This usually takes 1–2 business days.
    </p>
    <div style="padding:16px;background:#e6f7ff;border-radius:8px;border:1px solid #91d5ff;">
      <p style="margin:0;color:#0050b3;font-size:13px;line-height:1.5;">
        <strong>What happens next?</strong><br/>
        An administrator will review your registration and assign a Sanitary Landfill Facility (SLF) to your account.
        Once approved, you can log in and start submitting disposal data.
      </p>
    </div>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Registration Received — SLF Generators Portal",
    html: portalEmailWrapper(body),
  });
}

// 2. Approval notification – account approved with assigned SLF
async function sendPortalApprovalEmail(email, firstName, slfName) {
  const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173/eswm-pipeline";
  const loginLink = `${CLIENT_URL}/slfportal/login`;

  const body = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#e6f7ee;border-radius:50%;padding:16px;">
        <span style="font-size:32px;">&#10003;</span>
      </div>
    </div>
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;text-align:center;">Account Approved!</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Hi <strong>${firstName}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#666;font-size:15px;line-height:1.6;">
      Great news! Your SLF Generators Portal account has been approved. You have been assigned to:
    </p>
    <div style="padding:16px;background:#f6ffed;border-radius:8px;border:1px solid #b7eb8f;text-align:center;margin-bottom:24px;">
      <p style="margin:0;color:#389e0d;font-size:18px;font-weight:700;">${slfName}</p>
    </div>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      You can now log in and start submitting disposal data for your assigned SLF facility.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:8px 0 24px;">
        <a href="${loginLink}" target="_blank" style="display:inline-block;background:#1a3353;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:0.5px;">
          Log In to Portal
        </a>
      </td></tr>
    </table>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Account Approved — SLF Generators Portal",
    html: portalEmailWrapper(body),
  });
}

// 3. Rejection notification
async function sendPortalRejectionEmail(email, firstName, reason) {
  const body = `
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;">Registration Update</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Hi <strong>${firstName}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      We regret to inform you that your registration on the SLF Generators Portal has been
      <strong style="color:#ff4d4f;">declined</strong>.
    </p>
    ${
      reason
        ? `<div style="padding:16px;background:#fff2f0;border-radius:8px;border:1px solid #ffccc7;margin-bottom:24px;">
            <p style="margin:0;color:#a8071a;font-size:14px;line-height:1.5;">
              <strong>Reason:</strong> ${reason}
            </p>
          </div>`
        : ""
    }
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      If you believe this was a mistake or have questions, please contact the ESWMP administration for further assistance.
    </p>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Registration Update — SLF Generators Portal",
    html: portalEmailWrapper(body),
  });
}

// 4. Password reset link
async function sendPortalResetPasswordEmail(email, firstName, resetLink) {
  const body = `
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;">Reset Your Password</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Hi <strong>${firstName}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      We received a request to reset your SLF Generators Portal password. Click the button below to set a new password.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:8px 0 24px;">
        <a href="${resetLink}" target="_blank" style="display:inline-block;background:#1a3353;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:0.5px;">
          Reset Password
        </a>
      </td></tr>
    </table>
    <p style="margin:0 0 16px;color:#666;font-size:14px;line-height:1.6;">
      Or copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 24px;padding:12px 16px;background:#f5f7fa;border-radius:6px;word-break:break-all;font-size:13px;color:#2d5f8a;">
      ${resetLink}
    </p>
    <div style="border-top:1px solid #eee;padding-top:20px;margin-top:8px;">
      <p style="margin:0;color:#999;font-size:13px;line-height:1.5;">
        This link will expire in <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this email.
      </p>
    </div>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Reset Your Password — SLF Generators Portal",
    html: portalEmailWrapper(body),
  });
}

// 5. Bulk acknowledge – admin acknowledged multiple entries at once
function getBulkAcknowledgeEmailHTML(data) {
  const { totalEntries, entries } = data;

  const entryRows = entries
    .map(
      (e) => `
      <tr>
        <td style="padding:8px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;font-weight:600;">${e.idNo}</td>
        <td style="padding:8px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.lguCompanyName || "—"}</td>
        <td style="padding:8px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.companyType || "—"}</td>
        <td style="padding:8px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.dateOfDisposal ? new Date(e.dateOfDisposal).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"}</td>
        <td style="padding:8px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.trucks?.length || 0}</td>
      </tr>`
    )
    .join("");

  return portalEmailWrapper(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#e6f7ee;border-radius:50%;padding:16px;">
        <span style="font-size:32px;">&#10003;</span>
      </div>
    </div>
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;text-align:center;">Submissions Acknowledged</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;text-align:center;">
      The administrator has reviewed and <strong style="color:#52c41a;">acknowledged</strong>
      <strong>${totalEntries}</strong> of your submission entr${totalEntries === 1 ? "y" : "ies"}.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:8px;overflow:hidden;margin-bottom:24px;">
      <tr style="background:#1a3353;">
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#fff;">ID No.</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#fff;">LGU/Company</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#fff;">Type</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#fff;">Date</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#fff;">Trucks</th>
      </tr>
      ${entryRows}
    </table>

    <div style="padding:16px;background:#fffbe6;border-radius:8px;border:1px solid #ffe58f;">
      <p style="margin:0;color:#ad6800;font-size:13px;line-height:1.5;">
        <strong>Note:</strong> If any information above is incorrect, please contact the ESWMP administration.
      </p>
    </div>
  `);
}

async function sendBulkAcknowledgeEmail(email, data) {
  const mailOptions = {
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `${data.totalEntries} Submission${data.totalEntries === 1 ? "" : "s"} Acknowledged | EMBR3 ESWMP`,
    html: getBulkAcknowledgeEmailHTML(data),
  };

  await transporter.sendMail(mailOptions);
}

// 6. Admin password reset link
async function sendAdminResetPasswordEmail(email, firstName, resetLink) {
  const body = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background-color:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1a3353 0%,#2d5f8a 100%);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;letter-spacing:2px;">EMBR3 ESWMP</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">Admin Panel</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;">Reset Your Password</h2>
            <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
              Hi <strong>${firstName}</strong>,
            </p>
            <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
              We received a request to reset your admin account password. Click the button below to set a new password.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:8px 0 24px;">
                <a href="${resetLink}" target="_blank" style="display:inline-block;background:#1a3353;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:0.5px;">
                  Reset Password
                </a>
              </td></tr>
            </table>
            <p style="margin:0 0 16px;color:#666;font-size:14px;line-height:1.6;">
              Or copy and paste this link into your browser:
            </p>
            <p style="margin:0 0 24px;padding:12px 16px;background:#f5f7fa;border-radius:6px;word-break:break-all;font-size:13px;color:#2d5f8a;">
              ${resetLink}
            </p>
            <div style="border-top:1px solid #eee;padding-top:20px;margin-top:8px;">
              <p style="margin:0;color:#999;font-size:13px;line-height:1.5;">
                This link will expire in <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this email.
              </p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;color:#999;font-size:12px;">&copy; 2026 EMBR3 ESWMP. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Reset Your Password — EMBR3 ESWMP Admin",
    html: body,
  });
}

module.exports = {
  sendVerificationEmail,
  sendAcknowledgementEmail,
  sendBulkAcknowledgeEmail,
  sendPortalSignupEmail,
  sendPortalApprovalEmail,
  sendPortalRejectionEmail,
  sendPortalResetPasswordEmail,
  sendAdminResetPasswordEmail,
};

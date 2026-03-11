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
  const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
  const verifyLink = `${CLIENT_URL}/verify-email?token=${token}`;

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

module.exports = { sendVerificationEmail, sendAcknowledgementEmail };

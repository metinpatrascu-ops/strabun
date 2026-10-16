"use strict";

const { randomUUID } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getStorage } = require("firebase-admin/storage");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");

initializeApp({
  storageBucket: "gemeenteecht-mailer.firebasestorage.app",
});

const resendApiKey = defineSecret("RESEND_API_KEY");
const allowedSenderEmails = defineString("SENDER_ALLOWED_EMAILS");
const verifiedFromAddress = defineString("RESEND_FROM_EMAIL", {
  default: "contact@gemeenteecht-susteren.com",
});
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertAuthorizedSender(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to use the email sender.");
  }
  const accountEmail = request.auth.token.email;
  if (!request.auth.token.email_verified || typeof accountEmail !== "string") {
    throw new HttpsError("permission-denied", "A verified account is required.");
  }
  const permittedEmails = allowedSenderEmails.value()
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!permittedEmails.includes(accountEmail.toLowerCase())) {
    throw new HttpsError("permission-denied", "This account is not allowed to use the email sender.");
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validateImageUrl(value, uid, bucket) {
  if (value === "") return "";
  if (typeof value !== "string" || value.length > 2500) {
    throw new HttpsError("invalid-argument", "Invalid image URL.");
  }

  try {
    const url = new URL(value);
    const objectPath = decodeURIComponent(url.pathname);
    const allowedPrefix = `/v0/b/${bucket}/o/email-assets/${uid}/`;
    if (
      url.protocol !== "https:" ||
      url.hostname !== "firebasestorage.googleapis.com" ||
      !objectPath.startsWith(allowedPrefix) ||
      !url.searchParams.has("token")
    ) {
      throw new Error("Image URL is not an uploaded asset.");
    }
    return url.href;
  } catch {
    throw new HttpsError("invalid-argument", "Invalid uploaded image.");
  }
}

function buildEmailHtml({
  subject,
  message,
  signature,
  backgroundImage,
  logoImage,
  stampImage,
  backgroundColor,
  textColor,
}) {
  const escapedSubject = escapeHtml(subject);
  const escapedMessage = escapeHtml(message).replaceAll("\n", "<br>");
  const escapedSignature = escapeHtml(signature).replaceAll("\n", "<br>");
  const imageStyle = backgroundImage
    ? `background-image:url('${escapeHtml(backgroundImage)}');background-position:center;background-size:cover;background-repeat:no-repeat;`
    : "";
  const logo = logoImage
    ? `<img src="${escapeHtml(logoImage)}" alt="" width="140" style="display:block;width:auto;max-width:140px;max-height:70px;margin:0 auto 24px;">`
    : "";
  const stamp = stampImage
    ? `<img src="${escapeHtml(stampImage)}" alt="Ștampilă" width="80" style="display:block;width:auto;max-width:80px;max-height:70px;margin:22px 0 0 auto;">`
    : "";
  const signatureHtml = signature
    ? `<tr><td style="padding-top:20px;border-top:1px solid #ffffff80;">${escapedSignature}</td></tr>`
    : "";

  return `<!doctype html>
<html lang="ro">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapedSubject}</title></head>
<body style="margin:0;padding:24px 10px;background:#f0f2f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
        <tr>
          <td bgcolor="${backgroundColor}" background="${backgroundImage ? escapeHtml(backgroundImage) : ""}" style="${imageStyle}background-color:${backgroundColor};color:${textColor};padding:40px 34px;border-radius:12px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="color:${textColor};">
              <tr><td style="padding-bottom:20px;">${logo}<h1 style="margin:0;font-size:25px;line-height:1.3;color:${textColor};">${escapedSubject}</h1></td></tr>
              <tr><td style="font-size:16px;line-height:1.7;color:${textColor};">${escapedMessage}</td></tr>
              ${signatureHtml}
              ${stamp ? `<tr><td>${stamp}</td></tr>` : ""}
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

exports.saveEmailAsset = onCall(async (request) => {
  assertAuthorizedSender(request);
  const { kind, contentType, content } = request.data || {};
  const allowedTypes = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  if (
    !["background", "logo", "stamp"].includes(kind) ||
    !Object.hasOwn(allowedTypes, contentType) ||
    typeof content !== "string" ||
    content.length > 7_000_000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)
  ) {
    throw new HttpsError("invalid-argument", "Invalid image upload.");
  }
  const image = Buffer.from(content, "base64");
  if (image.length > 5 * 1024 * 1024 || image.toString("base64") !== content) {
    throw new HttpsError("invalid-argument", "Images must be no larger than 5 MB.");
  }
  const signatures = {
    "image/png": image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/jpeg": image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff,
    "image/webp": image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP",
  };
  if (!signatures[contentType]) {
    throw new HttpsError("invalid-argument", "The uploaded file is not a valid image of that type.");
  }

  const bucketName = "gemeenteecht-mailer.firebasestorage.app";
  const objectPath = `email-assets/${request.auth.uid}/${kind}-${randomUUID()}.${allowedTypes[contentType]}`;
  const token = randomUUID();
  await getStorage().bucket(bucketName).file(objectPath).save(image, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: "public, max-age=31536000",
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
  return { url };
});

exports.sendEmail = onCall(
  {
    secrets: [resendApiKey],
  },
  async (request) => {
    assertAuthorizedSender(request);

    const {
      to,
      senderName,
      subject,
      message,
      signature = "",
      backgroundImage = "",
      logoImage = "",
      stampImage = "",
      backgroundColor,
      textColor,
    } = request.data || {};
    if (typeof to !== "string" || to.length > 254 || !emailPattern.test(to)) {
      throw new HttpsError("invalid-argument", "Enter one valid recipient email address.");
    }
    if (
      typeof senderName !== "string" ||
      senderName.trim().length < 1 ||
      senderName.length > 70 ||
      /[<>\r\n"]/.test(senderName)
    ) {
      throw new HttpsError("invalid-argument", "Enter a valid sender display name.");
    }
    if (typeof subject !== "string" || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) {
      throw new HttpsError("invalid-argument", "Enter a valid subject.");
    }
    if (typeof message !== "string" || !message.trim() || message.length > 10000) {
      throw new HttpsError("invalid-argument", "Enter a message up to 10,000 characters.");
    }
    if (typeof signature !== "string" || signature.length > 3000) {
      throw new HttpsError("invalid-argument", "The signature is too long.");
    }
    if (!/^#[0-9a-f]{6}$/i.test(backgroundColor) || !/^#[0-9a-f]{6}$/i.test(textColor)) {
      throw new HttpsError("invalid-argument", "Choose valid email colors.");
    }

    const bucket = "gemeenteecht-mailer.firebasestorage.app";
    const images = {
      backgroundImage: validateImageUrl(backgroundImage, request.auth.uid, bucket),
      logoImage: validateImageUrl(logoImage, request.auth.uid, bucket),
      stampImage: validateImageUrl(stampImage, request.auth.uid, bucket),
    };
    const fromAddress = verifiedFromAddress.value().trim();
    if (!emailPattern.test(fromAddress)) {
      throw new HttpsError("failed-precondition", "Configure a verified sender address.");
    }

    const html = buildEmailHtml({
      subject: subject.trim(),
      message,
      signature,
      ...images,
      backgroundColor,
      textColor,
    });
    const text = signature ? `${message}\n\n${signature}` : message;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + resendApiKey.value(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${senderName.trim()} <${fromAddress}>`,
        to: [to],
        subject: subject.trim(),
        text,
        html,
      }),
    });

    if (!response.ok) {
      console.error("Email provider rejected send request", response.status);
      throw new HttpsError("internal", "The email provider could not send this message.");
    }
    const result = await response.json();
    return { id: result.id, to };
  },
);

const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { defineSecret, defineString } = require("firebase-functions/params");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

initializeApp();

const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFromEmail = defineString("RESEND_FROM_EMAIL");
const SEND_LIMIT = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_LOGO_BYTES = 300 * 1024;
const THEMES = {
    green: { background: "#eaf1e8", text: "#26332a" },
    ivory: { background: "#f7f1e5", text: "#352f26" },
    rose: { background: "#f8e9e8", text: "#3b2c2c" },
    blue: { background: "#e8eff7", text: "#283342" },
    dark: { background: "#303b38", text: "#f4f5f0" },
};

function requireText(value, field, maxLength) {
    if (typeof value !== "string") {
        throw new HttpsError("invalid-argument", `Câmpul ${field} este obligatoriu.`);
    }

    const text = value.trim();
    if (!text || text.length > maxLength) {
        throw new HttpsError("invalid-argument", `Câmpul ${field} trebuie să aibă cel mult ${maxLength} de caractere.`);
    }
    return text;
}

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[character]);
}

function parseLogo(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") {
        throw new HttpsError("invalid-argument", "Sigla nu este validă.");
    }

    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) throw new HttpsError("invalid-argument", "Sigla trebuie să fie PNG, JPEG sau WebP.");

    const content = match[2];
    const decoded = Buffer.from(content, "base64");
    if (decoded.length === 0 || decoded.length > MAX_LOGO_BYTES || decoded.toString("base64") !== content) {
        throw new HttpsError("invalid-argument", "Sigla trebuie să aibă cel mult 300 KB.");
    }

    const extension = match[1] === "jpeg" ? "jpg" : match[1];
    return { content, filename: `sigla.${extension}` };
}

function createEmailHtml({ senderName, subject, message, theme, showStamp, hasLogo }) {
    const palette = THEMES[theme];
    const stamp = showStamp
        ? '<span style="display:inline-block;border:1px solid #bd9657;border-radius:50%;color:#a27a39;width:52px;height:52px;line-height:52px;text-align:center;font-size:9px;font-weight:bold;transform:rotate(8deg)">SIGILIU<br>PERSONAL</span>'
        : "";
    const logo = hasLogo
        ? '<img src="cid:brand-logo" alt="Siglă" width="36" height="36" style="display:block;width:36px;height:36px;object-fit:contain;border-radius:8px">'
        : '<span style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;border-radius:8px;background:#ffffffa6;color:#426b53;font-size:15px;font-weight:bold">E</span>';

    return `<!doctype html>
<html lang="ro">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f6f5f1;font-family:Arial,Helvetica,sans-serif;color:${palette.text}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:${palette.background};border-radius:12px">
    <tr><td style="padding:26px 26px 0">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
        <td width="42" valign="middle">${logo}</td>
        <td valign="middle" style="padding-left:10px;font-size:14px;font-weight:bold">${escapeHtml(senderName)}</td>
        <td width="64" align="right" valign="middle">${stamp}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:24px 26px 28px">
      <h1 style="margin:0 0 17px;font-size:21px;line-height:1.4">${escapeHtml(subject)}</h1>
      <div style="font-size:14px;line-height:1.8;white-space:normal">${escapeHtml(message).replace(/\r?\n/g, "<br>")}</div>
    </td></tr>
    <tr><td style="padding:17px 26px 24px;border-top:1px solid rgba(70,80,70,.16);font-size:12px;color:${palette.text}">
      Cu drag,<br><strong>${escapeHtml(senderName)}</strong>
    </td></tr>
  </table>
</body>
</html>`;
}

async function reserveSendSlot(uid) {
    const firestore = getFirestore();
    const ref = firestore.collection("emailSendLimits").doc(uid);
    const now = Date.now();

    await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const previousStart = snapshot.get("windowStartedAt")?.toMillis() ?? 0;
        const previousCount = snapshot.get("count") ?? 0;
        const expired = now - previousStart >= WINDOW_MS;
        const windowStartedAt = expired ? now : previousStart;
        const count = expired ? 0 : previousCount;

        if (count >= SEND_LIMIT) {
            throw new HttpsError("resource-exhausted", "Ai atins limita de 5 e-mailuri în 24 de ore.");
        }

        transaction.set(ref, {
            windowStartedAt: new Date(windowStartedAt),
            count: count + 1,
            updatedAt: FieldValue.serverTimestamp(),
        });
    });
}

exports.sendEmail = onCall(
    {
        region: "europe-west1",
        enforceAppCheck: true,
        secrets: [resendApiKey],
        maxInstances: 3,
        timeoutSeconds: 30,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Autentificarea este necesară pentru a trimite e-mailuri.");
        }

        const data = request.data || {};
        const recipient = requireText(data.recipient, "destinatar", 254);
        const senderName = requireText(data.senderName, "numele expeditorului", 80);
        const subject = requireText(data.subject, "subiectul", 160);
        const message = requireText(data.message, "mesajul", 5000);
        if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(recipient)) {
            throw new HttpsError("invalid-argument", "Adresa destinatarului nu este validă.");
        }
        if (/[\u0000-\u001f\u007f<>]/.test(senderName) || /[\r\n]/.test(subject)) {
            throw new HttpsError("invalid-argument", "Numele expeditorului sau subiectul conține caractere nepermise.");
        }

        const theme = data.theme || "green";
        if (!Object.hasOwn(THEMES, theme)) {
            throw new HttpsError("invalid-argument", "Fundalul selectat nu este valid.");
        }
        if (typeof data.showStamp !== "boolean") {
            throw new HttpsError("invalid-argument", "Opțiunea ștampilă nu este validă.");
        }
        const logo = parseLogo(data.logo);
        const fromEmail = resendFromEmail.value().trim();
        if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(fromEmail)) {
            logger.error("RESEND_FROM_EMAIL is missing or is not a valid email address.");
            throw new HttpsError("failed-precondition", "Adresa verificată a expeditorului nu este configurată.");
        }

        await reserveSendSlot(request.auth.uid);

        const payload = {
            from: `${senderName} <${fromEmail}>`,
            to: [recipient],
            subject,
            html: createEmailHtml({ senderName, subject, message, theme, showStamp: data.showStamp, hasLogo: Boolean(logo) }),
        };
        if (logo) {
            payload.attachments = [{
                filename: logo.filename,
                content: logo.content,
                content_id: "brand-logo",
            }];
        }

        let response;
        try {
            response = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    Authorization: "Bearer " + resendApiKey.value(),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15000),
            });
        } catch (error) {
            logger.error("Resend request failed.", { message: error.message });
            throw new HttpsError("unavailable", "Serviciul de e-mail nu este disponibil momentan.");
        }

        if (!response.ok) {
            logger.error("Resend rejected an email request.", { status: response.status });
            throw new HttpsError("internal", "E-mailul nu a putut fi trimis. Verifică expeditorul și încearcă din nou.");
        }

        const result = await response.json();
        return { id: result.id };
    },
);

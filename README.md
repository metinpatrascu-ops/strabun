# Mail Atelier

A private email composer for the `gemeenteecht-mailer` Firebase project. It supports a background image with text over it, logo and stamp images, an editable sender display name, and a custom signature/disclaimer appended to each message.

## One-time setup

1. In Firebase Console, enable **Authentication → Email/Password** and **Email link (passwordless sign-in)**. Add the Hosting domain to Firebase Authentication's authorized domains. The email address must appear in the function's `SENDER_ALLOWED_EMAILS` parameter; only those addresses can send email or upload assets.
2. Enable **Cloud Storage** for the project. Deploy the included rules; client access is denied, and image uploads are handled by the authenticated, allowlisted function.
3. Verify `gemeenteecht-susteren.com` as a sending domain in Resend and create a new API key. The configured sender address is `contact@gemeenteecht-susteren.com` and must be authorized by that verified domain.
4. Install the Firebase CLI and dependencies:

   ```sh
   npm install --prefix functions
   ```

5. Store the Resend API key without entering it in a terminal:

   - Open **Google Cloud Console → Secret Manager** for the `gemeenteecht-mailer` project.
   - Select **Create secret**, name it exactly `RESEND_API_KEY`, paste a newly generated Resend API key as the secret value, and create it.
   - Do not add the key to source code, this repository, or the browser app. The Functions code already binds `RESEND_API_KEY` as a Secret Manager secret.

6. Deploy:

   ```sh
   firebase deploy --only functions,hosting,storage
   ```

   This deploy command contains no key value. On the first function deployment, Firebase prompts for `SENDER_ALLOWED_EMAILS` (one or more comma-separated verified account emails). `RESEND_FROM_EMAIL` defaults to `contact@gemeenteecht-susteren.com` and can be overridden if needed.

The recipient sees the sender display name selected in the app, paired with the verified `RESEND_FROM_EMAIL` address. The app never sends through a visitor-provided address. Uploaded images are stored in Firebase Storage by the authenticated function and linked into the HTML email; some email clients may hide images until the recipient allows them.

Never put the Resend API key in source code or client-side code. Any API key previously pasted into chat should be revoked in Resend and replaced with a newly generated key in Secret Manager.

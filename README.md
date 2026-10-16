# Mail Atelier

A private email composer for the `gemeenteecht-mailer` Firebase project. It supports a background image with text over it, logo and stamp images, an editable sender display name, and a custom signature/disclaimer appended to each message.

## One-time setup

1. In Firebase Console, enable **Authentication → Email/Password**, create the sender account, and verify its email address. `SENDER_ALLOWED_EMAILS` defaults to `metinpatrascu@gmail.com`; only verified accounts in this comma-separated allowlist can send email or upload assets. Use **Resetează parola** on the app's sign-in screen to set or recover the account password without sharing it.
2. Enable **Cloud Storage** for the project. Deploy the included rules; client access is denied, and image uploads are handled by the authenticated, allowlisted function.
3. Verify `gemeenteecht-susteren.com` as a sending domain in Resend and create a new API key. `RESEND_FROM_EMAIL` defaults to `contact@gemeenteecht-susteren.com`; it must be authorized by that verified domain.
4. Install the Firebase CLI and dependencies:

   ```sh
   npm install --prefix functions
   ```

5. Store the Resend API key without entering it in a terminal:

   - Open **Google Cloud Console → Secret Manager** for the `gemeenteecht-mailer` project.
   - Select **Create secret**, name it exactly `RESEND_API_KEY`, paste a newly generated Resend API key as the secret value, and create it.
   - Do not add the key to source code, this repository, or the browser app. The Functions code already binds `RESEND_API_KEY` as a Secret Manager secret.
   - The GitHub Actions service-account secret is only used to authorize deployment; its value cannot be read by the workflow or safely copied into Firebase Secret Manager. Create or rotate the Resend key in Resend and add it directly to Secret Manager.

6. Deploy:

   ```sh
   firebase deploy --only functions,hosting,storage
   ```

   This deploy command contains no key value. `SENDER_ALLOWED_EMAILS` and `RESEND_FROM_EMAIL` have defaults in the Functions code; you can override them with Firebase Functions parameters if needed.

The recipient sees the sender display name selected in the app, paired with the verified `RESEND_FROM_EMAIL` address. The app never sends through a visitor-provided address. Uploaded images are stored in Firebase Storage by the authenticated function and linked into the HTML email; some email clients may hide images until the recipient allows them.

Never put the Resend API key in source code or client-side code. Any API key previously pasted into chat should be revoked in Resend and replaced with a newly generated key in Secret Manager.

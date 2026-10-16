# Mail Atelier

A private email composer for the `gemeenteecht-mailer` Firebase project. It supports a background image with text over it, logo and stamp images, an editable sender display name, and a custom signature/disclaimer appended to each message.

## One-time setup

1. In Firebase Console, enable **Authentication → Email/Password**, create the sender account, and verify its email address. The email must also appear in the function's `SENDER_ALLOWED_EMAILS` parameter. No public sign-up is provided.
2. Enable **Cloud Storage** for the project. Deploy the included rules so users can upload only image files to their own asset folder.
3. Verify a sending domain in Resend and create an API key. The sender address configured below must use that verified domain.
4. Install the Firebase CLI and dependencies:

   ```sh
   npm install --prefix functions
   ```

5. Set the Resend API key as a Firebase secret:

   ```sh
   firebase functions:secrets:set RESEND_API_KEY
   ```

6. Deploy:

   ```sh
   firebase deploy --only functions,hosting,storage
   ```

   On the first function deployment, Firebase prompts for `SENDER_ALLOWED_EMAILS` (one or more comma-separated verified account emails) and `RESEND_FROM_EMAIL` (the email address verified in Resend, without a display name).

The recipient sees the sender display name selected in the app, paired with the verified `RESEND_FROM_EMAIL` address. The app never sends through a visitor-provided address. Uploaded images are stored in Firebase Storage and linked into the HTML email; some email clients may hide images until the recipient allows them.

# Sehat Bhabua setup

## Requirements

- Node.js 18+
- MongoDB running locally, or a MongoDB Atlas connection string

## Run locally

1. Copy `.env.example` to `.env`.
2. Set a strong `JWT_SECRET` and your `MONGODB_URI`.
3. Install packages:

   ```powershell
   npm install
   ```

4. Add or migrate the doctor catalog and indexes:

   ```powershell
   npm run seed
   ```

   The idempotent seed creates 10 demo doctors in each Kaimur location:
   Bhabua, Mohania, Kudra, Ramgarh, Chainpur and Adhaura (60 total). Existing
   users/doctors are updated, not replaced. The server creates the new token
   indexes on startup; existing duplicate bookings must be cleaned before
   MongoDB can build the patient/date unique index.

5. Start the server:

   ```powershell
   npm start
   ```

Open `http://localhost:3000`.

Patients can filter State → District → Doctor/Clinic, see schedules and live capacity,
book one or more patient tokens per doctor/date in a single login, and view appointment history by status. Doctor
and admin dashboards support daily filtering and statuses (booked, confirmed,
in_progress, completed, cancelled, no_show). Demo doctor passwords are
`change-this-password`; change them before production.

For paid UPI bookings, the selected slot is held for 30 minutes while payment is
pending. The patient submits the UPI transaction reference; an admin must verify
the transaction and approve it before the token is issued. Unpaid bookings that
do not submit a reference in time are cancelled and their slot is released.
One login can book tokens for multiple family members in one booking. Enter each
patient's name and age; a ₹1.89 platform fee is added per patient/token to the
doctor's fee. The UPI total is the resulting per-token amount multiplied by the
number of patients, and admin approval issues one token per patient.

Patients can open **मेरे tokens** after login to see their token number, the
currently running token, how many patients are ahead, the estimated waiting
time, and the clinic's scheduled appointment time. The **Team से सवाल पूछें**
form stores questions in MongoDB; the admin can answer them from
`/admin.html`, and the patient's answer appears after refreshing the app.

The **AI सहायक** answers patient-specific token/appointment questions and
general app or clinic-process questions. It uses Gemini on the server and the
browser's Hindi speech features to accept voice input and read answers aloud.
Set `GEMINI_API_KEY` as a secret environment variable in Render; never put the
key in browser JavaScript or commit it. The assistant is not a doctor and must
not be used for diagnosis, prescriptions, or emergencies.

Use these private dashboard URLs on the same host:

- Admin/team: `/admin.html` — logs in with `ADMIN_PHONE` and `ADMIN_PASSWORD` and
  shows every patient's booking, doctor, date, status and contact number.
- Doctor: `/doctor.html` — logs in with that doctor's account and shows that
  doctor's patient tokens.

The dashboard only shows bookings stored in the MongoDB database used by that
server. A local MongoDB database and a MongoDB Atlas database are different
databases; local bookings will not appear online unless both environments use
the same database or the data is migrated. On Render, set `MONGODB_URI` to the
Atlas database used by the deployed app. The server creates the admin account
from `ADMIN_PHONE` and `ADMIN_PASSWORD` on startup if it does not already exist.

## Free Render demo deployment

The repository includes a `render.yaml` Blueprint configuration. Before deploying:

1. Push this project to a GitHub repository. Never commit `.env`.
2. In MongoDB Atlas, create a new database user and rotate any password that was previously shared.
3. Add the Render outbound access rule required for the demo database (Atlas `0.0.0.0/0` is convenient for a demo but should be restricted for production).
4. In Render, choose **New > Blueprint**, select the GitHub repository, and apply `render.yaml`.
5. Set the generated service's `MONGODB_URI` to the Atlas connection string for the `bhabua_token` database. Also set `ADMIN_PHONE`, a strong `ADMIN_PASSWORD`, and the real `UPI_ID` and `UPI_PAYEE_NAME` in Render's environment settings. The local `.env` file is not uploaded to Render. For email OTP and question notifications, set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` to a valid Resend API key, and `RESEND_FROM_EMAIL` to a sender permitted by Resend. Resend's `onboarding@resend.dev` sender is limited to the email address associated with your Resend account; verify your own domain in Resend to send OTPs to other recipients. Save the environment variables and redeploy. Never commit API keys or put them in browser code.
6. Wait for the deploy to become live, then open the generated `https://...onrender.com` URL.
7. Run the seed command once against Atlas from a trusted local terminal:

   ```powershell
   $env:MONGODB_URI="mongodb+srv://..."
   node seed.js
   ```

   Do not put the Atlas URI in GitHub or in `render.yaml`.

8. Open `https://<your-render-host>.onrender.com/admin.html`, sign in with the
   same `ADMIN_PHONE` and `ADMIN_PASSWORD` values configured in Render, choose
   the booking date, and press **Refresh**. Run `node seed.js` against the same
   Atlas URI before testing doctor accounts; otherwise the deployed database
   will not contain the seeded doctor users.

Render uses `/api/health` as the health check. After configuring UPI, check this endpoint's `manualUpiConfigured` field; it should be `true`. After configuring Resend, check its `emailOtpConfigured` field; it should also be `true`. Free services may sleep when idle, so the first request can take longer during a demo.

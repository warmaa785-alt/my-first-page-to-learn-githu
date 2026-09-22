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
book one atomic token per doctor/date, and view appointment history by status. Doctor
and admin dashboards support daily filtering and statuses (booked, confirmed,
in_progress, completed, cancelled, no_show). Demo doctor passwords are
`change-this-password`; change them before production.

## Free Render demo deployment

The repository includes a `render.yaml` Blueprint configuration. Before deploying:

1. Push this project to a GitHub repository. Never commit `.env`.
2. In MongoDB Atlas, create a new database user and rotate any password that was previously shared.
3. Add the Render outbound access rule required for the demo database (Atlas `0.0.0.0/0` is convenient for a demo but should be restricted for production).
4. In Render, choose **New > Blueprint**, select the GitHub repository, and apply `render.yaml`.
5. Set the generated service's `MONGODB_URI` to the Atlas connection string for the `bhabua_token` database. Also set `ADMIN_PHONE` and a strong `ADMIN_PASSWORD`.
6. Wait for the deploy to become live, then open the generated `https://...onrender.com` URL.
7. Run the seed command once against Atlas from a trusted local terminal:

   ```powershell
   $env:MONGODB_URI="mongodb+srv://..."
   node seed.js
   ```

   Do not put the Atlas URI in GitHub or in `render.yaml`.

Render uses `/api/health` as the health check. Free services may sleep when idle, so the first request can take longer during a demo.

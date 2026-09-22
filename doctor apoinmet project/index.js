require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
if (!MONGODB_URI || !JWT_SECRET) throw new Error("MONGODB_URI and JWT_SECRET are required in a .env file.");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const states = ["Bihar"];
// Keep the local Kaimur names used by the seeded doctors, while also exposing
// every Bihar district in the location selector.
const districts = ["Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur", "Bhojpur", "Buxar", "Darbhanga", "East Champaran", "Gaya", "Gopalganj", "Jamui", "Jehanabad", "Kaimur", "Katihar", "Khagaria", "Kishanganj", "Lakhisarai", "Madhepura", "Madhubani", "Munger", "Muzaffarpur", "Nalanda", "Nawada", "Patna", "Purnia", "Rohtas", "Saharsa", "Samastipur", "Saran", "Sheikhpura", "Sheohar", "Sitamarhi", "Siwan", "Supaul", "Vaishali", "West Champaran"];
const districtCities = {
    Kaimur: ["Bhabua", "Mohania", "Kudra", "Ramgarh", "Chainpur", "Adhaura"],
    Patna: ["Patna City", "Danapur", "Barh", "Masaurhi"],
    Gaya: ["Gaya", "Bodh Gaya", "Sherghati", "Tekari"],
    Muzaffarpur: ["Muzaffarpur", "Kanti", "Sakra"],
    Nalanda: ["Bihar Sharif", "Rajgir", "Hilsa"],
    Rohtas: ["Sasaram", "Dehri", "Bikramganj"],
    Vaishali: ["Hajipur", "Mahua", "Lalganj"],
    "East Champaran": ["Motihari", "Raxaul", "Chakia"],
    "West Champaran": ["Bettiah", "Bagaha", "Narkatiaganj"]
};

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true }, phone: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true }, role: { type: String, enum: ["patient", "doctor", "admin"], default: "patient" },
    location: { consent: { type: Boolean, default: false }, latitude: Number, longitude: Number, capturedAt: Date }
}, { timestamps: true });
const doctorSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true }, name: { type: String, required: true, trim: true },
    specialty: { type: String, required: true, trim: true }, clinic: { type: String, required: true, trim: true },
    state: { type: String, default: "Bihar", index: true }, district: { type: String, default: "Kaimur", index: true }, city: { type: String, default: "Bhabua", index: true },
    address: { type: String, default: "Bhabua, Kaimur, Bihar" }, fee: { type: Number, default: 300, min: 0 },
    averageMinutes: { type: Number, default: 10, min: 1 }, tokenLimit: { type: Number, default: 50, min: 1 },
    availableDays: { type: [String], default: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] },
    openingTime: { type: String, default: "09:00" }, closingTime: { type: String, default: "17:00" }, active: { type: Boolean, default: true }
}, { timestamps: true });
const tokenSchema = new mongoose.Schema({
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true }, patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    patientName: { type: String, required: true }, patientPhone: { type: String, required: true, index: true },
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true }, state: { type: String, required: true }, district: { type: String, required: true }, city: { type: String, required: true }, clinic: { type: String, required: true },
    tokenNumber: { type: Number, required: true }, visitDate: { type: String, required: true }, appointmentId: { type: String, unique: true, index: true },
    appointmentTime: String, bookedAtIndia: String,
    paymentMethod: { type: String, enum: ["demo_cash", "demo_upi", "demo_card"], default: "demo_cash" },
    paymentStatus: { type: String, enum: ["demo_paid"], default: "demo_paid" },
    paymentId: String,
    status: { type: String, enum: ["booked", "confirmed", "in_progress", "called", "completed", "cancelled", "no_show"], default: "booked" }
}, { timestamps: true });
tokenSchema.index({ doctor: 1, visitDate: 1, tokenNumber: 1 }, { unique: true });
tokenSchema.index({ doctor: 1, patient: 1, visitDate: 1 });
const counterSchema = new mongoose.Schema({ doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true }, visitDate: { type: String, required: true }, nextToken: { type: Number, default: 1 } });
counterSchema.index({ doctor: 1, visitDate: 1 }, { unique: true });
const User = mongoose.model("User", userSchema);
const Doctor = mongoose.model("Doctor", doctorSchema);
const Token = mongoose.model("Token", tokenSchema);
const DailyCounter = mongoose.model("DailyCounter", counterSchema);
const resetRequests = new Map();

function signUser(user) { return jwt.sign({ id: user._id.toString(), role: user.role }, JWT_SECRET, { expiresIn: "7d" }); }
function auth(role) { return (req, res, next) => { try { const h = req.headers.authorization || ""; const p = jwt.verify(h.startsWith("Bearer ") ? h.slice(7) : "", JWT_SECRET); if (role && p.role !== role) return res.status(403).json({ message: "You do not have permission for this action." }); req.user = p; next(); } catch { res.status(401).json({ message: "Please log in to continue." }); } }; }
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function tokenId(name, n) { const first = (name || "TOKEN").trim().split(/\s+/)[0].replace(/[^\p{L}\p{N}]/gu, "").toUpperCase(); return `${first || "TOKEN"}-${String(n).padStart(3, "0")}`; }
function appointmentTime(doctor, n) { const [h, m] = (doctor.openingTime || "09:00").split(":").map(Number); const d = new Date(2000, 0, 1, h, m + (n - 1) * doctor.averageMinutes); return d.toTimeString().slice(0, 5); }
function indiaDateTime(date = new Date()) { return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kolkata" }).format(date); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= today(); }

app.post("/api/auth/register", async (req, res) => {
    try { const { name, phone, password } = req.body; if (!name || !phone || !password || password.length < 6) return res.status(400).json({ message: "Name, phone and a password of 6+ characters are required." });
        const user = await User.create({ name, phone, passwordHash: await bcrypt.hash(password, 12) }); res.status(201).json({ token: signUser(user), user: { name: user.name, phone: user.phone, role: user.role } });
    } catch (e) { res.status(e.code === 11000 ? 409 : 500).json({ message: e.code === 11000 ? "This phone number is already registered." : "Registration failed." }); }
});
app.post("/api/auth/login", async (req, res) => { const user = await User.findOne({ phone: req.body.phone }); if (!user || !(await bcrypt.compare(req.body.password || "", user.passwordHash))) return res.status(401).json({ message: "Invalid phone number or password." }); res.json({ token: signUser(user), user: { name: user.name, phone: user.phone, role: user.role } }); });
app.get("/api/auth/me", auth(), async (req, res) => { const user = await User.findById(req.user.id).select("name phone role location"); if (!user) return res.status(404).json({ message: "Patient account not found." }); res.json({ user }); });
app.post("/api/auth/forgot-password/request", async (req, res) => {
    const phone = String(req.body.phone || "").trim(); if (!phone) return res.status(400).json({ message: "Phone number is required." });
    const previous = resetRequests.get(phone); if (previous && previous.lastRequest > Date.now() - 60 * 1000) return res.status(429).json({ message: "Please wait a minute before requesting another OTP." });
    const user = await User.findOne({ phone }); const generic = { message: "If this phone is registered, a demo OTP has been generated." };
    if (!user) return res.json(generic);
    const otp = String(crypto.randomInt(100000, 1000000)); resetRequests.set(phone, { hash: await bcrypt.hash(otp, 10), expires: Date.now() + 10 * 60 * 1000, attempts: 0, lastRequest: Date.now() });
    console.log(`[DEMO OTP] password reset for ${phone}: ${otp} (expires in 10 minutes)`);
    res.json({ ...generic, demoOnly: true, demoOtp: process.env.NODE_ENV === "production" ? undefined : otp, expiresInSeconds: 600 });
});
app.post("/api/auth/forgot-password/verify", async (req, res) => {
    const phone = String(req.body.phone || "").trim(); const otp = String(req.body.otp || "").trim(); const password = String(req.body.newPassword || "");
    const request = resetRequests.get(phone); if (!request || request.expires < Date.now() || request.attempts >= 5) return res.status(400).json({ message: "OTP expired or unavailable. Request a new OTP." });
    request.attempts += 1; if (!/^\d{6}$/.test(otp) || password.length < 6 || !(await bcrypt.compare(otp, request.hash))) return res.status(400).json({ message: "Invalid OTP or password must be 6+ characters." });
    const user = await User.findOne({ phone }); if (!user) return res.status(400).json({ message: "OTP expired or unavailable. Request a new OTP." });
    user.passwordHash = await bcrypt.hash(password, 12); await user.save(); resetRequests.delete(phone); res.json({ message: "Password updated. You can now log in." });
});

app.get("/api/locations", (req, res) => res.json({
    states,
    districts,
    cities: Object.fromEntries(districts.map((district) => [district, districtCities[district] || [district]])),
    locations: districts.map((district) => ({ state: "Bihar", district, cities: districtCities[district] || [district] }))
}));
app.get("/api/doctors", async (req, res) => {
    const filter = { active: true }; if (req.query.state) filter.state = req.query.state; if (req.query.district) filter.district = req.query.district; if (req.query.city) filter.city = req.query.city;
    if (req.query.search) filter.$or = [{ name: new RegExp(req.query.search, "i") }, { specialty: new RegExp(req.query.search, "i") }, { clinic: new RegExp(req.query.search, "i") }];
    res.json(await Doctor.find(filter).sort({ district: 1, name: 1 }));
});
app.get("/api/doctors/:id/status", async (req, res) => {
    const doctor = await Doctor.findOne({ _id: req.params.id, active: true }); if (!doctor) return res.status(404).json({ message: "Doctor not found." });
    const visitDate = req.query.date || today(); const tokens = await Token.find({ doctor: doctor._id, visitDate }).sort({ tokenNumber: 1 });
    const active = tokens.filter((t) => !["cancelled", "no_show", "completed"].includes(t.status));
    const current = tokens.find((t) => ["in_progress", "called"].includes(t.status));
    const occupied = new Set(tokens.filter((t) => t.status !== "cancelled").map((t) => t.tokenNumber));
    res.json({ doctor, total: doctor.tokenLimit, booked: active.length, available: Math.max(0, doctor.tokenLimit - active.length), availableTokens: Array.from({ length: doctor.tokenLimit }, (_, i) => i + 1).filter((n) => !occupied.has(n)), bookedToday: active.length, currentToken: current?.tokenNumber || 0, estimatedMinutes: active.length * doctor.averageMinutes, tokens: tokens.map((t) => ({ tokenNumber: t.tokenNumber, status: t.status, appointmentTime: t.appointmentTime })) });
});

app.post("/api/tokens", auth("patient"), async (req, res) => {
    try {
        const { doctorId, visitDate, preferredToken, paymentMethod = "demo_cash" } = req.body; if (!doctorId || !validDate(visitDate)) return res.status(400).json({ message: "A valid doctor and today or future date are required." });
        if (!["demo_cash", "demo_upi", "demo_card"].includes(paymentMethod)) return res.status(400).json({ message: "Please choose a valid demo payment method." });
        const doctor = await Doctor.findOne({ _id: doctorId, active: true }); if (!doctor) return res.status(404).json({ message: "Doctor not found." });
        const day = new Date(`${visitDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }); if (doctor.availableDays?.length && !doctor.availableDays.includes(day)) return res.status(409).json({ message: `Doctor is not available on ${day}.` });
        const patient = await User.findById(req.user.id).select("name phone"); if (!patient) return res.status(401).json({ message: "Patient account not found." });
        let number;
        if (preferredToken !== undefined) {
            number = Number(preferredToken);
            if (!Number.isInteger(number) || number < 1 || number > doctor.tokenLimit || await Token.exists({ doctor: doctor._id, visitDate, tokenNumber: number, status: { $ne: "cancelled" } })) return res.status(409).json({ message: "That token is no longer available. Please choose another." });
        } else {
            let counter;
            for (let attempt = 0; attempt < 3; attempt++) {
                counter = await DailyCounter.findOneAndUpdate({ doctor: doctor._id, visitDate, nextToken: { $lte: doctor.tokenLimit } }, { $inc: { nextToken: 1 } }, { new: true });
                if (counter) break;
                try { await DailyCounter.create({ doctor: doctor._id, visitDate, nextToken: 1 }); } catch (e) { if (e.code !== 11000) throw e; }
            }
            if (!counter) return res.status(409).json({ message: "All tokens for this date are booked." });
            number = counter.nextToken - 1;
        }
        const appointment = await Token.create({
            doctor: doctor._id,
            patient: req.user.id,
            patientName: patient.name,
            patientPhone: patient.phone,
            clinicId: doctor._id,
            state: doctor.state,
            district: doctor.district,
            city: doctor.city,
            clinic: doctor.clinic,
            tokenNumber: number,
            visitDate,
            appointmentId: `APT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
            appointmentTime: appointmentTime(doctor, number), bookedAtIndia: indiaDateTime(),
            paymentMethod, paymentStatus: "demo_paid", paymentId: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
        });
        res.status(201).json({ appointment, token: tokenId(patient.name, number), message: "Appointment confirmed." });
    } catch (e) { if (e.code === 11000) return res.status(409).json({ message: "This appointment or token was just booked. Please refresh and try again." }); res.status(500).json({ message: "Could not book the token." }); }
});
app.post("/api/patients/location", auth("patient"), async (req, res) => { const { consent, latitude, longitude } = req.body; if (!consent) { await User.findByIdAndUpdate(req.user.id, { "location.consent": false }); return res.json({ consent: false }); } if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return res.status(400).json({ message: "Valid location coordinates are required." }); await User.findByIdAndUpdate(req.user.id, { "location.consent": true, "location.latitude": latitude, "location.longitude": longitude, "location.capturedAt": new Date() }); res.json({ consent: true }); });
app.get("/api/tokens/my", auth("patient"), async (req, res) => { const appointments = await Token.find({ patient: req.user.id }).populate("doctor").populate("patient", "name").sort({ visitDate: -1, tokenNumber: 1 }); res.json(appointments.map((x) => ({ ...x.toObject(), tokenId: tokenId(x.patient?.name, x.tokenNumber) }))); });
app.get("/api/tokens/:id/tracking", auth("patient"), async (req, res) => {
    const appointment = await Token.findOne({ _id: req.params.id, patient: req.user.id }).populate("doctor", "name clinic address averageMinutes").populate("patient", "name");
    if (!appointment) return res.status(404).json({ message: "Appointment not found." });
    const tokens = await Token.find({ doctor: appointment.doctor._id, visitDate: appointment.visitDate });
    const current = tokens.find((x) => ["called", "in_progress"].includes(x.status));
    const ahead = tokens.filter((x) => x.tokenNumber < appointment.tokenNumber && !["cancelled", "no_show", "completed"].includes(x.status)).length;
    res.json({ appointmentId: appointment.appointmentId, doctor: appointment.doctor, clinic: appointment.clinic, token: appointment.tokenNumber, tokenId: tokenId(appointment.patient?.name, appointment.tokenNumber), visitDate: appointment.visitDate, status: appointment.status, currentRunningToken: current?.tokenNumber || Math.max(0, ...tokens.filter((x) => x.status === "completed").map((x) => x.tokenNumber)), patientsAhead: ahead, estimatedWaitMinutes: ahead * (appointment.doctor.averageMinutes || 10), updatedAt: new Date().toISOString() });
});

app.get("/api/doctor/tokens", auth("doctor"), async (req, res) => { const doctor = await Doctor.findOne({ user: req.user.id }); if (!doctor) return res.status(404).json({ message: "Doctor profile not found." }); const visitDate = req.query.date || today(); const a = await Token.find({ doctor: doctor._id, visitDate }).populate("patient", "name phone").sort({ tokenNumber: 1 }); res.json(a.map((x) => ({ ...x.toObject(), tokenId: tokenId(x.patient?.name, x.tokenNumber) }))); });
app.get("/api/doctor/dashboard", auth("doctor"), async (req, res) => { const doctor = await Doctor.findOne({ user: req.user.id }); if (!doctor) return res.status(404).json({ message: "Doctor profile not found." }); const date = req.query.date || today(); const tokens = await Token.find({ doctor: doctor._id, visitDate: date }).populate("patient", "name phone").sort({ tokenNumber: 1 }); res.json({ doctor, date, summary: { total: doctor.tokenLimit, booked: tokens.filter((x) => !["cancelled", "no_show"].includes(x.status)).length, completed: tokens.filter((x) => x.status === "completed").length, current: tokens.find((x) => ["called", "in_progress"].includes(x.status))?.tokenNumber || 0 }, tokens: tokens.map((x) => ({ ...x.toObject(), tokenId: tokenId(x.patient?.name, x.tokenNumber) })) }); });
app.patch("/api/doctor/tokens/:id", auth("doctor"), async (req, res) => { const doctor = await Doctor.findOne({ user: req.user.id }); const allowed = ["booked", "confirmed", "in_progress", "called", "completed", "cancelled", "no_show"]; if (!allowed.includes(req.body.status)) return res.status(400).json({ message: "Invalid token status." }); const a = await Token.findOneAndUpdate({ _id: req.params.id, doctor: doctor?._id }, { status: req.body.status }, { new: true, runValidators: true }); if (!a) return res.status(404).json({ message: "Token not found." }); res.json(a); });
app.post("/api/doctor/next", auth("doctor"), async (req, res) => { const doctor = await Doctor.findOne({ user: req.user.id }); const date = req.body.date || today(); const current = await Token.findOneAndUpdate({ doctor: doctor?._id, visitDate: date, status: { $in: ["booked", "confirmed"] } }, { status: "in_progress" }, { sort: { tokenNumber: 1 }, new: true }); if (!current) return res.status(404).json({ message: "No waiting token." }); res.json(current); });
app.get("/api/admin/tokens", auth("admin"), async (req, res) => { const filter = req.query.date ? { visitDate: req.query.date } : {}; const a = await Token.find(filter).populate("patient", "name phone location").populate("doctor", "name clinic district").sort({ visitDate: -1, tokenNumber: 1 }); res.json(a.map((x) => ({ id: x._id, patientId: x.patient?._id, patientName: x.patientName || x.patient?.name, patientPhone: x.patientPhone || x.patient?.phone, phone: x.patientPhone || x.patient?.phone, location: x.patient?.location?.consent ? x.patient.location : null, doctor: x.doctor?.name, clinic: x.doctor?.clinic, district: x.doctor?.district, tokenNumber: x.tokenNumber, tokenId: tokenId(x.patientName || x.patient?.name, x.tokenNumber), appointmentId: x.appointmentId, appointmentTime: x.appointmentTime, visitDate: x.visitDate, createdAt: x.createdAt, bookedAtIndia: x.bookedAtIndia, paymentMethod: x.paymentMethod, paymentStatus: x.paymentStatus, paymentId: x.paymentId, status: x.status }))); });
app.get("/api/admin/dashboard", auth("admin"), async (req, res) => { const date = req.query.date || today(); const tokens = await Token.find({ visitDate: date }).populate("patient", "name phone").populate("doctor", "name clinic district").sort({ tokenNumber: 1 }); res.json({ date, total: tokens.length, byStatus: tokens.reduce((o, t) => { o[t.status] = (o[t.status] || 0) + 1; return o; }, {}), tokens }); });
app.get("/api/health", (req, res) => res.json({ status: "ok", city: "Bhabua", district: "Kaimur" }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
mongoose.connect(MONGODB_URI).then(async () => {
   try { await Token.collection.dropIndex("doctor_1_patient_1_visitDate_1"); } catch (e) { if (e.codeName !== "IndexNotFound" && e.code !== 27) console.error("Could not update old booking index:", e.message); }
   const oldTokens = await Token.find({ $or: [{ patientName: { $exists: false } }, { patientPhone: { $exists: false } }] }).populate("patient", "name phone");
   for (const oldToken of oldTokens) {
       if (oldToken.patient) await Token.updateOne({ _id: oldToken._id }, { $set: { patientName: oldToken.patient.name, patientPhone: oldToken.patient.phone } });
   }
   app.listen(PORT, "0.0.0.0", () => console.log(`Bhabua token server running on port ${PORT}`));
}).catch((e) => { console.error("MongoDB connection failed:", e.message); process.exit(1); });

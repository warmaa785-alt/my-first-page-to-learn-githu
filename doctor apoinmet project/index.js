require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const dns = require("node:dns");
const net = require("node:net");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");
const nodemailer = require("nodemailer");
const { cert, getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const QRCode = require("qrcode");

if (process.env.SMTP_HOST) dns.setDefaultResultOrder("ipv4first");

function connectSmtpOverIPv4(options, callback) {
    const socket = net.connect({
        host: options.host,
        port: options.port,
        family: 4
    });
    let settled = false;
    const fail = (error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        callback(error);
    };

    socket.setTimeout(options.connectionTimeout || 10000, () => {
        fail(new Error("SMTP IPv4 connection timed out"));
    });
    socket.once("error", fail);
    socket.once("connect", () => {
        if (settled) return;
        settled = true;
        socket.setTimeout(0);
        socket.removeListener("error", fail);
        callback(null, { connection: socket });
    });
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) cb(null, true);
        else cb(new Error("Only images allowed"), false);
    }
});

const smtpPort = Number(process.env.SMTP_PORT || 587);
const emailProvider = String(process.env.EMAIL_PROVIDER || (process.env.RESEND_API_KEY ? "resend" : "smtp"))
    .trim()
    .toLowerCase();
const emailTransporter = (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        getSocket: connectSmtpOverIPv4,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000
    })
    : null;
const SUPPORT_NOTIFICATION_EMAIL = String(process.env.SUPPORT_NOTIFICATION_EMAIL || "warmaa785@gmail.com").trim();
const PLATFORM_FEE_PER_TOKEN = 1.89;
const emailConfigured = emailProvider === "resend"
    ? Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
    : emailProvider === "smtp" && Boolean(emailTransporter);

async function sendEmail({ to, subject, text }) {
    if (!emailConfigured) {
        return { success: false, reason: `Email provider "${emailProvider}" is not configured.` };
    }
    try {
        if (emailProvider === "resend") {
            const response = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    from: process.env.RESEND_FROM_EMAIL,
                    to: [to],
                    subject,
                    text
                }),
                signal: AbortSignal.timeout(10000)
            });
            const responseText = await response.text();
            let responseBody;
            try {
                responseBody = JSON.parse(responseText);
            } catch {
                responseBody = null;
            }
            if (!response.ok) {
                return {
                    success: false,
                    reason: responseBody?.message || `Resend API returned HTTP ${response.status}.`
                };
            }
            return { success: true };
        }
        await emailTransporter.sendMail({
            from: `"Sehat Bhabua" <${process.env.SMTP_USER}>`,
            to,
            subject,
            text
        });
        return { success: true };
    } catch (error) {
        return { success: false, reason: error.message };
    }
}

const otpStore = new Map();
function generateOTP() { return String(crypto.randomInt(100000, 1000000)); }
async function sendOTPEmail(email, otp, type) {
    const subjects = { login: "Sehat Bhabua - Login OTP", appointment: "Sehat Bhabua - Appointment Confirmation OTP" };
    const messages = {
        login: `आपका Login OTP: ${otp}\nयह 10 मिनट के लिए वैध है। किसी से शेयर न करें।`,
        appointment: `आपका Appointment Confirmation OTP: ${otp}\nयह 10 मिनट के लिए वैध है।`
    };
    const delivery = await sendEmail({
        to: email,
        subject: subjects[type] || subjects.login,
        text: messages[type] || messages.login
    });
    if (!delivery.success) console.error("Email send failed:", delivery.reason);
    return delivery;
}
async function sendSupportQuestionNotification({ patientName, question, createdAt, dashboardUrl }) {
    return sendEmail({
        to: SUPPORT_NOTIFICATION_EMAIL,
        subject: "नया patient question - Sehat Bhabua",
        text: `नया सवाल आया है।\n\nPatient: ${patientName}\nसमय: ${new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Kolkata"
        }).format(createdAt)}\n\nसवाल:\n${question}\n\nजवाब देने के लिए admin dashboard खोलें (admin login जरूरी है):\n${dashboardUrl}\n\nयह notification है; इस email का reply app में answer के रूप में save नहीं होगा।`
    });
}
async function parseGroqResponse(response) {
    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error(`Groq returned an invalid response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
        const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
        throw new Error(String(detail).replace(/[\r\n]/g, " ").slice(0, 240));
    }
    return data;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const UPI_ID = String(process.env.UPI_ID || "").trim();
const UPI_PAYEE_NAME = String(process.env.UPI_PAYEE_NAME || "Sehat Bhabua").trim();
const validTwilioSender = /^\+[1-9]\d{7,14}$/.test(TWILIO_PHONE_NUMBER || "");
let twilioClient = null;
if (TWILIO_ACCOUNT_SID || TWILIO_AUTH_TOKEN || TWILIO_PHONE_NUMBER) {
    if (TWILIO_ACCOUNT_SID?.startsWith("AC") && TWILIO_AUTH_TOKEN && validTwilioSender) {
        try {
            twilioClient = require("twilio")(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        } catch (e) {
            console.warn("Twilio init failed:", e.message);
        }
    } else {
        console.warn("Twilio OTP is disabled because the account SID, auth token or E.164 sender number is invalid.");
    }
}
let firebaseAuth = null;
let firebaseApp = null;
let serviceAccount = null;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        const privateKey = account.privateKey || account.private_key;
        serviceAccount = {
            projectId: account.projectId || account.project_id,
            clientEmail: account.clientEmail || account.client_email,
            privateKey: typeof privateKey === "string" ? privateKey.replace(/\\n/g, "\n").trim() : ""
        };
    } else {
        const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
        if (FIREBASE_PROJECT_ID || FIREBASE_CLIENT_EMAIL || FIREBASE_PRIVATE_KEY) {
            serviceAccount = {
                projectId: FIREBASE_PROJECT_ID,
                clientEmail: FIREBASE_CLIENT_EMAIL,
                privateKey: (FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim()
            };
        }
    }
} catch {
    console.warn("Firebase service-account JSON is invalid; Firebase Phone Auth is disabled. Check FIREBASE_SERVICE_ACCOUNT formatting.");
}

if (serviceAccount) {
    if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
        console.warn("Firebase Admin credentials are incomplete; Firebase Phone Auth is disabled.");
    } else {
        let privateKeyValid = false;
        try {
            crypto.createPrivateKey(serviceAccount.privateKey);
            privateKeyValid = true;
        } catch {
            console.warn("Firebase private key is invalid or truncated; Firebase Phone Auth is disabled. Replace it with the complete private_key from the Firebase service-account JSON. Email OTP remains available.");
        }
        if (privateKeyValid) {
            try {
                firebaseApp = getApps().length
                    ? getApp()
                    : initializeApp({ credential: cert(serviceAccount) });
                firebaseAuth = getAuth(firebaseApp);
                console.log("Firebase Admin Phone Auth verification is enabled.");
            } catch (error) {
                console.error("Firebase Admin initialization failed; Firebase Phone Auth is disabled:", error.message);
            }
        }
    }
} else {
    console.log("Firebase Admin credentials are not configured; SMS OTP will use the configured provider.");
}

if (!MONGODB_URI || !JWT_SECRET) throw new Error("MONGODB_URI and JWT_SECRET are required in a .env file.");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
    socket.on("join-admin", () => {
        socket.join("admins");
        console.log("Admin joined notification room");
    });
    socket.on("join-patient", (patientId) => {
        socket.join(`patient-${patientId}`);
        console.log(`Patient ${patientId} joined notification room`);
    });
});

const states = ["Bihar"];
// Keep the local Kaimur names used by the seeded doctors, while also exposing
// every Bihar district in the location selector.
const districts = ["Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur", "Bhojpur", "Buxar", "Darbhanga", "East Champaran", "Gaya", "Gopalganj", "Jamui", "Jehanabad", "Kaimur", "Katihar", "Khagaria", "Kishanganj", "Lakhisarai", "Madhepura", "Madhubani", "Munger", "Muzaffarpur", "Nalanda", "Nawada", "Patna", "Purnia", "Rohtas", "Saharsa", "Samastipur", "Saran", "Sheikhpura", "Sheohar", "Sitamarhi", "Siwan", "Supaul", "Vaishali", "West Champaran"];
const districtCities = {
    Kaimur: ["Bhabua", "Mohania", "Kudra", "Ramgarh", "Chainpur", "Adhaura", "durgawti"],
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
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    email: { type: String, unique: true, sparse: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["patient", "doctor", "admin"], default: "patient" },
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
    patientName: { type: String, required: true }, patientAge: { type: Number, min: 1, max: 120 }, patientPhone: { type: String, required: true, index: true },
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true }, state: { type: String, required: true }, district: { type: String, required: true }, city: { type: String, required: true }, clinic: { type: String, required: true },
    tokenNumber: { type: Number, min: 1 }, slotNumber: { type: Number, min: 1 }, preferredTokenNumber: { type: Number, min: 1 }, paymentGroupId: { type: String, index: true }, visitDate: { type: String, required: true }, appointmentId: { type: String, unique: true, index: true },
    appointmentTime: String, bookedAtIndia: String,
    paymentMethod: { type: String, enum: ["upi_manual", "demo_cash", "demo_upi", "demo_card"], default: "upi_manual" },
    paymentStatus: { type: String, enum: ["pending", "submitted", "confirmed", "failed", "demo_paid"], default: "pending" },
    paymentAmount: { type: Number, min: 0 },
    paymentId: String,
    paymentReference: { type: String, trim: true, maxlength: 80 },
    status: { type: String, enum: ["awaiting_payment", "booked", "confirmed", "in_progress", "called", "completed", "cancelled", "no_show"], default: "booked" }
}, { timestamps: true });
tokenSchema.index({ doctor: 1, visitDate: 1, slotNumber: 1 }, { unique: true, partialFilterExpression: { slotNumber: { $exists: true } } });
tokenSchema.index({ doctor: 1, patient: 1, visitDate: 1 });
const counterSchema = new mongoose.Schema({ doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true }, visitDate: { type: String, required: true }, nextToken: { type: Number, default: 1 } });
counterSchema.index({ doctor: 1, visitDate: 1 }, { unique: true });
const supportQuestionSchema = new mongoose.Schema({
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    question: { type: String, required: true, trim: true, maxlength: 500 },
    answer: { type: String, trim: true, maxlength: 1000, default: "" },
    status: { type: String, enum: ["open", "answered"], default: "open" }
}, { timestamps: true });
const feedbackSchema = new mongoose.Schema({
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: "Token", required: true, unique: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 500, default: "" }
}, { timestamps: true });
const User = mongoose.model("User", userSchema);
const Doctor = mongoose.model("Doctor", doctorSchema);
const Token = mongoose.model("Token", tokenSchema);
const DailyCounter = mongoose.model("DailyCounter", counterSchema);
const SupportQuestion = mongoose.model("SupportQuestion", supportQuestionSchema);
const Feedback = mongoose.model("Feedback", feedbackSchema);
const resetRequests = new Map();

async function ensureAdminAccount() {
    const phone = String(process.env.ADMIN_PHONE || "").trim();
    const password = String(process.env.ADMIN_PASSWORD || "");
    if (!phone || !password) {
        console.warn("ADMIN_PHONE and ADMIN_PASSWORD are not set; the admin dashboard cannot be used until an admin account is seeded.");
        return;
    }
    const existing = await User.findOne({ phone });
    if (existing) {
        if (existing.role !== "admin") throw new Error(`ADMIN_PHONE belongs to a ${existing.role} account; use a dedicated admin phone number.`);
        return;
    }
    await User.create({
        name: "Sehat Kaimur Team",
        phone,
        passwordHash: await bcrypt.hash(password, 12),
        role: "admin"
    });
    console.log(`Created admin account for ${phone}.`);
}

function signUser(user) { return jwt.sign({ id: user._id.toString(), role: user.role }, JWT_SECRET, { expiresIn: "7d" }); }
function auth(role) { return (req, res, next) => { try { const h = req.headers.authorization || ""; const p = jwt.verify(h.startsWith("Bearer ") ? h.slice(7) : "", JWT_SECRET); if (role && p.role !== role) return res.status(403).json({ message: "You do not have permission for this action." }); req.user = p; next(); } catch { res.status(401).json({ message: "Please log in to continue." }); } }; }
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function tokenId(name, n) { if (!Number.isInteger(n)) return null; const first = (name || "TOKEN").trim().split(/\s+/)[0].replace(/[^\p{L}\p{N}]/gu, "").toUpperCase(); return `${first || "TOKEN"}-${String(n).padStart(3, "0")}`; }
function appointmentTime(doctor, n) { const [h, m] = (doctor.openingTime || "09:00").split(":").map(Number); const d = new Date(2000, 0, 1, h, m + (n - 1) * doctor.averageMinutes); return d.toTimeString().slice(0, 5); }
function indiaDateTime(date = new Date()) { return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kolkata" }).format(date); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= today(); }
function normalizePhone(value) {
    const input = String(value || "").trim();
    const digits = input.replace(/\D/g, "");
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
    if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
    if (input.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
    return null;
}
function phoneLookupValues(phone) {
    const values = [phone, phone.slice(1)];
    if (phone.startsWith("+91")) values.push(phone.slice(3));
    return [...new Set(values)];
}
function findUserByPhone(phone) {
    return User.findOne({ phone: { $in: phoneLookupValues(phone) } });
}

app.post("/api/auth/register", async (req, res) => {
    try { const { name, phone, email, password } = req.body; if (!name || !phone || !password || password.length < 6) return res.status(400).json({ message: "Name, phone and a password of 6+ characters are required." });
        const user = await User.create({ name, phone, email: email?.toLowerCase(), passwordHash: await bcrypt.hash(password, 12) }); res.status(201).json({ token: signUser(user), user: { name: user.name, phone: user.phone, email: user.email, role: user.role } });
    } catch (e) { res.status(e.code === 11000 ? 409 : 500).json({ message: e.code === 11000 ? "This phone number or email is already registered." : "Registration failed." }); }
});
app.post("/api/auth/login", async (req, res) => { const user = await User.findOne({ phone: req.body.phone }); if (!user || !(await bcrypt.compare(req.body.password || "", user.passwordHash))) return res.status(401).json({ message: "Invalid phone number or password." }); res.json({ token: signUser(user), user: { name: user.name, phone: user.phone, email: user.email, role: user.role } }); });
app.get("/api/auth/me", auth(), async (req, res) => { const user = await User.findById(req.user.id).select("name phone email role location"); if (!user) return res.status(404).json({ message: "Patient account not found." }); res.json({ user }); });
app.post("/api/auth/forgot-password/request", async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ message: "Enter a valid email address." });
    const previous = resetRequests.get(email);
    if (previous && previous.lastRequest > Date.now() - 60 * 1000) return res.status(429).json({ message: "Please wait a minute before requesting another OTP." });
    const user = await User.findOne({ email, role: "patient" });
    const generic = { message: "If this email is registered, a reset OTP has been sent." };
    if (!user) return res.json(generic);
    const otp = generateOTP();
    resetRequests.set(email, { hash: await bcrypt.hash(otp, 10), expires: Date.now() + 10 * 60 * 1000, attempts: 0, lastRequest: Date.now() });
    const delivery = await sendOTPEmail(email, otp, "login");
    if (!delivery.success) {
        resetRequests.delete(email);
        console.error("Password reset email could not be sent:", delivery.reason);
        return res.status(503).json({ message: "ईमेल OTP नहीं भेजा जा सका। Server email provider settings जाँचें।" });
    }
    res.json({ ...generic, message: "If this email is registered, a reset OTP has been sent.", expiresInSeconds: 600 });
});
app.post("/api/auth/forgot-password/verify", async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const otp = String(req.body.otp || "").trim();
    const password = String(req.body.newPassword || "");
    const request = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? resetRequests.get(email) : null;
    if (!request || request.expires < Date.now() || request.attempts >= 5) return res.status(400).json({ message: "OTP expired or unavailable. Request a new OTP." });
    request.attempts += 1;
    if (!/^\d{6}$/.test(otp) || password.length < 6 || !(await bcrypt.compare(otp, request.hash))) return res.status(400).json({ message: "Invalid OTP or password must be 6+ characters." });
    const user = await User.findOne({ email, role: "patient" });
    if (!user) return res.status(400).json({ message: "OTP expired or unavailable. Request a new OTP." });
    user.passwordHash = await bcrypt.hash(password, 12); await user.save(); resetRequests.delete(email); res.json({ message: "Password updated. You can now log in." });
});

app.post("/api/auth/otp/send", async (req, res) => {
    const type = String(req.body.type || "login");
    if (type !== "login") return res.status(400).json({ message: "Invalid OTP purpose." });
    const rawContact = String(req.body.contact || "").trim();
    const contact = rawContact.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || contact.length > 254) {
        return res.status(400).json({ message: "Enter a valid email address for OTP." });
    }
    const user = await User.findOne({ email: contact });
    if (user && user.role !== "patient") return res.status(403).json({ message: "Use the doctor or team login for this account." });
    const key = `${type}:${contact}`;
    const prev = otpStore.get(key);
    if (prev && prev.lastRequest > Date.now() - 60 * 1000) return res.status(429).json({ message: "Please wait 1 minute before requesting another OTP." });
    const otp = generateOTP();
    otpStore.set(key, {
        otp,
        expires: Date.now() + 10 * 60 * 1000,
        attempts: 0,
        lastRequest: Date.now(),
        userId: user?._id.toString() || null,
        isNewUser: !user
    });
    const delivery = await sendOTPEmail(contact, otp, "login");
    if (!delivery.success) {
        otpStore.delete(key);
        console.error("Email OTP delivery is unavailable:", delivery.reason);
        return res.status(503).json({ message: "ईमेल OTP नहीं भेजा जा सका। Server email provider settings जाँचें।" });
    }
    return res.json({ message: "OTP आपके email पर भेज दिया गया है।", via: "email", isNewUser: !user });
});

app.post("/api/auth/otp/verify", async (req, res) => {
    const type = String(req.body.type || "login");
    const contact = String(req.body.contact || "").trim().toLowerCase();
    const otp = String(req.body.otp || "").trim();
    const name = String(req.body.name || "").trim();
    if (type !== "login") return res.status(400).json({ message: "Invalid OTP purpose." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || contact.length > 254 || !/^\d{6}$/.test(otp)) {
        return res.status(400).json({ message: "Enter a valid email address and six-digit OTP." });
    }
    const key = `${type}:${contact}`;
    const record = otpStore.get(key);
    if (!record || record.expires < Date.now() || record.attempts >= 5) return res.status(400).json({ message: "OTP expired or unavailable. Request a new OTP." });
    if (record.otp !== otp) {
        record.attempts += 1;
        return res.status(400).json({ message: "Invalid OTP." });
    }

    let user = record.userId ? await User.findById(record.userId) : null;
    if (!user && record.isNewUser) {
        const phone = normalizePhone(req.body.phone);
        if (!phone) return res.status(400).json({ message: "OTP सही है। Account बनाने के लिए 10-digit mobile number भरें।" });
        if (name.length < 2) return res.status(400).json({ message: "OTP सही है। Account बनाने के लिए अपना पूरा नाम भरें।" });
        try {
            user = await User.create({
                name,
                phone,
                email: contact,
                passwordHash: await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 12)
            });
        } catch (error) {
            if (error.code === 11000) return res.status(409).json({ message: "यह mobile number या email पहले से registered है। सही contact number डालें या अपने account में login करें।" });
            throw error;
        }
    }

    if (!user) return res.status(404).json({ message: "User not found." });
    if (user.role !== "patient") return res.status(403).json({ message: "Use the doctor or team login for this account." });
    otpStore.delete(key);
    res.json({ token: signUser(user), user: { id: user._id.toString(), name: user.name, phone: user.phone, email: user.email, role: user.role } });
});

// Firebase Phone Auth - Send OTP
app.post("/api/auth/firebase/send-otp", async (req, res) => {
    res.status(410).json({ message: "Use the Firebase client Phone Auth SDK to send phone verification codes." });
});

// Firebase Phone Auth - Verify OTP (legacy - backend OTP)
app.post("/api/auth/firebase/verify-otp", async (req, res) => {
    res.status(410).json({ message: "Send and verify Firebase phone codes with the Firebase client Phone Auth SDK." });
});

// Firebase Client SDK - Verify ID Token (frontend sends ID token after phone auth)
app.post("/api/auth/firebase/verify-id-token", async (req, res) => {
    if (!firebaseAuth) return res.status(503).json({ message: "Firebase server verification is not configured. Use SMS OTP delivery or configure Firebase Admin credentials." });
    const { idToken, phone, name } = req.body;
    if (!idToken) return res.status(400).json({ message: "ID token required." });
    try {
        const decodedToken = await firebaseAuth.verifyIdToken(idToken);
        const firebasePhone = normalizePhone(decodedToken.phone_number);
        const normalizedPhone = normalizePhone(phone);
        if (!firebasePhone) return res.status(400).json({ message: "Verified Firebase account has no valid phone number." });
        if (normalizedPhone && normalizedPhone !== firebasePhone) {
            return res.status(400).json({ message: "Phone number mismatch." });
        }
        let user = await findUserByPhone(firebasePhone);
        if (!user) {
            const patientName = String(name || "").trim();
            if (patientName.length < 2) return res.status(400).json({ message: "Name is required for new users." });
            user = await User.create({ name: patientName, phone: firebasePhone, passwordHash: await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 12) });
        }
        if (user.role !== "patient") return res.status(403).json({ message: "Use the doctor or team login for this account." });
        res.json({ token: signUser(user), user: { id: user._id.toString(), name: user.name, phone: user.phone, email: user.email, role: user.role } });
    } catch (e) {
        console.error("Firebase ID token verify failed:", e.message);
        res.status(401).json({ message: "Firebase could not verify this sign-in. Check the OTP and Firebase project configuration." });
    }
});

// Firebase web config for frontend
app.get("/api/firebase-config", (req, res) => {
    const projectId = process.env.FIREBASE_PROJECT_ID || "";
    const config = {
        enabled: Boolean(firebaseAuth && process.env.FIREBASE_API_KEY && projectId && process.env.FIREBASE_APP_ID),
        apiKey: process.env.FIREBASE_API_KEY || "",
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || (projectId ? `${projectId}.firebaseapp.com` : ""),
        projectId,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.appspot.com` : ""),
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
        appId: process.env.FIREBASE_APP_ID || ""
    };
    res.json(config);
});

app.get("/api/locations", (req, res) => res.json({
    states,
    districts,
    cities: Object.fromEntries(districts.map((district) => [district, districtCities[district] || [district]])),
    locations: districts.map((district) => ({ state: "Bihar", district, cities: districtCities[district] || [district] }))
}));
app.get("/api/doctors", async (req, res) => {
    const filter = { active: true }; if (req.query.state) filter.state = req.query.state; if (req.query.district) filter.district = req.query.district; if (req.query.city) filter.city = req.query.city;
    const search = String(req.query.search || "").trim();
    if (search) {
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.$or = [{ name: new RegExp(escapedSearch, "i") }, { specialty: new RegExp(escapedSearch, "i") }, { clinic: new RegExp(escapedSearch, "i") }];
    }
    const doctors = await Doctor.find(filter).sort({ district: 1, name: 1 });
    const ratings = await Feedback.aggregate([
        { $match: { doctor: { $in: doctors.map((doctor) => doctor._id) } } },
        { $group: { _id: "$doctor", averageRating: { $avg: "$rating" }, ratingCount: { $sum: 1 } } }
    ]);
    const ratingsByDoctor = new Map(ratings.map((rating) => [rating._id.toString(), rating]));
    res.json(doctors.map((doctor) => {
        const rating = ratingsByDoctor.get(doctor._id.toString());
        return {
            ...doctor.toObject(),
            averageRating: rating ? Math.round(rating.averageRating * 10) / 10 : null,
            ratingCount: rating?.ratingCount || 0
        };
    }));
});
app.get("/api/doctors/:id/status", async (req, res) => {
    const doctor = await Doctor.findOne({ _id: req.params.id, active: true }); if (!doctor) return res.status(404).json({ message: "Doctor not found." });
    const rating = await Feedback.aggregate([
        { $match: { doctor: doctor._id } },
        { $group: { _id: "$doctor", averageRating: { $avg: "$rating" }, ratingCount: { $sum: 1 } } }
    ]);
    const visitDate = req.query.date || today(); const tokens = await Token.find({ doctor: doctor._id, visitDate }).sort({ tokenNumber: 1 });
    const active = tokens.filter((t) => !["cancelled", "no_show", "completed"].includes(t.status));
    const assigned = tokens.filter((t) => Number.isInteger(t.tokenNumber));
    const activeAssigned = active.filter((t) => Number.isInteger(t.tokenNumber));
    const current = assigned.find((t) => ["in_progress", "called"].includes(t.status));
    const occupied = new Set(tokens.filter((t) => t.status !== "cancelled").map((t) => t.slotNumber ?? t.tokenNumber).filter(Number.isInteger));
    res.json({ doctor, averageRating: rating.length ? Math.round(rating[0].averageRating * 10) / 10 : null, ratingCount: rating[0]?.ratingCount || 0, total: doctor.tokenLimit, booked: active.length, available: Math.max(0, doctor.tokenLimit - occupied.size), availableTokens: Array.from({ length: doctor.tokenLimit }, (_, i) => i + 1).filter((n) => !occupied.has(n)), bookedToday: active.length, currentToken: current?.tokenNumber || 0, estimatedMinutes: activeAssigned.length * doctor.averageMinutes, tokens: assigned.map((t) => ({ tokenNumber: t.tokenNumber, status: t.status, appointmentTime: t.appointmentTime })) });
});

async function createManualUpiPayment(appointmentId, amount) {
    if (!amount || !UPI_ID) return null;
    const upiUrl = `upi://pay?${new URLSearchParams({
        pa: UPI_ID,
        pn: UPI_PAYEE_NAME,
        am: amount.toFixed(2),
        cu: "INR",
        tn: `Appointment ${appointmentId}`
    })}`;
    const qrDataUrl = await QRCode.toDataURL(upiUrl, { errorCorrectionLevel: "M", margin: 1, width: 240 });
    return { upiId: UPI_ID, payeeName: UPI_PAYEE_NAME, amount, upiUrl, qrDataUrl };
}

async function verifyPaymentAndIssueToken(appointmentId) {
    const groupFilter = mongoose.isValidObjectId(appointmentId)
        ? { $or: [{ paymentGroupId: appointmentId }, { _id: appointmentId }] }
        : { paymentGroupId: appointmentId };
    const appointments = await Token.find({
        ...groupFilter,
        paymentMethod: "upi_manual",
        paymentStatus: "submitted"
    }).populate("doctor");
    if (!appointments.length || appointments.some((appointment) => !appointment.doctor || !Number.isInteger(appointment.slotNumber))) {
        return null;
    }
    const issued = [];
    for (const appointment of appointments) {
        const tokenNumber = appointment.tokenNumber ?? appointment.slotNumber;
        const updated = await Token.findOneAndUpdate(
            {
                _id: appointment._id,
                paymentMethod: "upi_manual",
                paymentStatus: "submitted",
                slotNumber: appointment.slotNumber,
                ...(Number.isInteger(appointment.tokenNumber) ? {} : { tokenNumber: { $exists: false } })
            },
            {
                $set: {
                    paymentStatus: "confirmed",
                    status: "booked",
                    tokenNumber,
                    appointmentTime: appointmentTime(appointment.doctor, tokenNumber)
                }
            },
            { new: true, runValidators: true }
        );
        if (!updated) throw new Error(`Payment group ${appointmentId} changed during token issuance.`);
        issued.push(updated);
    }
    return issued;
}

app.post("/api/tokens", auth("patient"), async (req, res) => {
    let bookingGroupId;
    try {
        const { doctorId, visitDate, preferredToken } = req.body;
        const patients = Array.isArray(req.body.patients)
            ? req.body.patients.map((patient) => ({
                name: String(patient?.name || "").trim(),
                age: Number(patient?.age)
            }))
            : [{
                name: String(req.body.patientName || "").trim(),
                age: Number(req.body.patientAge)
            }];
        if (!doctorId || !validDate(visitDate)) return res.status(400).json({ message: "A valid doctor and today or future date are required." });
        if (!patients.length || patients.length > 50 || patients.some((patient) =>
            patient.name.length < 2 || patient.name.length > 100 ||
            !Number.isInteger(patient.age) || patient.age < 1 || patient.age > 120
        )) {
            return res.status(400).json({ message: "हर मरीज के लिए 2 से 100 अक्षर का नाम और 1 से 120 के बीच उम्र भरें।" });
        }
        const doctor = await Doctor.findOne({ _id: doctorId, active: true }); if (!doctor) return res.status(404).json({ message: "Doctor not found." });
        const feePerToken = Number(doctor.fee || 0);
        const totalPerTokenPaise = Math.round((feePerToken + PLATFORM_FEE_PER_TOKEN) * 100);
        const amountPerToken = totalPerTokenPaise / 100;
        const amount = (totalPerTokenPaise * patients.length) / 100;
        if (amount > 0 && !UPI_ID) return res.status(503).json({ message: "UPI payment is not configured yet. Add your UPI_ID in the server .env file." });
        if (amount > 0 && !/^[\w.-]{2,256}@[A-Za-z0-9.-]{2,64}$/.test(UPI_ID)) return res.status(503).json({ message: "UPI_ID in the server configuration is not a valid UPI ID." });
        const day = new Date(`${visitDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }); if (doctor.availableDays?.length && !doctor.availableDays.includes(day)) return res.status(409).json({ message: `Doctor is not available on ${day}.` });
        const patient = await User.findById(req.user.id).select("name phone"); if (!patient) return res.status(401).json({ message: "Patient account not found." });
        const preferredNumber = Number(preferredToken);
        if (!Number.isInteger(preferredNumber) || preferredNumber < 1 || preferredNumber > doctor.tokenLimit) {
            return res.status(400).json({ message: "Please choose an available token number." });
        }
        const existingSlots = await Token.find({
            doctor: doctor._id,
            visitDate,
            status: { $ne: "cancelled" },
            $or: [{ slotNumber: { $exists: true } }, { tokenNumber: { $exists: true } }]
        }).select("slotNumber tokenNumber").lean();
        const occupied = new Set(existingSlots.map((entry) => entry.slotNumber ?? entry.tokenNumber).filter(Number.isInteger));
        if (occupied.has(preferredNumber)) return res.status(409).json({ message: "That token is no longer available. Please choose another." });
        const availableSlots = Array.from({ length: doctor.tokenLimit }, (_, index) => index + 1)
            .filter((number) => !occupied.has(number));
        if (availableSlots.length < patients.length) {
            return res.status(409).json({ message: `इस तारीख को ${patients.length} मरीजों के लिए पर्याप्त token खाली नहीं हैं। केवल ${availableSlots.length} उपलब्ध हैं।` });
        }
        const slotNumbers = [preferredNumber, ...availableSlots.filter((number) => number !== preferredNumber)]
            .slice(0, patients.length);
        bookingGroupId = `${amount > 0 ? "PAY" : "BOOK"}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
        const appointmentId = bookingGroupId;
        const paymentStatus = amount > 0 ? "pending" : "confirmed";
        const payment = await createManualUpiPayment(appointmentId, amount);
        const appointments = await Token.insertMany(patients.map((person, index) => {
            const number = amount === 0 ? slotNumbers[index] : undefined;
            return {
                doctor: doctor._id,
                patient: req.user.id,
                patientName: person.name,
                patientAge: person.age,
                patientPhone: patient.phone,
                clinicId: doctor._id,
                state: doctor.state,
                district: doctor.district,
                city: doctor.city,
                clinic: doctor.clinic,
                slotNumber: slotNumbers[index],
                ...(amount === 0 ? { tokenNumber: number, appointmentTime: appointmentTime(doctor, number) } : {}),
                visitDate,
                appointmentId: `APT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
                paymentGroupId: bookingGroupId,
                bookedAtIndia: indiaDateTime(),
                paymentMethod: "upi_manual",
                paymentStatus,
                paymentAmount: amountPerToken,
                status: amount > 0 ? "awaiting_payment" : "booked",
                paymentId: amount > 0 ? undefined : "NO_PAYMENT_REQUIRED"
            };
        }));
        const tokenList = appointments.map((appointment) => ({
            patientName: appointment.patientName,
            token: Number.isInteger(appointment.tokenNumber)
                ? tokenId(appointment.patientName, appointment.tokenNumber)
                : null
        }));
        res.status(201).json({
            appointment: appointments[0],
            appointments,
            tokens: tokenList,
            token: tokenList[0]?.token || null,
            payment: payment || { upiId: UPI_ID, payeeName: UPI_PAYEE_NAME, amount, upiUrl: null, qrDataUrl: null },
            message: amount > 0
                ? `${patients.length} मरीजों की booking pending है। प्रति मरीज ₹${feePerToken.toFixed(2)} doctor fee + ₹${PLATFORM_FEE_PER_TOKEN.toFixed(2)} platform fee = ₹${amountPerToken.toFixed(2)}; कुल ₹${amount.toFixed(2)}। एक बार UPI payment करके reference भेजें। Admin verify करने के बाद सभी tokens issue होंगे।`
                : `${patients.length} मरीजों के tokens book हो गए। कोई payment जरूरी नहीं।`
        });
    } catch (e) {
        if (bookingGroupId) await Token.deleteMany({ paymentGroupId: bookingGroupId });
        if (e.code === 11000) return res.status(409).json({ message: "This appointment or token was just booked. Please refresh and try again." });
        console.error("Appointment booking failed:", e.message);
        res.status(500).json({ message: "Could not book the token. Please try again or contact the team." });
    }
});
app.post("/api/tokens/:id/payment-reference", auth("patient"), async (req, res) => {
    const reference = String(req.body.reference || "").trim();
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Appointment ID अमान्य है।" });
    if (!/^[A-Za-z0-9-]{8,80}$/.test(reference)) {
        return res.status(400).json({ message: "UPI transaction reference 8 से 80 letters/numbers में डालें।" });
    }
    const appointment = await Token.findOne({ _id: req.params.id, patient: req.user.id, status: "awaiting_payment" });
    if (!appointment) return res.status(404).json({ message: "Appointment नहीं मिला।" });
    if (appointment.paymentMethod !== "upi_manual" || appointment.paymentStatus !== "pending") {
        return res.status(409).json({ message: "इस appointment के लिए payment reference पहले ही भेजा जा चुका है या payment जरूरी नहीं है।" });
    }
    if (appointment.createdAt < new Date(Date.now() - 30 * 60 * 1000)) {
        const groupFilter = appointment.paymentGroupId
            ? { paymentGroupId: appointment.paymentGroupId, status: "awaiting_payment", paymentStatus: "pending" }
            : { _id: appointment._id, status: "awaiting_payment", paymentStatus: "pending" };
        await Token.updateMany(
            groupFilter,
            { $set: { paymentStatus: "failed", status: "cancelled" }, $unset: { slotNumber: 1 } }
        );
        return res.status(410).json({ message: "Payment reservation 30 मिनट बाद expire हो गई। कृपया नया token चुनकर दोबारा booking करें।" });
    }
    const groupFilter = appointment.paymentGroupId
        ? { paymentGroupId: appointment.paymentGroupId, patient: req.user.id, status: "awaiting_payment", paymentStatus: "pending" }
        : { _id: appointment._id, patient: req.user.id, status: "awaiting_payment", paymentStatus: "pending" };
    const groupSize = appointment.paymentGroupId
        ? await Token.countDocuments({ paymentGroupId: appointment.paymentGroupId, patient: req.user.id })
        : 1;
    const updated = await Token.updateMany(groupFilter, { $set: { paymentReference: reference, paymentStatus: "submitted" } });
    if (updated.modifiedCount !== groupSize) {
        return res.status(409).json({ message: "Booking payment status changed. Refresh your appointments and try again." });
    }
    io.to("admins").emit("payment-reference-submitted", {
        appointmentId: appointment.paymentGroupId || appointment.appointmentId,
        paymentReference: reference,
        patientCount: groupSize,
        submittedAt: new Date()
    });
    res.json({ message: "Payment reference team को भेज दिया गया है। Admin verify करने के बाद सभी मरीजों को token मिलेगा।", paymentStatus: "submitted" });
});
app.post("/api/patients/location", auth("patient"), async (req, res) => { const { consent, latitude, longitude } = req.body; if (!consent) { await User.findByIdAndUpdate(req.user.id, { "location.consent": false }); return res.json({ consent: false }); } if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return res.status(400).json({ message: "Valid location coordinates are required." }); await User.findByIdAndUpdate(req.user.id, { "location.consent": true, "location.latitude": latitude, "location.longitude": longitude, "location.capturedAt": new Date() }); res.json({ consent: true }); });
app.get("/api/tokens/my", auth("patient"), async (req, res) => {
    const appointments = await Token.find({ patient: req.user.id }).populate("doctor").populate("patient", "name").sort({ visitDate: -1, tokenNumber: 1 });
    const groupSizes = new Map();
    for (const appointment of appointments) {
        if (appointment.paymentGroupId) {
            groupSizes.set(appointment.paymentGroupId, (groupSizes.get(appointment.paymentGroupId) || 0) + 1);
        }
    }
    res.json(await Promise.all(appointments.map(async (appointment) => {
        const item = appointment.toObject();
        const groupSize = appointment.paymentGroupId ? groupSizes.get(appointment.paymentGroupId) || 1 : 1;
        return {
            ...item,
            tokenId: tokenId(appointment.patientName || appointment.patient?.name, appointment.tokenNumber),
            payment: appointment.paymentStatus === "pending"
                ? await createManualUpiPayment(
                    appointment.paymentGroupId || appointment.appointmentId,
                    Number(appointment.paymentAmount ?? appointment.doctor?.fee ?? 0) * groupSize
                )
                : null
        };
    })));
});
app.get("/api/feedback/my", auth("patient"), async (req, res) => {
    const appointments = await Token.find({ patient: req.user.id, status: "completed" })
        .populate("doctor", "name clinic")
        .sort({ visitDate: -1, tokenNumber: 1 });
    const feedback = await Feedback.find({ patient: req.user.id }).lean();
    const feedbackByAppointment = new Map(feedback.map((item) => [item.appointment.toString(), item]));
    res.json(appointments.map((appointment) => ({
        appointmentId: appointment._id,
        appointmentCode: appointment.appointmentId,
        doctor: appointment.doctor?.name || "Doctor",
        clinic: appointment.doctor?.clinic || appointment.clinic,
        visitDate: appointment.visitDate,
        tokenNumber: appointment.tokenNumber,
        feedback: feedbackByAppointment.get(appointment._id.toString()) || null
    })));
});
app.post("/api/feedback", auth("patient"), async (req, res) => {
    const appointmentId = String(req.body.appointmentId || "");
    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || "").trim();
    if (!mongoose.isValidObjectId(appointmentId)) return res.status(400).json({ message: "Appointment चुनें।" });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ message: "Rating 1 से 5 के बीच चुनें।" });
    if (comment.length > 500) return res.status(400).json({ message: "Feedback 500 अक्षरों से कम रखें।" });
    const appointment = await Token.findOne({ _id: appointmentId, patient: req.user.id, status: "completed" });
    if (!appointment) return res.status(404).json({ message: "Feedback केवल पूरे हो चुके अपने appointment के लिए भेज सकते हैं।" });
    try {
        const feedback = await Feedback.create({
            patient: req.user.id,
            doctor: appointment.doctor,
            appointment: appointment._id,
            rating,
            comment
        });
        res.status(201).json({ message: "धन्यवाद! आपका feedback भेज दिया गया है।", feedback });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: "इस appointment का feedback पहले ही भेजा जा चुका है।" });
        throw error;
    }
});
app.post("/api/assistant", auth(), async (req, res) => {
    if (!GROQ_API_KEY) return res.status(503).json({ message: "AI assistant अभी configure नहीं है। Admin से GROQ_API_KEY set करने को कहें।" });
    const question = String(req.body.question || "").trim();
    if (!question || question.length > 1000) return res.status(400).json({ message: "सवाल 1 से 1000 अक्षरों में लिखें।" });
    const appointments = await Token.find({ patient: req.user.id }).populate("doctor", "name clinic").sort({ visitDate: -1, tokenNumber: 1 }).limit(10);
    const bookingContext = appointments.map((x) => ({ appointmentId: x.appointmentId, patientName: x.patientName, doctor: x.doctor?.name, clinic: x.doctor?.clinic, visitDate: x.visitDate, appointmentTime: x.appointmentTime, tokenNumber: x.tokenNumber, status: x.status }));
    let doctorContext = [];
    const q = question.toLowerCase();
    const locationKeywords = ["chainpur", "चैनपुर", "bhabua", "भभुआ", "mohania", "मोहनिया", "kaimur", "कैमूर", "ramgarh", "रामगढ़", "kudra", "कुदरा", "adhaura", "अधौरा", "durgawati", "दुर्गावती"];
    const matchedLocation = locationKeywords.find(loc => q.includes(loc));
    let doctorFilter = { active: true };
    if (matchedLocation) {
        const cityMap = { "chainpur": "Chainpur", "चैनपुर": "Chainpur", "bhabua": "Bhabua", "भभुआ": "Bhabua", "mohania": "Mohania", "मोहनिया": "Mohania", "kaimur": "Kaimur", "कैमूर": "Kaimur", "ramgarh": "Ramgarh", "रामगढ़": "Ramgarh", "kudra": "Kudra", "कुदरा": "Kudra", "adhaura": "Adhaura", "अधौरा": "Adhaura", "durgawati": "Durgawati", "दुर्गावती": "Durgawati" };
        const city = cityMap[matchedLocation];
        if (city) doctorFilter.city = city;
    }
    const specialtyKeywords = ["general", "physician", "cardiologist", "कार्डियोलॉजिस्ट", "dermatologist", "त्वचा", "pediatrician", "बाल", "orthopedic", "हड्डी", "dentist", "दांत", "gynecologist", "स्त्री"];
    const matchedSpecialty = specialtyKeywords.find(s => q.includes(s));
    if (matchedSpecialty) {
        const specialtyMap = { "general": "General Physician", "physician": "General Physician", "cardiologist": "Cardiologist", "कार्डियोलॉजिस्ट": "Cardiologist", "dermatologist": "Dermatologist", "त्वचा": "Dermatologist", "pediatrician": "Pediatrician", "बाल": "Pediatrician", "orthopedic": "Orthopedic", "हड्डी": "Orthopedic", "dentist": "Dentist", "दांत": "Dentist", "gynecologist": "Gynecologist", "स्त्री": "Gynecologist" };
        doctorFilter.specialty = new RegExp(specialtyMap[matchedSpecialty], "i");
    }
    if (Object.keys(doctorFilter).length > 1 || doctorFilter.city || doctorFilter.specialty) {
        const doctors = await Doctor.find(doctorFilter).select("name specialty clinic city district address fee averageMinutes tokenLimit availableDays openingTime closingTime").limit(20);
        doctorContext = doctors.map(d => ({ name: d.name, specialty: d.specialty, clinic: d.clinic, city: d.city, district: d.district, address: d.address, fee: d.fee, availableDays: d.availableDays, openingTime: d.openingTime, closingTime: d.closingTime, tokenLimit: d.tokenLimit }));
    }
    const prompt = `तुम Sehat Bhabua app के Hindi patient-support assistant हो।
Patient के booking data से token, appointment date/time और status के सवालों का सीधा जवाब दो।
सार्वजनिक रूप से उपलब्ध doctors की जानकारी भी उपयोग करो।
सामान्य स्वास्थ्य जानकारी, दवा के बारे में सामान्य ज्ञान, बीमारियों के लक्षण, बचाव के तरीके, lifestyle tips आदि पर भी जवाब दे सकते हो।
**सुरक्षा नियम:**
- Diagnosis मत दो (ये मत कहो "आपको ये बीमारी है")
- Prescription या दवा की specific dose मत बताओ
- Emergency में तुरंत doctor या local emergency service (108/112) से संपर्क कहो
- गंभीर symptoms हों तो "डॉक्टर से मिलें" कहो
जवाब 3-5 छोटे Hindi वाक्यों में दो, सरल भाषा में।
Patient booking data: ${JSON.stringify(bookingContext)}
Public doctor data (relevant): ${JSON.stringify(doctorContext)}
सवाल: ${question}`;
    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.2,
                max_tokens: 300
            }),
            signal: AbortSignal.timeout(45000)
        });
        const data = await parseGroqResponse(response);
        const answer = data.choices?.[0]?.message?.content?.trim();
        if (!answer) return res.status(502).json({ message: "AI assistant ने खाली जवाब दिया। फिर कोशिश करें।" });
        res.json({ answer });
    } catch (error) {
        console.error("AI assistant request failed:", error.message);
        res.status(502).json({ message: `AI assistant error: ${error.message}` });
    }
});
app.post("/api/assistant/image", auth(), upload.single("image"), async (req, res) => {
    if (!GROQ_API_KEY) return res.status(503).json({ message: "AI assistant अभी configure नहीं है।" });
    if (!req.file) return res.status(400).json({ message: "Image required." });
    const question = String(req.body.question || "").trim() || "इस दवा/टैबलेट की पहचान और इसके सामान्य उपयोग बताएं। खुराक या इलाज की सलाह न दें; सावधानियां और संभावित जोखिम बताएं।";
    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;
    const visionModel = "qwen/qwen3.8-27b";
    const prompt = `तुम Sehat Bhabua app के Hindi medical assistant हो।
दवा/टैबलेट/कैप्सूल/सिरप की फोटो का विश्लेषण करो।
यदि स्पष्ट हो तो नाम और सामान्य उपयोग बताओ; सावधानियां और संभावित जोखिम बताओ, लेकिन खुराक या इलाज की सलाह न दो।
**सुरक्षा नियम:**
- Exact dosage मत बताओ (डॉक्टर से पूछें कहो)
- Prescription मत दो
- "डॉक्टर/फार्मासिस्ट से सलाह लें" जरूर कहो
- गलत पहचान हो सकती है, disclaimer दो
जवाब 4-6 छोटे Hindi वाक्यों में दो, सरल भाषा में।
सवाल: ${question}`;
    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: visionModel,
                messages: [{
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
                    ]
                }],
                temperature: 0.1,
                max_tokens: 500
            }),
            signal: AbortSignal.timeout(45000)
        });
        const data = await parseGroqResponse(response);
        const answer = data.choices?.[0]?.message?.content?.trim();
        if (!answer) return res.status(502).json({ message: "Could not analyze image." });
        res.json({ answer, disclaimer: "यह जानकारी केवल सामान्य ज्ञान के लिए है। कृपया दवा लेने से पहले डॉक्टर या फार्मासिस्ट से जरूर सलाह लें।" });
    } catch (error) {
        console.error("Image analysis failed:", error.message);
        res.status(502).json({ message: `Image analysis error: ${error.message}` });
    }
});
app.get("/api/tokens/:id/tracking", auth("patient"), async (req, res) => {
    const appointment = await Token.findOne({ _id: req.params.id, patient: req.user.id }).populate("doctor", "name clinic address averageMinutes").populate("patient", "name");
    if (!appointment) return res.status(404).json({ message: "Appointment not found." });
    if (!Number.isInteger(appointment.tokenNumber)) return res.status(409).json({ message: "Token tracking starts after payment verification and token assignment." });
    const tokens = await Token.find({ doctor: appointment.doctor._id, visitDate: appointment.visitDate });
    const current = tokens.find((x) => ["called", "in_progress"].includes(x.status));
    const ahead = tokens.filter((x) => x.tokenNumber < appointment.tokenNumber && !["cancelled", "no_show", "completed"].includes(x.status)).length;
    const currentRunningToken = current?.tokenNumber || Math.max(0, ...tokens.filter((x) => x.status === "completed").map((x) => x.tokenNumber));
    res.json({ appointmentId: appointment.appointmentId, patientName: appointment.patientName, doctor: appointment.doctor, clinic: appointment.clinic, token: appointment.tokenNumber, tokenId: tokenId(appointment.patientName || appointment.patient?.name, appointment.tokenNumber), appointmentTime: appointment.appointmentTime, visitDate: appointment.visitDate, status: appointment.status, currentRunningToken, patientsAhead: ahead, estimatedWaitMinutes: ahead * (appointment.doctor.averageMinutes || 10), updatedAt: new Date().toISOString() });
});
app.post("/api/support/questions", auth(), async (req, res) => {
    const question = String(req.body.question || "").trim();
    if (!question || question.length > 500) return res.status(400).json({ message: "अपना सवाल 1 से 500 अक्षरों में लिखें।" });
    const item = await SupportQuestion.create({ patient: req.user.id, question });
    const populated = await SupportQuestion.findById(item._id).populate("patient", "name phone");
    io.to("admins").emit("new-question", {
        questionId: item._id,
        patientName: populated.patient?.name,
        patientPhone: populated.patient?.phone,
        question: populated.question,
        createdAt: populated.createdAt
    });
    const appBaseUrl = String(process.env.APP_BASE_URL || process.env.FRONTEND_URL || `http://localhost:${PORT}`).trim().replace(/\/+$/, "");
    const notification = await sendSupportQuestionNotification({
        patientName: populated.patient?.name || "Patient",
        question: populated.question,
        createdAt: populated.createdAt || item.createdAt,
        dashboardUrl: `${appBaseUrl}/admin.html#question-${item._id}`
    });
    if (!notification.success) {
        console.error("Support question email notification failed:", notification.reason);
        return res.status(201).json({
            id: item._id,
            notificationSent: false,
            message: "आपका सवाल team dashboard में भेज दिया गया है, लेकिन Gmail notification नहीं भेजा जा सका। Admin email/SMTP settings जाँचें।"
        });
    }
    res.status(201).json({
        id: item._id,
        notificationSent: true,
        message: "आपका सवाल team dashboard में भेजा गया है और Gmail पर notification भेज दिया गया है।"
    });
});
app.get("/api/support/questions/my", auth(), async (req, res) => {
    const items = await SupportQuestion.find({ patient: req.user.id }).sort({ createdAt: -1 }).limit(20);
    res.json(items);
});

app.get("/api/doctor/tokens", auth("doctor"), async (req, res) => { const doctor = await Doctor.findOne({ user: req.user.id }); if (!doctor) return res.status(404).json({ message: "Doctor profile not found." }); const visitDate = req.query.date || today(); const a = await Token.find({ doctor: doctor._id, visitDate, tokenNumber: { $exists: true } }).populate("patient", "name phone").sort({ tokenNumber: 1 }); res.json(a.map((x) => ({ ...x.toObject(), tokenId: tokenId(x.patientName || x.patient?.name, x.tokenNumber) }))); });
app.get("/api/doctor/dashboard", auth("doctor"), async (req, res) => { const doctor = await Doctor.findOne({ user: req.user.id }); if (!doctor) return res.status(404).json({ message: "Doctor profile not found." }); const date = req.query.date || today(); const tokens = await Token.find({ doctor: doctor._id, visitDate: date, tokenNumber: { $exists: true } }).populate("patient", "name phone").sort({ tokenNumber: 1 }); res.json({ doctor, date, summary: { total: doctor.tokenLimit, booked: tokens.filter((x) => !["cancelled", "no_show"].includes(x.status)).length, completed: tokens.filter((x) => x.status === "completed").length, current: tokens.find((x) => ["called", "in_progress"].includes(x.status))?.tokenNumber || 0 }, tokens: tokens.map((x) => ({ ...x.toObject(), tokenId: tokenId(x.patientName || x.patient?.name, x.tokenNumber) })) }); });
app.get("/api/doctor/feedback", auth("doctor"), async (req, res) => {
    const doctor = await Doctor.findOne({ user: req.user.id }).select("_id");
    if (!doctor) return res.status(404).json({ message: "Doctor profile not found." });
    const [summary] = await Feedback.aggregate([
        { $match: { doctor: doctor._id } },
        { $group: { _id: "$doctor", averageRating: { $avg: "$rating" }, ratingCount: { $sum: 1 } } }
    ]);
    const items = await Feedback.find({ doctor: doctor._id })
        .select("rating comment createdAt")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
    res.json({
        averageRating: summary ? Math.round(summary.averageRating * 10) / 10 : null,
        ratingCount: summary?.ratingCount || 0,
        feedback: items
    });
});
app.patch("/api/doctor/tokens/:id", auth("doctor"), async (req, res) => {
    const doctor = await Doctor.findOne({ user: req.user.id });
    const allowed = ["booked", "confirmed", "in_progress", "called", "completed", "cancelled", "no_show"];
    if (!allowed.includes(req.body.status)) return res.status(400).json({ message: "Invalid token status." });
    const update = { $set: { status: req.body.status } };
    if (req.body.status === "cancelled") update.$unset = { slotNumber: 1 };
    const appointment = await Token.findOneAndUpdate(
        { _id: req.params.id, doctor: doctor?._id, tokenNumber: { $exists: true } },
        update,
        { new: true, runValidators: true }
    );
    if (!appointment) return res.status(404).json({ message: "Token not found." });
    res.json(appointment);
});
app.post("/api/doctor/next", auth("doctor"), async (req, res) => { const doctor = await Doctor.findOne({ user: req.user.id }); const date = req.body.date || today(); const current = await Token.findOneAndUpdate({ doctor: doctor?._id, visitDate: date, status: { $in: ["booked", "confirmed"] }, tokenNumber: { $exists: true } }, { status: "in_progress" }, { sort: { tokenNumber: 1 }, new: true }); if (!current) return res.status(404).json({ message: "No waiting token." }); res.json(current); });
app.get("/api/admin/tokens", auth("admin"), async (req, res) => {
    const filter = req.query.date ? { visitDate: req.query.date } : {};
    const appointments = await Token.find(filter)
        .populate("patient", "name phone location")
        .populate("doctor", "name clinic district")
        .sort({ visitDate: -1, tokenNumber: 1 });
    res.json(appointments.map((appointment) => ({
        id: appointment._id,
        patientId: appointment.patient?._id,
        patientName: appointment.patientName || appointment.patient?.name,
        patientPhone: appointment.patientPhone || appointment.patient?.phone,
        phone: appointment.patientPhone || appointment.patient?.phone,
        location: appointment.patient?.location?.consent ? appointment.patient.location : null,
        doctor: appointment.doctor?.name,
        clinic: appointment.doctor?.clinic,
        district: appointment.doctor?.district,
        tokenNumber: appointment.tokenNumber,
        slotNumber: appointment.slotNumber,
        tokenId: tokenId(appointment.patientName || appointment.patient?.name, appointment.tokenNumber),
        appointmentId: appointment.appointmentId,
        appointmentTime: appointment.appointmentTime,
        visitDate: appointment.visitDate,
        createdAt: appointment.createdAt,
        bookedAtIndia: appointment.bookedAtIndia,
        fee: appointment.paymentAmount ?? appointment.doctor?.fee ?? 0,
        paymentMethod: appointment.paymentMethod,
        paymentStatus: appointment.paymentStatus,
        paymentId: appointment.paymentId,
        paymentReference: appointment.paymentReference,
        status: appointment.status
    })));
});
app.get("/api/admin/payments", auth("admin"), async (req, res) => {
    const payments = await Token.find({ paymentMethod: "upi_manual", paymentStatus: "submitted" })
        .populate("patient", "name phone")
        .populate("doctor", "name clinic fee")
        .sort({ updatedAt: 1 });
    const groups = new Map();
    for (const appointment of payments) {
        const key = appointment.paymentGroupId || appointment._id.toString();
        const group = groups.get(key) || {
            id: key,
            appointmentId: appointment.paymentGroupId || appointment.appointmentId,
            paymentMethod: "upi_manual",
            paymentStatus: "submitted",
            doctor: appointment.doctor?.name,
            clinic: appointment.doctor?.clinic,
            visitDate: appointment.visitDate,
            fee: 0,
            paymentReference: appointment.paymentReference,
            patients: []
        };
        group.fee += Number(appointment.paymentAmount ?? appointment.doctor?.fee ?? 0);
        group.patients.push({
            name: appointment.patientName || appointment.patient?.name || "Patient",
            age: appointment.patientAge,
            phone: appointment.patientPhone || appointment.patient?.phone || "—",
            slotNumber: appointment.slotNumber
        });
        groups.set(key, group);
    }
    res.json([...groups.values()]);
});
app.patch("/api/admin/tokens/:id/payment", auth("admin"), async (req, res) => {
    const paymentStatus = String(req.body.status || "");
    if (!mongoose.isValidObjectId(req.params.id) && !/^PAY-[A-Z0-9]{16}$/.test(req.params.id)) return res.status(400).json({ message: "Payment ID is invalid." });
    if (!["confirmed", "failed"].includes(paymentStatus)) return res.status(400).json({ message: "Payment status must be confirmed or failed." });
    let appointments;
    if (paymentStatus === "confirmed") {
        appointments = await verifyPaymentAndIssueToken(req.params.id);
        if (!appointments) {
            const paymentFilter = mongoose.isValidObjectId(req.params.id)
                ? { $or: [{ paymentGroupId: req.params.id }, { _id: req.params.id }] }
                : { paymentGroupId: req.params.id };
            const pending = await Token.exists({
                ...paymentFilter,
                paymentMethod: "upi_manual",
                paymentStatus: "submitted",
                slotNumber: { $exists: false }
            });
            if (pending) {
                return res.status(409).json({ message: "Payment received, but no token is available for this date. Do not approve; contact the patient to arrange a refund." });
            }
        }
    } else {
        const paymentFilter = mongoose.isValidObjectId(req.params.id)
            ? { $or: [{ paymentGroupId: req.params.id }, { _id: req.params.id }] }
            : { paymentGroupId: req.params.id };
        appointments = await Token.find(paymentFilter);
        const submittedIds = appointments
            .filter((appointment) => appointment.paymentMethod === "upi_manual" && appointment.paymentStatus === "submitted")
            .map((appointment) => appointment._id);
        if (submittedIds.length) {
            await Token.updateMany(
                { _id: { $in: submittedIds }, paymentStatus: "submitted" },
                { $set: { paymentStatus: "failed", status: "cancelled" }, $unset: { slotNumber: 1 } }
            );
            appointments = await Token.find({ _id: { $in: submittedIds } });
        } else {
            appointments = [];
        }
    }
    if (!appointments?.length) return res.status(404).json({ message: "No submitted UPI payment was found for this payment." });
    const patientUpdates = new Map();
    for (const appointment of appointments) {
        const patientId = appointment.patient.toString();
        const update = patientUpdates.get(patientId) || {
            appointmentId: appointment.paymentGroupId || appointment.appointmentId,
            paymentStatus: appointment.paymentStatus,
            tokens: []
        };
        if (Number.isInteger(appointment.tokenNumber)) {
            update.tokens.push({ name: appointment.patientName, tokenNumber: appointment.tokenNumber });
        }
        patientUpdates.set(patientId, update);
    }
    for (const [patientId, update] of patientUpdates) {
        io.to(`patient-${patientId}`).emit("payment-status-updated", update);
    }
    res.json({
        message: paymentStatus === "confirmed"
            ? `Payment verified. ${appointments.length} patient token(s) issued.`
            : `Payment marked as not verified; no tokens were issued.`,
        paymentStatus: appointments[0].paymentStatus,
        tokensIssued: paymentStatus === "confirmed" ? appointments.map((appointment) => ({
            name: appointment.patientName,
            tokenNumber: appointment.tokenNumber
        })) : []
    });
});
app.get("/api/admin/dashboard", auth("admin"), async (req, res) => { const date = req.query.date || today(); const tokens = await Token.find({ visitDate: date }).populate("patient", "name phone").populate("doctor", "name clinic district").sort({ tokenNumber: 1 }); res.json({ date, total: tokens.length, byStatus: tokens.reduce((o, t) => { o[t.status] = (o[t.status] || 0) + 1; return o; }, {}), tokens }); });
app.get("/api/admin/questions", auth("admin"), async (req, res) => {
    const items = await SupportQuestion.find().populate("patient", "name phone").sort({ status: 1, createdAt: -1 }).limit(100);
    res.json(items);
});
app.get("/api/admin/feedback", auth("admin"), async (req, res) => {
    const items = await Feedback.find()
        .populate("patient", "name phone email")
        .populate("doctor", "name clinic")
        .populate("appointment", "appointmentId visitDate tokenNumber")
        .sort({ createdAt: -1 })
        .limit(200);
    res.json(items);
});
app.patch("/api/admin/questions/:id", auth("admin"), async (req, res) => {
    const answer = String(req.body.answer || "").trim();
    if (!answer || answer.length > 1000) return res.status(400).json({ message: "जवाब 1 से 1000 अक्षरों में लिखें।" });
    const item = await SupportQuestion.findByIdAndUpdate(req.params.id, { answer, status: "answered" }, { new: true, runValidators: true }).populate("patient", "name phone _id");
    if (!item) return res.status(404).json({ message: "सवाल नहीं मिला।" });
    io.to(`patient-${item.patient._id}`).emit("answer-received", {
        questionId: item._id,
        question: item.question,
        answer: item.answer,
        answeredAt: new Date()
    });
    if (twilioClient && item.patient?.phone) {
        const to = `+91${item.patient.phone}`;
        const body = `Sehat Bhabua: आपके सवाल "${item.question.slice(0, 50)}..." का जवाब: ${answer.slice(0, 100)}`;
        try {
            await twilioClient.messages.create({ body, from: TWILIO_PHONE_NUMBER, to });
            console.log(`SMS sent to ${to}`);
        } catch (err) {
            console.error("Twilio SMS failed:", err.message);
        }
    }
    res.json(item);
});
app.get("/api/health", (req, res) => res.json({
    status: "ok",
    city: "Bhabua",
    district: "Kaimur",
    providers: {
        emailProvider,
        emailOtpConfigured: emailConfigured,
        supportQuestionEmailConfigured: Boolean(emailConfigured && SUPPORT_NOTIFICATION_EMAIL),
        firebasePhoneAuthConfigured: Boolean(firebaseAuth),
        smsOtpEnabled: false,
        manualUpiConfigured: /^[\w.-]{2,256}@[A-Za-z0-9.-]{2,64}$/.test(UPI_ID),
        ai: Boolean(GROQ_API_KEY)
    }
}));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
async function expireUnpaidBookings() {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const result = await Token.updateMany(
        { status: "awaiting_payment", paymentStatus: "pending", createdAt: { $lt: cutoff } },
        { $set: { paymentStatus: "failed", status: "cancelled" }, $unset: { slotNumber: 1 } }
    );
    if (result.modifiedCount) {
        console.log(`Expired ${result.modifiedCount} unpaid booking reservation(s).`);
    }
}
mongoose.connect(MONGODB_URI).then(async () => {
   await ensureAdminAccount();
   try { await Token.collection.dropIndex("doctor_1_patient_1_visitDate_1"); } catch (e) { if (e.codeName !== "IndexNotFound" && e.code !== 27) console.error("Could not update old booking index:", e.message); }
   try { await Token.collection.dropIndex("doctor_1_visitDate_1_tokenNumber_1"); } catch (e) { if (e.codeName !== "IndexNotFound" && e.code !== 27) throw e; }
   await Token.updateMany({ status: "cancelled", slotNumber: { $exists: true } }, { $unset: { slotNumber: 1 } });
   const tokensWithoutSlot = await Token.find({
       slotNumber: { $exists: false },
       status: { $ne: "cancelled" },
       $or: [
           { tokenNumber: { $exists: true } },
           { preferredTokenNumber: { $exists: true } }
       ]
   }).select("_id tokenNumber preferredTokenNumber").lean();
   for (const token of tokensWithoutSlot) {
       const slotNumber = Number.isInteger(token.tokenNumber) ? token.tokenNumber : token.preferredTokenNumber;
       if (!Number.isInteger(slotNumber)) continue;
       await Token.updateOne(
           { _id: token._id, slotNumber: { $exists: false } },
           { $set: { slotNumber }, $unset: { preferredTokenNumber: 1 } }
       );
   }
   await Token.collection.createIndex(
       { doctor: 1, visitDate: 1, slotNumber: 1 },
       { unique: true, partialFilterExpression: { slotNumber: { $exists: true } } }
   );
   const oldTokens = await Token.find({ $or: [{ patientName: { $exists: false } }, { patientPhone: { $exists: false } }] }).populate("patient", "name phone");
   for (const oldToken of oldTokens) {
       if (oldToken.patient) await Token.updateOne({ _id: oldToken._id }, { $set: { patientName: oldToken.patient.name, patientPhone: oldToken.patient.phone } });
   }
   await expireUnpaidBookings();
   setInterval(() => {
       expireUnpaidBookings().catch((error) => console.error("Could not expire unpaid booking reservations:", error.message));
   }, 5 * 60 * 1000);
   server.listen(PORT, "0.0.0.0", () => console.log(`Bhabua token server running on port ${PORT}`));
}).catch((e) => { console.error("MongoDB connection failed:", e.message); process.exit(1); });

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({ name: String, phone: { type: String, unique: true }, passwordHash: String, role: String });
const doctorSchema = new mongoose.Schema({ user: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true }, name: String, specialty: String, clinic: String, state: String, district: String, city: String, address: String, fee: Number, averageMinutes: Number, tokenLimit: Number, availableDays: [String], openingTime: String, closingTime: String, active: Boolean });
const User = mongoose.model("User", userSchema);
const Doctor = mongoose.model("Doctor", doctorSchema);
const locations = ["Bhabua", "Mohania", "Kudra", "Ramgarh", "Chainpur", "Adhaura"];
const specialties = ["General Physician", "Cardiologist", "Dermatologist", "Pediatrician", "Orthopedic"];

async function seed() {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required in .env");
    await mongoose.connect(process.env.MONGODB_URI);
    for (let locationIndex = 0; locationIndex < locations.length; locationIndex++) {
        const district = locations[locationIndex];
        for (let number = 1; number <= 10; number++) {
            const phone = `91${locationIndex + 1}${String(number).padStart(2, "0")}000000`;
            const name = `Dr. ${district} ${["Ananya", "Rahul", "Neha", "Vinod", "Sunil", "Pooja", "Amit", "Kiran", "Ravi", "Meena"][number - 1]}`;
            let user = await User.findOne({ phone });
            if (!user) user = await User.create({ name, phone, passwordHash: await bcrypt.hash("change-this-password", 12), role: "doctor" });
            await Doctor.findOneAndUpdate({ user: user._id }, {
                user: user._id, name, specialty: specialties[(number - 1) % specialties.length], clinic: `${district} Care Clinic ${number}`,
                state: "Bihar", district: "Kaimur", city: district, address: `${district}, Kaimur, Bihar`, fee: 250 + ((number - 1) % 5) * 100,
                averageMinutes: 8 + ((number - 1) % 5) * 2, tokenLimit: 50, availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
                openingTime: "09:00", closingTime: "17:00", active: true
            }, { upsert: true, new: true });
        }
    }
    await Doctor.updateMany(
        { district: { $in: ["Bhabua", "Mohania", "Kudra", "Ramgarh", "Chainpur", "Adhaura"] } },
        { $set: { state: "Bihar", district: "Kaimur" } }
    );
    const adminPhone = process.env.ADMIN_PHONE || "9000000099";
    const admin = await User.findOne({ phone: adminPhone });
    if (!admin) await User.create({ name: "Sehat Kaimur Team", phone: adminPhone, passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || "change-this-admin-password", 12), role: "admin" });
    console.log("Seeded 60 doctors across Bhabua, Mohania, Kudra, Ramgarh, Chainpur and Adhaura under Bihar's Kaimur district.");
    await mongoose.disconnect();
}
seed().catch((error) => { console.error("Seeding failed:", error.message); process.exit(1); });

const doctorState = { token: localStorage.getItem("bhabua-doctor-token") || "" };
const doctor$ = (selector) => document.querySelector(selector);

async function doctorApi(url, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (doctorState.token) headers.Authorization = `Bearer ${doctorState.token}`;
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({ message: "Server returned an invalid response." }));
    if (!response.ok) throw new Error(data.message || "Request failed.");
    return data;
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function indiaDateTime(value) {
    return value ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata"
    }).format(new Date(value)) : "—";
}

function render(tokens) {
    doctor$("#doctor-tokens").innerHTML = tokens.length ? tokens.map((appointment) => `
        <article class="appointment">
            <strong>${escapeHtml(appointment.tokenId)} · ${escapeHtml(appointment.appointmentTime || "")}</strong>
            <p>
                <b>Appointment ID:</b> ${escapeHtml(appointment.appointmentId || "—")}<br>
                <b>Visit date:</b> ${escapeHtml(appointment.visitDate)}<br>
                <b>Token booked at (India):</b> ${escapeHtml(appointment.bookedAtIndia || indiaDateTime(appointment.createdAt))}<br>
                <b>Patient:</b> ${escapeHtml(appointment.patientName || appointment.patient?.name || "—")} · ${escapeHtml(appointment.patientPhone || appointment.patient?.phone || "—")}<br>
                <b>Payment:</b> ${escapeHtml(appointment.paymentMethod || "demo_cash")} · ${escapeHtml(appointment.paymentStatus || "demo_paid")}<br>
                Status: ${escapeHtml(appointment.status)}
            </p>
            <div class="actions">
                ${["booked", "confirmed"].includes(appointment.status) ? `<button data-token="${escapeHtml(appointment._id)}" data-status="in_progress">Call / Start</button>` : ""}
                ${appointment.status === "in_progress" ? `<button data-token="${escapeHtml(appointment._id)}" data-status="completed">Completed</button><button class="secondary" data-token="${escapeHtml(appointment._id)}" data-status="no_show">No show</button>` : ""}
                ${["booked", "confirmed", "in_progress"].includes(appointment.status) ? `<button class="secondary" data-token="${escapeHtml(appointment._id)}" data-status="cancelled">Cancel</button>` : ""}
            </div>
        </article>`).join("") : "<p>Is date ke liye koi patient token nahi hai.</p>";
}

async function loadDoctorFeedback() {
    try {
        const data = await doctorApi("/api/doctor/feedback");
        doctor$("#doctor-feedback-summary").textContent = data.ratingCount
            ? `औसत rating: ${data.averageRating} / 5 · कुल ${data.ratingCount} patient feedback`
            : "अभी तक कोई patient feedback नहीं आया है। Appointment पूरा होने के बाद मरीज feedback दे सकते हैं।";
        doctor$("#doctor-feedback").innerHTML = data.feedback.length ? data.feedback.map((item) => `
            <article class="appointment">
                <strong class="doctor-rating">${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)} · ${item.rating} / 5</strong>
                <p>${item.comment ? escapeHtml(item.comment) : "मरीज ने केवल rating दी है।"}</p>
                <small>${indiaDateTime(item.createdAt)}</small>
            </article>`).join("") : "<p>अभी कोई feedback नहीं आया है।";
    } catch (error) {
        doctor$("#doctor-feedback").textContent = error.message;
    }
}

async function load() {
    if (!doctorState.token) return;
    try {
        const data = await doctorApi(`/api/doctor/dashboard?date=${encodeURIComponent(doctor$("#doctor-date").value)}`);
        doctor$("#doctor-profile").innerHTML = `
            <div>
                <span>Logged-in doctor</span>
                <strong>${escapeHtml(data.doctor.name)}</strong>
                <small>${escapeHtml(data.doctor.specialty)} · ${escapeHtml(data.doctor.clinic)}</small>
                <small>${escapeHtml(data.doctor.city)}, ${escapeHtml(data.doctor.district)}, ${escapeHtml(data.doctor.state)}</small>
            </div>`;
        doctor$("#doctor-summary").textContent = `Total tokens ${data.summary.total} · Booked patients ${data.summary.booked} · Completed ${data.summary.completed} · Current #${data.summary.current || "—"}`;
        render(data.tokens);
        loadDoctorFeedback();
    } catch (error) {
        doctor$("#doctor-message").textContent = error.message;
    }
}

function today() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

doctor$("#doctor-date").value = today();
doctor$("#doctor-login").addEventListener("click", async () => {
    try {
        const data = await doctorApi("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
                phone: doctor$("#doctor-phone").value,
                password: doctor$("#doctor-password").value
            })
        });
        if (data.user.role !== "doctor") throw new Error("Yeh doctor account nahi hai.");
        doctorState.token = data.token;
        localStorage.setItem("bhabua-doctor-token", data.token);
        doctor$("#doctor-panel").hidden = false;
        doctor$("#doctor-logout").hidden = false;
        load();
    } catch (error) {
        doctor$("#doctor-message").textContent = error.message;
    }
});

doctor$("#doctor-next").addEventListener("click", async () => {
    try {
        await doctorApi("/api/doctor/next", {
            method: "POST",
            body: JSON.stringify({ date: doctor$("#doctor-date").value })
        });
        load();
    } catch (error) {
        doctor$("#doctor-message").textContent = error.message;
    }
});

doctor$("#doctor-refresh").addEventListener("click", load);
doctor$("#doctor-date").addEventListener("change", load);
doctor$("#doctor-logout").addEventListener("click", () => {
    localStorage.removeItem("bhabua-doctor-token");
    location.reload();
});
doctor$("#doctor-tokens").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-token]");
    if (!button) return;
    try {
        await doctorApi(`/api/doctor/tokens/${button.dataset.token}`, {
            method: "PATCH",
            body: JSON.stringify({ status: button.dataset.status })
        });
        load();
    } catch (error) {
        doctor$("#doctor-message").textContent = error.message;
    }
});

if (doctorState.token) {
    doctor$("#doctor-panel").hidden = false;
    doctor$("#doctor-logout").hidden = false;
    load();
}

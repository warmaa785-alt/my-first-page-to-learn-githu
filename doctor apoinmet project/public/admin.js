const adminState = { token: "", socket: null };
const admin$ = (selector) => document.querySelector(selector);

async function adminApi(url, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (adminState.token) headers.Authorization = `Bearer ${adminState.token}`;
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

function renderAppointments(items) {
    admin$("#admin-appointments").innerHTML = items.length ? items.map((item) => `
        <article class="appointment">
            <strong>${escapeHtml(item.tokenId || (item.status === "awaiting_payment" ? "Payment verification pending" : "Token not assigned"))} · ${escapeHtml(item.status)}</strong>
            <p>
                <b>Appointment ID:</b> ${escapeHtml(item.appointmentId || "—")}<br>
                <b>Patient:</b> ${escapeHtml(item.patientName)} · ${escapeHtml(item.phone || item.patientPhone || "—")}<br>
                <b>Doctor:</b> ${escapeHtml(item.doctor)} · ${escapeHtml(item.clinic)}<br>
                <b>Visit date & time:</b> ${escapeHtml(item.visitDate)} · ${escapeHtml(item.appointmentTime || "Clinic timing")}<br>
                <b>Token booked at (India):</b> ${escapeHtml(item.bookedAtIndia || indiaDateTime(item.createdAt))}<br>
                <b>Payment:</b> ₹${escapeHtml(item.fee)} · ${escapeHtml(item.paymentStatus || "—")} · ${escapeHtml(item.paymentReference || item.paymentId || "—")}<br>
                <b>Location:</b> ${escapeHtml(item.district || "—")}
            </p>
        </article>`).join("") : "<p>अभी कोई booking नहीं है।";
}

function renderPayments(items) {
    const pending = items.filter((item) => item.paymentMethod === "upi_manual" && item.paymentStatus === "submitted");
    admin$("#admin-payments").innerHTML = pending.length ? pending.map((item) => `
        <article class="appointment">
            <strong>${escapeHtml(item.appointmentId)} · ${item.patients.length} मरीज · ₹${escapeHtml(item.fee)}</strong>
            <p>
                Doctor: ${escapeHtml(item.doctor)} · ${escapeHtml(item.clinic)}<br>
                UPI reference: <b>${escapeHtml(item.paymentReference)}</b><br>
                Date: ${escapeHtml(item.visitDate)} · payment approval के बाद tokens issue होंगे
            </p>
            <ul>${item.patients.map((patient) => `<li>${escapeHtml(patient.name)} · उम्र ${escapeHtml(patient.age || "—")} · ${escapeHtml(patient.phone)} · Reserved slot ${escapeHtml(patient.slotNumber || "—")}</li>`).join("")}</ul>
            <div class="actions">
                <button type="button" data-payment="${escapeHtml(item.id)}" data-status="confirmed">UPI में verify करके approve</button>
                <button type="button" class="secondary" data-payment="${escapeHtml(item.id)}" data-status="failed">Payment नहीं मिला</button>
            </div>
        </article>`).join("") : "<p>अभी कोई payment verification pending नहीं है।";
}

function renderFeedback(items) {
    admin$("#admin-feedback").innerHTML = items.length ? items.map((item) => `
        <article class="appointment">
            <strong>${escapeHtml(item.doctor?.name || "Doctor")} · ${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}</strong>
            <p>
                Patient: ${escapeHtml(item.patient?.name || "Patient")} · ${escapeHtml(item.patient?.phone || "—")}<br>
                Appointment: ${escapeHtml(item.appointment?.appointmentId || "—")} · ${escapeHtml(item.appointment?.visitDate || "—")}<br>
                ${escapeHtml(item.doctor?.clinic || "")}
            </p>
            ${item.comment ? `<p>${escapeHtml(item.comment)}</p>` : "<p>कोई comment नहीं।"}
        </article>`).join("") : "<p>अभी कोई feedback नहीं आया है।";
}

function renderQuestions(items) {
    admin$("#admin-questions").innerHTML = items.length ? items.map((item) => `
        <article class="appointment" id="question-${escapeHtml(item._id)}">
            <b>${escapeHtml(item.patient?.name || "Patient")} · ${escapeHtml(item.patient?.phone || "—")}</b>
            <p>${escapeHtml(item.question)}</p>
            ${item.status === "answered"
                ? `<p><b>जवाब:</b> ${escapeHtml(item.answer)}</p>`
                : `<textarea data-question="${escapeHtml(item._id)}" maxlength="1000" placeholder="Patient को जवाब लिखें"></textarea>
                   <button type="button" data-answer="${escapeHtml(item._id)}">जवाब भेजें</button>`}
        </article>`).join("") : "<p>अभी कोई सवाल नहीं है।";
    const questionId = window.location.hash.match(/^#question-([a-f\d]{24})$/i)?.[1];
    if (questionId) {
        document.getElementById(`question-${questionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
}

function showNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body, icon: "/favicon.ico", tag: "admin-notification" });
    }
}

async function load() {
    try {
        const date = encodeURIComponent(admin$("#admin-date").value);
        const [appointments, payments, questions, feedback] = await Promise.all([
            adminApi(`/api/admin/tokens?date=${date}`),
            adminApi("/api/admin/payments"),
            adminApi("/api/admin/questions"),
            adminApi("/api/admin/feedback")
        ]);
        renderAppointments(appointments);
        renderPayments(payments);
        renderQuestions(questions);
        renderFeedback(feedback);
    } catch (error) {
        admin$("#admin-message").textContent = error.message;
    }
}

function initSocket() {
    if (adminState.socket) return;
    adminState.socket = io();
    adminState.socket.on("connect", () => adminState.socket.emit("join-admin"));
    adminState.socket.on("new-question", (data) => {
        showNotification("नया सवाल आया", `${data.patientName || "Patient"}: ${data.question.slice(0, 50)}`);
        load();
    });
    adminState.socket.on("payment-reference-submitted", (data) => {
        showNotification("UPI payment verify करें", `${data.patientCount} मरीज · ${data.appointmentId}: ${data.paymentReference}`);
        load();
    });
    adminState.socket.on("disconnect", () => {
        setTimeout(initSocket, 5000);
    });
    adminState.socket.on("connect_error", (error) => {
        console.error("Admin socket connection failed:", error.message);
    });
}

admin$("#admin-date").value = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
admin$("#admin-login").addEventListener("click", async () => {
    try {
        const data = await adminApi("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
                phone: admin$("#admin-phone").value,
                password: admin$("#admin-password").value
            })
        });
        if (data.user.role !== "admin") throw new Error("यह admin account नहीं है।");
        adminState.token = data.token;
        admin$("#admin-message").textContent = "Team login सफल।";
        if ("Notification" in window) {
            Notification.requestPermission().finally(() => {
                initSocket();
                load();
            });
        } else {
            initSocket();
            load();
        }
    } catch (error) {
        admin$("#admin-message").textContent = error.message;
    }
});

admin$("#admin-refresh").addEventListener("click", load);
admin$("#admin-date").addEventListener("change", load);
admin$("#admin-payments").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-payment]");
    if (!button) return;
    button.disabled = true;
    try {
        const result = await adminApi(`/api/admin/tokens/${button.dataset.payment}/payment`, {
            method: "PATCH",
            body: JSON.stringify({ status: button.dataset.status })
        });
        admin$("#admin-message").textContent = result.message;
        await load();
    } catch (error) {
        button.disabled = false;
        admin$("#admin-message").textContent = error.message;
    }
});
admin$("#admin-questions").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-answer]");
    if (!button) return;
    const field = admin$(`[data-question="${button.dataset.answer}"]`);
    try {
        await adminApi(`/api/admin/questions/${button.dataset.answer}`, {
            method: "PATCH",
            body: JSON.stringify({ answer: field.value })
        });
        await load();
    } catch (error) {
        admin$("#admin-message").textContent = error.message;
    }
});

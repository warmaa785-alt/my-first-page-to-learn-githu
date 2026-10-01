const state = { token: localStorage.getItem("bhabua-token") || "", doctors: [], user: null, socket: null };
const $ = (s) => document.querySelector(s);

async function api(url, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({ message: "Server returned an invalid response." }));
    if (response.status === 401) { state.token = ""; localStorage.removeItem("bhabua-token"); updateIdentity(); }
    if (!response.ok) throw new Error(data.message || "Request failed.");
    return data;
}
function showNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body, icon: "/favicon.ico", tag: "patient-notification" });
    }
}
function requestNotifications() {
    if (!("Notification" in window)) {
        initSocket();
        return;
    }
    Notification.requestPermission().then(initSocket).catch((error) => console.warn("Notification permission unavailable:", error.message));
}
function initSocket() {
    if (state.socket || !state.token) return;
    state.socket = io();
    state.socket.on("connect", () => {
        console.log("Patient socket connected");
        if (state.user?.id) state.socket.emit("join-patient", state.user.id);
    });
    state.socket.on("answer-received", (data) => {
        console.log("Answer received:", data);
        showNotification("✅ जवाब मिल गया!", `आपके सवाल का जवाब: ${data.answer.slice(0, 60)}...`);
        loadSupportQuestions();
    });
    state.socket.on("payment-status-updated", (data) => {
        $("#support-message").textContent = `${data.appointmentId}: payment status ${data.paymentStatus}`;
        loadAppointments();
    });
    state.socket.on("disconnect", () => {
        console.log("Socket disconnected, reconnecting...");
        setTimeout(initSocket, 5000);
    });
    state.socket.on("connect_error", (err) => {
        console.error("Socket error:", err);
        setTimeout(initSocket, 5000);
    });
}
function updateIdentity() {
    $("#patient-identity").textContent = state.user ? `${state.user.name} · ${state.user.phone}` : "Guest";
    $("#logout").hidden = !state.token; $("#header-auth-button").textContent = state.token ? "Account" : "Login / Register";
    $("#auth-panel").hidden = !!state.token;
}
function finishLogin(data) {
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("bhabua-token", state.token);
    $("#auth-message").textContent = `नमस्ते ${data.user.name}, अब आप token ले सकते हैं।`;
    $("#name").hidden = true;
    $("#name").required = false;
    $("#phone").hidden = true;
    $("#phone").required = false;
    $("#otp-panel").hidden = true;
    $("#send-otp").hidden = false;
    updateIdentity();
    loadAppointments();
    requestNotifications();
}

async function sendOTP() {
    const email = $("#email").value.trim().toLowerCase();
    if (!email) { $("#auth-message").textContent = "अपना email address डालें।"; return; }
    $("#auth-message").textContent = "OTP भेजा जा रहा है...";
    $("#name").hidden = true;
    $("#name").required = false;
    $("#phone").hidden = true;
    $("#phone").required = false;
    try {
        const data = await api("/api/auth/otp/send", { method: "POST", body: JSON.stringify({ contact: email, type: "login" }) });
        $("#name").hidden = !data.isNewUser;
        $("#name").required = Boolean(data.isNewUser);
        $("#phone").hidden = !data.isNewUser;
        $("#phone").required = Boolean(data.isNewUser);
        $("#auth-message").textContent = data.message;
        $("#send-otp").hidden = true;
        $("#otp-panel").hidden = false;
        $("#otp").focus();
    } catch (error) {
        $("#send-otp").hidden = false;
        $("#otp-panel").hidden = true;
        $("#auth-message").textContent = error.message;
    }
}

async function verifyOTP() {
    const email = $("#email").value.trim().toLowerCase();
    const otp = $("#otp").value.trim();
    if (!otp || otp.length !== 6) { $("#auth-message").textContent = "Enter 6-digit OTP."; return; }

    try {
        const data = await api("/api/auth/otp/verify", {
            method: "POST",
            body: JSON.stringify({
                contact: email,
                otp,
                type: "login",
                name: $("#name").value.trim(),
                phone: $("#phone").value.trim()
            })
        });
        finishLogin(data);
    } catch (error) { $("#auth-message").textContent = error.message; }
}

async function resendOTP() {
    await sendOTP();
}
async function loadSession() { if (!state.token) return; try { state.user = (await api("/api/auth/me")).user; updateIdentity(); loadAppointments(); requestNotifications(); } catch { updateIdentity(); } }
async function loadLocations() {
    try {
        const data = await api("/api/locations");
        $("#state").innerHTML = "<option value=''>State चुनें</option>" + data.states.map((x) => `<option>${x}</option>`).join("");
        $("#district").innerHTML = "<option value=''>District चुनें</option>";
        $("#city").innerHTML = "<option value=''>City/Market चुनें</option>";
        window.locationData = data;
    } catch (error) {
        console.error("Location filters could not be loaded:", error.message);
    }
    await loadDoctors();
}
function fillDistricts() {
    const district = $("#district");
    district.disabled = !$("#state").value;
    district.innerHTML = `<option value="">District चुनें</option>${(window.locationData?.districts || []).map((x) => `<option>${x}</option>`).join("")}`;
    $("#city").disabled = true;
    $("#city").innerHTML = "<option value=''>पहले District चुनें</option>";
    $("#doctors").innerHTML = "<p>District select करें।</p>";
}
function fillCities() {
    const cities = window.locationData?.cities?.[$("#district").value] || [$("#district").value];
    $("#city").disabled = !$("#district").value;
    $("#city").innerHTML = `<option value="">City/Market चुनें</option>${cities.map((x) => `<option>${x}</option>`).join("")}`;
    $("#doctors").innerHTML = "<p>City/Market select करें।</p>";
}
let suggestionTimer;
async function loadSearchSuggestions() {
    const query = $("#search").value.trim();
    const box = $("#search-suggestions");
    if (!query) {
        box.hidden = true;
        box.innerHTML = "";
        return;
    }
    try {
        const doctors = await api(`/api/doctors?search=${encodeURIComponent(query)}`);
        const suggestions = doctors.slice(0, 6);
        box.innerHTML = suggestions.length ? suggestions.map((doctor) => `
            <button class="search-suggestion" type="button" data-search-value="${doctor.name}">
                ${doctor.name}<small>${doctor.specialty} · ${doctor.city || doctor.district} · ${doctor.clinic}</small>
            </button>`).join("") : "<p class='search-empty'>Doctor नहीं मिला।</p>";
        box.hidden = false;
    } catch {
        box.hidden = true;
    }
}
async function loadDoctors() {
    try {
        const search = $("#search").value.trim();
        const params = new URLSearchParams({ search });
        if ($("#state").value) params.set("state", $("#state").value);
        if ($("#district").value) params.set("district", $("#district").value);
        if ($("#city").value) params.set("city", $("#city").value);
        state.doctors = await api(`/api/doctors?${params}`);
        $("#doctors").innerHTML = state.doctors.length ? state.doctors.map((d) => `<article class="doctor" data-doctor-id="${d._id}" tabindex="0"><div class="doctor-avatar">${escapeHtml(d.name.replace("Dr. ", "").split(" ").map((x) => x[0]).slice(0, 2).join(""))}</div><h3>${escapeHtml(d.name)}</h3><strong>${escapeHtml(d.specialty)}</strong><p>${escapeHtml(d.clinic)}<br>${escapeHtml(d.address)}</p><p class="doctor-rating">${d.averageRating ? `★ ${d.averageRating} / 5` : "अभी कोई rating नहीं"} · ${d.ratingCount} patient feedback</p><div class="doctor-summary"><span>Fee ₹${d.fee}</span><span>Details देखें →</span></div></article>`).join("") : "<p>इस location में doctor नहीं मिला।";
    } catch (e) { $("#doctors").innerHTML = `<div class="error-box">${e.message}</div>`; }
}
async function trackingCard(x) {
    if (!state.token || ["completed", "cancelled", "no_show"].includes(x.status)) return "";
    try { const t = await api(`/api/tokens/${x._id}/tracking`); return `<div class="tracking"><strong>Live token स्थिति</strong><p><b>आपका नंबर:</b> #${t.token}<br><b>अभी चल रहा नंबर:</b> #${t.currentRunningToken || "—"} · <b>${t.patientsAhead}</b> patient(s) आगे<br><b>अनुमानित समय:</b> लगभग ${t.estimatedWaitMinutes} मिनट बाद · scheduled time ${t.appointmentTime || "clinic timing"}</p><button class="secondary refresh-tracking" data-id="${x._id}">अभी स्थिति देखें</button></div>`; } catch { return "<p>Tracking temporarily unavailable.</p>"; }
}
async function loadSupportQuestions() {
    if (!state.token) { $("#support-answers").innerHTML = "<p>सवाल भेजने के लिए पहले login करें।</p>"; return; }
    try {
        const items = await api("/api/support/questions/my");
        $("#support-answers").innerHTML = items.length ? items.map((x) => `<article class="appointment"><b>आपका सवाल:</b> ${x.question}<br><b>स्थिति:</b> ${x.status === "answered" ? "जवाब मिल गया" : "Team जवाब देगी"}${x.answer ? `<p><b>Team का जवाब:</b> ${x.answer}</p>` : ""}</article>`).join("") : "<p>अभी कोई सवाल नहीं भेजा गया है।</p>";
    } catch (e) { $("#support-message").textContent = e.message; }
}
function speakAssistantAnswer(text) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "hi-IN";
    speech.rate = 0.95;
    window.speechSynthesis.speak(speech);
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&", "<": "<", ">": ">", '"': "\"", "'": "'" }[character])); }
function addChatMessage(role, content, hasDisclaimer = false) {
    const chat = $("#assistant-chat");
    const div = document.createElement("div");
    div.className = `assistant-msg ${role === "user" ? "user" : "ai"}`;
    const avatar = role === "user" ? "👤" : "🤖";
    const avatarBg = role === "user" ? "user" : "ai";
    let html = `<div class="assistant-avatar">${avatar}</div><div class="assistant-bubble">${escapeHtml(content)}`;
    if (hasDisclaimer) html += `<div class="disclaimer">⚠️ यह जानकारी केवल सामान्य ज्ञान के लिए है। दवा लेने से पहले डॉक्टर या फार्मासिस्ट से जरूर सलाह लें।</div>`;
    html += `<button class="secondary assistant-speak" type="button" style="margin-top: 8px; padding: 6px 12px; font-size: 0.85rem;">🔊 सुनें</button></div>`;
    div.innerHTML = html;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    div.querySelector(".assistant-speak")?.addEventListener("click", () => speakAssistantAnswer(content));
}
async function askAssistant() {
    if (!state.token) { $("#auth-panel").hidden = false; $("#assistant-message").textContent = "AI के लिए पहले login करें।"; return; }
    const question = $("#assistant-question").value.trim();
    if (!question && !selectedImageFile) { $("#assistant-message").textContent = "सवाल लिखें या फोटो चुनें।"; return; }
    $("#assistant-message").textContent = "";
    if (question) {
        addChatMessage("user", question);
        $("#assistant-question").value = "";
        $("#assistant-question").style.height = "auto";
    }
    const thinkingDiv = document.createElement("div");
    thinkingDiv.className = "assistant-msg ai";
    thinkingDiv.innerHTML = `<div class="assistant-avatar">🤖</div><div class="assistant-bubble">सोच रहा है... <span class="typing">⋯</span></div>`;
    $("#assistant-chat").appendChild(thinkingDiv);
    $("#assistant-chat").scrollTop = $("#assistant-chat").scrollHeight;
    try {
        let data;
        if (selectedImageFile) {
            const formData = new FormData();
            formData.append("image", selectedImageFile);
            if (question) formData.append("question", question);
            const response = await fetch("/api/assistant/image", {
                method: "POST",
                headers: { "Authorization": `Bearer ${state.token}` },
                body: formData
            });
            data = await response.json().catch(() => ({ message: "AI service returned an invalid response." }));
            if (!response.ok) throw new Error(data.message || "Analysis failed");
            clearImagePreview();
            thinkingDiv.remove();
            addChatMessage("ai", data.answer, true);
        } else {
            const response = await api("/api/assistant", { method: "POST", body: JSON.stringify({ question }) });
            thinkingDiv.remove();
            addChatMessage("ai", response.answer);
        }
    } catch (error) {
        thinkingDiv.remove();
        $("#assistant-message").textContent = error.message;
    }
}
let selectedImageFile = null;
function showImagePreview(file) {
    if (!file) return;
    selectedImageFile = file;
    const url = URL.createObjectURL(file);
    const preview = $("#image-preview");
    preview.hidden = false;
    preview.dataset.objectUrl = url;
    preview.innerHTML = `<img src="${url}" alt="Preview"><button type="button" onclick="clearImagePreview()" aria-label="Remove image">×</button>`;
    addChatMessage("user", "📷 फोटो भेजी गई", false);
}
function clearImagePreview() {
    selectedImageFile = null;
    const preview = $("#image-preview");
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    delete preview.dataset.objectUrl;
    preview.hidden = true;
    preview.innerHTML = "";
    $("#assistant-image").value = "";
}
window.clearImagePreview = clearImagePreview;
async function loadAppointments() {
    if (!state.token) { $("#appointments").innerHTML = "<p>Login के बाद आपके tokens दिखेंगे।</p>"; return; }
    try {
        const items = await api("/api/tokens/my"); const groups = ["booked", "confirmed", "in_progress", "completed", "cancelled", "no_show"];
        const html = [];
        for (const status of groups) {
            const rows = items.filter((x) => x.status === status);
            if (!rows.length) continue;
            html.push(`<h3>${status.replace("_", " ")}</h3>`);
            for (const appointment of rows) {
                const paymentStatus = appointment.paymentStatus || "unknown";
                const paymentText = {
                    pending: "UPI payment pending",
                    submitted: "Payment reference team verification में है",
                    confirmed: "Payment verified",
                    failed: "Payment verify नहीं हुआ",
                    demo_paid: "पुराना demo payment"
                }[paymentStatus] || paymentStatus;
                const paymentForm = paymentStatus === "pending"
                    ? `<form class="payment-reference-form" data-appointment="${appointment._id}">
                        <label>UPI transaction reference<input name="reference" maxlength="80" minlength="8" pattern="[A-Za-z0-9-]{8,80}" required placeholder="UPI app का transaction ID"></label>
                        <button type="submit">Payment reference भेजें</button>
                    </form>`
                    : "";
                const paymentDetails = appointment.payment?.upiUrl
                    ? `<p>UPI ID: <strong>${escapeHtml(appointment.payment.upiId)}</strong> · Amount: <strong>₹${appointment.payment.amount}</strong></p>
                        <a class="upi-pay-link" href="${escapeHtml(appointment.payment.upiUrl)}">UPI app खोलें</a>
                        <p>या QR scan करके payment करें:</p>
                        <img class="upi-qr" src="${appointment.payment.qrDataUrl}" alt="UPI payment QR code">`
                    : "";
                html.push(`<article class="appointment"><strong>${appointment.appointmentId || "Appointment"} · Token ${appointment.tokenId}</strong><p>${appointment.doctor.name} · ${appointment.doctor.clinic} · ${appointment.visitDate} · ${appointment.appointmentTime || ""}<br>Payment: ₹${appointment.paymentAmount ?? appointment.doctor.fee ?? 0} · ${paymentText}<br>Status: ${appointment.status}</p>${paymentDetails}${paymentForm}${await trackingCard(appointment)}</article>`);
            }
        }
        $("#appointments").innerHTML = html.join("") || "<p>अभी कोई appointment नहीं है।";
        loadSupportQuestions();
        if (state.user?.role === "patient") loadFeedback();
    } catch (e) { $("#appointments").textContent = e.message; }
}
async function loadFeedback() {
    if (!state.token || state.user?.role !== "patient") {
        $("#feedback-appointments").innerHTML = "<p>Patient login के बाद feedback दे सकते हैं।</p>";
        return;
    }
    try {
        const appointments = await api("/api/feedback/my");
        $("#feedback-appointments").innerHTML = appointments.length ? appointments.map((appointment) => appointment.feedback
            ? `<article class="appointment"><strong>${escapeHtml(appointment.doctor)} · ${escapeHtml(appointment.appointmentCode)}</strong><p>आपकी rating: ${"★".repeat(appointment.feedback.rating)}${"☆".repeat(5 - appointment.feedback.rating)}</p>${appointment.feedback.comment ? `<p>${escapeHtml(appointment.feedback.comment)}</p>` : ""}</article>`
            : `<form class="feedback-form appointment" data-appointment="${appointment.appointmentId}">
                <strong>${escapeHtml(appointment.doctor)} · ${escapeHtml(appointment.clinic)}</strong>
                <p>${escapeHtml(appointment.appointmentCode)} · ${escapeHtml(appointment.visitDate)} · Token ${appointment.tokenNumber}</p>
                <label>Rating
                    <select name="rating" required>
                        <option value="">Rating चुनें</option>
                        <option value="5">5 - बहुत अच्छा</option>
                        <option value="4">4 - अच्छा</option>
                        <option value="3">3 - ठीक</option>
                        <option value="2">2 - खराब</option>
                        <option value="1">1 - बहुत खराब</option>
                    </select>
                </label>
                <label>Comment (optional)<textarea name="comment" maxlength="500" placeholder="अपना अनुभव बताएं"></textarea></label>
                <button type="submit">Feedback भेजें</button>
            </form>`).join("") : "<p>Feedback देने के लिए अभी कोई पूरा हुआ appointment नहीं है।";
    } catch (error) {
        $("#feedback-appointments").textContent = error.message;
    }
}
async function showDoctorDetails(id) {
    const doctor = state.doctors.find((x) => x._id === id); if (!doctor) return;
    try {
        const status = await api(`/api/doctors/${id}/status`); $("#doctors").closest(".card").hidden = true; $("#doctor-details").hidden = false;
        $("#details-content").innerHTML = `<h2>${escapeHtml(doctor.name)}</h2><p class="detail-specialty">${escapeHtml(doctor.specialty)} · ${escapeHtml(doctor.clinic)} · ${escapeHtml(doctor.district)}</p><p class="doctor-rating">${status.averageRating ? `★ ${status.averageRating} / 5` : "अभी कोई rating नहीं"} · ${status.ratingCount} patient feedback</p><div class="info-grid"><div><strong>Fee</strong><b>₹${doctor.fee}</b></div><div><strong>Total / Booked / Available</strong><b id="availability-summary">${status.total} / ${status.booked} / ${status.available}</b></div><div><strong>Current token</strong><b id="current-token">#${status.currentToken || "—"}</b></div><div><strong>Days and timing</strong><b>${doctor.availableDays.join(", ")} · ${doctor.openingTime}-${doctor.closingTime}</b></div></div><form class="booking-form" data-doctor="${id}"><label>Patient Name<input id="patient-name" type="text" placeholder="Patient Name" required></label><label>Age<input id="patient-age" type="number" placeholder="Age" min="1" max="120" required></label><label>Date<input id="visit-date" type="date" required></label><label>Token<select id="preferred-token">${status.availableTokens.map((n) => `<option value="${n}">Token ${n}</option>`).join("")}</select></label><p>Payment: ₹${doctor.fee} by UPI. Payment team verify करेगी; कोई payment gateway fee नहीं।</p><button>Token book करें और UPI से pay करें</button></form><p class="payment-note">UPI payment सीधे configured account में होगा। Payment verify होने तक booking payment pending दिखाएगी।</p><p id="booking-message" class="message"></p><div id="booking-confirmation" class="booking-confirmation" hidden></div>`;
        $("#visit-date").min = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
        $("#visit-date").addEventListener("change", async (event) => { try { const next = await api(`/api/doctors/${id}/status?date=${event.target.value}`); $("#availability-summary").textContent = `${next.total} / ${next.booked} / ${next.available}`; $("#current-token").textContent = `#${next.currentToken || "—"}`; $("#preferred-token").innerHTML = next.availableTokens.length ? next.availableTokens.map((n) => `<option value="${n}">Token ${n}</option>`).join("") : "<option value=''>No token available</option>"; } catch (error) { $("#booking-message").textContent = error.message; } });
    } catch (e) { alert(e.message); }
}
$("#header-auth-button").addEventListener("click", () => { if (state.token) { $("#appointments").scrollIntoView({ behavior: "smooth" }); return; } $("#auth-panel").hidden = !$("#auth-panel").hidden; });
$("#logout").addEventListener("click", () => { state.token = ""; state.user = null; localStorage.removeItem("bhabua-token"); updateIdentity(); loadAppointments(); });
$("#send-otp").addEventListener("click", sendOTP);
$("#verify-otp").addEventListener("click", verifyOTP);
$("#resend-otp").addEventListener("click", resendOTP);
$("#refresh").addEventListener("click", loadAppointments);
$("#ask-support").addEventListener("click", async () => { if (!state.token) { $("#auth-panel").hidden = false; $("#support-message").textContent = "सवाल भेजने के लिए पहले login करें।"; return; } try { const d = await api("/api/support/questions", { method: "POST", body: JSON.stringify({ question: $("#support-question").value }) }); $("#support-question").value = ""; $("#support-message").textContent = d.message; loadSupportQuestions(); } catch (e) { $("#support-message").textContent = e.message; } });
$("#assistant-ask").addEventListener("click", askAssistant);
$("#assistant-mic").addEventListener("click", () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { $("#assistant-message").textContent = "इस browser में voice input उपलब्ध नहीं है। सवाल लिखकर पूछें।"; return; }
    const recognition = new Recognition();
    recognition.lang = "hi-IN";
    recognition.onresult = (event) => { $("#assistant-question").value = event.results[0][0].transcript; askAssistant(); };
    recognition.onerror = () => { $("#assistant-message").textContent = "आवाज़ समझ नहीं आई। फिर कोशिश करें या सवाल लिखें।"; };
    recognition.start();
});
function openCameraOrGallery(useCamera) {
    const input = $("#assistant-image");
    if (useCamera) {
        const isSecure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
        if (!isSecure && !navigator.mediaDevices) {
            $("#assistant-message").textContent = "कैमरा के लिए HTTPS या localhost जरूरी है। गैलरी से चुनें।";
            input.capture = "";
            input.click();
            return;
        }
        input.capture = "environment";
    } else {
        input.capture = "";
    }
    input.click();
}
$("#assistant-attach").addEventListener("click", () => {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
        const actionSheet = document.createElement("div");
        actionSheet.style.cssText = "position:fixed;bottom:0;left:0;right:0;background:white;padding:16px;border-radius:16px 16px 0 0;box-shadow:0 -4px 20px #0003;z-index:9999;display:flex;flex-direction:column;gap:12px;";
        actionSheet.innerHTML = `
            <div style="font-weight:bold;color:#0f6b70;padding:0 12px;">फोटो चुनें</div>
            <button id="opt-camera" style="padding:16px;border:0;background:#f5fbfa;border-radius:10px;font-size:1rem;display:flex;align-items:center;gap:12px;"><span style="font-size:1.5rem;">📸</span>कैमरा से खींचें</button>
            <button id="opt-gallery" style="padding:16px;border:0;background:#f5fbfa;border-radius:10px;font-size:1rem;display:flex;align-items:center;gap:12px;"><span style="font-size:1.5rem;">🖼️</span>गैलरी से चुनें</button>
            <button id="opt-cancel" style="padding:12px;border:0;background:transparent;color:#0f6b70;font-size:1rem;">रद्द करें</button>
        `;
        document.body.appendChild(actionSheet);
        const remove = () => { actionSheet.remove(); };
        $("#opt-camera").addEventListener("click", () => { remove(); openCameraOrGallery(true); });
        $("#opt-gallery").addEventListener("click", () => { remove(); openCameraOrGallery(false); });
        $("#opt-cancel").addEventListener("click", remove);
        actionSheet.addEventListener("click", (e) => { if (e.target === actionSheet) remove(); });
    } else {
        openCameraOrGallery(true);
    }
});
$("#assistant-image").addEventListener("change", (e) => { const file = e.target.files[0]; if (file) showImagePreview(file); });
$("#assistant-question").addEventListener("input", function() { this.style.height = "auto"; this.style.height = Math.min(this.scrollHeight, 120) + "px"; });
$("#assistant-question").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askAssistant(); } });
$("#otp").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); verifyOTP(); } });
$("#search").addEventListener("input", () => {
    clearTimeout(suggestionTimer);
    suggestionTimer = setTimeout(loadSearchSuggestions, 180);
    loadDoctors();
});
$("#search").addEventListener("focus", loadSearchSuggestions);
$("#search").addEventListener("keydown", (event) => {
    if (event.key === "Escape") $("#search-suggestions").hidden = true;
});
$("#search-suggestions").addEventListener("click", (event) => {
    const suggestion = event.target.closest("[data-search-value]");
    if (!suggestion) return;
    $("#search").value = suggestion.dataset.searchValue;
    $("#search-suggestions").hidden = true;
    loadDoctors();
});
document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-box")) $("#search-suggestions").hidden = true;
});
$("#state").addEventListener("change", fillDistricts); $("#district").addEventListener("change", fillCities); $("#city").addEventListener("change", loadDoctors);
$("#back-to-doctors").addEventListener("click", () => { $("#doctor-details").hidden = true; $("#doctors").closest(".card").hidden = false; });
$("#doctors").addEventListener("click", (e) => { const card = e.target.closest(".doctor"); if (card) showDoctorDetails(card.dataset.doctorId); });
$("#appointments").addEventListener("click", (e) => { if (e.target.classList.contains("refresh-tracking")) loadAppointments(); });
$("#doctor-details").addEventListener("submit", async (event) => {
    if (!event.target.matches(".booking-form")) return;
    event.preventDefault();
    if (!state.token) {
        $("#auth-panel").hidden = false;
        $("#booking-message").textContent = "कृपया पहले login करें।";
        return;
    }
    try {
        const data = await api("/api/tokens", {
            method: "POST",
            body: JSON.stringify({
                doctorId: event.target.dataset.doctor,
                visitDate: $("#visit-date").value,
                preferredToken: $("#preferred-token").value,
                patientName: $("#patient-name").value,
                patientAge: $("#patient-age").value
            })
        });
        const appointment = data.appointment;
        const paymentMarkup = data.payment.amount > 0
            ? `<p>UPI ID: <strong>${escapeHtml(data.payment.upiId)}</strong> · Amount: <strong>₹${data.payment.amount}</strong></p>
                <a class="upi-pay-link" href="${escapeHtml(data.payment.upiUrl)}">UPI app खोलें</a>
                <p>या QR scan करके payment करें:</p>
                <img class="upi-qr" src="${data.payment.qrDataUrl}" alt="UPI payment QR code">
                <form class="payment-reference-form" data-appointment="${appointment._id}">
                    <label>UPI transaction reference<input name="reference" maxlength="80" minlength="8" pattern="[A-Za-z0-9-]{8,80}" required placeholder="UPI app से transaction ID"></label>
                    <button type="submit">Payment reference भेजें</button>
                </form>
                <p class="payment-note">Team UPI transaction verify करेगी। Verification से पहले status pending रहेगा।</p>`
            : "<p>यह appointment free है; कोई payment जरूरी नहीं।</p>";
        $("#booking-message").textContent = data.message;
        $("#booking-confirmation").hidden = false;
        $("#booking-confirmation").innerHTML = `<h3>Appointment booked ✓</h3>
            <div class="booking-confirmation-grid">
                <div><strong>Appointment ID</strong><b>${escapeHtml(appointment.appointmentId)}</b></div>
                <div><strong>Token</strong><b>${escapeHtml(data.token)}</b></div>
                <div><strong>Date</strong><b>${escapeHtml(appointment.visitDate)}</b></div>
                <div><strong>Time</strong><b>${escapeHtml(appointment.appointmentTime || "Clinic timing")}</b></div>
                <div><strong>Payment status</strong><b>${escapeHtml(appointment.paymentStatus)}</b></div>
            </div>${paymentMarkup}`;
        loadAppointments();
    } catch (error) {
        $("#booking-message").textContent = error.message;
    }
});
document.addEventListener("submit", async (event) => {
    const form = event.target.closest(".payment-reference-form");
    if (!form) return;
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
        const result = await api(`/api/tokens/${form.dataset.appointment}/payment-reference`, {
            method: "POST",
            body: JSON.stringify({ reference: new FormData(form).get("reference") })
        });
        $("#feedback-message").textContent = result.message;
        await loadAppointments();
    } catch (error) {
        submit.disabled = false;
        $("#feedback-message").textContent = error.message;
    }
});
$("#feedback-appointments").addEventListener("submit", async (event) => {
    const form = event.target.closest(".feedback-form");
    if (!form) return;
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
        const formData = new FormData(form);
        const result = await api("/api/feedback", {
            method: "POST",
            body: JSON.stringify({
                appointmentId: form.dataset.appointment,
                rating: formData.get("rating"),
                comment: formData.get("comment")
            })
        });
        $("#feedback-message").textContent = result.message;
        await loadFeedback();
    } catch (error) {
        submit.disabled = false;
        $("#feedback-message").textContent = error.message;
    }
});
updateIdentity(); loadLocations(); loadSession();

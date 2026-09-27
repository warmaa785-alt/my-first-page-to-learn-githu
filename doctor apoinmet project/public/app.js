const state = { token: localStorage.getItem("bhabua-token") || "", doctors: [], user: null };
const $ = (s) => document.querySelector(s);
async function api(url, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(url, { ...options, headers });
    const data = await response.json();
    if (response.status === 401) { state.token = ""; localStorage.removeItem("bhabua-token"); updateIdentity(); }
    if (!response.ok) throw new Error(data.message || "Request failed.");
    return data;
}
function updateIdentity() {
    $("#patient-identity").textContent = state.user ? `${state.user.name} · ${state.user.phone}` : "Guest";
    $("#logout").hidden = !state.token; $("#header-auth-button").textContent = state.token ? "Account" : "Login / Register";
    $("#auth-panel").hidden = !!state.token;
}
async function authenticate(endpoint) {
    try {
        const data = await api(`/api/auth/${endpoint}`, { method: "POST", body: JSON.stringify({ name: $("#name").value, phone: $("#phone").value, password: $("#password").value }) });
        state.token = data.token; state.user = data.user; localStorage.setItem("bhabua-token", state.token);
        $("#auth-message").textContent = `नमस्ते ${data.user.name}, अब आप token ले सकते हैं।`; updateIdentity(); loadAppointments();
    } catch (e) { $("#auth-message").textContent = e.message; }
}
async function loadSession() { if (!state.token) return; try { state.user = (await api("/api/auth/me")).user; updateIdentity(); loadAppointments(); } catch { updateIdentity(); } }
async function loadLocations() {
    try {
        const data = await api("/api/locations");
        $("#state").innerHTML = "<option value=''>State चुनें</option>" + data.states.map((x) => `<option>${x}</option>`).join("");
        $("#district").innerHTML = "<option value=''>District चुनें</option>";
        $("#city").innerHTML = "<option value=''>City/Market चुनें</option>";
        window.locationData = data;
    } catch (error) {
        $("#doctors").innerHTML = `<div class="error-box"><strong>Doctors load नहीं हो पाए।</strong><p>${error.message}</p><small>http://localhost:3000 से app खोलें और Ctrl + F5 दबाएँ।</small></div>`;
    }
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
        if (!search && (!$("#state").value || !$("#district").value || !$("#city").value)) {
            $("#doctors").innerHTML = "<p>State, District और City/Market चुनें।</p>";
            return;
        }
        const params = new URLSearchParams({ search });
        if ($("#state").value) params.set("state", $("#state").value);
        if ($("#district").value) params.set("district", $("#district").value);
        if ($("#city").value) params.set("city", $("#city").value);
        state.doctors = await api(`/api/doctors?${params}`);
        $("#doctors").innerHTML = state.doctors.length ? state.doctors.map((d) => `<article class="doctor" data-doctor-id="${d._id}" tabindex="0"><div class="doctor-avatar">${d.name.replace("Dr. ", "").split(" ").map((x) => x[0]).slice(0, 2).join("")}</div><h3>${d.name}</h3><strong>${d.specialty}</strong><p>${d.clinic}<br>${d.address}</p><div class="doctor-summary"><span>Fee ₹${d.fee}</span><span>Details देखें →</span></div></article>`).join("") : "<p>इस location में doctor नहीं मिला।";
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
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }
async function askAssistant() {
    if (!state.token) { $("#auth-panel").hidden = false; $("#assistant-message").textContent = "AI assistant के लिए पहले login करें।"; return; }
    const question = $("#assistant-question").value.trim();
    if (!question) { $("#assistant-message").textContent = "पहले अपना सवाल लिखें या बोलकर पूछें।"; return; }
    $("#assistant-message").textContent = "AI जवाब तैयार कर रहा है...";
    try {
        const data = await api("/api/assistant", { method: "POST", body: JSON.stringify({ question }) });
        $("#assistant-answer").hidden = false;
        $("#assistant-answer").innerHTML = `<b>AI सहायक:</b><p>${escapeHtml(data.answer)}</p><button class="secondary assistant-speak" type="button">🔊 जवाब सुनें</button>`;
        $("#assistant-message").textContent = "";
        speakAssistantAnswer(data.answer);
    } catch (error) { $("#assistant-message").textContent = error.message; }
}
async function loadAppointments() {
    if (!state.token) { $("#appointments").innerHTML = "<p>Login के बाद आपके tokens दिखेंगे।</p>"; return; }
    try {
        const items = await api("/api/tokens/my"); const groups = ["booked", "confirmed", "in_progress", "completed", "cancelled", "no_show"];
        const html = [];
        for (const status of groups) { const rows = items.filter((x) => x.status === status); if (!rows.length) continue; html.push(`<h3>${status.replace("_", " ")}</h3>`); for (const x of rows) html.push(`<article class="appointment"><strong>${x.appointmentId || "Appointment"} · Token ${x.tokenId}</strong><p>${x.doctor.name} · ${x.doctor.clinic} · ${x.visitDate} · ${x.appointmentTime || ""}<br>Payment: ${x.paymentMethod || "demo_cash"} · ${x.paymentStatus || "demo_paid"}<br>Status: ${x.status}</p>${await trackingCard(x)}</article>`); }
        $("#appointments").innerHTML = html.join("") || "<p>अभी कोई appointment नहीं है।";
        loadSupportQuestions();
    } catch (e) { $("#appointments").textContent = e.message; }
}
async function showDoctorDetails(id) {
    const doctor = state.doctors.find((x) => x._id === id); if (!doctor) return;
    try {
        const status = await api(`/api/doctors/${id}/status`); $("#doctors").closest(".card").hidden = true; $("#doctor-details").hidden = false;
        $("#details-content").innerHTML = `<h2>${doctor.name}</h2><p class="detail-specialty">${doctor.specialty} · ${doctor.clinic} · ${doctor.district}</p><div class="info-grid"><div><strong>Fee</strong><b>₹${doctor.fee}</b></div><div><strong>Total / Booked / Available</strong><b id="availability-summary">${status.total} / ${status.booked} / ${status.available}</b></div><div><strong>Current token</strong><b id="current-token">#${status.currentToken || "—"}</b></div><div><strong>Days and timing</strong><b>${doctor.availableDays.join(", ")} · ${doctor.openingTime}-${doctor.closingTime}</b></div></div><form class="booking-form" data-doctor="${id}"><label>Date<input id="visit-date" type="date" required></label><label>Token<select id="preferred-token">${status.availableTokens.map((n) => `<option value="${n}">Token ${n}</option>`).join("")}</select></label><label>Demo payment<select id="payment-method" required><option value="demo_cash">Demo Cash</option><option value="demo_upi">Demo UPI</option><option value="demo_card">Demo Card</option></select></label><button>Pay demo & book</button></form><p class="payment-note">यह केवल demo payment है; कोई real पैसा नहीं कटेगा।</p><p id="booking-message" class="message"></p><div id="booking-confirmation" class="booking-confirmation" hidden></div>`;
        $("#visit-date").min = new Date().toISOString().slice(0, 10);
        $("#visit-date").addEventListener("change", async (event) => { try { const next = await api(`/api/doctors/${id}/status?date=${event.target.value}`); $("#availability-summary").textContent = `${next.total} / ${next.booked} / ${next.available}`; $("#current-token").textContent = `#${next.currentToken || "—"}`; $("#preferred-token").innerHTML = next.availableTokens.length ? next.availableTokens.map((n) => `<option value="${n}">Token ${n}</option>`).join("") : "<option value=''>No token available</option>"; } catch (error) { $("#booking-message").textContent = error.message; } });
    } catch (e) { alert(e.message); }
}
$("#header-auth-button").addEventListener("click", () => { if (state.token) { $("#appointments").scrollIntoView({ behavior: "smooth" }); return; } $("#auth-panel").hidden = !$("#auth-panel").hidden; });
$("#logout").addEventListener("click", () => { state.token = ""; state.user = null; localStorage.removeItem("bhabua-token"); updateIdentity(); loadAppointments(); });
$("#register").addEventListener("click", () => authenticate("register")); $("#login").addEventListener("click", () => authenticate("login"));
$("#forgot-password").addEventListener("click", async () => { $("#forgot-panel").hidden = false; try { const d = await api("/api/auth/forgot-password/request", { method: "POST", body: JSON.stringify({ phone: $("#phone").value }) }); $("#forgot-message").textContent = `${d.message} ${d.demoOtp ? `Demo OTP: ${d.demoOtp}` : ""}`; } catch (e) { $("#forgot-message").textContent = e.message; } });
$("#verify-otp").addEventListener("click", async () => { try { const d = await api("/api/auth/forgot-password/verify", { method: "POST", body: JSON.stringify({ phone: $("#phone").value, otp: $("#otp").value, newPassword: $("#new-password").value }) }); $("#forgot-message").textContent = d.message; } catch (e) { $("#forgot-message").textContent = e.message; } });
$("#refresh").addEventListener("click", loadAppointments);
$("#ask-support").addEventListener("click", async () => { if (!state.token) { $("#auth-panel").hidden = false; $("#support-message").textContent = "सवाल भेजने के लिए पहले login करें।"; return; } try { const d = await api("/api/support/questions", { method: "POST", body: JSON.stringify({ question: $("#support-question").value }) }); $("#support-question").value = ""; $("#support-message").textContent = d.message; loadSupportQuestions(); } catch (e) { $("#support-message").textContent = e.message; } });
$("#assistant-ask").addEventListener("click", askAssistant);
$("#assistant-answer").addEventListener("click", () => { const answer = $("#assistant-answer p")?.textContent; if (answer) speakAssistantAnswer(answer); });
$("#assistant-mic").addEventListener("click", () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { $("#assistant-message").textContent = "इस browser में voice input उपलब्ध नहीं है। सवाल लिखकर पूछें।"; return; }
    const recognition = new Recognition();
    recognition.lang = "hi-IN";
    recognition.onresult = (event) => { $("#assistant-question").value = event.results[0][0].transcript; askAssistant(); };
    recognition.onerror = () => { $("#assistant-message").textContent = "आवाज़ समझ नहीं आई। फिर कोशिश करें या सवाल लिखें।"; };
    recognition.start();
});
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
$("#doctor-details").addEventListener("submit", async (e) => { e.preventDefault(); if (!state.token) { $("#auth-panel").hidden = false; $("#booking-message").textContent = "Please login first."; return; } try { const data = await api("/api/tokens", { method: "POST", body: JSON.stringify({ doctorId: e.target.dataset.doctor, visitDate: $("#visit-date").value, preferredToken: $("#preferred-token").value, paymentMethod: $("#payment-method").value }) }); const appointment = data.appointment; $("#booking-message").textContent = data.message || "Appointment booked successfully."; $("#booking-confirmation").hidden = false; $("#booking-confirmation").innerHTML = `<h3>Appointment confirmed ✓</h3><div class="booking-confirmation-grid"><div><strong>Appointment ID</strong><b>${appointment.appointmentId}</b></div><div><strong>Token</strong><b>${data.token}</b></div><div><strong>Date</strong><b>${appointment.visitDate}</b></div><div><strong>Time</strong><b>${appointment.appointmentTime || "Clinic timing"}</b></div><div><strong>Payment</strong><b>${appointment.paymentMethod} · Demo paid</b></div><div><strong>Status</strong><b>${appointment.status}</b></div></div>`; loadAppointments(); } catch (error) { $("#booking-message").textContent = error.message; } });
updateIdentity(); loadLocations(); loadSession();

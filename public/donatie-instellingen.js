const $ = (selector) => document.querySelector(selector);
const tenantId = sessionStorage.getItem("selectedTenant") || "";
const headers = (extra) => ({ ...(tenantId ? { "x-tenant-id": tenantId } : {}), ...extra });
const money = (cents) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format((cents || 0) / 100);
const date = (value) => new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const labels = { completed: "Geslaagd", pending: "In behandeling", cancel_requested: "Wordt geannuleerd", cancelled: "Geannuleerd", failed: "Mislukt" };

async function load() {
  const response = await fetch("/api/portal/donations", { headers: headers() });
  if (response.status === 401) return location.href = "/inloggen";
  const data = await response.json();
  if (!response.ok) {
    $("#notice").textContent = data.error;
    $("#notice").classList.add("show");
    return;
  }
  $("#total").textContent = money(data.summary.totalCents);
  $("#today").textContent = money(data.summary.todayCents);
  $("#count").textContent = data.summary.count;
  $("#pending").textContent = data.summary.pending;
  $("#donations").innerHTML = data.donations.map((item) => `<tr><td>${date(item.createdAt)}</td><td><strong>${money(item.amountCents)}</strong></td><td>${item.source === "kiosk" ? "Donatiescherm" : escapeHtml(item.source)}</td><td>${escapeHtml(item.provider)}</td><td><span class="badge ${escapeHtml(item.status)}">${labels[item.status] || escapeHtml(item.status)}</span></td><td><code>${escapeHtml(item.orderId)}</code></td></tr>`).join("") || `<tr><td colspan="6">Nog geen donaties geregistreerd.</td></tr>`;
}

$("#refresh").onclick = load;
$("#logout").onclick = async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.href = "/inloggen";
};
load();

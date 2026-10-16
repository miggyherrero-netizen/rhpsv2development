"use strict";

const elements = {
  connectionBadge: document.querySelector("#connectionBadge"),
  statusDot: document.querySelector("#statusDot"),
  statusLabel: document.querySelector("#statusLabel"),
  statusDetail: document.querySelector("#statusDetail"),
  startButton: document.querySelector("#startButton"),
  openButton: document.querySelector("#openButton"),
  restartButton: document.querySelector("#restartButton"),
  stopButton: document.querySelector("#stopButton"),
  actionMessage: document.querySelector("#actionMessage"),
  latencyValue: document.querySelector("#latencyValue"),
  ownershipValue: document.querySelector("#ownershipValue"),
  startedValue: document.querySelector("#startedValue"),
  logs: document.querySelector("#logs"),
  clearLogsButton: document.querySelector("#clearLogsButton"),
  updates: document.querySelector("#updates"),
};

let sessionToken = "";
let lastLogId = 0;
let actionBusy = false;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function request(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function formatStarted(value) {
  if (!value) return "—";
  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderStatus(status) {
  const { app, launcher } = status;
  elements.statusDot.className = `status-dot ${app.online ? "is-online" : launcher.state === "starting" ? "is-checking" : "is-offline"}`;
  elements.statusLabel.textContent = app.online ? "System online" : launcher.state === "starting" ? "Starting system" : launcher.state === "stopping" ? "Stopping system" : "System offline";
  elements.statusDetail.textContent = launcher.state === "external"
    ? "Running outside this control center"
    : app.online
      ? `HTTP ${app.statusCode} at localhost:3000`
      : launcher.state === "starting"
        ? "Waiting for localhost:3000"
        : "Ready to start";

  elements.startButton.disabled = actionBusy || !launcher.canStart;
  elements.stopButton.disabled = actionBusy || !launcher.canStop;
  elements.restartButton.disabled = actionBusy || !launcher.canRestart;
  elements.openButton.disabled = !app.online;
  elements.latencyValue.textContent = app.online && app.latencyMs !== null ? `${app.latencyMs} ms` : "—";
  elements.ownershipValue.textContent = launcher.managed ? "Managed here" : launcher.state === "external" ? "External process" : "No process";
  elements.startedValue.textContent = formatStarted(launcher.startedAt);
}

async function refreshStatus() {
  try {
    renderStatus(await request("/api/health"));
    elements.connectionBadge.textContent = "Launcher connected";
    elements.connectionBadge.classList.remove("is-offline");
  } catch {
    elements.connectionBadge.textContent = "Launcher disconnected";
    elements.connectionBadge.classList.add("is-offline");
    elements.statusDot.className = "status-dot is-offline";
    elements.statusLabel.textContent = "Launcher offline";
    elements.statusDetail.textContent = "Reopen the desktop launcher";
  }
}

function appendLogs(entries) {
  if (!entries.length) return;
  const empty = elements.logs.querySelector(".empty-state");
  if (empty) empty.remove();
  const shouldFollow = elements.logs.scrollTop + elements.logs.clientHeight >= elements.logs.scrollHeight - 45;

  for (const entry of entries) {
    lastLogId = Math.max(lastLogId, entry.id);
    const row = document.createElement("div");
    row.className = `log-entry is-${entry.level}`;
    const time = new Date(entry.at).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    row.innerHTML = `<span class="log-time">${escapeHtml(time)}</span><span class="log-level">${escapeHtml(entry.level)}</span><span class="log-message">${escapeHtml(entry.message)}</span>`;
    elements.logs.append(row);
  }
  while (elements.logs.children.length > 600) elements.logs.firstElementChild.remove();
  if (shouldFollow) elements.logs.scrollTop = elements.logs.scrollHeight;
}

async function refreshLogs() {
  try {
    const body = await request(`/api/logs?after=${lastLogId}`);
    appendLogs(body.entries);
  } catch {
    // The status badge communicates launcher connection failures.
  }
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  let html = "";
  let inList = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("- ")) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${escapeHtml(line.slice(2))}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (line.startsWith("# ")) html += `<h3>${escapeHtml(line.slice(2))}</h3>`;
    else if (line.startsWith("## ")) html += `<h4>${escapeHtml(line.slice(3))}</h4>`;
    else if (line) html += `<p>${escapeHtml(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

async function loadUpdates() {
  try {
    const data = await request("/api/updates");
    let html = renderMarkdown(data.patchNotes);
    if (data.git.available) {
      html += "<h4>Recent Git history</h4>";
      html += data.git.entries.map((entry) => `<div class="git-entry"><code>${escapeHtml(entry.hash)}</code> · ${escapeHtml(entry.date)}<p>${escapeHtml(entry.subject)}</p></div>`).join("");
    }
    html += `<p class="update-note">${escapeHtml(data.git.message)}</p>`;
    elements.updates.innerHTML = html;
  } catch (error) {
    elements.updates.innerHTML = `<p class="empty-state">Could not load update notes: ${escapeHtml(error.message)}</p>`;
  }
}

async function runAction(action) {
  actionBusy = true;
  elements.actionMessage.classList.remove("is-error");
  elements.actionMessage.textContent = `${action[0].toUpperCase()}${action.slice(1)} request sent…`;
  await refreshStatus();
  try {
    const body = await request("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Launcher-Token": sessionToken },
      body: JSON.stringify({ action }),
    });
    elements.actionMessage.textContent = body.message;
  } catch (error) {
    elements.actionMessage.textContent = error.message;
    elements.actionMessage.classList.add("is-error");
  } finally {
    actionBusy = false;
    await Promise.all([refreshStatus(), refreshLogs()]);
  }
}

elements.startButton.addEventListener("click", () => runAction("start"));
elements.stopButton.addEventListener("click", () => runAction("stop"));
elements.restartButton.addEventListener("click", () => runAction("restart"));
elements.openButton.addEventListener("click", () => window.open("http://127.0.0.1:3000", "_blank", "noopener"));
elements.clearLogsButton.addEventListener("click", () => {
  elements.logs.innerHTML = '<p class="empty-state">Log view cleared. New output will appear here.</p>';
});

async function initialize() {
  try {
    sessionToken = (await request("/api/session")).token;
    await Promise.all([refreshStatus(), refreshLogs(), loadUpdates()]);
    setInterval(refreshStatus, 1800);
    setInterval(refreshLogs, 1000);
  } catch (error) {
    elements.actionMessage.textContent = `Launcher initialization failed: ${error.message}`;
    elements.actionMessage.classList.add("is-error");
  }
}

initialize();

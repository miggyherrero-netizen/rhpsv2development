"use strict";

(() => {
  const KEY = "herrero-ai-work-v1";
  const $ = (selector) => document.querySelector(selector);
  const form = $("#trackerForm");
  const message = $("#trackerMessage");
  const statuses = ["Planned", "In progress", "Ready for review", "Merged", "Done"];
  const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  let records = [];
  let storedValue = null;
  let writable = true;
  function say(text, error = false) { message.textContent = text; message.classList.toggle("is-error", error); }
  function safeUrl(value) {
    if (!value) return "";
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Work links must use HTTPS and contain no credentials.");
    return url.href;
  }
  function validate(rows) {
    if (!Array.isArray(rows) || rows.length > 2000) throw new Error("Backup must contain at most 2,000 work entries.");
    const ids = new Set();
    return rows.map((r) => {
      if (!r || typeof r !== "object" || typeof r.id !== "string" || !r.id || r.id.length > 120 || ids.has(r.id)) throw new Error("Invalid or duplicate work ID.");
      ids.add(r.id);
      for (const [key, max] of [["agent", 120], ["title", 240], ["ownerNotes", 5000], ["url", 1000]]) {
        if (typeof r[key] !== "string" || r[key].length > max) throw new Error(`Invalid ${key}.`);
      }
      if (!r.agent.trim() || !r.title.trim() || !statuses.includes(r.status)) throw new Error("Each entry needs an agent, task and valid status.");
      if (typeof r.workDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.workDate) || !Number.isFinite(Date.parse(r.workDate)) || new Date(r.workDate).toISOString().slice(0, 10) !== r.workDate) throw new Error("Invalid work date.");
      if (r.ownerRating !== null && (!Number.isInteger(r.ownerRating) || r.ownerRating < 1 || r.ownerRating > 5)) throw new Error("Ratings must be 1–5 or unrated.");
      safeUrl(r.url);
      if (r.review != null) {
        const rev = r.review;
        if (typeof rev !== "object" || typeof rev.summary !== "string" || typeof rev.scope !== "string" || typeof rev.sha !== "string" || typeof rev.reviewedAt !== "string") throw new Error("Invalid review evidence.");
        if (!rev.scores || !["Correctness", "Safeguards", "Maintainability", "Verification"].every((k) => Number.isInteger(rev.scores[k]) && rev.scores[k] >= 1 && rev.scores[k] <= 5)) throw new Error("Invalid review scores.");
        for (const key of ["strengths", "findings", "checks", "limits"]) {
          if (!Array.isArray(rev[key]) || rev[key].length > 100 || !rev[key].every((v) => typeof v === "string" && v.length <= 10000)) throw new Error("Invalid review notes.");
        }
        if (!Array.isArray(rev.sources) || rev.sources.length > 100 || !rev.sources.every((s) => typeof s.label === "string" && typeof s.url === "string" && safeUrl(s.url))) throw new Error("Invalid review source.");
      }
      return { id: r.id, agent: r.agent, title: r.title, status: r.status, ownerNotes: r.ownerNotes, url: r.url, workDate: r.workDate, ownerRating: r.ownerRating, review: r.review ?? null };
    });
  }
  function save(next) {
    if (!writable) { say("Stored data could not be loaded. Export it before importing a valid backup to recover.", true); return false; }
    try {
      const current = localStorage.getItem(KEY);
      if (current !== storedValue) { say("Another tab changed the tracker. Reload before saving to keep its changes.", true); return false; }
      const clean = validate(next);
      const serialized = JSON.stringify({ version: 1, records: clean });
      localStorage.setItem(KEY, serialized);
      storedValue = serialized;
      records = clean;
      render();
      return true;
    } catch (error) { say(`Could not save: ${error.message} Export a backup before closing this tab.`, true); return false; }
  }
  function score(review) { return (["Correctness", "Safeguards", "Maintainability", "Verification"].reduce((n, k) => n + review.scores[k], 0) / 4).toFixed(2); }
  function list(items) { return `<ul>${items.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>`; }
  function renderReview(r) {
    if (!r.review) return '<p class="work-meta">No code review recorded yet.</p>';
    const v = r.review;
    return `<details><summary>Read code review, findings &amp; evidence</summary><p>${esc(v.summary)}</p><p class="work-meta">Reviewer: Codex · ${esc(v.reviewedAt)} · Provisional<br>Reviewed revision: <code>${esc(v.sha)}</code><br>Scope: ${esc(v.scope)}</p><p>${Object.entries(v.scores).map(([k, n]) => `${esc(k)} ${esc(n)}/5`).join(" · ")}</p><h4>What works well</h4>${list(v.strengths)}<div class="work-findings"><h4>Findings / follow-ups</h4>${list(v.findings)}</div><h4>Checks observed in this review</h4>${list(v.checks)}<h4>Not verified / limits</h4>${list(v.limits)}<h4>Source files at reviewed revision</h4><ul>${v.sources.map((s) => `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ↗</a></li>`).join("")}</ul></details>`;
  }
  function render() {
    const reviewed = records.filter((r) => r.review);
    const rated = records.filter((r) => r.ownerRating !== null);
    $("#trackerStats").innerHTML = [[records.length, "work entries"], [reviewed.length, "code / document reviews"], [rated.length ? `${(rated.reduce((n, r) => n + r.ownerRating, 0) / rated.length).toFixed(1)} / 5` : "—", "your average rating"], [records.filter((r) => ["Merged", "Done"].includes(r.status)).length, "completed / merged"]].map(([n, label]) => `<div><strong>${esc(n)}</strong><span>${esc(label)}</span></div>`).join("");
    const search = $("#trackerSearch").value.toLowerCase().trim();
    const status = $("#trackerFilter").value;
    const shown = records.filter((r) => (!status || r.status === status) && JSON.stringify(r).toLowerCase().includes(search)).sort((a, b) => b.workDate.localeCompare(a.workDate) || b.id.localeCompare(a.id));
    $("#trackerList").innerHTML = shown.length ? shown.map((r) => `<article class="work-card"><div class="work-top"><div><span class="work-status">${esc(r.status)}</span><h3>${esc(r.title)}</h3><div class="work-meta">${esc(r.agent)} · ${esc(r.workDate)}</div></div><div class="work-score">${r.review ? score(r.review) + " / 5" : "—"}<small>Codex review${r.review ? " · provisional" : " pending"}</small><small>Your rating: ${r.ownerRating === null ? "not rated" : esc(r.ownerRating) + " / 5"}</small></div></div>${r.url ? `<p><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">Open work on GitHub / source ↗</a></p>` : ""}${r.ownerNotes ? `<p class="work-note"><strong>Your notes</strong><br>${esc(r.ownerNotes)}</p>` : ""}${renderReview(r)}<div class="tracker-actions"><button class="button button-secondary" data-edit="${esc(r.id)}" type="button">Edit / rate</button><button class="text-button" data-delete="${esc(r.id)}" type="button">Remove entry</button></div></article>`).join("") : '<p class="empty-state">No matching work. Add a task or clear your filters.</p>';
  }
  function closeForm() { form.hidden = true; form.reset(); $("#trackerAdd").focus(); }
  function openForm(id = "") {
    form.reset();
    const r = records.find((v) => v.id === id);
    $("#trackerFormTitle").textContent = r ? "Edit / rate work" : "Add work";
    for (const key of ["id", "agent", "title", "status", "ownerRating", "ownerNotes", "url", "workDate"]) {
      if (r) form.elements.namedItem(key).value = r[key] ?? "";
    }
    if (!r) form.elements.namedItem("workDate").value = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    form.hidden = false;
    form.elements.namedItem("agent").focus();
  }
  $("#trackerAdd").addEventListener("click", () => openForm());
  $("#trackerCancel").addEventListener("click", closeForm);
  $("#trackerSearch").addEventListener("input", render);
  $("#trackerFilter").addEventListener("change", render);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(form));
    const existing = records.find((r) => r.id === fields.id);
    const row = { ...fields, agent: fields.agent.trim(), title: fields.title.trim(), id: fields.id || crypto.randomUUID(), ownerRating: fields.ownerRating ? Number(fields.ownerRating) : null, review: existing?.review ?? null };
    const next = existing ? records.map((r) => r.id === row.id ? row : r) : [...records, row];
    if (save(next)) { closeForm(); say("Work saved in this browser. Export a backup to keep a separate copy."); }
  });
  $("#trackerList").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.edit) openForm(button.dataset.edit);
    if (button.dataset.delete) {
      const row = records.find((r) => r.id === button.dataset.delete);
      if (row && confirm(`Remove “${row.title}” from your tracker? Export first if you want to keep a copy.`) && save(records.filter((r) => r.id !== row.id))) say("Entry removed.");
    }
  });
  $("#trackerExport").addEventListener("click", () => {
    const data = !writable && storedValue !== null ? storedValue : JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "herrero-ai-work-backup.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(writable ? "Backup download started." : "Original unreadable data exported. You can now import a valid backup.", !writable);
  });
  $("#trackerImport").addEventListener("click", () => $("#trackerImportFile").click());
  $("#trackerImportFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Maximum backup size is 5 MB.");
      const data = JSON.parse(await file.text());
      if (data.version !== 1) throw new Error("Unsupported backup version.");
      const incoming = validate(data.records);
      if (confirm(`Replace the tracker with ${incoming.length} imported entries? Export your current tracker first if needed.`)) {
        const before = writable; writable = true;
        if (save(incoming)) { closeForm(); say("Backup imported and saved in this browser."); }
        else writable = before;
      }
    } catch (error) { say(`Import stopped: ${error.message} Existing entries were kept.`, true); }
    finally { event.target.value = ""; }
  });
  window.addEventListener("storage", (event) => { if (event.key === KEY) say("Tracker changed in another tab. Reload this page before editing.", true); });
  try {
    storedValue = localStorage.getItem(KEY);
    if (storedValue === null) {
      records = validate(window.AI_WORK_SEED);
      if (save(records)) say("Five GitHub PRs loaded with provisional reviews. Your ratings are still blank.");
    } else {
      const data = JSON.parse(storedValue);
      if (data.version !== 1) throw new Error("Unsupported saved version.");
      records = validate(data.records);
    }
  } catch (error) { writable = false; say(`Saved tracker could not be loaded: ${error.message} Original data was kept. Export it, then import a valid backup.`, true); }
  render();
})();

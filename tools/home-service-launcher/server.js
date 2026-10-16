"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const HOST = "127.0.0.1";
const CONTROL_PORT = 4310;
const APP_HOST = "127.0.0.1";
const APP_PORT = 3000;
const APP_URL = `http://${APP_HOST}:${APP_PORT}`;
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const STATIC_ROOT = path.join(__dirname, "public");
const PATCH_NOTES_PATH = path.join(__dirname, "PATCH_NOTES.md");
const SESSION_TOKEN = crypto.randomBytes(24).toString("hex");
const MAX_LOG_ENTRIES = 600;

let managedProcess = null;
let managedState = "stopped";
let managedStartedAt = null;
let nextLogId = 1;
const runtimeLogs = [];

function redactLogText(value) {
  return String(value)
    .replace(
      /((?:DATABASE_URL|DIRECT_URL|PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)\s*[=:]\s*)[^\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(/:\/\/([^:\s/]+):([^@\s/]+)@/g, "://$1:[REDACTED]@")
    .replace(/\b(?:sk|pk)_[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_KEY]");
}

function addLog(level, message) {
  const text = redactLogText(message).replace(/\u001b\[[0-9;]*m/g, "").trimEnd();
  if (!text) return;

  for (const line of text.split(/\r?\n/)) {
    runtimeLogs.push({
      id: nextLogId++,
      at: new Date().toISOString(),
      level,
      message: line,
    });
  }

  if (runtimeLogs.length > MAX_LOG_ENTRIES) {
    runtimeLogs.splice(0, runtimeLogs.length - MAX_LOG_ENTRIES);
  }
}

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

function checkAppOnline() {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const request = http.get(
      {
        hostname: APP_HOST,
        port: APP_PORT,
        path: "/",
        timeout: 1200,
        headers: { Accept: "text/html" },
      },
      (response) => {
        response.resume();
        resolve({
          online: true,
          statusCode: response.statusCode || null,
          latencyMs: Date.now() - startedAt,
        });
      },
    );

    request.on("timeout", () => request.destroy());
    request.on("error", () => {
      resolve({ online: false, statusCode: null, latencyMs: null });
    });
  });
}

function isManagedProcessActive() {
  return Boolean(managedProcess && managedProcess.exitCode === null && !managedProcess.killed);
}

async function getStatus() {
  const app = await checkAppOnline();
  const managed = isManagedProcessActive();

  let state = managedState;
  if (app.online && !managed) state = "external";
  if (app.online && managed) state = "online";
  if (!app.online && managed && managedState !== "stopping") state = "starting";
  if (!app.online && !managed && !["exited", "error"].includes(managedState)) state = "offline";

  return {
    app: {
      online: app.online,
      url: APP_URL,
      statusCode: app.statusCode,
      latencyMs: app.latencyMs,
    },
    launcher: {
      state,
      managed,
      pid: managed ? managedProcess.pid : null,
      startedAt: managed ? managedStartedAt : null,
      canStart: !app.online && !managed,
      canStop: managed,
      canRestart: managed,
    },
  };
}

function nextInvocation() {
  const nextCli = path.join(PROJECT_ROOT, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextCli)) {
    throw new Error("Next.js is not installed. Run npm install in the project folder first.");
  }

  return {
    command: process.execPath,
    args: [nextCli, "dev", "-H", APP_HOST, "-p", String(APP_PORT)],
  };
}

async function startApp() {
  const status = await getStatus();
  if (status.app.online) {
    const owner = status.launcher.managed ? "this launcher" : "another terminal or shortcut";
    throw new Error(`The site is already online and was started by ${owner}.`);
  }
  if (isManagedProcessActive()) {
    throw new Error("The development server is already starting.");
  }

  if (!fs.existsSync(path.join(PROJECT_ROOT, "package.json"))) {
    throw new Error("The project package.json could not be found.");
  }

  const invocation = nextInvocation();
  addLog("system", `Starting Home Service from ${PROJECT_ROOT}`);
  managedState = "starting";
  managedStartedAt = new Date().toISOString();

  const child = spawn(invocation.command, invocation.args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, FORCE_COLOR: "0" },
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  managedProcess = child;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => addLog("info", chunk));
  child.stderr.on("data", (chunk) => addLog("error", chunk));
  child.on("error", (error) => {
    managedState = "error";
    addLog("error", `Could not start the development server: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    const expected = managedState === "stopping";
    managedState = expected ? "stopped" : code === 0 ? "exited" : "error";
    addLog(
      expected ? "system" : "error",
      expected
        ? "Home Service stopped."
        : `Development server exited (code ${code ?? "none"}, signal ${signal ?? "none"}).`,
    );
    if (managedProcess === child) managedProcess = null;
    managedStartedAt = null;
  });

  return { ok: true, message: "Home Service is starting." };
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function stopApp() {
  if (!isManagedProcessActive()) {
    const app = await checkAppOnline();
    if (app.online) {
      throw new Error("The site was started outside this launcher. Stop it from its original terminal.");
    }
    throw new Error("The site is already stopped.");
  }

  const child = managedProcess;
  managedState = "stopping";
  addLog("system", `Stopping managed process ${child.pid}...`);

  if (process.platform === "win32") {
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 8000,
    });
    if (result.error) {
      managedState = "error";
      throw new Error(`Windows could not stop the server: ${result.error.message}`);
    }
    if (result.status !== 0 && child.exitCode === null) {
      managedState = "error";
      throw new Error((result.stderr || "Windows could not stop the server.").trim());
    }
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      managedState = "error";
      throw new Error(`Could not stop the server: ${error.message}`);
    }
  }

  await waitForExit(child, 5000);
  return { ok: true, message: "Home Service stopped." };
}

async function restartApp() {
  if (!isManagedProcessActive()) {
    const app = await checkAppOnline();
    if (app.online) {
      throw new Error("The site was started outside this launcher and cannot be restarted here.");
    }
    return startApp();
  }

  await stopApp();
  await new Promise((resolve) => setTimeout(resolve, 500));
  return startApp();
}

function readPatchNotes() {
  try {
    return fs.readFileSync(PATCH_NOTES_PATH, "utf8").trim();
  } catch {
    return "# Patch & update log\n\nNo local patch notes are available yet.";
  }
}

function readGitHistory() {
  const result = spawnSync(
    "git",
    ["-C", PROJECT_ROOT, "log", "-8", "--date=short", "--pretty=format:%h|%ad|%s"],
    { encoding: "utf8", windowsHide: true, timeout: 2500 },
  );

  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    return {
      available: false,
      message: "Git history is not available for this project folder. Showing the local patch log instead.",
      entries: [],
    };
  }

  return {
    available: true,
    message: "Recent entries from the local Git history.",
    entries: result.stdout.trim().split(/\r?\n/).map((line) => {
      const [hash, date, ...subject] = line.split("|");
      return { hash, date, subject: subject.join("|") };
    }),
  };
}

function isAllowedHost(req) {
  const host = (req.headers.host || "").toLowerCase();
  return host === `${HOST}:${CONTROL_PORT}` || host === `localhost:${CONTROL_PORT}`;
}

function isAllowedMutation(req) {
  const origin = req.headers.origin;
  const validOrigin = !origin || origin === `http://${HOST}:${CONTROL_PORT}` || origin === `http://localhost:${CONTROL_PORT}`;
  return validOrigin && req.headers["x-launcher-token"] === SESSION_TOKEN;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : new URL(req.url, `http://${HOST}`).pathname;
  const decoded = decodeURIComponent(requestPath);
  const candidate = path.resolve(STATIC_ROOT, `.${decoded}`);
  if (candidate !== STATIC_ROOT && !candidate.startsWith(`${STATIC_ROOT}${path.sep}`)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  const extension = path.extname(candidate).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
  };

  fs.readFile(candidate, (error, content) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(error.code === "ENOENT" ? "Not found" : "Could not read the file");
    }
    res.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  if (!isAllowedHost(req)) {
    return json(res, 403, { ok: false, error: "This launcher accepts localhost requests only." });
  }

  const url = new URL(req.url, `http://${HOST}:${CONTROL_PORT}`);

  if (req.method === "GET" && url.pathname === "/api/session") {
    return json(res, 200, { token: SESSION_TOKEN });
  }
  if (req.method === "GET" && (url.pathname === "/api/status" || url.pathname === "/api/health")) {
    return json(res, 200, await getStatus());
  }
  if (req.method === "GET" && url.pathname === "/api/logs") {
    const after = Number.parseInt(url.searchParams.get("after") || "0", 10);
    const safeAfter = Number.isFinite(after) && after >= 0 ? after : 0;
    return json(res, 200, { entries: runtimeLogs.filter((entry) => entry.id > safeAfter) });
  }
  if (req.method === "GET" && url.pathname === "/api/updates") {
    return json(res, 200, { patchNotes: readPatchNotes(), git: readGitHistory() });
  }
  if (req.method === "POST" && url.pathname === "/api/action") {
    if (!isAllowedMutation(req)) {
      return json(res, 403, { ok: false, error: "Invalid local launcher session." });
    }

    try {
      const body = await readJsonBody(req);
      const actions = { start: startApp, stop: stopApp, restart: restartApp };
      if (typeof body.action !== "string" || !Object.hasOwn(actions, body.action)) {
        return json(res, 400, { ok: false, error: "Unknown launcher action." });
      }
      return json(res, 200, await actions[body.action]());
    } catch (error) {
      addLog("error", error.message);
      return json(res, 409, { ok: false, error: error.message });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(res, 405, { ok: false, error: "Method not allowed." });
  }
  return serveStatic(req, res);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Home Service Launcher is already running at http://${HOST}:${CONTROL_PORT}`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});

server.listen(CONTROL_PORT, HOST, () => {
  addLog("system", `Launcher ready at http://${HOST}:${CONTROL_PORT}`);
  addLog("system", "Use Start to run the Home Service development server.");
  console.log(`Home Service Launcher: http://${HOST}:${CONTROL_PORT}`);
});

function shutdown() {
  server.close();
  if (isManagedProcessActive()) {
    addLog("system", "Launcher is closing; the managed development server will be stopped.");
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(managedProcess.pid), "/T", "/F"], { windowsHide: true });
    } else {
      try { process.kill(-managedProcess.pid, "SIGTERM"); } catch { /* already stopped */ }
    }
  }
}

process.on("SIGINT", () => { shutdown(); process.exit(0); });
process.on("SIGTERM", () => { shutdown(); process.exit(0); });

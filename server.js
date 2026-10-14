import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
loadEnv(join(root, ".env"));

const redmineUrl = (process.env.REDMINE_URL || "").replace(/\/$/, "");
const apiKey = process.env.REDMINE_API_KEY || "";
const projectId = process.env.REDMINE_PROJECT || "devops2026";
const port = Number(process.env.PORT || 3780);
const maxIssues = 300;

if (!redmineUrl || !apiKey) {
  console.error("Falta REDMINE_URL o REDMINE_API_KEY. Copiá .env.example a .env.");
  process.exit(1);
}

const files = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === "GET" && url.pathname === "/api/board") {
      const scope = url.searchParams.get("scope") === "all" ? "all" : "open";
      const board = await loadBoard(scope);
      return sendJson(res, 200, board);
    }
    const priorityMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/priority$/);
    if (req.method === "PUT" && priorityMatch) {
      const body = await readJson(req);
      const priorityId = Number(body.priority_id);
      if (!Number.isInteger(priorityId)) {
        return sendJson(res, 400, { error: "priority_id inválido." });
      }
      const priorities = await loadPriorities();
      if (!priorities.some((priority) => priority.id === priorityId)) {
        return sendJson(res, 400, { error: "Esa prioridad no existe en Redmine." });
      }
      const current = await redmine(`/issues/${priorityMatch[1]}.json`);
      const issueProject = current.issue?.project;
      if (issueProject?.identifier !== projectId && String(issueProject?.id) !== projectId) {
        return sendJson(res, 403, { error: "Esa petición no pertenece al canal DevOps." });
      }
      await redmine(`/issues/${priorityMatch[1]}.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue: { priority_id: priorityId } }),
      });
      return sendJson(res, 200, { ok: true, id: Number(priorityMatch[1]), priority_id: priorityId });
    }
    const asset = files[url.pathname];
    if (req.method === "GET" && asset) {
      const filePath = resolve(root, "public", asset.file);
      res.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "no-store" });
      res.end(readFileSync(filePath));
      return;
    }
    sendJson(res, 404, { error: "No encontrado." });
  } catch (error) {
    const status = error.status || 502;
    sendJson(res, status, { error: error.message || "Error inesperado." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Tablero en http://127.0.0.1:${port}`);
});

async function loadBoard(scope) {
  const [user, project, priorities, issues] = await Promise.all([
    redmine("/users/current.json").then((data) => publicUser(data.user)),
    redmine(`/projects/${encodeURIComponent(projectId)}.json`).then((data) => ({
      id: data.project.id,
      name: data.project.name,
      identifier: data.project.identifier,
    })),
    loadPriorities(),
    loadIssues(scope),
  ]);
  return {
    user,
    project,
    redmine_url: redmineUrl,
    scope,
    priorities,
    issues,
  };
}

async function loadPriorities() {
  const data = await redmine("/enumerations/issue_priorities.json");
  const list = (data.issue_priorities || []).filter((priority) => priority.active !== false);
  return list.reverse().map((priority) => ({
    id: priority.id,
    name: priority.name,
    is_default: Boolean(priority.is_default),
  }));
}

async function loadIssues(scope) {
  const issues = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total && issues.length < maxIssues) {
    const params = new URLSearchParams({
      project_id: projectId,
      status_id: scope === "all" ? "*" : "open",
      limit: "100",
      offset: String(offset),
      sort: "updated_on:desc",
    });
    const page = await redmine(`/issues.json?${params}`);
    total = page.total_count ?? 0;
    issues.push(...(page.issues || []).map(publicIssue));
    if (!(page.issues || []).length) break;
    offset += page.issues.length;
  }
  return issues;
}

function publicUser(user) {
  return {
    id: user.id,
    login: user.login,
    name: [user.firstname, user.lastname].filter(Boolean).join(" "),
  };
}

function publicIssue(issue) {
  return {
    id: issue.id,
    subject: issue.subject,
    status: issue.status?.name ?? "",
    priority_id: issue.priority?.id ?? null,
    priority: issue.priority?.name ?? "",
    tracker: issue.tracker?.name ?? "",
    assignee: issue.assigned_to?.name ?? "Sin asignar",
    updated_on: issue.updated_on,
    due_date: issue.due_date,
    done_ratio: issue.done_ratio ?? 0,
  };
}

async function redmine(path, options = {}) {
  let response;
  try {
    response = await fetch(`${redmineUrl}${path}`, {
      ...options,
      headers: {
        "X-Redmine-API-Key": apiKey,
        Accept: "application/json",
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    const wrapped = new Error("No se pudo conectar con Redmine. Si estás fuera de la red, conectate a la VPN.");
    wrapped.status = 502;
    throw wrapped;
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const detail = Array.isArray(body?.errors) ? body.errors.join(", ") : "";
    const wrapped = new Error(messageForStatus(response.status, detail));
    wrapped.status = response.status === 401 || response.status === 403 ? response.status : 502;
    throw wrapped;
  }
  return body;
}

function messageForStatus(status, detail) {
  if (status === 401) return "Redmine rechazó la API key.";
  if (status === 403) return "No tenés permiso para ver o cambiar esa petición.";
  if (status === 404) return "Redmine no encontró el proyecto o la petición.";
  if (status === 422) return detail || "Redmine no aceptó el cambio de prioridad.";
  return detail || `Redmine respondió ${status}.`;
}

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

function readJson(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("JSON inválido."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

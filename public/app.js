const boardEl = document.querySelector("#board");
const whoEl = document.querySelector("#who");
const bannerEl = document.querySelector("#banner");
const searchEl = document.querySelector("#search");

let board = null;
let scope = "open";
let query = "";
let savingId = null;

document.querySelector("#reload").addEventListener("click", () => load());
document.querySelector("#scope-open").addEventListener("click", () => setScope("open"));
document.querySelector("#scope-all").addEventListener("click", () => setScope("all"));
searchEl.addEventListener("input", () => {
  query = searchEl.value;
  render();
});

load();

async function load() {
  banner(false);
  whoEl.textContent = "Cargando peticiones…";
  try {
    const response = await fetch(`/api/board?scope=${scope}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo cargar el tablero.");
    board = data;
    render();
  } catch (error) {
    board = null;
    boardEl.innerHTML = "";
    whoEl.textContent = "Sin conexión con Redmine";
    banner(error.message);
  }
}

function setScope(next) {
  scope = next;
  document.querySelector("#scope-open").classList.toggle("on", scope === "open");
  document.querySelector("#scope-all").classList.toggle("on", scope === "all");
  document.querySelector("#scope-open").setAttribute("aria-pressed", String(scope === "open"));
  document.querySelector("#scope-all").setAttribute("aria-pressed", String(scope === "all"));
  load();
}

function render() {
  if (!board) return;
  const visible = board.issues.filter(matches);
  const label = scope === "open" ? "abiertas" : "en total";
  whoEl.textContent = `${board.user.name} · ${board.project.name} · ${board.issues.length} ${label}${
    query.trim() ? ` · mostrando ${visible.length}` : ""
  }`;
  boardEl.innerHTML = board.priorities
    .map((priority) => columnHtml(priority, visible.filter((issue) => issue.priority_id === priority.id)))
    .join("");
  bindBoard();
}

function columnHtml(priority, issues) {
  const cards = issues.length
    ? issues.map(cardHtml).join("")
    : `<p class="empty">Ninguna petición${query.trim() ? " coincide" : ""}.</p>`;
  return `<section class="column" data-priority-id="${priority.id}" data-name="${esc(priority.name)}">
    <header><h2>${esc(priority.name)}</h2><span class="count">${issues.length}</span></header>
    ${cards}
  </section>`;
}

function cardHtml(issue) {
  const index = board.priorities.findIndex((priority) => priority.id === issue.priority_id);
  const higher = board.priorities[index - 1];
  const lower = board.priorities[index + 1];
  const when = formatDate(issue.updated_on);
  const due = issue.due_date ? ` · vence ${issue.due_date}` : "";
  const buttons = [
    higher ? `<button type="button" data-priority="${higher.id}">Subir a ${esc(higher.name)}</button>` : "",
    lower ? `<button type="button" data-priority="${lower.id}">Bajar a ${esc(lower.name)}</button>` : "",
  ].join("");
  return `<article class="card${savingId === issue.id ? " saving" : ""}" draggable="true" data-id="${issue.id}">
    <header>
      <a class="id" href="${esc(board.redmine_url)}/issues/${issue.id}" target="_blank" rel="noreferrer">#${issue.id}</a>
      <span class="tracker">${esc(issue.tracker)}</span>
    </header>
    <h3>${esc(issue.subject)}</h3>
    <p class="meta">${esc(issue.assignee)} · ${esc(issue.status)} · ${esc(when)}${esc(due)}</p>
    <div class="actions">${buttons}</div>
  </article>`;
}

function bindBoard() {
  for (const card of boardEl.querySelectorAll(".card")) {
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", card.dataset.id);
      event.dataTransfer.effectAllowed = "move";
    });
    for (const button of card.querySelectorAll("button")) {
      button.addEventListener("click", () => changePriority(Number(card.dataset.id), Number(button.dataset.priority)));
    }
  }
  for (const column of boardEl.querySelectorAll(".column")) {
    column.addEventListener("dragover", (event) => {
      event.preventDefault();
      column.classList.add("over");
    });
    column.addEventListener("dragleave", () => column.classList.remove("over"));
    column.addEventListener("drop", (event) => {
      event.preventDefault();
      column.classList.remove("over");
      const id = Number(event.dataTransfer.getData("text/plain"));
      changePriority(id, Number(column.dataset.priorityId));
    });
  }
}

async function changePriority(id, priorityId) {
  const issue = board?.issues.find((item) => item.id === id);
  if (!issue || issue.priority_id === priorityId || savingId) return;
  const priority = board.priorities.find((item) => item.id === priorityId);
  savingId = id;
  render();
  try {
    const response = await fetch(`/api/issues/${id}/priority`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority_id: priorityId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo guardar la prioridad.");
    issue.priority_id = priorityId;
    issue.priority = priority?.name || issue.priority;
    banner(false);
  } catch (error) {
    banner(error.message);
  } finally {
    savingId = null;
    render();
  }
}

function matches(issue) {
  const needle = norm(query.trim());
  if (!needle) return true;
  return norm(`${issue.id} ${issue.subject} ${issue.assignee} ${issue.status} ${issue.tracker}`).includes(needle);
}

function banner(message) {
  if (!message) {
    bannerEl.hidden = true;
    bannerEl.textContent = "";
    return;
  }
  bannerEl.hidden = false;
  bannerEl.textContent = message;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function norm(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

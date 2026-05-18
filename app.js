const STORAGE_KEY = "freezerSpaceManager-v1";
const API_URL = "/api/data";
const FIREBASE_SDK_VERSION = "12.7.0";
const FIREBASE_COLLECTION = "sistemas";
const FIREBASE_DOC_ID = "gestao-freezers";

const plans = {
  quarter: { label: "1/4", temperature: "Refrigerado/Congelado", defaultFee: 890, defaultCm: 35, defaultShelves: 2 },
  half: { label: "1/2", temperature: "Refrigerado/Congelado", defaultFee: 1290, defaultCm: 70, defaultShelves: 4 },
  threeQuarter: { label: "3/4", temperature: "Refrigerado/Congelado", defaultFee: 1690, defaultCm: 105, defaultShelves: 5 },
  full: { label: "1", temperature: "Refrigerado/Congelado", defaultFee: 1890, defaultCm: 140, defaultShelves: 6 }
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

const state = {
  data: { rooms: [], freezers: [], contracts: [] },
  filters: {
    roomId: "all"
  },
  sharedMode: false,
  sharedProvider: "local"
};

let firebaseStore = null;
let unsubscribeFirebase = null;

const elements = {
  metricRevenue: document.querySelector("#metric-revenue"),
  metricActiveContracts: document.querySelector("#metric-active-contracts"),
  metricCost: document.querySelector("#metric-cost"),
  metricFreezers: document.querySelector("#metric-freezers"),
  metricProfit: document.querySelector("#metric-profit"),
  metricMargin: document.querySelector("#metric-margin"),
  metricOccupancy: document.querySelector("#metric-occupancy"),
  metricAvailable: document.querySelector("#metric-available"),
  roomForm: document.querySelector("#room-form"),
  freezerForm: document.querySelector("#freezer-form"),
  contractForm: document.querySelector("#contract-form"),
  roomFilter: document.querySelector("#room-filter"),
  freezerList: document.querySelector("#freezer-list"),
  financeTable: document.querySelector("#finance-table"),
  contractList: document.querySelector("#contract-list"),
  loadDemo: document.querySelector("#load-demo"),
  exportData: document.querySelector("#export-data"),
  importData: document.querySelector("#import-data"),
  emptyTemplate: document.querySelector("#empty-template")
};

initialize();

async function initialize() {
  state.data = await loadData();
  registerEvents();
  setDefaultContractDate();
  render();
}

function registerEvents() {
  elements.roomForm.addEventListener("submit", handleRoomSubmit);
  elements.freezerForm.addEventListener("submit", handleFreezerSubmit);
  elements.contractForm.addEventListener("submit", handleContractSubmit);
  elements.roomFilter.addEventListener("change", () => {
    state.filters.roomId = elements.roomFilter.value;
    renderLists();
  });
  elements.contractForm.elements.namedItem("planKey").addEventListener("change", applyPlanDefaults);
  elements.loadDemo.addEventListener("click", loadDemoData);
  elements.exportData.addEventListener("click", exportData);
  elements.importData.addEventListener("change", importData);

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    const { action, id } = button.dataset;
    if (action === "edit-room") editRoom(id);
    if (action === "edit-freezer") editFreezer(id);
    if (action === "edit-contract") editContract(id);
    if (action === "delete-room") deleteRoom(id);
    if (action === "delete-freezer") deleteFreezer(id);
    if (action === "delete-contract") deleteContract(id);
  });
}

async function handleRoomSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.namedItem("id").value || createId();
  const room = {
    id,
    name: getFormValue(form, "name"),
    notes: getFormValue(form, "notes")
  };

  upsert(state.data.rooms, room);
  await persistData();
  form.reset();
  render();
}

async function handleFreezerSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.namedItem("id").value || createId();
  const freezer = {
    id,
    roomId: getFormValue(form, "roomId"),
    name: getFormValue(form, "name"),
    temperatureType: getFormValue(form, "temperatureType"),
    capacityCm: getNumber(form, "capacityCm"),
    shelves: getNumber(form, "shelves"),
    monthlyCost: getNumber(form, "monthlyCost")
  };

  upsert(state.data.freezers, freezer);
  await persistData();
  form.reset();
  form.elements.namedItem("capacityCm").value = 140;
  form.elements.namedItem("shelves").value = 6;
  render();
}

async function handleContractSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.namedItem("id").value || createId();
  const contract = {
    id,
    clientName: getFormValue(form, "clientName"),
    freezerId: getFormValue(form, "freezerId"),
    planKey: getFormValue(form, "planKey"),
    occupiedCm: getNumber(form, "occupiedCm"),
    shelvesUsed: getNumber(form, "shelvesUsed"),
    monthlyFee: getNumber(form, "monthlyFee"),
    startDate: getFormValue(form, "startDate"),
    status: getFormValue(form, "status")
  };

  const freezer = state.data.freezers.find((item) => item.id === contract.freezerId);
  const usedWithoutCurrent = getFreezerContracts(contract.freezerId)
    .filter((item) => item.id !== id && item.status === "active")
    .reduce((sum, item) => sum + item.occupiedCm, 0);

  if (freezer && contract.status === "active" && usedWithoutCurrent + contract.occupiedCm > freezer.capacityCm) {
    const available = Math.max(0, freezer.capacityCm - usedWithoutCurrent);
    window.alert(`Espaco insuficiente neste freezer. Disponivel: ${available} cm.`);
    return;
  }

  upsert(state.data.contracts, contract);
  await persistData();
  form.reset();
  setDefaultContractDate();
  render();
}

function render() {
  ensureStarterState();
  populateSelects();
  renderMetrics();
  renderLists();
}

function ensureStarterState() {
  if (!state.data.rooms.length) {
    state.data.rooms.push({ id: createId(), name: "Sala principal", notes: "Cadastro inicial" });
    persistData();
  }
}

function populateSelects() {
  const roomOptions = state.data.rooms.map((room) => `<option value="${room.id}">${escapeHtml(room.name)}</option>`).join("");
  elements.freezerForm.elements.namedItem("roomId").innerHTML = roomOptions;
  elements.roomFilter.innerHTML = `<option value="all">Todas as salas</option>${roomOptions}`;
  elements.roomFilter.value = state.data.rooms.some((room) => room.id === state.filters.roomId) ? state.filters.roomId : "all";
  state.filters.roomId = elements.roomFilter.value;

  const freezerOptions = state.data.freezers.map((freezer) => {
    const room = getRoom(freezer.roomId);
    return `<option value="${freezer.id}">${escapeHtml(freezer.name)} - ${escapeHtml(room?.name || "Sem sala")}</option>`;
  }).join("");
  elements.contractForm.elements.namedItem("freezerId").innerHTML = freezerOptions;

  elements.contractForm.elements.namedItem("planKey").innerHTML = Object.entries(plans).map(([key, plan]) => {
    return `<option value="${key}">${plan.label} - ${formatCurrency(plan.defaultFee)}</option>`;
  }).join("");

  if (!elements.contractForm.elements.namedItem("occupiedCm").value) {
    applyPlanDefaults();
  }
}

function renderMetrics() {
  const activeContracts = state.data.contracts.filter((contract) => contract.status === "active");
  const revenue = activeContracts.reduce((sum, contract) => sum + contract.monthlyFee, 0);
  const cost = state.data.freezers.reduce((sum, freezer) => sum + freezer.monthlyCost, 0);
  const totalCapacity = state.data.freezers.reduce((sum, freezer) => sum + freezer.capacityCm, 0);
  const occupied = activeContracts.reduce((sum, contract) => sum + contract.occupiedCm, 0);
  const available = Math.max(0, totalCapacity - occupied);
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const occupancy = totalCapacity > 0 ? (occupied / totalCapacity) * 100 : 0;

  elements.metricRevenue.textContent = formatCurrency(revenue);
  elements.metricActiveContracts.textContent = `${activeContracts.length} contrato(s) ativo(s)`;
  elements.metricCost.textContent = formatCurrency(cost);
  elements.metricFreezers.textContent = `${state.data.freezers.length} freezer(s) cadastrado(s)`;
  elements.metricProfit.textContent = formatCurrency(profit);
  elements.metricMargin.textContent = `Margem ${margin.toFixed(1)}%`;
  elements.metricOccupancy.textContent = `${occupancy.toFixed(1)}%`;
  elements.metricAvailable.textContent = `${available} cm disponiveis`;
}

function renderLists() {
  renderFreezers();
  renderFinanceTable();
  renderContracts();
}

function renderFreezers() {
  const freezers = getFilteredFreezers();
  if (!freezers.length) {
    showEmpty(elements.freezerList);
    return;
  }

  elements.freezerList.innerHTML = freezers.map((freezer) => {
    const stats = getFreezerStats(freezer);
    const statusClass = stats.occupancy >= 100 ? "full" : stats.occupancy >= 85 ? "warning" : "";
    const pillClass = stats.occupancy >= 100 ? "bad" : stats.occupancy >= 85 ? "warn" : "ok";
    const clients = getFreezerContracts(freezer.id).filter((contract) => contract.status === "active");
    const room = getRoom(freezer.roomId);

    return `
      <article class="freezer-card ${statusClass}">
        <div class="freezer-head">
          <div>
            <h3>${escapeHtml(freezer.name)}</h3>
            <span class="muted">${escapeHtml(room?.name || "Sem sala")} - ${escapeHtml(freezer.temperatureType)}</span>
          </div>
          <span class="status-pill ${pillClass}">${stats.availableCm} cm livres</span>
        </div>
        <div class="capacity-bar" title="${stats.occupiedCm} cm ocupados de ${freezer.capacityCm} cm">
          <div style="width:${Math.min(100, stats.occupancy)}%"></div>
        </div>
        <div class="freezer-stats">
          <div class="stat-box"><span>Ocupacao</span><strong>${stats.occupancy.toFixed(1)}%</strong></div>
          <div class="stat-box"><span>Receita</span><strong>${formatCurrency(stats.revenue)}</strong></div>
          <div class="stat-box"><span>Resultado</span><strong>${formatCurrency(stats.profit)}</strong></div>
        </div>
        <div class="mini-list">
          ${clients.length ? clients.map((contract) => `
            <div class="mini-client">
              <div>
                <strong>${escapeHtml(contract.clientName)}</strong>
                <span>${getPlanLabel(contract.planKey)} - ${contract.occupiedCm} cm - ${formatCurrency(contract.monthlyFee)}</span>
              </div>
              <button class="button secondary" type="button" data-action="edit-contract" data-id="${contract.id}">Mover</button>
            </div>
          `).join("") : `<span class="muted">Sem clientes ativos neste freezer.</span>`}
        </div>
        <div class="row-actions">
          <button class="button secondary" type="button" data-action="edit-freezer" data-id="${freezer.id}">Editar</button>
          <button class="button danger" type="button" data-action="delete-freezer" data-id="${freezer.id}">Remover</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderFinanceTable() {
  const freezers = getFilteredFreezers();
  if (!freezers.length) {
    showEmpty(elements.financeTable);
    return;
  }

  elements.financeTable.innerHTML = freezers.map((freezer) => {
    const stats = getFreezerStats(freezer);
    const revenuePerCm = stats.occupiedCm > 0 ? stats.revenue / stats.occupiedCm : 0;
    const margin = stats.revenue > 0 ? (stats.profit / stats.revenue) * 100 : 0;

    return `
      <article class="table-row">
        <div><strong>${escapeHtml(freezer.name)}</strong><span>${escapeHtml(getRoom(freezer.roomId)?.name || "Sem sala")}</span></div>
        <div><strong>${formatCurrency(stats.revenue)}</strong><span>Faturamento</span></div>
        <div><strong>${formatCurrency(freezer.monthlyCost)}</strong><span>Custo</span></div>
        <div><strong>${formatCurrency(stats.profit)}</strong><span>Resultado</span></div>
        <div><strong>${margin.toFixed(1)}%</strong><span>Margem</span></div>
        <div><strong>${formatCurrency(revenuePerCm)}</strong><span>Receita/cm</span></div>
        <div class="row-actions">
          <button class="button secondary" type="button" data-action="edit-freezer" data-id="${freezer.id}">Editar</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderContracts() {
  if (!state.data.contracts.length) {
    showEmpty(elements.contractList);
    return;
  }

  elements.contractList.innerHTML = state.data.contracts.map((contract) => {
    const freezer = state.data.freezers.find((item) => item.id === contract.freezerId);
    const room = freezer ? getRoom(freezer.roomId) : null;

    return `
      <article class="table-row contract-row">
        <div><strong>${escapeHtml(contract.clientName)}</strong><span>${contract.status === "active" ? "Ativo" : "Pausado"} desde ${formatDate(contract.startDate)}</span></div>
        <div><strong>${getPlanLabel(contract.planKey)}</strong><span>Plano</span></div>
        <div><strong>${contract.occupiedCm} cm</strong><span>${contract.shelvesUsed} prateleira(s)</span></div>
        <div><strong>${formatCurrency(contract.monthlyFee)}</strong><span>Mensalidade</span></div>
        <div><strong>${escapeHtml(freezer?.name || "Sem freezer")}</strong><span>${escapeHtml(room?.name || "Sem sala")}</span></div>
        <div class="row-actions">
          <button class="button secondary" type="button" data-action="edit-contract" data-id="${contract.id}">Editar/mover</button>
          <button class="button danger" type="button" data-action="delete-contract" data-id="${contract.id}">Remover</button>
        </div>
      </article>
    `;
  }).join("");
}

function editRoom(id) {
  const room = state.data.rooms.find((item) => item.id === id);
  if (!room) return;
  setFormValues(elements.roomForm, room);
  elements.roomForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editFreezer(id) {
  const freezer = state.data.freezers.find((item) => item.id === id);
  if (!freezer) return;
  setFormValues(elements.freezerForm, freezer);
  elements.freezerForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editContract(id) {
  const contract = state.data.contracts.find((item) => item.id === id);
  if (!contract) return;
  setFormValues(elements.contractForm, contract);
  elements.contractForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteRoom(id) {
  const hasFreezer = state.data.freezers.some((freezer) => freezer.roomId === id);
  if (hasFreezer) {
    window.alert("Remova ou mova os freezers desta sala antes de excluir.");
    return;
  }
  state.data.rooms = state.data.rooms.filter((room) => room.id !== id);
  await persistData();
  render();
}

async function deleteFreezer(id) {
  const hasContracts = state.data.contracts.some((contract) => contract.freezerId === id);
  if (hasContracts) {
    window.alert("Remova ou mova os clientes deste freezer antes de excluir.");
    return;
  }
  state.data.freezers = state.data.freezers.filter((freezer) => freezer.id !== id);
  await persistData();
  render();
}

async function deleteContract(id) {
  state.data.contracts = state.data.contracts.filter((contract) => contract.id !== id);
  await persistData();
  render();
}

function applyPlanDefaults() {
  const plan = plans[elements.contractForm.elements.namedItem("planKey").value] || plans.quarter;
  const form = elements.contractForm;
  form.elements.namedItem("occupiedCm").value = plan.defaultCm;
  form.elements.namedItem("shelvesUsed").value = plan.defaultShelves;
  form.elements.namedItem("monthlyFee").value = plan.defaultFee;
}

function getFreezerStats(freezer) {
  const activeContracts = getFreezerContracts(freezer.id).filter((contract) => contract.status === "active");
  const occupiedCm = activeContracts.reduce((sum, contract) => sum + contract.occupiedCm, 0);
  const shelvesUsed = activeContracts.reduce((sum, contract) => sum + contract.shelvesUsed, 0);
  const revenue = activeContracts.reduce((sum, contract) => sum + contract.monthlyFee, 0);
  const availableCm = Math.max(0, freezer.capacityCm - occupiedCm);
  const occupancy = freezer.capacityCm > 0 ? (occupiedCm / freezer.capacityCm) * 100 : 0;

  return {
    occupiedCm,
    shelvesUsed,
    revenue,
    availableCm,
    occupancy,
    profit: revenue - freezer.monthlyCost
  };
}

function getFilteredFreezers() {
  return state.data.freezers.filter((freezer) => state.filters.roomId === "all" || freezer.roomId === state.filters.roomId);
}

function getFreezerContracts(freezerId) {
  return state.data.contracts.filter((contract) => contract.freezerId === freezerId);
}

function getRoom(roomId) {
  return state.data.rooms.find((room) => room.id === roomId);
}

function getPlanLabel(planKey) {
  return plans[planKey]?.label || planKey;
}

function setDefaultContractDate() {
  elements.contractForm.elements.namedItem("startDate").value = formatDateInput(new Date());
}

async function loadDemoData() {
  const roomA = createId();
  const roomB = createId();
  const freezerA = createId();
  const freezerB = createId();
  const freezerC = createId();

  state.data = {
    rooms: [
      { id: roomA, name: "Sala fria 01", notes: "Operacao congelada" },
      { id: roomB, name: "Sala refrigerada 02", notes: "Produtos resfriados" }
    ],
    freezers: [
      { id: freezerA, roomId: roomA, name: "FZ-01", temperatureType: "Congelado", capacityCm: 140, shelves: 6, monthlyCost: 760 },
      { id: freezerB, roomId: roomA, name: "FZ-02", temperatureType: "Congelado", capacityCm: 140, shelves: 6, monthlyCost: 820 },
      { id: freezerC, roomId: roomB, name: "RF-01", temperatureType: "Refrigerado", capacityCm: 140, shelves: 6, monthlyCost: 690 }
    ],
    contracts: [
      createContract("Acai Norte", freezerA, "half", -110),
      createContract("Doces Bela Vista", freezerA, "quarter", -54),
      createContract("Carnes Premium", freezerB, "threeQuarter", -32),
      createContract("Emporio Verde", freezerC, "quarter", -18),
      createContract("Massas da Casa", freezerC, "half", -8)
    ]
  };

  await persistData();
  render();
}

function createContract(clientName, freezerId, planKey, startOffsetDays) {
  const plan = plans[planKey];
  const date = new Date();
  date.setDate(date.getDate() + startOffsetDays);
  return {
    id: createId(),
    clientName,
    freezerId,
    planKey,
    occupiedCm: plan.defaultCm,
    shelvesUsed: plan.defaultShelves,
    monthlyFee: plan.defaultFee,
    startDate: formatDateInput(date),
    status: "active"
  };
}

function exportData() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "gestao-freezers-dados.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      state.data = sanitizeData(JSON.parse(String(reader.result)));
      persistData();
      render();
    } catch (error) {
      window.alert("Nao foi possivel importar o JSON.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

async function loadData() {
  const localData = loadLocalData();

  try {
    const firebaseData = await loadFirebaseData(localData);
    if (firebaseData) {
      state.sharedMode = true;
      state.sharedProvider = "firebase";
      return firebaseData;
    }
  } catch (error) {
    console.warn("Firebase indisponivel.", error);
  }

  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("API indisponivel.");
    const serverData = sanitizeData(await response.json());
    state.sharedMode = true;
    state.sharedProvider = "server";

    const serverIsEmpty = !serverData.rooms.length && !serverData.freezers.length && !serverData.contracts.length;
    const localHasData = localData.rooms.length || localData.freezers.length || localData.contracts.length;
    if (serverIsEmpty && localHasData) {
      await saveServerData(localData);
      return localData;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(serverData));
    return serverData;
  } catch (error) {
    state.sharedMode = false;
    state.sharedProvider = "local";
    window.alert("Nao foi possivel conectar ao armazenamento compartilhado. Os dados serao salvos apenas neste navegador enquanto o servidor estiver indisponivel.");
    return localData;
  }
}

function loadLocalData() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitizeData(JSON.parse(stored)) : { rooms: [], freezers: [], contracts: [] };
  } catch (error) {
    return { rooms: [], freezers: [], contracts: [] };
  }
}

function sanitizeData(data) {
  return {
    rooms: Array.isArray(data.rooms) ? data.rooms : [],
    freezers: Array.isArray(data.freezers) ? data.freezers : [],
    contracts: Array.isArray(data.contracts) ? data.contracts : []
  };
}

async function persistData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  if (state.sharedMode) {
    try {
      if (state.sharedProvider === "firebase") {
        await saveFirebaseData(state.data);
      } else {
        await saveServerData(state.data);
      }
    } catch (error) {
      window.alert("Nao foi possivel salvar no armazenamento compartilhado. Verifique a conexao e tente novamente.");
      throw error;
    }
  }
}

async function loadFirebaseData(localData) {
  if (!hasFirebaseConfig()) {
    return null;
  }

  const [{ initializeApp }, firestore] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`)
  ]);

  const app = initializeApp(window.FIREBASE_CONFIG);
  const db = firestore.getFirestore(app);
  const docRef = firestore.doc(db, FIREBASE_COLLECTION, FIREBASE_DOC_ID);
  firebaseStore = { firestore, docRef };

  const snapshot = await firestore.getDoc(docRef);
  if (snapshot.exists()) {
    const data = sanitizeData(snapshot.data());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    subscribeFirebaseUpdates();
    return data;
  }

  const seedData = await loadSeedData(localData);
  await firestore.setDoc(docRef, seedData);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seedData));
  subscribeFirebaseUpdates();
  return seedData;
}

function subscribeFirebaseUpdates() {
  if (!firebaseStore || unsubscribeFirebase) {
    return;
  }

  unsubscribeFirebase = firebaseStore.firestore.onSnapshot(firebaseStore.docRef, (snapshot) => {
    if (!snapshot.exists()) {
      return;
    }

    state.data = sanitizeData(snapshot.data());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    render();
  });
}

async function saveFirebaseData(data) {
  if (!firebaseStore) {
    throw new Error("Firebase nao inicializado.");
  }
  await firebaseStore.firestore.setDoc(firebaseStore.docRef, sanitizeData(data));
}

async function loadSeedData(localData) {
  const localHasData = localData.rooms.length || localData.freezers.length || localData.contracts.length;
  if (localHasData) {
    return localData;
  }

  try {
    const response = await fetch("./data.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Seed indisponivel.");
    return sanitizeData(await response.json());
  } catch (error) {
    return { rooms: [], freezers: [], contracts: [] };
  }
}

function hasFirebaseConfig() {
  const config = window.FIREBASE_CONFIG || {};
  return Boolean(
    config.apiKey &&
    config.projectId &&
    !String(config.apiKey).includes("COLE_AQUI") &&
    !String(config.projectId).includes("COLE_AQUI")
  );
}

async function saveServerData(data) {
  const response = await fetch(API_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sanitizeData(data))
  });
  if (!response.ok) {
    throw new Error("Nao foi possivel salvar no servidor.");
  }
}

function upsert(collection, item) {
  const index = collection.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    collection[index] = item;
  } else {
    collection.push(item);
  }
}

function setFormValues(form, values) {
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field) field.value = value;
  });
}

function getFormValue(form, name) {
  return String(form.elements.namedItem(name).value || "").trim();
}

function getNumber(form, name) {
  return Number(form.elements.namedItem(name).value) || 0;
}

function showEmpty(container) {
  container.innerHTML = "";
  container.appendChild(elements.emptyTemplate.content.cloneNode(true));
}

function formatCurrency(value) {
  return currencyFormatter.format(Number(value) || 0);
}

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${dateString}T12:00:00`));
}

function formatDateInput(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function createId() {
  return crypto.randomUUID();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

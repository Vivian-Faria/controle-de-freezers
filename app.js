const STORAGE_KEY = "freezerSpaceManager-v2"; // bumped: new clientOwned field
const SHELVES_INCLUDED = 3;   // prateleiras já inclusas no aluguel base
const EXTRA_SHELF_COST = 15;  // R$/prateleira extra acima das inclusas
const API_URL = "/api/data";
const FIREBASE_SDK_VERSION = "12.7.0";
const FIREBASE_COLLECTION = "sistemas";
const FIREBASE_DOC_ID = "gestao-freezers";

const plans = {
  quarter:      { label: "1/4", temperature: "Refrigerado/Congelado", defaultFee: 890,  defaultCm: 35,  defaultShelves: 2 },
  half:         { label: "1/2", temperature: "Refrigerado/Congelado", defaultFee: 1290, defaultCm: 70,  defaultShelves: 4 },
  threeQuarter: { label: "3/4", temperature: "Refrigerado/Congelado", defaultFee: 1690, defaultCm: 105, defaultShelves: 5 },
  full:         { label: "1",   temperature: "Refrigerado/Congelado", defaultFee: 1890, defaultCm: 140, defaultShelves: 6 }
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const state = {
  data: { rooms: [], freezers: [], contracts: [] },
  filters: { roomId: "all" },
  sharedMode: false,
  sharedProvider: "local"
};

let firebaseStore = null;
let unsubscribeFirebase = null;
let isReady = false; // evita salvar antes dos dados carregarem

const elements = {
  tabButtons:           document.querySelectorAll("[data-page-target]"),
  pageViews:            document.querySelectorAll("[data-page]"),
  metricRevenue:        document.querySelector("#metric-revenue"),
  metricActiveContracts:document.querySelector("#metric-active-contracts"),
  metricCost:           document.querySelector("#metric-cost"),
  metricFreezers:       document.querySelector("#metric-freezers"),
  metricProfit:         document.querySelector("#metric-profit"),
  metricMargin:         document.querySelector("#metric-margin"),
  metricOccupancy:      document.querySelector("#metric-occupancy"),
  metricAvailable:      document.querySelector("#metric-available"),
  focusCaption:         document.querySelector("#focus-caption"),
  metricEmptySpace:     document.querySelector("#metric-empty-space"),
  metricEmptyEquivalent:document.querySelector("#metric-empty-equivalent"),
  metricIdleCost:       document.querySelector("#metric-idle-cost"),
  metricIdleCount:      document.querySelector("#metric-idle-count"),
  metricSmallClients:   document.querySelector("#metric-small-clients"),
  metricSmallSpace:     document.querySelector("#metric-small-space"),
  opportunityList:      document.querySelector("#opportunity-list"),
  moveModal:            document.querySelector("#move-modal"),
  moveClose:            document.querySelector("#move-close"),
  moveSummary:          document.querySelector("#move-summary"),
  moveTargets:          document.querySelector("#move-targets"),
  roomForm:             document.querySelector("#room-form"),
  freezerForm:          document.querySelector("#freezer-form"),
  contractForm:         document.querySelector("#contract-form"),
  roomFilter:           document.querySelector("#room-filter"),
  freezerList:          document.querySelector("#freezer-list"),
  financeTable:         document.querySelector("#finance-table"),
  contractList:         document.querySelector("#contract-list"),
  emptyTemplate:        document.querySelector("#empty-template")
};

initialize();

async function initialize() {
  state.data = await loadData();
  isReady = true;
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

  document.addEventListener("change", (event) => {
    if (event.target.id === "contract-room-filter") {
      updateContractFreezerSelect(event.target.value);
    }
  });

  elements.moveClose.addEventListener("click", (event) => {
    event.stopPropagation();
    closeMoveModal();
  });
  elements.moveModal.addEventListener("click", (event) => {
    if (event.target === elements.moveModal) closeMoveModal();
  });

  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.pageTarget));
  });

  document.addEventListener("dragstart", handleDragStart);
  document.addEventListener("dragover",  handleDragOver);
  document.addEventListener("dragleave", handleDragLeave);
  document.addEventListener("drop",      handleDrop);

  // Delegated click handler — single source of truth for all data-action buttons
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    // Prevent click from bubbling into drag handlers or double-firing
    event.stopPropagation();

    const { action, id, freezerId } = button.dataset;
    if (action === "edit-room")       editRoom(id);
    if (action === "edit-freezer")    editFreezer(id);
    if (action === "edit-contract")   editContract(id);
    if (action === "open-move")       openMoveModal(id);
    if (action === "move-contract")   moveContract(id, freezerId);
    if (action === "delete-room")     deleteRoom(id);
    if (action === "delete-freezer")  deleteFreezer(id);
    if (action === "delete-contract") deleteContract(id);
  });
}

// ─── FORM HANDLERS ──────────────────────────────────────────────────────────

async function handleRoomSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id   = form.elements.namedItem("id").value || createId();
  const room = { id, name: getFormValue(form, "name"), notes: getFormValue(form, "notes") };
  upsert(state.data.rooms, room);
  await persistData();
  form.reset();
  form.elements.namedItem("id").value = "";
  form.querySelector("button[type=submit]").textContent = "Salvar sala";
  render();
}

async function handleFreezerSubmit(event) {
  event.preventDefault();
  const form    = event.currentTarget;
  const id      = form.elements.namedItem("id").value || createId();
  const clientOwned = form.elements.namedItem("clientOwned").checked;
  const freezer = {
    id,
    roomId:          getFormValue(form, "roomId"),
    name:            getFormValue(form, "name"),
    temperatureType: getFormValue(form, "temperatureType"),
    capacityCm:      getNumber(form, "capacityCm"),
    shelves:         getNumber(form, "shelves"),
    monthlyCost:     clientOwned ? 0 : getNumber(form, "monthlyCost"),
    clientOwned:     clientOwned
  };
  upsert(state.data.freezers, freezer);
  await persistData();
  form.reset();
  form.elements.namedItem("id").value         = "";
  form.elements.namedItem("capacityCm").value = 140;
  form.elements.namedItem("shelves").value    = 6;
  form.elements.namedItem("clientOwned").checked = false;
  form.querySelector("button[type=submit]").textContent = "Salvar freezer";
  render();
}

async function handleContractSubmit(event) {
  event.preventDefault();
  const form     = event.currentTarget;
  const id       = form.elements.namedItem("id").value || createId();
  const contract = {
    id,
    clientName:  getFormValue(form, "clientName"),
    freezerId:   getFormValue(form, "freezerId"),
    planKey:     getFormValue(form, "planKey"),
    occupiedCm:  getNumber(form, "occupiedCm"),
    shelvesUsed: getNumber(form, "shelvesUsed"),
    monthlyFee:  getNumber(form, "monthlyFee"),
    startDate:   getFormValue(form, "startDate"),
    status:      getFormValue(form, "status")
  };

  const freezer            = state.data.freezers.find((f) => f.id === contract.freezerId);
  const usedWithoutCurrent = getFreezerContracts(contract.freezerId)
    .filter((c) => c.id !== id && c.status === "active")
    .reduce((sum, c) => sum + c.occupiedCm, 0);

  if (freezer && contract.status === "active" && usedWithoutCurrent + contract.occupiedCm > freezer.capacityCm) {
    const available = Math.max(0, freezer.capacityCm - usedWithoutCurrent);
    window.alert(`Espaço insuficiente neste freezer. Disponível: ${available} cm.`);
    return;
  }

  upsert(state.data.contracts, contract);
  await persistData();
  form.reset();
  form.elements.namedItem("id").value = "";
  form.querySelector("button[type=submit]").textContent = "Salvar cliente";
  setDefaultContractDate();
  render();
}

// ─── RENDER ─────────────────────────────────────────────────────────────────

function render() {
  populateSelects();
  renderMetrics();
  renderLists();
}


function updateContractFreezerSelect(roomId) {
  const filtered = roomId === "all"
    ? state.data.freezers
    : state.data.freezers.filter(f => f.roomId === roomId);
  const current = elements.contractForm.elements.namedItem("freezerId").value;
  elements.contractForm.elements.namedItem("freezerId").innerHTML = filtered.map((f) => {
    const room = getRoom(f.roomId);
    const owned = f.clientOwned ? " ★" : "";
    return `<option value="${f.id}">${escapeHtml(f.name)}${owned} — ${escapeHtml(room?.name || "Sem sala")}</option>`;
  }).join("");
  if (filtered.some(f => f.id === current)) {
    elements.contractForm.elements.namedItem("freezerId").value = current;
  }
}
function populateSelects() {
  const roomOptions = state.data.rooms
    .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`)
    .join("");

  elements.freezerForm.elements.namedItem("roomId").innerHTML = roomOptions;
  elements.roomFilter.innerHTML = `<option value="all">Todas as salas</option>${roomOptions}`;
  elements.roomFilter.value = state.data.rooms.some((r) => r.id === state.filters.roomId)
    ? state.filters.roomId : "all";
  state.filters.roomId = elements.roomFilter.value;

  // Populate room filter in contract form
  const contractRoomFilter = document.querySelector("#contract-room-filter");
  if (contractRoomFilter) {
    const currentRoomFilter = contractRoomFilter.value || "all";
    contractRoomFilter.innerHTML = `<option value="all">Todas as salas</option>` +
      state.data.rooms.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("");
    contractRoomFilter.value = state.data.rooms.some(r => r.id === currentRoomFilter) ? currentRoomFilter : "all";
    updateContractFreezerSelect(contractRoomFilter.value);
  }

  elements.contractForm.elements.namedItem("planKey").innerHTML = Object.entries(plans)
    .map(([key, plan]) => `<option value="${key}">${plan.label} – ${formatCurrency(plan.defaultFee)}</option>`)
    .join("");

  if (!elements.contractForm.elements.namedItem("occupiedCm").value) applyPlanDefaults();
}

function renderMetrics() {
  const activeContracts = state.data.contracts.filter((c) => c.status === "active");
  const revenue         = activeContracts.reduce((s, c) => s + c.monthlyFee, 0);
  // Custo total = aluguel base + prateleiras extras de cada freezer
  const cost            = state.data.freezers.reduce((s, f) => s + getTotalFreezerCost(f), 0);
  const totalCapacity   = state.data.freezers.reduce((s, f) => s + f.capacityCm, 0);
  const occupied        = activeContracts.reduce((s, c) => s + c.occupiedCm, 0);
  const available       = Math.max(0, totalCapacity - occupied);
  const profit          = revenue - cost;
  const margin          = revenue > 0 ? (profit / revenue) * 100 : 0;
  const occupancy       = totalCapacity > 0 ? (occupied / totalCapacity) * 100 : 0;

  elements.metricRevenue.textContent         = formatCurrency(revenue);
  elements.metricActiveContracts.textContent = `${activeContracts.length} contrato(s) ativo(s)`;
  elements.metricCost.textContent            = formatCurrency(cost);
  elements.metricFreezers.textContent        = `${state.data.freezers.length} freezer(s) cadastrado(s)`;
  elements.metricProfit.textContent          = formatCurrency(profit);
  elements.metricMargin.textContent          = `Margem ${margin.toFixed(1)}%`;
  elements.metricOccupancy.textContent       = `${occupancy.toFixed(1)}%`;
  elements.metricAvailable.textContent       = `${available} cm disponíveis`;

  renderOpportunitySummary(activeContracts, available);
}

function renderLists() {
  renderFreezers();
  renderFinanceTable();
  renderContracts();
  renderSetupLists();
}

function showPage(pageName) {
  elements.pageViews.forEach((page) => {
    page.classList.toggle("active", page.dataset.page === pageName);
  });
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.pageTarget === pageName);
  });
}

// ─── OPPORTUNITY ANALYSIS ───────────────────────────────────────────────────

function renderOpportunitySummary(activeContracts, availableCm) {
  const allFreezers = state.data.freezers.map((f) => ({ freezer: f, stats: getFreezerStats(f) }));

  const emptyFreezers     = allFreezers.filter(({ stats, freezer }) => stats.occupancy === 0 && !freezer.clientOwned)
    .sort((a, b) => getTotalFreezerCost(b.freezer) - getTotalFreezerCost(a.freezer));
  const underusedFreezers = allFreezers.filter(({ stats, freezer }) => stats.occupancy > 0 && stats.occupancy < 50 && !freezer.clientOwned)
    .sort((a, b) => b.stats.availableCm - a.stats.availableCm);

  // Custo ocioso = custo fixo proporcional ao espaço vago de cada freezer alugado
  const idleCost = allFreezers.reduce((s, { freezer, stats }) => {
    if (freezer.clientOwned) return s;
    const idleFraction = stats.occupancy < 100 ? (100 - stats.occupancy) / 100 : 0;
    return s + getTotalFreezerCost(freezer) * idleFraction;
  }, 0);

  // Consolidation scenarios: which freezers could be emptied by moving clients?
  const consolidationPlans = buildConsolidationPlans(allFreezers, activeContracts);
  const bestPlans = consolidationPlans.slice(0, 3);

  const freezerEquiv = state.data.freezers.length ? availableCm / averageFreezerCapacity() : 0;
  const focusLevel   = idleCost > 0 || emptyFreezers.length || underusedFreezers.length || bestPlans.length ? "warn" : "ok";

  // "Small clients" metric now reflects actual consolidation potential
  const consolidatableContracts = [...new Set(bestPlans.flatMap(p => p.moves.map(m => m.contract.id)))];
  const consolidatableCost = bestPlans.reduce((s, p) => s + p.savingPerMonth, 0);

  elements.metricEmptySpace.textContent      = `${availableCm} cm`;
  elements.metricEmptyEquivalent.textContent = `Equivale a ${freezerEquiv.toFixed(1)} freezer(s) de capacidade média`;
  elements.metricIdleCost.textContent        = formatCurrency(idleCost);
  elements.metricIdleCount.textContent       = `${emptyFreezers.length} vazio(s) + ${underusedFreezers.length} abaixo de 50%`;

  // Show consolidation potential, not raw count of small contracts
  elements.metricSmallClients.textContent = bestPlans.length > 0
    ? `${bestPlans.length} plano(s)`
    : "—";
  elements.metricSmallSpace.textContent = bestPlans.length > 0
    ? `Economia potencial: ${formatCurrency(consolidatableCost)}/mês`
    : "Sem reorganização viável no momento";

  elements.focusCaption.className  = `status-pill ${focusLevel}`;
  elements.focusCaption.textContent = focusLevel === "warn"
    ? "Há oportunidades de consolidação"
    : "Ocupação bem distribuída";

  renderRecommendations(emptyFreezers, underusedFreezers, bestPlans);
}

/**
 * buildConsolidationPlans
 * Para cada freezer alugado com custo, tenta montar um plano real:
 *   "Se movermos estes clientes para outros freezers com espaço,
 *    este freezer pode ser devolvido, economizando R$X/mês"
 * Só gera plano se TODOS os clientes do freezer têm destino viável.
 */
function buildConsolidationPlans(allFreezers, activeContracts) {
  const plans = [];

  // Candidatos a esvaziar: freezers alugados com baixa ocupação
  const candidates = allFreezers
    .filter(({ freezer, stats }) => !freezer.clientOwned && stats.occupancy < 80 && stats.clientCount > 0)
    .sort((a, b) => getTotalFreezerCost(b.freezer) - getTotalFreezerCost(a.freezer)); // maior custo primeiro

  for (const { freezer, stats } of candidates) {
    const clientsToMove = activeContracts.filter(c => c.freezerId === freezer.id && c.status === "active");
    if (!clientsToMove.length) continue;

    // Simulate: can ALL clients fit elsewhere?
    // We track a "virtual occupancy" map to not double-book space
    const virtualSpace = {}; // freezerId -> cm used after moves
    allFreezers.forEach(({ freezer: f, stats: s }) => {
      virtualSpace[f.id] = s.occupiedCm;
    });

    const moves = [];
    let planViable = true;

    for (const contract of clientsToMove) {
      // Find best target that has room in virtual space
      const target = allFreezers
        .filter(({ freezer: f }) => f.id !== freezer.id)
        .map(({ freezer: f }) => ({
          freezer: f,
          virtualAvailable: f.capacityCm - (virtualSpace[f.id] || 0)
        }))
        .filter(({ virtualAvailable }) => virtualAvailable >= contract.occupiedCm)
        .sort((a, b) => {
          // prefer freezers already partially full (consolidation) and same temperature
          const tempMatchA = a.freezer.temperatureType === freezer.temperatureType ? 0 : 1;
          const tempMatchB = b.freezer.temperatureType === freezer.temperatureType ? 0 : 1;
          const leftoverA  = a.virtualAvailable - contract.occupiedCm;
          const leftoverB  = b.virtualAvailable - contract.occupiedCm;
          return tempMatchA - tempMatchB || leftoverA - leftoverB;
        })[0];

      if (!target) { planViable = false; break; }

      // Reserve space
      virtualSpace[target.freezer.id] = (virtualSpace[target.freezer.id] || 0) + contract.occupiedCm;
      moves.push({ contract, targetFreezer: target.freezer });
    }

    if (!planViable || !moves.length) continue;

    const saving = getTotalFreezerCost(freezer);
    // Only recommend if saving is meaningful (>0) and we're not just moving to equally costly freezers
    if (saving <= 0) continue;

    plans.push({
      sourceFreezer:  freezer,
      moves,
      savingPerMonth: saving,
      clientCount:    clientsToMove.length
    });
  }

  // Sort by saving descending, deduplicate (a freezer can't appear as source twice)
  const seen = new Set();
  return plans
    .sort((a, b) => b.savingPerMonth - a.savingPerMonth)
    .filter(p => { if (seen.has(p.sourceFreezer.id)) return false; seen.add(p.sourceFreezer.id); return true; });
}

function renderRecommendations(emptyFreezers, underusedFreezers, consolidationPlans) {
  const recs = [];

  // 1) Freezers 100% ociosos — custo sem nenhuma receita
  emptyFreezers.slice(0, 3).forEach(({ freezer }) => {
    recs.push({
      priority:    "high",
      title:       `${escapeHtml(freezer.name)} está completamente vazio`,
      description: `${escapeHtml(getRoom(freezer.roomId)?.name || "Sem sala")} — custo correndo sem nenhuma receita. Considere devolver o equipamento.`,
      value:       formatCurrency(getTotalFreezerCost(freezer)),
      detail:      "economia imediata/mês se devolver",
      action:      "edit-freezer",
      id:          freezer.id,
      button:      "Ver freezer"
    });
  });

  // 2) Consolidation plans — the real intelligence
  consolidationPlans.forEach((plan) => {
    const { sourceFreezer, moves, savingPerMonth, clientCount } = plan;
    const moveList = moves.map(m =>
      `${escapeHtml(m.contract.clientName)} → ${escapeHtml(m.targetFreezer.name)}`
    ).join(", ");
    const clientNames = moves.map(m => escapeHtml(m.contract.clientName)).join(" e ");
    // First contract to move — button opens move modal
    const firstContract = moves[0].contract;

    recs.push({
      priority:    "medium",
      title:       `Esvaziar ${escapeHtml(sourceFreezer.name)} e economizar ${formatCurrency(savingPerMonth)}/mês`,
      description: `${clientCount} cliente(s) podem ser realocados com espaço disponível em outros freezers: ${moveList}.`,
      value:       formatCurrency(savingPerMonth),
      detail:      "economia mensal se devolver este freezer",
      action:      "open-move",
      id:          firstContract.id,
      button:      clientCount === 1 ? "Mover cliente" : "Iniciar reorganização"
    });
  });

  // 3) Underused freezers — informational, only if no consolidation plan covers them
  const coveredIds = new Set(consolidationPlans.map(p => p.sourceFreezer.id));
  underusedFreezers
    .filter(({ freezer }) => !coveredIds.has(freezer.id))
    .slice(0, 2)
    .forEach(({ freezer, stats }) => {
      recs.push({
        priority:    "low",
        title:       `${escapeHtml(freezer.name)} está ${stats.occupancy.toFixed(0)}% ocupado`,
        description: `Cabe mais ${stats.availableCm} cm. Pode absorver clientes de outro freezer para liberar espaço.`,
        value:       `${stats.availableCm} cm disponíveis`,
        detail:      `resultado atual: ${formatCurrency(stats.profit)}`,
        action:      "edit-freezer",
        id:          freezer.id,
        button:      "Ver freezer"
      });
    });

  if (!recs.length) {
    elements.opportunityList.innerHTML = `
      <div class="empty-state compact">
        <strong>Nenhuma oportunidade de consolidação no momento</strong>
        <p>Todos os freezers estão bem aproveitados ou não há destino viável para mover clientes.</p>
      </div>`;
    return;
  }

  elements.opportunityList.innerHTML = recs.map((item) => `
    <article class="opportunity-row ${item.priority}">
      <div class="opp-info">
        <strong>${item.title}</strong>
        <span>${item.description}</span>
      </div>
      <div class="opp-value">
        <strong>${item.value}</strong>
        <span>${item.detail}</span>
      </div>
      <button class="button ${item.priority === 'high' ? 'primary' : 'secondary'}" type="button"
              data-action="${item.action}" data-id="${item.id}">${item.button}</button>
    </article>
  `).join("");
}

// Encontra o melhor freezer de destino para um contrato (estratégia de consolidação)
function findBestMoveTarget(contract) {
  const candidates = state.data.freezers
    .filter((f) => f.id !== contract.freezerId)
    .map((f) => {
      const stats = getFreezerStats(f);
      return { ...f, availableCm: stats.availableCm, occupancy: stats.occupancy, clientCount: stats.clientCount };
    })
    .filter((f) => f.availableCm >= contract.occupiedCm)
    // Prefere freezer com mais clientes já (concentração) e menor espaço sobrando depois
    .sort((a, b) => {
      const leftoverA = a.availableCm - contract.occupiedCm;
      const leftoverB = b.availableCm - contract.occupiedCm;
      // penaliza excesso de espaço sobrando, prioriza maior concentração
      return (leftoverA - leftoverB) || (b.clientCount - a.clientCount);
    });
  return candidates[0] || null;
}

// ─── FREEZER LIST ────────────────────────────────────────────────────────────

function renderFreezers() {
  const freezers = getFilteredFreezers();
  if (!freezers.length) {
    showEmpty(elements.freezerList);
    return;
  }

  elements.freezerList.innerHTML = freezers.map((freezer) => {
    const stats     = getFreezerStats(freezer);
    const statusCls = stats.occupancy >= 100 ? "full" : stats.occupancy >= 85 ? "warning" : "";
    const pillCls   = stats.occupancy >= 100 ? "bad"  : stats.occupancy >= 85 ? "warn"    : "ok";
    const clients   = getFreezerContracts(freezer.id).filter((c) => c.status === "active");
    const room      = getRoom(freezer.roomId);

    return `
      <article class="freezer-card ${statusCls}" data-freezer-id="${freezer.id}">
        <div class="freezer-head">
          <div>
            <h3>${escapeHtml(freezer.name)} ${freezer.clientOwned ? '<span class="owned-badge">Do cliente</span>' : ""}</h3>
            <span class="muted">${escapeHtml(room?.name || "Sem sala")} · ${escapeHtml(freezer.temperatureType)}</span>
          </div>
          <span class="status-pill ${pillCls}">${stats.availableCm} cm livres</span>
        </div>

        <div class="capacity-bar" title="${stats.occupiedCm} cm ocupados de ${freezer.capacityCm} cm">
          <div style="width:${Math.min(100, stats.occupancy)}%"></div>
        </div>

        <div class="freezer-stats">
          <div class="stat-box"><span>Ocupação</span><strong>${stats.occupancy.toFixed(1)}%</strong></div>
          <div class="stat-box"><span>Receita</span><strong>${formatCurrency(stats.revenue)}</strong></div>
          <div class="stat-box">
            <span>Custo ${freezer.clientOwned ? "(cliente)" : "fixo"}</span>
            <strong>${freezer.clientOwned ? "R$ 0,00" : formatCurrency(freezer.monthlyCost)}</strong>
            ${!freezer.clientOwned && getExtraShelfCost(freezer) > 0
              ? `<span class="shelf-cost-note">+${formatCurrency(getExtraShelfCost(freezer))} (${Math.max(0,freezer.shelves-SHELVES_INCLUDED)} prat. extra)</span>`
              : freezer.clientOwned ? '<span class="shelf-cost-note" style="color:var(--accent-2)">freezer do cliente</span>' : ""}
          </div>
          <div class="stat-box"><span>Resultado</span><strong class="${stats.profit >= 0 ? 'positive' : 'negative'}">${formatCurrency(stats.profit)}</strong></div>
        </div>

        <div class="mini-list">
          ${clients.length
            ? clients.map((c) => `
              <div class="mini-client" draggable="true" data-contract-id="${c.id}">
                <div class="mini-client-info">
                  <strong>${escapeHtml(c.clientName)}</strong>
                  <span>${getPlanLabel(c.planKey)} · ${c.occupiedCm} cm · ${formatCurrency(c.monthlyFee)}/mês</span>
                </div>
                <button class="button secondary btn-sm" type="button"
                        data-action="open-move" data-id="${c.id}">Mover</button>
              </div>`).join("")
            : `<span class="muted empty-clients">Nenhum cliente ativo — custo sem receita.</span>`
          }
        </div>

        <div class="row-actions">
          <button class="button secondary" type="button" data-action="edit-freezer" data-id="${freezer.id}">Editar</button>
          <button class="button danger"    type="button" data-action="delete-freezer" data-id="${freezer.id}">Remover</button>
        </div>
      </article>`;
  }).join("");
}

// ─── FINANCE TABLE ───────────────────────────────────────────────────────────

function renderFinanceTable() {
  const freezers = getFilteredFreezers();
  if (!freezers.length) {
    showEmpty(elements.financeTable);
    return;
  }

  elements.financeTable.innerHTML = freezers.map((freezer) => {
    const stats = getFreezerStats(freezer);
    // CORREÇÃO: custo fixo do freezer NÃO é dividido por clientes
    // O que muda com mais clientes é apenas a diluição (informativa)
    const costPerCm   = stats.occupiedCm > 0 ? freezer.monthlyCost / stats.occupiedCm : freezer.monthlyCost;
    const revenuePerCm = stats.occupiedCm > 0 ? stats.revenue / stats.occupiedCm : 0;
    const margin       = stats.revenue > 0 ? (stats.profit / stats.revenue) * 100 : 0;
    const breakEvenCm  = freezer.capacityCm > 0
      ? Math.ceil((freezer.monthlyCost / (stats.revenue / Math.max(stats.occupiedCm, 1))) )
      : 0;

    return `
      <article class="table-row finance-row">
        <div class="finance-name">
          <strong>${escapeHtml(freezer.name)}</strong>
          <span>${escapeHtml(getRoom(freezer.roomId)?.name || "Sem sala")} · ${stats.clientCount} cliente(s)</span>
        </div>
        <div><strong>${formatCurrency(stats.revenue)}</strong><span>Faturamento</span></div>
        <div>
          <strong>${freezer.clientOwned ? "R$ 0,00" : formatCurrency(getTotalFreezerCost(freezer))}</strong>
          <span>${freezer.clientOwned ? "Freezer do cliente" : "Custo total"}</span>
          ${!freezer.clientOwned && getExtraShelfCost(freezer) > 0
            ? `<small style="color:var(--warn);font-size:.7rem">Base ${formatCurrency(freezer.monthlyCost)} + ${formatCurrency(getExtraShelfCost(freezer))} prat. (${Math.max(0,freezer.shelves-SHELVES_INCLUDED)}×R$15)</small>`
            : ""}
        </div>
        <div><strong class="${stats.profit >= 0 ? 'positive' : 'negative'}">${formatCurrency(stats.profit)}</strong><span>Resultado</span></div>
        <div><strong>${margin.toFixed(1)}%</strong><span>Margem</span></div>
        <div><strong>${formatCurrency(costPerCm)}</strong><span>Custo/cm ocupado</span></div>
        <div><strong>${formatCurrency(revenuePerCm)}</strong><span>Receita/cm</span></div>
        <div class="row-actions">
          <button class="button secondary" type="button" data-action="edit-freezer" data-id="${freezer.id}">Editar</button>
        </div>
      </article>`;
  }).join("");
}

// ─── CONTRACT LIST ───────────────────────────────────────────────────────────

function renderContracts() {
  if (!state.data.contracts.length) {
    showEmpty(elements.contractList);
    return;
  }

  elements.contractList.innerHTML = state.data.contracts.map((contract) => {
    const freezer = state.data.freezers.find((f) => f.id === contract.freezerId);
    const room    = freezer ? getRoom(freezer.roomId) : null;
    return `
      <article class="table-row contract-row">
        <div>
          <strong>${escapeHtml(contract.clientName)}</strong>
          <span class="status-badge ${contract.status}">${contract.status === "active" ? "Ativo" : "Pausado"} · desde ${formatDate(contract.startDate)}</span>
        </div>
        <div><strong>${getPlanLabel(contract.planKey)}</strong><span>Plano</span></div>
        <div><strong>${contract.occupiedCm} cm</strong><span>${contract.shelvesUsed} prateleira(s)</span></div>
        <div><strong>${formatCurrency(contract.monthlyFee)}</strong><span>Mensalidade</span></div>
        <div>
          <strong>${escapeHtml(freezer?.name || "Sem freezer")} ${freezer?.clientOwned ? '<span class="owned-badge">Do cliente</span>' : ""}</strong>
          <span>${escapeHtml(room?.name || "Sem sala")}</span>
        </div>
        <div class="row-actions">
          <button class="button secondary" type="button" data-action="edit-contract"   data-id="${contract.id}">Editar</button>
          <button class="button secondary" type="button" data-action="open-move"       data-id="${contract.id}">Mover</button>
          <button class="button danger"    type="button" data-action="delete-contract" data-id="${contract.id}">Remover</button>
        </div>
      </article>`;
  }).join("");
}

// ─── SETUP LISTS ─────────────────────────────────────────────────────────────

function renderSetupLists() {
  // Render room list in setup page
  const roomListEl = document.querySelector("#room-list");
  if (roomListEl) {
    if (!state.data.rooms.length) {
      showEmpty(roomListEl);
    } else {
      roomListEl.innerHTML = state.data.rooms.map((room) => `
        <article class="table-row">
          <div><strong>${escapeHtml(room.name)}</strong><span>${escapeHtml(room.notes || "—")}</span></div>
          <div class="row-actions">
            <button class="button secondary" type="button" data-action="edit-room"   data-id="${room.id}">Editar</button>
            <button class="button danger"    type="button" data-action="delete-room" data-id="${room.id}">Remover</button>
          </div>
        </article>`).join("");
    }
  }

  // Render freezer list in setup page
  const freezerSetupEl = document.querySelector("#freezer-setup-list");
  if (freezerSetupEl) {
    if (!state.data.freezers.length) {
      showEmpty(freezerSetupEl);
    } else {
      freezerSetupEl.innerHTML = state.data.freezers.map((freezer) => {
        const room = getRoom(freezer.roomId);
        return `
          <article class="table-row">
            <div><strong>${escapeHtml(freezer.name)}</strong><span>${escapeHtml(room?.name || "Sem sala")} · ${escapeHtml(freezer.temperatureType)}</span></div>
            <div><strong>${freezer.capacityCm} cm</strong><span>${freezer.shelves} prateleira(s)${!freezer.clientOwned && freezer.shelves > SHELVES_INCLUDED ? ` <span style="color:var(--warn)">(${freezer.shelves-SHELVES_INCLUDED} extra${freezer.shelves-SHELVES_INCLUDED>1?"s":""})</span>` : ""}</span></div>
            <div>
              <strong>${freezer.clientOwned ? '<span class="owned-badge">Do cliente</span>' : formatCurrency(getTotalFreezerCost(freezer))}</strong>
              <span>${freezer.clientOwned ? "Sem custo" : (getExtraShelfCost(freezer)>0 ? `Base ${formatCurrency(freezer.monthlyCost)} + ${formatCurrency(getExtraShelfCost(freezer))} extras` : "Custo fixo/mês")}</span>
            </div>
            <div class="row-actions">
              <button class="button secondary" type="button" data-action="edit-freezer"   data-id="${freezer.id}">Editar</button>
              <button class="button danger"    type="button" data-action="delete-freezer" data-id="${freezer.id}">Remover</button>
            </div>
          </article>`;
      }).join("");
    }
  }
}

// ─── MOVE MODAL ──────────────────────────────────────────────────────────────

function openMoveModal(contractId) {
  const contract = state.data.contracts.find((c) => c.id === contractId);
  if (!contract) return;

  const currentFreezer = state.data.freezers.find((f) => f.id === contract.freezerId);
  const bestTarget     = findBestMoveTarget(contract);

  elements.moveSummary.innerHTML = `
    <div class="move-from">
      <strong>${escapeHtml(contract.clientName)}</strong>
      ocupa <strong>${contract.occupiedCm} cm</strong> (plano ${getPlanLabel(contract.planKey)}) em
      <strong>${escapeHtml(currentFreezer?.name || "freezer atual")}</strong>
      · mensalidade ${formatCurrency(contract.monthlyFee)}
    </div>
    ${bestTarget ? `<div class="move-suggestion">💡 Sugestão estratégica: <strong>${escapeHtml(bestTarget.name)}</strong> — concentra melhor o espaço e pode liberar o freezer atual.</div>` : ""}
  `;

  const targets = state.data.freezers
    .filter((f) => f.id !== contract.freezerId)
    .map((f) => {
      const stats = getFreezerStats(f);
      const fits  = stats.availableCm >= contract.occupiedCm;
      // calcula resultado do freezer de origem se cliente sair
      const originStats     = getFreezerStats(currentFreezer);
      const originNewRevenue= originStats.revenue - contract.monthlyFee;
      const originNewProfit = originNewRevenue - (currentFreezer?.monthlyCost || 0);
      const isBest          = bestTarget && f.id === bestTarget.id;
      return { freezer: f, stats, fits, isBest };
    })
    .sort((a, b) => Number(b.isBest) - Number(a.isBest) || Number(b.fits) - Number(a.fits) || b.stats.availableCm - a.stats.availableCm);

  if (!targets.length) {
    elements.moveTargets.innerHTML = `
      <div class="empty-state compact">
        <strong>Nenhum outro freezer cadastrado</strong>
        <p>Cadastre outro freezer antes de mover este cliente.</p>
      </div>`;
  } else {
    elements.moveTargets.innerHTML = targets.map(({ freezer, stats, fits, isBest }) => `
      <button class="move-target ${isBest ? "best" : ""} ${fits ? "" : "disabled"}"
              type="button"
              data-action="move-contract"
              data-id="${contract.id}"
              data-freezer-id="${freezer.id}"
              ${fits ? "" : "disabled"}>
        <div class="move-target-info">
          <strong>${escapeHtml(freezer.name)} ${isBest ? '<span class="best-badge">✦ Melhor opção</span>' : ""}</strong>
          <span>${escapeHtml(getRoom(freezer.roomId)?.name || "Sem sala")} · ${stats.availableCm} cm disponíveis · ${stats.clientCount} cliente(s) atual(is)</span>
          <span>Custo fixo: ${formatCurrency(freezer.monthlyCost)} · Receita atual: ${formatCurrency(stats.revenue)}</span>
        </div>
        <span class="status-pill ${fits ? (isBest ? "ok best-pill" : "ok") : "bad"}">${fits ? (isBest ? "Mover aqui ✓" : "Mover para cá") : "Sem espaço"}</span>
      </button>
    `).join("");
  }

  elements.moveModal.classList.remove("is-hidden");
}

function closeMoveModal() {
  elements.moveModal.classList.add("is-hidden");
  elements.moveSummary.innerHTML   = "";
  elements.moveTargets.innerHTML   = "";
}

async function moveContract(contractId, targetFreezerId) {
  const contract      = state.data.contracts.find((c) => c.id === contractId);
  const targetFreezer = state.data.freezers.find((f) => f.id === targetFreezerId);
  if (!contract || !targetFreezer) return;
  if (contract.freezerId === targetFreezerId) { closeMoveModal(); return; }

  const targetStats = getFreezerStats(targetFreezer);
  if (targetStats.availableCm < contract.occupiedCm) {
    window.alert(`Espaço insuficiente neste freezer. Disponível: ${targetStats.availableCm} cm.`);
    return;
  }

  const prevFreezer = contract.freezerId;
  contract.freezerId = targetFreezerId;
  await persistData();
  closeMoveModal();
  render();

  // Verifica se o freezer de origem ficou vazio após a movimentação
  const originContracts = getFreezerContracts(prevFreezer).filter((c) => c.status === "active");
  if (originContracts.length === 0) {
    const origin = state.data.freezers.find((f) => f.id === prevFreezer);
    if (origin) {
      window.alert(`✅ ${contract.clientName} foi movido para ${targetFreezer.name}.\n\n⚠️ ${origin.name} ficou VAZIO. Considere devolver esse equipamento para eliminar o custo de ${formatCurrency(origin.monthlyCost)}/mês.`);
    }
  }
}

// ─── DRAG & DROP ─────────────────────────────────────────────────────────────

function handleDragStart(event) {
  const card = event.target.closest("[data-contract-id]");
  if (!card) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", card.dataset.contractId);
  card.classList.add("dragging");
}

function handleDragOver(event) {
  if (!event.dataTransfer?.types?.includes("text/plain")) return;
  const card = event.target.closest("[data-freezer-id]");
  if (!card || elements.moveModal.contains(event.target)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  card.classList.add("drag-over");
}

function handleDragLeave(event) {
  const card = event.target.closest("[data-freezer-id]");
  if (!card || card.contains(event.relatedTarget)) return;
  card.classList.remove("drag-over");
}

async function handleDrop(event) {
  if (!event.dataTransfer?.types?.includes("text/plain")) return;
  const card = event.target.closest("[data-freezer-id]");
  if (!card || elements.moveModal.contains(event.target)) return;
  event.preventDefault();
  document.querySelectorAll(".drag-over, .dragging").forEach((el) => el.classList.remove("drag-over", "dragging"));
  const contractId      = event.dataTransfer.getData("text/plain");
  const targetFreezerId = card.dataset.freezerId;
  if (contractId && targetFreezerId) await moveContract(contractId, targetFreezerId);
}

// ─── PLAN DEFAULTS ───────────────────────────────────────────────────────────

function applyPlanDefaults() {
  const plan = plans[elements.contractForm.elements.namedItem("planKey").value] || plans.quarter;
  const form = elements.contractForm;
  form.elements.namedItem("occupiedCm").value  = plan.defaultCm;
  form.elements.namedItem("shelvesUsed").value = plan.defaultShelves;
  form.elements.namedItem("monthlyFee").value  = plan.defaultFee;
}

// ─── STATS ───────────────────────────────────────────────────────────────────


// Custo de prateleiras extras: R$15 por prateleira acima das 3 inclusas no aluguel
function getExtraShelfCost(freezer) {
  if (freezer.clientOwned) return 0; // freezer do cliente: sem custo nosso
  const extras = Math.max(0, (freezer.shelves || 0) - SHELVES_INCLUDED);
  return extras * EXTRA_SHELF_COST;
}

// Custo total do freezer = aluguel base + prateleiras extras
function getTotalFreezerCost(freezer) {
  if (freezer.clientOwned) return 0;
  return (freezer.monthlyCost || 0) + getExtraShelfCost(freezer);
}
/**
 * getFreezerStats — calcula métricas do freezer.
 * LÓGICA DE CUSTO: o monthlyCost é fixo do equipamento.
 * Com 1 ou 10 clientes ele continua o mesmo. Mais clientes = mais receita = melhor margem.
 */
function getFreezerStats(freezer) {
  const active    = getFreezerContracts(freezer.id).filter((c) => c.status === "active");
  const occupiedCm  = active.reduce((s, c) => s + c.occupiedCm, 0);
  const shelvesUsed = active.reduce((s, c) => s + c.shelvesUsed, 0);
  const revenue     = active.reduce((s, c) => s + c.monthlyFee, 0);
  const availableCm = Math.max(0, freezer.capacityCm - occupiedCm);
  const occupancy   = freezer.capacityCm > 0 ? (occupiedCm / freezer.capacityCm) * 100 : 0;

  return {
    occupiedCm,
    shelvesUsed,
    clientCount: active.length,
    revenue,
    availableCm,
    occupancy,
    // Custo total = aluguel base + prateleiras extras (R$15/un acima de 3)
    profit: revenue - getTotalFreezerCost(freezer)
  };
}

function getFilteredFreezers() {
  return state.data.freezers.filter(
    (f) => state.filters.roomId === "all" || f.roomId === state.filters.roomId
  );
}

function getFreezerContracts(freezerId) {
  return state.data.contracts.filter((c) => c.freezerId === freezerId);
}

function averageFreezerCapacity() {
  const total = state.data.freezers.reduce((s, f) => s + f.capacityCm, 0);
  return total / Math.max(1, state.data.freezers.length);
}

function getRoom(roomId)      { return state.data.rooms.find((r) => r.id === roomId); }
function getPlanLabel(planKey){ return plans[planKey]?.label || planKey; }

// ─── CRUD HELPERS ────────────────────────────────────────────────────────────

function editRoom(id) {
  const room = state.data.rooms.find((r) => r.id === id);
  if (!room) return;
  showPage("setup");
  setFormValues(elements.roomForm, room);
  elements.roomForm.querySelector("button[type=submit]").textContent = "Atualizar sala";
  elements.roomForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editFreezer(id) {
  const freezer = state.data.freezers.find((f) => f.id === id);
  if (!freezer) return;
  showPage("setup");
  setFormValues(elements.freezerForm, freezer);
  elements.freezerForm.elements.namedItem("clientOwned").checked = !!freezer.clientOwned;
  elements.freezerForm.querySelector("button[type=submit]").textContent = "Atualizar freezer";
  elements.freezerForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editContract(id) {
  const contract = state.data.contracts.find((c) => c.id === id);
  if (!contract) return;
  showPage("clients");
  setFormValues(elements.contractForm, contract);
  elements.contractForm.querySelector("button[type=submit]").textContent = "Atualizar cliente";
  elements.contractForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteRoom(id) {
  if (state.data.freezers.some((f) => f.roomId === id)) {
    window.alert("Remova ou mova os freezers desta sala antes de excluir.");
    return;
  }
  if (!window.confirm("Remover esta sala?")) return;
  state.data.rooms = state.data.rooms.filter((r) => r.id !== id);
  await persistData();
  render();
}

async function deleteFreezer(id) {
  if (state.data.contracts.some((c) => c.freezerId === id)) {
    window.alert("Remova ou mova os clientes deste freezer antes de excluir.");
    return;
  }
  if (!window.confirm("Remover este freezer?")) return;
  state.data.freezers = state.data.freezers.filter((f) => f.id !== id);
  await persistData();
  render();
}

async function deleteContract(id) {
  if (!window.confirm("Remover este contrato?")) return;
  state.data.contracts = state.data.contracts.filter((c) => c.id !== id);
  await persistData();
  render();
}

// ─── DATA PERSISTENCE ────────────────────────────────────────────────────────

async function persistData() {
  if (!isReady) return; // ainda inicializando, não salva
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  if (state.sharedMode) {
    try {
      if (state.sharedProvider === "firebase") {
        await saveFirebaseData(state.data);
      } else {
        await saveServerData(state.data);
      }
    } catch (error) {
      window.alert("Não foi possível salvar no armazenamento compartilhado. Verifique a conexão.");
      throw error;
    }
  }
}

async function loadData() {
  const localData = loadLocalData();

  try {
    const firebaseData = await loadFirebaseData(localData);
    if (firebaseData) {
      state.sharedMode     = true;
      state.sharedProvider = "firebase";
      return firebaseData;
    }
  } catch (error) {
    console.warn("Firebase indisponível.", error);
  }

  try {
    const response   = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("API indisponível.");
    const serverData = sanitizeData(await response.json());
    state.sharedMode     = true;
    state.sharedProvider = "server";
    const serverEmpty = !serverData.rooms.length && !serverData.freezers.length && !serverData.contracts.length;
    const localHas    = localData.rooms.length || localData.freezers.length || localData.contracts.length;
    if (serverEmpty && localHas) { await saveServerData(localData); return localData; }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serverData));
    return serverData;
  } catch (_) {
    // API indisponível — continua com dados locais sem alert
  }

  // Se não há dados locais, tenta carregar data.json como seed
  const localHasData = localData.rooms.length || localData.freezers.length || localData.contracts.length;
  if (!localHasData) {
    try {
      const response = await fetch("./data.json", { cache: "no-store" });
      if (response.ok) {
        const seed = sanitizeData(await response.json());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
        return seed;
      }
    } catch (_) {}
  }

  state.sharedMode     = false;
  state.sharedProvider = "local";
  return localData;
}

function loadLocalData() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitizeData(JSON.parse(stored)) : { rooms: [], freezers: [], contracts: [] };
  } catch { return { rooms: [], freezers: [], contracts: [] }; }
}

function sanitizeData(data) {
  return {
    rooms:     Array.isArray(data.rooms)     ? data.rooms     : [],
    freezers:  Array.isArray(data.freezers)  ? data.freezers.map(f => ({ ...f, clientOwned: !!f.clientOwned }))  : [],
    contracts: Array.isArray(data.contracts) ? data.contracts : []
  };
}

async function loadFirebaseData(localData) {
  if (!hasFirebaseConfig()) return null;
  const [{ initializeApp }, firestore] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`)
  ]);
  const app    = initializeApp(window.FIREBASE_CONFIG);
  const db     = firestore.getFirestore(app);
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
  if (!firebaseStore || unsubscribeFirebase) return;
  unsubscribeFirebase = firebaseStore.firestore.onSnapshot(firebaseStore.docRef, (snapshot) => {
    if (!snapshot.exists()) return;
    state.data = sanitizeData(snapshot.data());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    render();
  });
}

async function saveFirebaseData(data) {
  if (!firebaseStore) throw new Error("Firebase não inicializado.");
  await firebaseStore.firestore.setDoc(firebaseStore.docRef, sanitizeData(data));
}

async function loadSeedData(localData) {
  const localHas = localData.rooms.length || localData.freezers.length || localData.contracts.length;
  if (localHas) return localData;
  try {
    const response = await fetch("./data.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Seed indisponível.");
    return sanitizeData(await response.json());
  } catch { return { rooms: [], freezers: [], contracts: [] }; }
}

function hasFirebaseConfig() {
  const config = window.FIREBASE_CONFIG || {};
  return Boolean(
    config.apiKey && config.projectId &&
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
  if (!response.ok) throw new Error("Não foi possível salvar no servidor.");
}

// ─── UTILS ───────────────────────────────────────────────────────────────────

function upsert(collection, item) {
  const idx = collection.findIndex((e) => e.id === item.id);
  if (idx >= 0) collection[idx] = item; else collection.push(item);
}

function setFormValues(form, values) {
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field) field.value = value;
  });
}

function getFormValue(form, name) { return String(form.elements.namedItem(name)?.value || "").trim(); }
function getNumber(form, name)    { return Number(form.elements.namedItem(name)?.value) || 0; }

function showEmpty(container) {
  container.innerHTML = "";
  container.appendChild(elements.emptyTemplate.content.cloneNode(true));
}

function formatCurrency(value)  { return currencyFormatter.format(Number(value) || 0); }
function formatDate(dateString) {
  if (!dateString) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${dateString}T12:00:00`));
}
function formatDateInput(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function createId()  { return crypto.randomUUID(); }
function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function setDefaultContractDate() {
  elements.contractForm.elements.namedItem("startDate").value = formatDateInput(new Date());
}

// ─── DEMO / EXPORT / IMPORT ──────────────────────────────────────────────────

async function loadDemoData() {
  const roomA = createId(), roomB = createId();
  const fzA   = createId(), fzB   = createId(), fzC = createId();
  state.data = {
    rooms: [
      { id: roomA, name: "Sala fria 01",        notes: "Operação congelada" },
      { id: roomB, name: "Sala refrigerada 02", notes: "Produtos resfriados" }
    ],
    freezers: [
      { id: fzA, roomId: roomA, name: "FZ-01", temperatureType: "Congelado",   capacityCm: 140, shelves: 6, monthlyCost: 760 },
      { id: fzB, roomId: roomA, name: "FZ-02", temperatureType: "Congelado",   capacityCm: 140, shelves: 6, monthlyCost: 820 },
      { id: fzC, roomId: roomB, name: "RF-01", temperatureType: "Refrigerado", capacityCm: 140, shelves: 6, monthlyCost: 690 }
    ],
    contracts: [
      mkContract("Acai Norte",       fzA, "half",         -110),
      mkContract("Doces Bela Vista", fzA, "quarter",       -54),
      mkContract("Carnes Premium",   fzB, "threeQuarter",  -32),
      mkContract("Emporio Verde",    fzC, "quarter",       -18),
      mkContract("Massas da Casa",   fzC, "half",           -8)
    ]
  };
  await persistData();
  render();
}

function mkContract(clientName, freezerId, planKey, offsetDays) {
  const plan = plans[planKey];
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return { id: createId(), clientName, freezerId, planKey, occupiedCm: plan.defaultCm, shelvesUsed: plan.defaultShelves, monthlyFee: plan.defaultFee, startDate: formatDateInput(date), status: "active" };
}

function exportData() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href  = url; link.download = "gestao-freezers-dados.json"; link.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state.data = sanitizeData(JSON.parse(String(reader.result)));
      persistData(); render();
    } catch { window.alert("Não foi possível importar o JSON."); }
    finally  { event.target.value = ""; }
  };
  reader.readAsText(file);
}

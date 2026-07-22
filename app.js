// ---------------------------------------------------------------------
// Quilting Business Manager — phone app
// Talks directly to Firestore. Needs internet to work; the computer
// program is the one that works offline.
// ---------------------------------------------------------------------

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const QUILTING_SIZES = ["Extra Large", "Large", "Medium", "Small", "Extra Small"];
const BATTING_TYPES = ["Warm & Natural", "Polyester"];
const DEFAULT_PRICING = {
  qsize: { "Extra Large": 0.015, "Large": 0.017, "Medium": 0.020, "Small": 0.024, "Extra Small": 0.030 },
  batting: { "Warm & Natural": 0.318, "Polyester": 0.300 },
  thread_flat: 3.00,
  binding_flat: 25.00,
  tax_rate: 6.0,
};

let currentPricing = DEFAULT_PRICING;
let allCustomers = [];
let allOrders = [];
let allTasks = [];
let editingOrderSyncId = null;

function uuid4() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function money(n) {
  return "$" + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function friendlyDate(value) {
  if (!value) return "—";
  const parts = value.split("-");
  if (parts.length !== 3) return value;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// -----------------------------------------------------------------
// Auth
// -----------------------------------------------------------------

function describeAuthError(error) {
  const code = error && error.code;
  const messages = {
    "auth/wrong-password": "That password doesn't match this email.",
    "auth/user-not-found": "No login exists for that email — check it matches exactly what you created in Firebase.",
    "auth/invalid-email": "That doesn't look like a valid email address.",
    "auth/invalid-credential": "That email and password combination wasn't recognized.",
    "auth/unauthorized-domain": "This page's web address isn't allowed to log in yet. In Firebase: Authentication -> Settings -> Authorized domains -> Add domain, and add this page's address (e.g. yourusername.github.io).",
    "auth/invalid-api-key": "The Firebase config on this page looks wrong — double-check firebase-config.js against what Firebase shows you.",
    "auth/network-request-failed": "Couldn't reach Firebase — check your internet connection.",
    "auth/too-many-requests": "Too many attempts in a row — wait a minute and try again.",
    "auth/user-disabled": "This login has been disabled in Firebase.",
  };
  return messages[code] || ("Couldn't log in (" + (code || "unknown error") + ").");
}

document.getElementById("loginForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("loginError");
  const statusEl = document.getElementById("loginStatus");
  errorEl.hidden = true;
  statusEl.textContent = "Logging in...";
  auth.signInWithEmailAndPassword(email, password)
    .then(function () { statusEl.textContent = ""; })
    .catch(function (error) {
      statusEl.textContent = "";
      errorEl.textContent = describeAuthError(error);
      errorEl.hidden = false;
      console.error("Login error:", error);
    });
});

document.getElementById("logoutBtn").addEventListener("click", function () {
  auth.signOut();
});

auth.onAuthStateChanged(function (user) {
  const loginView = document.getElementById("loginView");
  const appShell = document.getElementById("appShell");
  if (user) {
    loginView.hidden = true;
    appShell.hidden = false;
    loadInitialData();
  } else {
    loginView.hidden = false;
    appShell.hidden = true;
  }
});

// -----------------------------------------------------------------
// Navigation
// -----------------------------------------------------------------

document.querySelectorAll(".navbtn[data-view]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    if (btn.dataset.view === "new-order") {
      editingOrderSyncId = null;
      document.getElementById("orderFormTitle").textContent = "New order";
      showView("new-order");
      resetNewOrderForm();
    } else {
      showView(btn.dataset.view);
    }
  });
});

function showView(name) {
  document.querySelectorAll(".view").forEach(function (v) { v.hidden = true; });
  document.getElementById("view-" + name).hidden = false;
  document.querySelectorAll(".navbtn[data-view]").forEach(function (b) {
    b.classList.toggle("is-active", b.dataset.view === name);
  });
  loadInitialData();
}

function openOrderForEdit(syncId) {
  const order = allOrders.find(function (o) { return o.sync_id === syncId; });
  if (!order) return;
  const customer = allCustomers.find(function (c) { return c.sync_id === order.customer_sync_id; });
  editingOrderSyncId = syncId;
  populateDropdowns();
  fillOrderForm(order, customer);
  document.getElementById("orderFormTitle").textContent = "Edit order";
  showView("new-order");
  recalcTotal();
}

function fillOrderForm(order, customer) {
  document.getElementById("customer_sync_id").value = order.customer_sync_id || "";
  document.getElementById("customer_name").value = customer ? customer.name || "" : "";
  document.getElementById("customer_address").value = customer ? customer.address || "" : "";
  document.getElementById("customer_phone").value = customer ? customer.phone || "" : "";
  document.getElementById("customer_email").value = customer ? customer.email || "" : "";
  document.getElementById("customerSearch").value = "";
  document.getElementById("customerSuggestions").innerHTML = "";

  document.getElementById("date_in").value = order.date_in || "";
  document.getElementById("due_date").value = order.due_date || "";

  document.getElementById("front_fabric_width").value = order.front_fabric_width || "";
  document.getElementById("front_fabric_height").value = order.front_fabric_height || "";
  document.getElementById("back_fabric_width").value = order.back_fabric_width || "";
  document.getElementById("back_fabric_height").value = order.back_fabric_height || "";

  document.getElementById("quilting_design_no_pref").checked = !!order.quilting_design_no_pref;
  document.getElementById("quilting_design").value = order.quilting_design || "";
  document.getElementById("quilting_design").disabled = !!order.quilting_design_no_pref;
  document.getElementById("quilting_size").value = order.quilting_size || "";

  document.getElementById("batting_type").value = order.batting_type || "";
  document.getElementById("batting_type_no_pref").checked = !!order.batting_type_no_pref;
  document.getElementById("batting_size").value = order.batting_size || "";

  document.getElementById("top_thread_no_pref").checked = !!order.top_thread_no_pref;
  document.getElementById("top_thread").value = order.top_thread || "";
  document.getElementById("top_thread").disabled = !!order.top_thread_no_pref;

  document.getElementById("bottom_thread_same_as_top").checked = !!order.bottom_thread_same_as_top;
  document.getElementById("bottom_thread").value = order.bottom_thread || "";
  document.getElementById("bottom_thread").disabled = !!order.bottom_thread_same_as_top;

  document.getElementById("seaming_cost").value = order.seaming_cost || "";
  document.getElementById("piecing_cost").value = order.piecing_cost || "";
  document.getElementById("completed_quilt_purchase").value = order.completed_quilt_purchase || "";

  document.getElementById("binding_who").value = order.binding_who || "Customer will do it";
  document.getElementById("binding_cut_type").value = order.binding_cut_type || "Cross Cut";
  document.getElementById("binding_color").value = order.binding_color || "";
  applyBinding();

  document.getElementById("notes").value = order.notes || "";
}

document.getElementById("syncStatusBtn").addEventListener("click", loadInitialData);

// -----------------------------------------------------------------
// Data loading
// -----------------------------------------------------------------

function loadInitialData() {
  db.collection("app_settings").doc("pricing").get().then(function (doc) {
    currentPricing = doc.exists ? doc.data() : DEFAULT_PRICING;
  }).catch(function () { currentPricing = DEFAULT_PRICING; });

  db.collection("app_settings").doc("business_info").get().then(function (doc) {
    const info = doc.exists ? doc.data() : {};
    if (info.name) {
      document.getElementById("appBrand").textContent = info.name;
      document.getElementById("loginBrand").textContent = info.name;
    }
  }).catch(function () {});

  db.collection("customers").get().then(function (snap) {
    allCustomers = snap.docs.map(function (d) { return Object.assign({ sync_id: d.id }, d.data()); });
  });

  db.collection("tasks").get().then(function (snap) {
    allTasks = snap.docs.map(function (d) { return Object.assign({ sync_id: d.id }, d.data()); })
      .filter(function (t) { return !t.deleted; });
    renderHome();
  });

  db.collection("orders").get().then(function (snap) {
    allOrders = snap.docs.map(function (d) { return Object.assign({ sync_id: d.id }, d.data()); })
      .filter(function (o) { return !o.deleted; });
    renderHome();
    renderOrders();
  });
}

// -----------------------------------------------------------------
// Home view
// -----------------------------------------------------------------

function renderHome() {
  const dueList = document.getElementById("homeDueList");
  const twoWeeks = new Date();
  twoWeeks.setDate(twoWeeks.getDate() + 14);
  const twoWeeksIso = twoWeeks.toISOString().slice(0, 10);

  const due = allOrders
    .filter(function (o) { return o.status !== "Completed" && o.due_date && o.due_date <= twoWeeksIso; })
    .sort(function (a, b) { return (a.due_date || "").localeCompare(b.due_date || ""); });

  dueList.innerHTML = "";
  if (due.length === 0) {
    dueList.innerHTML = '<li class="empty-note">Nothing due in the next two weeks.</li>';
  } else {
    due.forEach(function (o) {
      const customer = allCustomers.find(function (c) { return c.sync_id === o.customer_sync_id; });
      const li = document.createElement("li");
      li.innerHTML = '<span>' + (customer ? customer.name : "Unknown customer") + '</span>' +
        '<span class="event-date">due ' + friendlyDate(o.due_date) + '</span>';
      dueList.appendChild(li);
    });
  }

  const taskList = document.getElementById("homeTaskList");
  const openTasks = allTasks.filter(function (t) { return !t.done; })
    .sort(function (a, b) { return (a.due_date || "9999").localeCompare(b.due_date || "9999"); });

  taskList.innerHTML = "";
  if (openTasks.length === 0) {
    taskList.innerHTML = '<li class="empty-note">No open tasks.</li>';
  } else {
    openTasks.forEach(function (t) {
      const li = document.createElement("li");
      li.dataset.syncId = t.sync_id;
      const btn = document.createElement("button");
      btn.className = "checkbox-btn";
      btn.textContent = "☐";
      btn.addEventListener("click", function () { toggleTaskDone(t.sync_id, li, btn); });
      li.appendChild(btn);
      const span = document.createElement("span");
      span.textContent = t.description;
      li.appendChild(span);
      if (t.due_date) {
        const dateSpan = document.createElement("span");
        dateSpan.className = "event-date";
        dateSpan.textContent = "due " + friendlyDate(t.due_date);
        li.appendChild(dateSpan);
      }
      taskList.appendChild(li);
    });
  }
}

function toggleTaskDone(syncId, li, btn) {
  const nowDone = !li.classList.contains("task-done-locally");
  li.classList.toggle("task-done-locally", nowDone);
  btn.textContent = nowDone ? "☑" : "☐";
  db.collection("tasks").doc(syncId).update({ done: nowDone, updated_at: new Date().toISOString() })
    .catch(function () {
      // Revert the visual state if the write failed (e.g. no connection)
      li.classList.toggle("task-done-locally", !nowDone);
      btn.textContent = !nowDone ? "☑" : "☐";
      alert("Couldn't save — check your internet connection and try again.");
    });
}

document.getElementById("quickTaskForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const input = document.getElementById("quickTaskDescription");
  const description = input.value.trim();
  if (!description) return;
  const now = new Date().toISOString();
  const syncId = uuid4();
  db.collection("tasks").doc(syncId).set({ description: description, due_date: null, done: false, updated_at: now })
    .then(function () {
      allTasks.push({ sync_id: syncId, description: description, due_date: null, done: false, updated_at: now });
      input.value = "";
      renderHome();
    })
    .catch(function () { alert("Couldn't save — check your internet connection and try again."); });
});

// -----------------------------------------------------------------
// Orders view
// -----------------------------------------------------------------

function renderOrders() {
  const list = document.getElementById("ordersList");
  const active = allOrders.filter(function (o) { return o.status !== "Completed"; })
    .sort(function (a, b) { return (a.due_date || "9999").localeCompare(b.due_date || "9999"); });

  list.innerHTML = "";
  if (active.length === 0) {
    list.innerHTML = '<p class="empty-note">No active orders.</p>';
    return;
  }

  active.forEach(function (o) {
    const customer = allCustomers.find(function (c) { return c.sync_id === o.customer_sync_id; });
    const card = document.createElement("div");
    card.className = "order-card";
    const statusClass = (o.status || "").toLowerCase().replace(/ /g, "-");
    card.innerHTML =
      '<div class="order-card-main">' +
        '<span class="order-name">' + (customer ? customer.name : "Unknown customer") + '</span>' +
        '<span class="badge badge-' + statusClass + '">' + o.status + '</span>' +
      '</div>' +
      '<div class="order-card-meta">' +
        '<span>Due ' + friendlyDate(o.due_date) + '</span>' +
        '<span>' + money(o.grand_total) + '</span>' +
      '</div>' +
      '<div class="order-card-actions">' +
        '<button class="btn btn-small btn-secondary" data-edit="' + o.sync_id + '">View / Edit</button>' +
        '<button class="btn btn-small btn-primary" data-complete="' + o.sync_id + '">Mark complete</button>' +
      '</div>';
    list.appendChild(card);
  });

  list.querySelectorAll("[data-edit]").forEach(function (btn) {
    btn.addEventListener("click", function () { openOrderForEdit(btn.dataset.edit); });
  });

  list.querySelectorAll("[data-complete]").forEach(function (btn) {
    btn.addEventListener("click", function () { completeOrder(btn.dataset.complete); });
  });
}

function completeOrder(syncId) {
  db.collection("orders").doc(syncId).update({
    status: "Completed",
    check_out_date: todayIso(),
    updated_at: new Date().toISOString(),
  }).then(function () {
    const order = allOrders.find(function (o) { return o.sync_id === syncId; });
    if (order) { order.status = "Completed"; order.check_out_date = todayIso(); }
    renderOrders();
    renderHome();
  }).catch(function () {
    alert("Couldn't save — check your internet connection and try again.");
  });
}

// -----------------------------------------------------------------
// New order form
// -----------------------------------------------------------------

function populateDropdowns() {
  const qsizeSelect = document.getElementById("quilting_size");
  qsizeSelect.innerHTML = QUILTING_SIZES.map(function (s) {
    const rate = (currentPricing.qsize && currentPricing.qsize[s]) || 0;
    return '<option value="' + s + '">' + s + " ($" + rate.toFixed(3) + "/sq in)</option>";
  }).join("");

  const battingSelect = document.getElementById("batting_type");
  battingSelect.innerHTML = BATTING_TYPES.map(function (b) {
    const rate = (currentPricing.batting && currentPricing.batting[b]) || 0;
    return '<option value="' + b + '">' + b + " ($" + rate.toFixed(3) + "/in)</option>";
  }).join("");
}

function resetNewOrderForm() {
  populateDropdowns();
  document.getElementById("newOrderForm").reset();
  document.getElementById("customer_sync_id").value = "";
  document.getElementById("customerSuggestions").innerHTML = "";
  document.getElementById("date_in").value = todayIso();
  applyBinding();
  recalcTotal();
}

// Customer search
const customerSearchInput = document.getElementById("customerSearch");
customerSearchInput.addEventListener("input", function () {
  const q = customerSearchInput.value.trim().toLowerCase();
  const box = document.getElementById("customerSuggestions");
  box.innerHTML = "";
  if (!q) return;
  const matches = allCustomers.filter(function (c) {
    return (c.name || "").toLowerCase().includes(q) || (c.phone || "").toLowerCase().includes(q);
  }).slice(0, 6);
  matches.forEach(function (c) {
    const item = document.createElement("div");
    item.className = "suggestion-item";
    item.textContent = c.name + " — " + (c.phone || "no phone");
    item.addEventListener("click", function () {
      document.getElementById("customer_sync_id").value = c.sync_id;
      document.getElementById("customer_name").value = c.name || "";
      document.getElementById("customer_address").value = c.address || "";
      document.getElementById("customer_phone").value = c.phone || "";
      document.getElementById("customer_email").value = c.email || "";
      box.innerHTML = "";
      customerSearchInput.value = "";
    });
    box.appendChild(item);
  });
});

// No-preference / same-as-top toggles
function wireNoPref(checkboxId, fieldId) {
  const box = document.getElementById(checkboxId);
  const field = document.getElementById(fieldId);
  const apply = function () { field.disabled = box.checked; if (box.checked) field.value = ""; };
  box.addEventListener("change", apply);
}
wireNoPref("quilting_design_no_pref", "quilting_design");
wireNoPref("top_thread_no_pref", "top_thread");

const sameAsTopBox = document.getElementById("bottom_thread_same_as_top");
const bottomThreadField = document.getElementById("bottom_thread");
const topThreadField = document.getElementById("top_thread");
function applySameAsTop() {
  bottomThreadField.disabled = sameAsTopBox.checked;
  if (sameAsTopBox.checked) bottomThreadField.value = topThreadField.value;
}
sameAsTopBox.addEventListener("change", applySameAsTop);
topThreadField.addEventListener("input", function () { if (sameAsTopBox.checked) bottomThreadField.value = topThreadField.value; });

// Binding conditional fields
const bindingWhoSelect = document.getElementById("binding_who");
const bindingExtra = document.getElementById("bindingExtra");
function applyBinding() {
  const show = bindingWhoSelect.value === "Business will do it";
  bindingExtra.hidden = !show;
  document.getElementById("binding_cut_type").required = show;
  document.getElementById("binding_color").required = show;
}
bindingWhoSelect.addEventListener("change", applyBinding);

// Live total (mirrors the same math the computer program uses)
function num(id) {
  const el = document.getElementById(id);
  const n = parseFloat(el ? el.value : "");
  return isNaN(n) ? 0 : n;
}

function calculateGrandTotal() {
  let subtotal = 0;
  const frontSqIn = num("front_fabric_width") * num("front_fabric_height");
  document.getElementById("frontSqInHint").textContent = "= " + frontSqIn.toFixed(1) + " sq in";

  const qsize = document.getElementById("quilting_size").value;
  subtotal += frontSqIn * ((currentPricing.qsize && currentPricing.qsize[qsize]) || 0);

  subtotal += currentPricing.thread_flat || 0;

  const battingSize = num("batting_size");
  if (battingSize) {
    const battingType = document.getElementById("batting_type").value;
    subtotal += battingSize * ((currentPricing.batting && currentPricing.batting[battingType]) || 0);
  }

  if (bindingWhoSelect.value === "Business will do it") subtotal += currentPricing.binding_flat || 0;

  ["seaming_cost", "piecing_cost", "completed_quilt_purchase"].forEach(function (id) {
    subtotal += num(id);
  });

  const taxRate = currentPricing.tax_rate || 0;
  const tax = subtotal * (taxRate / 100);
  return Math.round((subtotal + tax) * 100) / 100;
}

function recalcTotal() {
  document.getElementById("grandTotalDisplay").textContent = money(calculateGrandTotal());
}

document.getElementById("newOrderForm").addEventListener("input", recalcTotal);
document.getElementById("newOrderForm").addEventListener("change", recalcTotal);

// Save
document.getElementById("newOrderForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const now = new Date().toISOString();

  let customerSyncId = document.getElementById("customer_sync_id").value;
  const customerData = {
    name: document.getElementById("customer_name").value.trim(),
    address: document.getElementById("customer_address").value.trim(),
    phone: document.getElementById("customer_phone").value.trim(),
    email: document.getElementById("customer_email").value.trim(),
    updated_at: now,
  };

  const customerPromise = customerSyncId
    ? db.collection("customers").doc(customerSyncId).update(customerData)
    : (function () {
        customerSyncId = uuid4();
        return db.collection("customers").doc(customerSyncId).set(customerData);
      })();

  customerPromise.then(function () {
    const orderData = {
      customer_sync_id: customerSyncId,
      date_in: document.getElementById("date_in").value || null,
      due_date: document.getElementById("due_date").value || null,
      front_fabric_width: num("front_fabric_width"),
      front_fabric_height: num("front_fabric_height"),
      back_fabric_width: num("back_fabric_width"),
      back_fabric_height: num("back_fabric_height"),
      quilting_design: document.getElementById("quilting_design_no_pref").checked ? "" : document.getElementById("quilting_design").value.trim(),
      quilting_design_no_pref: document.getElementById("quilting_design_no_pref").checked,
      quilting_size: document.getElementById("quilting_size").value,
      batting_type: document.getElementById("batting_type").value,
      batting_type_no_pref: document.getElementById("batting_type_no_pref").checked,
      batting_size: num("batting_size") || null,
      top_thread: document.getElementById("top_thread_no_pref").checked ? "" : document.getElementById("top_thread").value.trim(),
      top_thread_no_pref: document.getElementById("top_thread_no_pref").checked,
      bottom_thread: sameAsTopBox.checked ? document.getElementById("top_thread").value.trim() : document.getElementById("bottom_thread").value.trim(),
      bottom_thread_same_as_top: sameAsTopBox.checked,
      seaming_cost: num("seaming_cost") || null,
      binding_who: bindingWhoSelect.value,
      binding_cut_type: bindingExtra.hidden ? null : document.getElementById("binding_cut_type").value,
      binding_color: bindingExtra.hidden ? null : document.getElementById("binding_color").value.trim(),
      piecing_cost: num("piecing_cost") || null,
      completed_quilt_purchase: num("completed_quilt_purchase") || null,
      notes: document.getElementById("notes").value.trim(),
      grand_total: calculateGrandTotal(),
      updated_at: now,
    };

    if (editingOrderSyncId) {
      // Editing: leave status, payment_status, and check_out_date exactly as
      // they are -- this form doesn't show them, so it should never reset a
      // Completed/Paid order back to Not Started/Unpaid.
      return db.collection("orders").doc(editingOrderSyncId).update(orderData);
    }
    orderData.check_out_date = null;
    orderData.status = "Not Started";
    orderData.payment_status = "Unpaid";
    return db.collection("orders").doc(uuid4()).set(orderData);
  }).then(function () {
    alert(editingOrderSyncId ? "Order updated." : "Order saved.");
    editingOrderSyncId = null;
    loadInitialData();
    showView("home");
  }).catch(function () {
    alert("Couldn't save — check your internet connection and try again.");
  });
});

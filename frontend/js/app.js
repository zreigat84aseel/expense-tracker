// Expense Tracker - frontend logic
//
// This page talks to the backend (Phase 1) with fetch and async/await.
// The backend must be running: open the backend folder and run "node server.js".
//
// How the page works:
//   1. refresh() asks the server for all the expenses (GET) and draws the page
//      (summary cards, chart, and table).
//   2. Add, edit, and delete send POST, PUT, and DELETE to the server.
//   3. After every change we call refresh() again, so the page always shows
//      what the server really saved. We never change the table by hand.

const API_URL = "http://localhost:3000/api/expenses";

// Bootstrap colour for the badge of each category
const CATEGORY_COLORS = {
  Food: "text-bg-success",
  Transport: "text-bg-primary",
  Bills: "text-bg-warning",
  Entertainment: "text-bg-info",
  Other: "text-bg-secondary",
};

// The same colours as hex codes, for the chart (Chart.js needs real colour values)
const CHART_COLORS = {
  Food: "#198754",
  Transport: "#0d6efd",
  Bills: "#ffc107",
  Entertainment: "#0dcaf0",
  Other: "#6c757d",
};

// All the expenses that came from the server (the last GET).
// The summary cards use this full list. The table uses a filtered copy of it.
let allExpenses = [];

// The expenses shown in the table right now (after the filter and the search).
// The "Export CSV" button downloads this list.
let filteredExpenses = [];

// The Chart.js chart. We keep it so we can destroy it before drawing a new one.
let categoryChart = null;

// ---------- Elements from the page ----------

const alertBox = document.getElementById("alert-box");
const spinner = document.getElementById("spinner");
const tableWrapper = document.getElementById("table-wrapper");
const tableBody = document.getElementById("expense-table-body");
const filterSelect = document.getElementById("filter-category");
const searchInput = document.getElementById("search-title");
const themeButton = document.getElementById("theme-button");
const exportButton = document.getElementById("export-button");
const chartCanvas = document.getElementById("category-chart");
const chartEmpty = document.getElementById("chart-empty");

const addForm = document.getElementById("add-form");
const addButton = document.getElementById("add-button");

const editForm = document.getElementById("edit-form");
const saveButton = document.getElementById("save-button");
const editModal = new bootstrap.Modal(document.getElementById("edit-modal"));

// ---------- Talking to the server ----------

// One helper for every request, so we don't repeat the same fetch code 4 times.
// It sends the request, reads the JSON, and throws an Error with a clear message
// if something goes wrong. The caller catches it and shows it in an alert.
async function request(url, options) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    // fetch only throws when it cannot reach the server at all (server off, no network)
    throw new Error("Cannot reach the server. Make sure the backend is running (node server.js) and try again.");
  }

  // Read the JSON the server sent back (our server always answers with JSON)
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  // fetch does NOT throw on 400, 404, or 500, so we check response.ok ourselves
  if (!response.ok) {
    // If the server sent a message (for example after 400), show that message
    const message = data && data.message ? data.message : "Request failed with status " + response.status + ".";
    throw new Error(message);
  }

  return data;
}

async function getExpenses() {
  return request(API_URL);
}

async function addExpense(expense) {
  return request(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(expense),
  });
}

async function updateExpense(id, expense) {
  return request(API_URL + "/" + id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(expense),
  });
}

async function deleteExpense(id) {
  return request(API_URL + "/" + id, { method: "DELETE" });
}

// ---------- Loading and drawing the page ----------

// Get the list from the server and draw the table and the summary cards
async function refresh() {
  showSpinner(true);

  try {
    allExpenses = await getExpenses();
    renderSummary(allExpenses);
    renderChart(allExpenses);
    applyFilter();
  } catch (error) {
    allExpenses = [];
    filteredExpenses = [];
    renderSummary(allExpenses);
    renderChart(allExpenses);
    renderTable([], "Could not load the expenses.");
    showAlert(error.message, "danger");
  } finally {
    // finally runs in both cases (success or error), so the spinner always goes away
    showSpinner(false);
  }
}

// Draw the table rows from an array of expenses
function renderTable(list, emptyMessage) {
  tableBody.innerHTML = "";

  if (list.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "text-center text-body-secondary py-4";
    cell.textContent = emptyMessage || "No expenses found.";
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  for (const expense of list) {
    const row = document.createElement("tr");

    // textContent (not innerHTML) so a title like "<b>hi</b>" shows as text and never runs as HTML
    const titleCell = document.createElement("td");
    titleCell.textContent = expense.title;

    const amountCell = document.createElement("td");
    amountCell.className = "text-end";
    amountCell.textContent = formatAmount(expense.amount);

    const categoryCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge " + (CATEGORY_COLORS[expense.category] || "text-bg-secondary");
    badge.textContent = expense.category;
    categoryCell.appendChild(badge);

    const dateCell = document.createElement("td");
    dateCell.className = "text-nowrap";
    dateCell.textContent = expense.date;

    const actionsCell = document.createElement("td");
    actionsCell.className = "text-end text-nowrap";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "btn btn-sm btn-outline-secondary me-1";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", function () {
      openEditModal(expense.id);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn btn-sm btn-outline-danger";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", function () {
      handleDelete(expense);
    });

    actionsCell.appendChild(editButton);
    actionsCell.appendChild(deleteButton);

    row.appendChild(titleCell);
    row.appendChild(amountCell);
    row.appendChild(categoryCell);
    row.appendChild(dateCell);
    row.appendChild(actionsCell);
    tableBody.appendChild(row);
  }
}

// Update the 4 summary cards (always from the FULL list, not the filtered one)
function renderSummary(list) {
  let total = 0;
  let highest = null;

  for (const expense of list) {
    total += expense.amount;
    if (highest === null || expense.amount > highest.amount) {
      highest = expense;
    }
  }

  document.getElementById("total-amount").textContent = formatAmount(total);
  document.getElementById("expense-count").textContent = list.length;
  document.getElementById("highest-amount").textContent = highest ? formatAmount(highest.amount) : formatAmount(0);
  document.getElementById("highest-title").textContent = highest ? highest.title : "-";

  // Average = total / number of expenses. If the list is empty, we show 0 (no division by 0).
  const average = list.length > 0 ? total / list.length : 0;
  document.getElementById("average-amount").textContent = formatAmount(average);
}

// ---------- Chart (bonus) ----------

// Draw a doughnut chart: how much money went to each category.
// Like the cards, it always uses the FULL list.
function renderChart(list) {
  // If Chart.js did not load (for example no internet), skip the chart and keep the page working
  if (typeof Chart === "undefined") {
    return;
  }

  // Add up the amounts of each category: { Food: 20.5, Bills: 50, ... }
  const totals = {};
  for (const expense of list) {
    totals[expense.category] = (totals[expense.category] || 0) + expense.amount;
  }

  const labels = Object.keys(totals);
  const values = labels.map(function (category) {
    return Number(totals[category].toFixed(2));
  });
  const colors = labels.map(function (category) {
    return CHART_COLORS[category] || "#6c757d";
  });

  // Remove the old chart before drawing a new one (Chart.js cannot draw twice on the same canvas)
  if (categoryChart !== null) {
    categoryChart.destroy();
    categoryChart = null;
  }

  // No data: hide the canvas and show a message instead
  const noData = labels.length === 0;
  chartCanvas.parentElement.classList.toggle("d-none", noData);
  chartEmpty.classList.toggle("d-none", !noData);
  if (noData) {
    return;
  }

  // The text colour of the page, so the legend is readable in light AND dark mode
  const textColor = getComputedStyle(document.body).color;

  categoryChart = new Chart(chartCanvas, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          // Legend on the right on a wide screen, under the chart on a phone
          position: window.innerWidth < 576 ? "bottom" : "right",
          labels: { color: textColor },
        },
        tooltip: {
          callbacks: {
            // Show "Food: 20.50" when you hover a part of the chart
            label: function (context) {
              return context.label + ": " + formatAmount(context.parsed);
            },
          },
        },
      },
    },
  });
}

// Show only the expenses that match the chosen category AND the search text.
// "All" means every category, and an empty search box means every title.
function applyFilter() {
  const category = filterSelect.value;
  const searchText = searchInput.value.trim().toLowerCase();

  filteredExpenses = allExpenses.filter(function (expense) {
    const categoryMatches = category === "All" || expense.category === category;
    // toLowerCase on both sides, so "lunch" also finds "Lunch"
    const titleMatches = expense.title.toLowerCase().includes(searchText);
    return categoryMatches && titleMatches;
  });

  if (allExpenses.length === 0) {
    renderTable(filteredExpenses, "No expenses yet. Add your first one above.");
  } else {
    renderTable(filteredExpenses, "No expenses match your filter.");
  }
}

// ---------- Export CSV (bonus) ----------

// Download the expenses shown in the table (after the filter and the search) as a CSV file.
// CSV = "comma-separated values": a text file that Excel opens as a table.
function exportCsv() {
  if (filteredExpenses.length === 0) {
    showAlert("There are no expenses to export.", "warning");
    return;
  }

  const lines = ["Title,Amount,Category,Date"];
  for (const expense of filteredExpenses) {
    lines.push(
      [
        csvCell(expense.title),
        formatAmount(expense.amount),
        csvCell(expense.category),
        expense.date,
      ].join(",")
    );
  }

  // "\uFEFF" at the start tells Excel the file is UTF-8, so Arabic titles show correctly
  const csvText = "\uFEFF" + lines.join("\r\n");

  // Make a file in the browser memory (Blob) and download it with a hidden link
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "expenses-" + todayString() + ".csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  showAlert("Exported " + filteredExpenses.length + " expenses to CSV.", "success");
}

// Make one text value safe to put in a CSV cell
function csvCell(text) {
  let value = String(text);

  // CSV injection: Excel runs a cell that starts with = + - @ as a formula.
  // Adding ' in front makes Excel show it as plain text.
  if (/^[=+\-@]/.test(value)) {
    value = "'" + value;
  }

  // Put the value in "quotes", and write any " inside it as "" (the CSV rule).
  // So a title with a comma, like "Lunch, big", stays in one cell.
  return '"' + value.replace(/"/g, '""') + '"';
}

// ---------- Add ----------

async function handleAdd(event) {
  event.preventDefault(); // stop the browser from reloading the page

  const expense = readForm("add");
  if (expense === null) {
    return; // the form has errors, and they are already shown under the fields
  }

  addButton.disabled = true;
  try {
    await addExpense(expense);
    showAlert('Expense "' + expense.title + '" added.', "success");
    resetAddForm();
    await refresh(); // ask the server for the list again
  } catch (error) {
    showAlert(error.message, "danger");
  } finally {
    addButton.disabled = false;
  }
}

function resetAddForm() {
  addForm.reset();
  clearErrors("add");
  document.getElementById("add-date").value = todayString();
}

// ---------- Edit ----------

// Fill the modal with the current data of this expense, then open it
function openEditModal(id) {
  const expense = allExpenses.find(function (item) {
    return item.id === id;
  });
  if (!expense) {
    return;
  }

  clearErrors("edit");
  document.getElementById("edit-id").value = expense.id;
  document.getElementById("edit-title").value = expense.title;
  document.getElementById("edit-amount").value = expense.amount;
  document.getElementById("edit-category").value = expense.category;
  document.getElementById("edit-date").value = expense.date;

  editModal.show();
}

async function handleEdit(event) {
  event.preventDefault();

  const expense = readForm("edit");
  if (expense === null) {
    return;
  }
  const id = document.getElementById("edit-id").value;

  saveButton.disabled = true;
  try {
    await updateExpense(id, expense);
    editModal.hide();
    showAlert('Expense "' + expense.title + '" updated.', "success");
    await refresh();
  } catch (error) {
    editModal.hide();
    showAlert(error.message, "danger");
  } finally {
    saveButton.disabled = false;
  }
}

// ---------- Delete ----------

async function handleDelete(expense) {
  const sure = confirm('Delete "' + expense.title + '"?');
  if (!sure) {
    return;
  }

  try {
    await deleteExpense(expense.id);
    showAlert('Expense "' + expense.title + '" deleted.', "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
  // Refresh in both cases: if someone already deleted it, the table still shows the truth
  await refresh();
}

// ---------- Form validation ----------

// Read and check the 4 fields of a form. "prefix" is "add" or "edit",
// because the fields are named add-title, edit-title, and so on.
// Returns the expense object if all is good, or null if there are errors.
function readForm(prefix) {
  clearErrors(prefix);

  const titleInput = document.getElementById(prefix + "-title");
  const amountInput = document.getElementById(prefix + "-amount");
  const categoryInput = document.getElementById(prefix + "-category");
  const dateInput = document.getElementById(prefix + "-date");

  const title = titleInput.value.trim();
  const amount = Number(amountInput.value);
  const category = categoryInput.value;
  const date = dateInput.value;

  let valid = true;

  if (title === "") {
    showFieldError(titleInput, "Title is required.");
    valid = false;
  }

  // amountInput.value is "" when the field is empty or has something that is not a number
  if (amountInput.value === "" || !Number.isFinite(amount) || amount <= 0) {
    showFieldError(amountInput, "Enter an amount greater than 0.");
    valid = false;
  }

  if (category === "") {
    showFieldError(categoryInput, "Choose a category.");
    valid = false;
  }

  if (date === "") {
    showFieldError(dateInput, "Date is required.");
    valid = false;
  }

  if (!valid) {
    return null;
  }

  return { title: title, amount: amount, category: category, date: date };
}

// Mark a field red and write the message under it (Bootstrap "is-invalid")
function showFieldError(input, message) {
  input.classList.add("is-invalid");
  input.nextElementSibling.textContent = message;
}

function clearErrors(prefix) {
  const fields = ["title", "amount", "category", "date"];
  for (const field of fields) {
    document.getElementById(prefix + "-" + field).classList.remove("is-invalid");
  }
}

// ---------- Small helpers ----------

function showSpinner(show) {
  spinner.classList.toggle("d-none", !show);
  tableWrapper.classList.toggle("d-none", show);
}

// Show a Bootstrap alert at the top of the page. type is "success", "danger", or "warning".
function showAlert(message, type) {
  alertBox.innerHTML = "";

  const alert = document.createElement("div");
  alert.className = "alert alert-" + type + " alert-dismissible fade show";
  alert.setAttribute("role", "alert");
  alert.textContent = message;

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "btn-close";
  closeButton.setAttribute("data-bs-dismiss", "alert");
  closeButton.setAttribute("aria-label", "Close");
  alert.appendChild(closeButton);

  alertBox.appendChild(alert);

  // Success messages go away by themselves after 3 seconds. Errors stay until closed.
  if (type === "success") {
    setTimeout(function () {
      alert.remove();
    }, 3000);
  }
}

// 4.5 -> "4.50"
function formatAmount(amount) {
  return amount.toFixed(2);
}

// Today's date as "YYYY-MM-DD" in the user's own time zone
function todayString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return now.getFullYear() + "-" + month + "-" + day;
}

// ---------- Dark mode (bonus) ----------

// Bootstrap 5.3 changes all its colours when the <html> tag has data-bs-theme="dark"
function setTheme(theme) {
  document.documentElement.setAttribute("data-bs-theme", theme);
  themeButton.textContent = theme === "dark" ? "Light mode" : "Dark mode";

  // Remember the choice, so the page opens in the same mode next time
  try {
    localStorage.setItem("theme", theme);
  } catch (error) {
    // localStorage can be blocked (private window). The page still works without it.
  }

  // Draw the chart again, so its legend text gets the new colour
  renderChart(allExpenses);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-bs-theme");
  setTheme(current === "dark" ? "light" : "dark");
}

// The saved theme, or "light" if there is none
function savedTheme() {
  try {
    return localStorage.getItem("theme") === "dark" ? "dark" : "light";
  } catch (error) {
    return "light";
  }
}

// ---------- Start ----------

addForm.addEventListener("submit", handleAdd);
editForm.addEventListener("submit", handleEdit);
filterSelect.addEventListener("change", applyFilter);
searchInput.addEventListener("input", applyFilter); // "input" runs on every letter you type
themeButton.addEventListener("click", toggleTheme);
exportButton.addEventListener("click", exportCsv);

setTheme(savedTheme());
document.getElementById("add-date").value = todayString();
refresh();

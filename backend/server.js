// Expense Tracker - backend (Express API + PostgreSQL)
//
// Run: node server.js   (restart it every time you change this file)
//
// Endpoints:
//   GET    /api/expenses        all expenses                 200
//   GET    /api/expenses/:id    one expense                  200 | 404
//   POST   /api/expenses        add an expense               201 | 400
//   PUT    /api/expenses/:id    update an expense            200 | 400 | 404
//   DELETE /api/expenses/:id    delete an expense            200 | 404
//
// Rules we follow:
//   - Every query sends the values as parameters ($1, $2...), never joined into the SQL text.
//   - The data is validated before the query, and bad data gets 400 with a clear message.
//   - The id is checked before the query, and a wrong or missing id gets 404.

require("dotenv").config(); // load .env into process.env (must be first)

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Middleware ----------

app.use(cors());         // let the frontend (another origin) read our responses
app.use(express.json()); // read JSON bodies into req.body

// ---------- Database ----------

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// ---------- Constants ----------

const CATEGORIES = ["Food", "Transport", "Bills", "Entertainment", "Other"];

// The columns we send back, fixed so the frontend gets clean values:
//   amount::float8               -> a real number (pg returns NUMERIC as text)
//   to_char(date, 'YYYY-MM-DD')  -> a plain "2026-01-15" string (no time zone shift)
// This text is written by us, not by the user, so it is safe to join into the SQL.
const COLUMNS =
  "id, title, amount::float8 AS amount, category, to_char(date, 'YYYY-MM-DD') AS date";

const MAX_ID = 2147483647;       // biggest value a PostgreSQL INTEGER (SERIAL) can hold
const MAX_AMOUNT = 99999999.99;  // biggest value NUMERIC(10,2) can hold
const MAX_TITLE_LENGTH = 100;    // VARCHAR(100)

// ---------- Helpers ----------

// Turn the :id from the URL into a valid number, or return null.
// req.params.id is always text, so "abc", "1.5", "0", and "-3" all return null.
function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > MAX_ID) {
    return null;
  }
  return id;
}

// Check that text is a real calendar date in the format YYYY-MM-DD.
// "2026-02-30" has the right shape but is not a real date, so it fails.
function isValidDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const parsed = new Date(text + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

// Validate the body of a POST or PUT.
// Returns { error: "message" } if something is wrong,
// or { value: { title, amount, category, date } } with clean data if all is good.
function validateExpense(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "The request body must be a JSON object." };
  }

  const { title, amount, category, date } = body;

  if (typeof title !== "string" || title.trim() === "") {
    return { error: "Title is required." };
  }
  if (title.trim().length > MAX_TITLE_LENGTH) {
    return { error: "Title must be " + MAX_TITLE_LENGTH + " characters or less." };
  }

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return { error: "Amount must be a number greater than 0." };
  }
  if (amount > MAX_AMOUNT) {
    return { error: "Amount is too large." };
  }

  if (!CATEGORIES.includes(category)) {
    return { error: "Category must be one of: " + CATEGORIES.join(", ") + "." };
  }

  if (!isValidDate(date)) {
    return { error: "Date is required and must be a valid date in the format YYYY-MM-DD." };
  }

  return { value: { title: title.trim(), amount, category, date } };
}

// ---------- Routes ----------

// GET /api/expenses - all expenses, oldest first
app.get("/api/expenses", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT " + COLUMNS + " FROM expenses ORDER BY date, id"
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

// GET /api/expenses/:id - one expense
app.get("/api/expenses/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(404).json({ message: "Expense not found." });
  }

  try {
    const result = await pool.query(
      "SELECT " + COLUMNS + " FROM expenses WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Expense not found." });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

// POST /api/expenses - add a new expense
app.post("/api/expenses", async (req, res) => {
  const check = validateExpense(req.body);
  if (check.error) {
    return res.status(400).json({ message: check.error });
  }

  const { title, amount, category, date } = check.value;

  try {
    const result = await pool.query(
      "INSERT INTO expenses (title, amount, category, date) VALUES ($1, $2, $3, $4) RETURNING " +
        COLUMNS,
      [title, amount, category, date]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

// PUT /api/expenses/:id - update an expense (all fields are required)
app.put("/api/expenses/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(404).json({ message: "Expense not found." });
  }

  const check = validateExpense(req.body);
  if (check.error) {
    return res.status(400).json({ message: check.error });
  }

  const { title, amount, category, date } = check.value;

  try {
    const result = await pool.query(
      "UPDATE expenses SET title = $1, amount = $2, category = $3, date = $4 WHERE id = $5 RETURNING " +
        COLUMNS,
      [title, amount, category, date, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Expense not found." });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

// DELETE /api/expenses/:id - delete an expense
app.delete("/api/expenses/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(404).json({ message: "Expense not found." });
  }

  try {
    const result = await pool.query(
      "DELETE FROM expenses WHERE id = $1 RETURNING " + COLUMNS,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Expense not found." });
    }

    res.json({ message: "Expense deleted.", expense: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

// ---------- Fallbacks (must come after all routes) ----------

// Any path that no route above matched -> JSON 404 instead of an HTML page
app.use((req, res) => {
  res.status(404).json({ message: "Route not found." });
});

// Errors thrown before a route runs, like a broken JSON body -> JSON instead of an HTML page
app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ message: "The request body is not valid JSON." });
  }
  console.error(error);
  res.status(500).json({ message: "Server error. Please try again later." });
});

// ---------- Start ----------

app.listen(PORT, (error) => {
  if (error) {
    console.error("Could not start the server: " + error.message);
    return;
  }
  console.log("Server running on http://localhost:" + PORT);
});

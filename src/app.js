const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const { swaggerUi, swaggerDocument } = require("./config/swagger");
const { pool } = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const salesRoutes = require("./routes/salesRoutes");
const shopRoutes = require("./routes/shopRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const aiRoutes = require("./routes/aiRoutes");
const alertsRoutes = require("./routes/alertsRoutes");
const auditRoutes = require("./routes/auditRoutes");
const reportsRoutes = require("./routes/reportsRoutes");

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));

// Health endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Smart Loss Control Backend running" });
});

// PostgreSQL test endpoint
app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ dbTime: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Routes
app.use("/auth", authRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/sales", salesRoutes);
app.use("/shops", shopRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/ai", aiRoutes);
app.use("/alerts", alertsRoutes);
app.use("/audit", auditRoutes);
app.use("/reports", reportsRoutes);

// Swagger docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

module.exports = app;

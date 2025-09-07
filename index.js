const express = require("express");
const cors = require("cors");
const connectDB = require("./config/database");
const bodyParser = require("body-parser");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Simplified CORS configuration - Allow ALL origins and headers
const corsOptions = {
  origin: true, // Allows ALL origins
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: "*", // Allows ALL headers
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false,
};

// Apply CORS middleware first
app.use(cors(corsOptions));

// Manual CORS headers as additional safety net
app.use((req, res, next) => {
  // Allow all origins
  res.header("Access-Control-Allow-Origin", "*");

  // Allow all methods
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD"
  );

  // Allow all headers
  res.header("Access-Control-Allow-Headers", "*");

  // Allow credentials
  res.header("Access-Control-Allow-Credentials", "true");

  // Handle preflight OPTIONS requests
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});

// Handle all preflight requests
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.status(200).end();
});

// Body parsing middleware
app.use(express.urlencoded({ extended: true, limit: "200mb" }));
app.use(bodyParser.json({ limit: "200mb" }));
app.use(bodyParser.urlencoded({ limit: "200mb", extended: true }));

// File upload middleware
const fileUpload = require("express-fileupload");

app.use(
  fileUpload({
    createParentPath: true,
    limits: {
      fileSize: 200 * 1024 * 1024, // 200MB
    },
    abortOnLimit: true,
    useTempFiles: false,
    debug: false,
    parseNested: true,
  })
);

app.use(express.json({ limit: "200mb" }));

// MongoDB Connection
connectDB();

// Routes
app.get("/", (req, res) => {
  res.send("<h1>Backend Working</h1>");
});

app.use("/api/admin", require("./routes/admin"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/courses", require("./routes/courses"));
app.use("/api/lectures", require("./routes/lecture"));
app.use("/api/semesters", require("./routes/semester"));
app.use("/api/students", require("./routes/students"));
app.use("/api/teachers", require("./routes/teachers"));
app.use("/api/events", require("./routes/event"));
app.use("/api/assignment", require("./routes/assignment"));
app.use("/api/activity", require("./routes/activity"));
app.use("/api/econtent", require("./routes/econtent"));
app.use("/api/students", require("./routes/getStudents"));
app.use("/api/announcement", require("./routes/announcement"));
app.use("/api/syllabus", require("./routes/syllabus"));
app.use("/api/discussion", require("./routes/discussion"));
app.use("/api/articles", require("./routes/articles"));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);

  // Ensure CORS headers are present even in error responses
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Credentials", "true");

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: "File too large",
      message: "Maximum file size is 200MB",
    });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      error: "Payload too large",
      message: "Request payload exceeds maximum size of 200MB",
    });
  }
  res.status(500).json({ error: "Internal Server Error" });
});

// 404 handler with CORS headers
app.use((req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("CORS configured: All origins and headers allowed");
});

const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");
const uploadMiddleware = require("../middleware/upload");

// Test route to verify router is working
router.get("/test", (req, res) => {
  res.json({ message: "Auth routes working" });
});

// Simplified file upload route for testing
router.post(
  "/upload-users",
  auth,
  checkRole(["admin"]),
  uploadMiddleware, // Now a direct middleware, not a factory function
  adminController.uploadUsers
);
router.get(
  "/my-students",
  auth, // Authentication middleware
  checkRole(["teacher", "student"]), // Role check middleware
  adminController.getMyStudents
);

// Admin route to get students for any teacher by ID
router.get(
  "/teacher/:teacherId/students",
  auth,
  checkRole(["teacher", "student"]),
  adminController.getStudentsByTeacherId
);

module.exports = router;

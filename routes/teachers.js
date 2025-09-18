const express = require("express");
const router = express.Router();
const {
  assignStudent,
  getStudents,
} = require("../controllers/teacherController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Get students (teacher, student, and admin)
router.get(
  "/students",
  auth,
  checkRole(["teacher", "student", "admin"]),
  getStudents
);

// Assign student (teacher and admin)
router.post(
  "/students/:studentId/assign",
  auth,
  checkRole(["teacher", "admin"]),
  assignStudent
);

module.exports = router;

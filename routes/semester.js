const express = require("express");
const router = express.Router();
const semesterController = require("../controllers/semesterController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Create semester (teacher and admin)
router.post(
  "/",
  auth,
  checkRole(["teacher", "admin"]),
  semesterController.createSemester
);

// Get all semesters (teacher, student, and admin)
router.get(
  "/",
  auth,
  checkRole(["teacher", "student", "admin"]),
  semesterController.getAllSemesters
);

module.exports = router;

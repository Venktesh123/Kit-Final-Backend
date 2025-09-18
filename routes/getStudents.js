const express = require("express");
const router = express.Router();
const studentController = require("../controllers/getStudentsController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Test route to verify router is working
router.get("/test", (req, res) => {
  res.json({ message: "GetStudents routes working" });
});

// Get students for currently authenticated teacher (teacher, student, and admin)
router.get(
  "/my-students",
  auth,
  checkRole(["teacher", "student", "admin"]),
  studentController.getMyStudents
);

// Get students for any teacher by ID (teacher, student, and admin)
router.get(
  "/teacher/:teacherId/students",
  auth,
  checkRole(["teacher", "student", "admin"]),
  studentController.getStudentsByTeacherId
);

module.exports = router;

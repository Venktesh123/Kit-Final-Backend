const express = require("express");
const router = express.Router();
const studentController = require("../controllers/getStudentsController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Test route to verify router is working
router.get("/test", (req, res) => {
  res.json({ message: "Auth routes working" });
});

router.get(
  "/my-students",
  auth, // Authentication middleware
  checkRole(["teacher", "student"]), // Role check middleware
  studentController.getMyStudents
);

// Admin route to get students for any teacher by ID
router.get(
  "/teacher/:teacherId/students",
  auth,
  checkRole(["teacher", "student"]),
  studentController.getStudentsByTeacherId
);

module.exports = router;

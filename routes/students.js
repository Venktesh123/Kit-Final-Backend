const express = require("express");
const router = express.Router();
const studentController = require("../controllers/studentController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Enroll in course (student and admin)
router.post(
  "/courses/:courseId/enroll",
  auth,
  checkRole(["student", "admin"]),
  studentController.enrollCourse
);

module.exports = router;

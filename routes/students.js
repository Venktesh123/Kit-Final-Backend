const express = require("express");
const router = express.Router();
const studentController = require("../controllers/studentController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

router.post(
  "/courses/:courseId/enroll",
  auth,
  checkRole(["student"]),
  studentController.enrollCourse
);

module.exports = router;

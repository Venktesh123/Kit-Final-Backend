const express = require("express");
const router = express.Router();
const semesterController = require("../controllers/semesterController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

router.post(
  "/",
  auth,
  checkRole(["teacher"]),
  semesterController.createSemester
);
router.get(
  "/",
  auth,
  checkRole(["teacher", "student"]),
  semesterController.getAllSemesters
);

module.exports = router;

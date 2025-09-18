const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");
const eContentController = require("../controllers/econtentController");

// Create a module for a course's EContent (teacher and admin)
router.post(
  "/course/:courseId/econtent",
  auth,
  checkRole(["teacher", "admin"]),
  eContentController.createEContent
);

// Get EContent for a specific course (teacher, student, and admin)
router.get(
  "/course/:courseId/econtent",
  auth,
  checkRole(["teacher", "student", "admin"]),
  eContentController.getEContentByCourse
);

// Get specific module by ID (teacher, student, and admin)
router.get(
  "/course/:courseId/econtent/module/:moduleId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  eContentController.getModuleById
);

// Update a module (teacher and admin)
router.put(
  "/course/:courseId/econtent/module/:moduleId",
  auth,
  checkRole(["teacher", "admin"]),
  eContentController.updateModule
);

// Delete a module and all its files (teacher and admin)
router.delete(
  "/course/:courseId/econtent/module/:moduleId",
  auth,
  checkRole(["teacher", "admin"]),
  eContentController.deleteModule
);

// Delete a specific file from a module (teacher and admin)
router.delete(
  "/course/:courseId/econtent/module/:moduleId/file/:fileId",
  auth,
  checkRole(["teacher", "admin"]),
  eContentController.deleteFile
);

module.exports = router;

const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");
const eContentController = require("../controllers/econtentController");

// Create a module for a course's EContent
router.post(
  "/course/:courseId/econtent",
  auth,
  checkRole(["teacher"]),
  eContentController.createEContent
);

// Get EContent for a specific course
router.get(
  "/course/:courseId/econtent",
  auth,
  checkRole(["teacher", "student"]),
  eContentController.getEContentByCourse
);

// Get specific module by ID
router.get(
  "/course/:courseId/econtent/module/:moduleId",
  auth,
  checkRole(["teacher", "student"]),
  eContentController.getModuleById
);

// Update a module
router.put(
  "/course/:courseId/econtent/module/:moduleId",
  auth,
  checkRole(["teacher"]),
  eContentController.updateModule
);

// Delete a module and all its files
router.delete(
  "/course/:courseId/econtent/module/:moduleId",
  auth,
  checkRole(["teacher"]),
  eContentController.deleteModule
);

// Delete a specific file from a module
router.delete(
  "/course/:courseId/econtent/module/:moduleId/file/:fileId",
  auth,
  checkRole(["teacher"]),
  eContentController.deleteFile
);

module.exports = router;

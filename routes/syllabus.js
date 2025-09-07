const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");
const syllabusController = require("../controllers/syllabusController");

// Get syllabus for a specific course
router.get(
  "/course/:courseId/syllabus",
  auth,
  checkRole(["teacher", "student"]),
  syllabusController.getCourseSyllabus
);

// Create a new module for a course
router.post(
  "/course/:courseId/syllabus/modules",
  auth,
  checkRole(["teacher"]),
  syllabusController.createModule
);

// Get specific module by ID
router.get(
  "/course/:courseId/syllabus/module/:moduleId",
  auth,
  checkRole(["teacher", "student"]),
  syllabusController.getModuleById
);

// Update a module (basic info)
router.put(
  "/course/:courseId/syllabus/module/:moduleId",
  auth,
  checkRole(["teacher"]),
  syllabusController.updateModule
);

// Delete a module
router.delete(
  "/course/:courseId/syllabus/module/:moduleId",
  auth,
  checkRole(["teacher"]),
  syllabusController.deleteModule
);

// Add content to module (PDF, PPT, Video, or Link)
router.post(
  "/course/:courseId/syllabus/module/:moduleId/content",
  auth,
  checkRole(["teacher"]),
  syllabusController.addModuleContent
);

// Update content item
router.put(
  "/course/:courseId/syllabus/module/:moduleId/content/:contentType/:contentId",
  auth,
  checkRole(["teacher"]),
  syllabusController.updateContentItem
);

// Delete content item
router.delete(
  "/course/:courseId/syllabus/module/:moduleId/content/:contentType/:contentId",
  auth,
  checkRole(["teacher"]),
  syllabusController.deleteContentItem
);

// Update content order within a module
router.put(
  "/course/:courseId/syllabus/module/:moduleId/content/:contentType/reorder",
  auth,
  checkRole(["teacher"]),
  syllabusController.updateContentOrder
);

module.exports = router;

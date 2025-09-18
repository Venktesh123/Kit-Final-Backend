const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");
const syllabusController = require("../controllers/syllabusController");

// Get syllabus for a specific course (teacher, student, and admin)
router.get(
  "/course/:courseId/syllabus",
  auth,
  checkRole(["teacher", "student", "admin"]),
  syllabusController.getCourseSyllabus
);

// Create a new module for a course (teacher and admin)
router.post(
  "/course/:courseId/syllabus/modules",
  auth,
  checkRole(["teacher", "admin"]),
  syllabusController.createModule
);

// Get specific module by ID (teacher, student, and admin)
router.get(
  "/course/:courseId/syllabus/module/:moduleId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  syllabusController.getModuleById
);

// Update a module (basic info) (teacher and admin)
router.put(
  "/course/:courseId/syllabus/module/:moduleId",
  auth,
  checkRole(["teacher", "admin"]),
  syllabusController.updateModule
);

// Delete a module (teacher and admin)
router.delete(
  "/course/:courseId/syllabus/module/:moduleId",
  auth,
  checkRole(["teacher", "admin"]),
  syllabusController.deleteModule
);

// Add content to module (PDF, PPT, Video, or Link) (teacher and admin)
router.post(
  "/course/:courseId/syllabus/module/:moduleId/content",
  auth,
  checkRole(["teacher", "admin"]),
  syllabusController.addModuleContent
);

// Update content item (teacher and admin)
router.put(
  "/course/:courseId/syllabus/module/:moduleId/content/:contentType/:contentId",
  auth,
  checkRole(["teacher", "admin"]),
  syllabusController.updateContentItem
);

// Delete content item (teacher and admin)
router.delete(
  "/course/:courseId/syllabus/module/:moduleId/content/:contentType/:contentId",
  auth,
  checkRole(["teacher", "admin"]),
  syllabusController.deleteContentItem
);

// Update content order within a module (teacher and admin)
router.put(
  "/course/:courseId/syllabus/module/:moduleId/content/:contentType/reorder",
  auth,
  checkRole(["teacher", "admin"]),
  syllabusController.updateContentOrder
);

module.exports = router;

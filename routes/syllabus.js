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

// Update module status (activate/deactivate)
router.patch(
  "/course/:courseId/syllabus/module/:moduleId/status",
  auth,
  checkRole(["teacher"]),
  syllabusController.updateModuleStatus
);

// Delete a module
router.delete(
  "/course/:courseId/syllabus/module/:moduleId",
  auth,
  checkRole(["teacher"]),
  syllabusController.deleteModule
);

// Create a new chapter within a module
router.post(
  "/course/:courseId/syllabus/module/:moduleId/chapters",
  auth,
  checkRole(["teacher"]),
  syllabusController.createChapter
);

// Update a chapter
router.put(
  "/course/:courseId/syllabus/module/:moduleId/chapter/:chapterId",
  auth,
  checkRole(["teacher"]),
  syllabusController.updateChapter
);

// Delete a chapter
router.delete(
  "/course/:courseId/syllabus/module/:moduleId/chapter/:chapterId",
  auth,
  checkRole(["teacher"]),
  syllabusController.deleteChapter
);

// Create a new article within a chapter
router.post(
  "/course/:courseId/syllabus/module/:moduleId/chapter/:chapterId/articles",
  auth,
  checkRole(["teacher"]),
  syllabusController.createArticle
);

// Add content to module
router.post(
  "/course/:courseId/syllabus/module/:moduleId/content",
  auth,
  checkRole(["teacher"]),
  syllabusController.addModuleContent
);

// Update content item
router.put(
  "/course/:courseId/syllabus/module/:moduleId/content/:contentId",
  auth,
  checkRole(["teacher"]),
  syllabusController.updateContentItem
);

// Delete content item
router.delete(
  "/course/:courseId/syllabus/module/:moduleId/content/:contentId",
  auth,
  checkRole(["teacher"]),
  syllabusController.deleteContentItem
);

module.exports = router;

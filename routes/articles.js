// routes/articles.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");
const articleController = require("../controllers/articleController");

// Get all modules with chapters and articles for a course (teacher, student, and admin)
router.get(
  "/course/:courseId/modules",
  auth,
  checkRole(["teacher", "student", "admin"]),
  articleController.getCourseModules
);

// Create a new chapter in a module (teacher and admin)
router.post(
  "/course/:courseId/module/:moduleId/chapters",
  auth,
  checkRole(["teacher", "admin"]),
  articleController.createChapter
);

// Create a new article in a chapter (teacher and admin)
router.post(
  "/course/:courseId/module/:moduleId/chapter/:chapterId/articles",
  auth,
  checkRole(["teacher", "admin"]),
  articleController.createArticle
);

// Get specific article by ID (teacher, student, and admin)
router.get(
  "/articles/:articleId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  articleController.getArticleById
);

// Update an article (teacher and admin)
router.put(
  "/articles/:articleId",
  auth,
  checkRole(["teacher", "admin"]),
  articleController.updateArticle
);

// Delete an article (teacher and admin)
router.delete(
  "/articles/:articleId",
  auth,
  checkRole(["teacher", "admin"]),
  articleController.deleteArticle
);

// Delete a chapter (teacher and admin)
router.delete(
  "/course/:courseId/module/:moduleId/chapter/:chapterId",
  auth,
  checkRole(["teacher", "admin"]),
  articleController.deleteChapter
);

module.exports = router;

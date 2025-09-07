// routes/articles.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");
const articleController = require("../controllers/articleController");

// Get all modules with chapters and articles for a course (similar to dummy data format)
router.get(
  "/course/:courseId/modules",
  auth,
  checkRole(["teacher", "student"]),
  articleController.getCourseModules
);

// Create a new chapter in a module (teacher only)
router.post(
  "/course/:courseId/module/:moduleId/chapters",
  auth,
  checkRole(["teacher"]),
  articleController.createChapter
);

// Create a new article in a chapter (teacher only)
router.post(
  "/course/:courseId/module/:moduleId/chapter/:chapterId/articles",
  auth,
  checkRole(["teacher"]),
  articleController.createArticle
);

// Get specific article by ID
router.get(
  "/articles/:articleId",
  auth,
  checkRole(["teacher", "student"]),
  articleController.getArticleById
);

// Update an article (teacher only)
router.put(
  "/articles/:articleId",
  auth,
  checkRole(["teacher"]),
  articleController.updateArticle
);

// Delete an article (teacher only)
router.delete(
  "/articles/:articleId",
  auth,
  checkRole(["teacher"]),
  articleController.deleteArticle
);
router.delete(
  "/course/:courseId/module/:moduleId/chapter/:chapterId",
  auth,
  checkRole(["teacher"]),
  articleController.deleteChapter
);

module.exports = router;

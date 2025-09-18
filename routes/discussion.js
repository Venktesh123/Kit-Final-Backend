const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");
const discussionController = require("../controllers/discussionController");

// Search discussions (teacher, student, and admin)
router.get(
  "/search",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.searchDiscussions
);

// Teacher-only discussions (teacher and admin)
router.post(
  "/teacher",
  auth,
  checkRole(["teacher", "admin"]),
  discussionController.createDiscussion
);

router.get(
  "/teacher",
  auth,
  checkRole(["teacher", "admin"]),
  discussionController.getTeacherDiscussions
);

// Course discussions (teacher, student, and admin)
router.post(
  "/course/:courseId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.createDiscussion
);

router.get(
  "/course/:courseId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.getCourseDiscussions
);

// Get a specific discussion by ID (teacher, student, and admin)
router.get(
  "/:discussionId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.getDiscussionById
);

// Add comment to a discussion (teacher, student, and admin)
router.post(
  "/:discussionId/comment",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.addComment
);

// Add reply to a comment (teacher, student, and admin)
router.post(
  "/:discussionId/comment/:commentId/reply",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.addReplyToComment
);

// Update a comment (teacher, student, and admin)
router.put(
  "/:discussionId/comment/:commentId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.updateComment
);

// Delete a comment (teacher, student, and admin)
router.delete(
  "/:discussionId/comment/:commentId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.deleteComment
);

// Update a discussion (teacher, student, and admin)
router.put(
  "/:discussionId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.updateDiscussion
);

// Delete a discussion (teacher, student, and admin)
router.delete(
  "/:discussionId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.deleteDiscussion
);

module.exports = router;

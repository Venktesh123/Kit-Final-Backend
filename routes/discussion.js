const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");
const discussionController = require("../controllers/discussionController");

// Search discussions
router.get(
  "/search",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.searchDiscussions
);

// Teacher-only discussions
router.post(
  "/teacher",
  auth,
  checkRole(["teacher"]),
  discussionController.createDiscussion
);

router.get(
  "/teacher",
  auth,
  checkRole(["teacher"]),
  discussionController.getTeacherDiscussions
);

// Course discussions (between teacher and students)
router.post(
  "/course/:courseId",
  auth,
  checkRole(["teacher", "student"]),
  discussionController.createDiscussion
);

router.get(
  "/course/:courseId",
  auth,
  checkRole(["teacher", "student"]),
  discussionController.getCourseDiscussions
);

// Get a specific discussion by ID
router.get(
  "/:discussionId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.getDiscussionById
);

// Add comment to a discussion
router.post(
  "/:discussionId/comment",
  auth,
  checkRole(["teacher", "student"]),
  discussionController.addComment
);

// Add reply to a comment
router.post(
  "/:discussionId/comment/:commentId/reply",
  auth,
  checkRole(["teacher", "student"]),
  discussionController.addReplyToComment
);

// Update a comment
router.put(
  "/:discussionId/comment/:commentId",
  auth,
  checkRole(["teacher", "student"]),
  discussionController.updateComment
);

// Delete a comment
router.delete(
  "/:discussionId/comment/:commentId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  discussionController.deleteComment
);

// Update a discussion (only for the author)
router.put(
  "/:discussionId",
  auth,
  checkRole(["teacher", "student"]),
  discussionController.updateDiscussion
);

// Delete a discussion (only for the author or admin)
router.delete(
  "/:discussionId",
  auth,
  checkRole(["teacher", "admin", "student"]),
  discussionController.deleteDiscussion
);

module.exports = router;

const express = require("express");
const router = express.Router();
const activityController = require("../controllers/activityController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Create a new activity (teacher and admin)
router.post(
  "/courses/:courseId/activities",
  auth,
  checkRole(["teacher", "admin"]),
  activityController.createActivity
);

// Submit an activity (student and admin)
router.post(
  "/activities/:activityId/submit",
  auth,
  checkRole(["student", "admin"]),
  activityController.submitActivity
);

// Grade a submission (teacher and admin)
router.post(
  "/activities/:activityId/submissions/:submissionId/grade",
  auth,
  checkRole(["teacher", "admin"]),
  activityController.gradeSubmission
);

// Get all activities for a course (teacher, student, and admin)
router.get(
  "/courses/:courseId/activities",
  auth,
  checkRole(["teacher", "student", "admin"]),
  activityController.getCourseActivities
);

// Get a specific activity (teacher, student, and admin)
router.get(
  "/activities/:activityId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  activityController.getActivityById
);

// Update an activity (teacher and admin)
router.put(
  "/activities/:activityId",
  auth,
  checkRole(["teacher", "admin"]),
  activityController.updateActivity
);

// Delete an activity (teacher and admin)
router.delete(
  "/activities/:activityId",
  auth,
  checkRole(["teacher", "admin"]),
  activityController.deleteActivity
);

module.exports = router;

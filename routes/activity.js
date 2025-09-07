const express = require("express");
const router = express.Router();
const activityController = require("../controllers/activityController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Create a new activity (teacher only)
router.post(
  "/courses/:courseId/activities",
  auth,
  checkRole(["teacher"]),
  activityController.createActivity
);

// Submit an activity (student only)
router.post(
  "/activities/:activityId/submit",
  auth,
  checkRole(["student"]),
  activityController.submitActivity
);

// Grade a submission (teacher only)
router.post(
  "/activities/:activityId/submissions/:submissionId/grade",
  auth,
  checkRole(["teacher"]),
  activityController.gradeSubmission
);

// Get all activities for a course
router.get(
  "/courses/:courseId/activities",
  auth,
  checkRole(["teacher", "student"]),
  activityController.getCourseActivities
);

// Get a specific activity
router.get(
  "/activities/:activityId",
  auth,
  checkRole(["teacher", "student"]),
  activityController.getActivityById
);

// Update an activity (teacher only)
router.put(
  "/activities/:activityId",
  auth,
  checkRole(["teacher"]),
  activityController.updateActivity
);

// Delete an activity (teacher only)
router.delete(
  "/activities/:activityId",
  auth,
  checkRole(["teacher"]),
  activityController.deleteActivity
);

module.exports = router;

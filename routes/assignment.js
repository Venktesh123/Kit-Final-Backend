const express = require("express");
const router = express.Router();
const assignmentController = require("../controllers/assignmentController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Create a new assignment (teacher and admin)
router.post(
  "/courses/:courseId/assignments",
  auth,
  checkRole(["teacher", "admin"]),
  assignmentController.createAssignment
);

// Submit an assignment (student and admin)
router.post(
  "/assignments/:assignmentId/submit",
  auth,
  checkRole(["student", "admin"]),
  assignmentController.submitAssignment
);

// Grade a submission (teacher and admin) - legacy endpoint
router.post(
  "/assignments/:assignmentId/submissions/:submissionId/grade",
  auth,
  checkRole(["teacher", "admin"]),
  assignmentController.gradeSubmission
);

// Update assignment grade (teacher and admin) - new endpoint for frontend
router.put(
  "/assignments/:assignmentId/submissions/:submissionId/grade",
  auth,
  checkRole(["teacher", "admin"]),
  assignmentController.updateAssignmentGrade
);

// Get all assignments for a course (teacher, student, and admin)
router.get(
  "/courses/:courseId/assignments",
  auth,
  checkRole(["teacher", "student", "admin"]),
  assignmentController.getCourseAssignments
);

// Get a specific assignment with submissions (teacher, student, and admin)
router.get(
  "/assignments/:assignmentId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  assignmentController.getAssignmentById
);

// Update an assignment (teacher and admin)
router.put(
  "/assignments/:assignmentId",
  auth,
  checkRole(["teacher", "admin"]),
  assignmentController.updateAssignment
);

// Delete an assignment (teacher and admin)
router.delete(
  "/assignments/:assignmentId",
  auth,
  checkRole(["teacher", "admin"]),
  assignmentController.deleteAssignment
);

module.exports = router;

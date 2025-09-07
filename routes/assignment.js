const express = require("express");
const router = express.Router();
const assignmentController = require("../controllers/assignmentController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Create a new assignment (teacher only)
router.post(
  "/courses/:courseId/assignments",
  auth,
  checkRole(["teacher"]),
  assignmentController.createAssignment
);

// Submit an assignment (student only)
router.post(
  "/assignments/:assignmentId/submit",
  auth,
  checkRole(["student"]),
  assignmentController.submitAssignment
);

// Grade a submission (teacher only) - legacy endpoint
router.post(
  "/assignments/:assignmentId/submissions/:submissionId/grade",
  auth,
  checkRole(["teacher"]),
  assignmentController.gradeSubmission
);

// Update assignment grade (teacher only) - new endpoint for frontend
router.put(
  "/assignments/:assignmentId/submissions/:submissionId/grade",
  auth,
  checkRole(["teacher"]),
  assignmentController.updateAssignmentGrade
);

// Get all assignments for a course
router.get(
  "/courses/:courseId/assignments",
  auth,
  checkRole(["teacher", "student"]),
  assignmentController.getCourseAssignments
);

// Get a specific assignment with submissions (for assignment viewer)
router.get(
  "/assignments/:assignmentId",
  auth,
  checkRole(["teacher", "student"]),
  assignmentController.getAssignmentById
);

// Update an assignment (teacher only)
router.put(
  "/assignments/:assignmentId",
  auth,
  checkRole(["teacher"]),
  assignmentController.updateAssignment
);

// Delete an assignment (teacher only)
router.delete(
  "/assignments/:assignmentId",
  auth,
  checkRole(["teacher"]),
  assignmentController.deleteAssignment
);

module.exports = router;

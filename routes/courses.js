const express = require("express");
const router = express.Router();
const {
  getUserCourses,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  getEnrolledCourses,
  updateCourseAttendance,
} = require("../controllers/courseController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Get all courses for teacher/student (teacher, student, and admin)
router.get(
  "/",
  auth,
  checkRole(["teacher", "student", "admin"]),
  getUserCourses
);

// Get enrolled courses for students (teacher, student, and admin)
router.get(
  "/student",
  auth,
  checkRole(["teacher", "student", "admin"]),
  getEnrolledCourses
);

// Get specific course by ID (teacher, student, and admin)
router.get(
  "/:courseId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  getCourseById
);

// Create new course (teacher and admin)
router.post("/", auth, checkRole(["teacher", "admin"]), createCourse);

// Update course (teacher and admin)
router.put("/:courseId", auth, checkRole(["teacher", "admin"]), updateCourse);

// Update course attendance only (teacher and admin)
router.put(
  "/:courseId/attendance",
  auth,
  checkRole(["teacher", "admin"]),
  updateCourseAttendance
);

// Delete course (teacher and admin)
router.delete(
  "/:courseId",
  auth,
  checkRole(["teacher", "admin"]),
  deleteCourse
);

module.exports = router;

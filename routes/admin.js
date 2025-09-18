const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const adminCourseController = require("../controllers/adminCourseController"); // ADD THIS LINE
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");
const uploadMiddleware = require("../middleware/upload");

// Test route to verify router is working
router.get("/test", (req, res) => {
  res.json({ message: "Admin routes working" });
});

// ===============================
// USER MANAGEMENT ROUTES
// ===============================

// Upload users from Excel file
router.post(
  "/upload-users",
  auth,
  checkRole(["admin"]),
  uploadMiddleware,
  adminController.uploadUsers
);

// Get all users with pagination and filtering
router.get("/users", auth, checkRole(["admin"]), adminController.getAllUsers);

// Delete user and all related data
router.delete(
  "/users/:userId",
  auth,
  checkRole(["admin"]),
  adminController.deleteUser
);

// Bulk delete users
router.post(
  "/users/bulk-delete",
  auth,
  checkRole(["admin"]),
  adminController.bulkDeleteUsers
);

// Get students for currently authenticated teacher
router.get(
  "/my-students",
  auth,
  checkRole(["teacher", "admin"]),
  adminController.getMyStudents
);

// Get students for any teacher by ID (admin access)
router.get(
  "/teacher/:teacherId/students",
  auth,
  checkRole(["admin"]),
  adminController.getStudentsByTeacherId
);

// ===============================
// COURSE CODE MANAGEMENT ROUTES
// ===============================

// Get all course codes with statistics
router.get(
  "/course-codes",
  auth,
  checkRole(["admin"]),
  adminController.getAllCourseCodes
);

// Create/assign new course code to teachers
router.post(
  "/course-codes",
  auth,
  checkRole(["admin"]),
  adminController.createCourseCode
);

// Update course code assignments (add/remove teachers, rename course code)
router.put(
  "/course-codes/:courseCode",
  auth,
  checkRole(["admin"]),
  adminController.updateCourseCode
);

// Delete course code and all related data
router.delete(
  "/course-codes/:courseCode",
  auth,
  checkRole(["admin"]),
  adminController.deleteCourseCode
);

// Bulk update course codes
router.post(
  "/course-codes/bulk-update",
  auth,
  checkRole(["admin"]),
  adminController.bulkUpdateCourseCodes
);

// ===============================
// COURSE MANAGEMENT ROUTES
// ===============================

// Get courses by course code
router.get(
  "/course-codes/:courseCode/courses",
  auth,
  checkRole(["admin"]),
  adminController.getCoursesByCode
);

// Get all courses with advanced filtering and pagination
router.get(
  "/courses",
  auth,
  checkRole(["admin"]),
  adminController.getAllCourses
);

// Delete course and all related data (admin version)
router.delete(
  "/courses/:courseId",
  auth,
  checkRole(["admin"]),
  adminController.deleteCourse
);

// ===============================
// ADMIN COURSE MANAGEMENT ROUTES (by courseCode) - NEW SECTION
// ===============================

// Create new course by courseCode (admin only)
router.post(
  "/courses/create",
  auth,
  checkRole(["admin"]),
  adminCourseController.createCourse
);

// Update course by courseCode (admin only)
router.put(
  "/courses/update",
  auth,
  checkRole(["admin"]),
  adminCourseController.updateCourse
);

// Delete course by courseCode (admin only)
router.delete(
  "/courses/delete",
  auth,
  checkRole(["admin"]),
  adminCourseController.deleteCourse
);

// Get course by courseCode (admin only)
router.get(
  "/courses/by-code/:courseCode",
  auth,
  checkRole(["admin"]),
  adminCourseController.getCourseByCode
);

// Get all courses with advanced filtering (admin only)
router.get(
  "/courses/all",
  auth,
  checkRole(["admin"]),
  adminCourseController.getAllCourses
);

// ===============================
// TEACHER MANAGEMENT ROUTES
// ===============================

// Get all teachers with their course codes
router.get(
  "/teachers",
  auth,
  checkRole(["admin"]),
  adminController.getAllTeachers
);

// Update teacher course codes
router.put(
  "/teachers/:teacherId/course-codes",
  auth,
  checkRole(["admin"]),
  adminController.updateTeacherCourseCodes
);

// ===============================
// STUDENT MANAGEMENT ROUTES
// ===============================

// Get all students with filtering
router.get(
  "/students",
  auth,
  checkRole(["admin"]),
  adminController.getAllStudents
);

// Update student course codes
router.put(
  "/students/:studentId/course-codes",
  auth,
  checkRole(["admin"]),
  adminController.updateStudentCourseCodes
);

// ===============================
// SYSTEM ADMINISTRATION ROUTES
// ===============================

// Get system statistics and overview
router.get(
  "/stats",
  auth,
  checkRole(["admin"]),
  adminController.getSystemStats
);

// Global search across all entities
router.get("/search", auth, checkRole(["admin"]), adminController.searchAll);

module.exports = router;

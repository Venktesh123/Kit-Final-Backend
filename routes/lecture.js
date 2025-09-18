const express = require("express");
const router = express.Router();
const {
  createLectureForModule,
  getModuleLectures,
  getCourseModulesWithLectures,
  updateLecture,
  deleteLecture,
  getLectureById,
  updateLectureOrder,
} = require("../controllers/lectureController");
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Get all modules with their lectures for a course (teacher, student, and admin)
router.get(
  "/course/:courseId/modules",
  auth,
  checkRole(["teacher", "student", "admin"]),
  getCourseModulesWithLectures
);

// Get all lectures for a specific module (teacher, student, and admin)
router.get(
  "/course/:courseId/module/:moduleId/lectures",
  auth,
  checkRole(["teacher", "student", "admin"]),
  getModuleLectures
);

// Create a new lecture for a specific module (teacher and admin)
router.post(
  "/course/:courseId/module/:moduleId/lectures",
  auth,
  checkRole(["teacher", "admin"]),
  createLectureForModule
);

// Get a specific lecture by ID (teacher, student, and admin)
router.get(
  "/course/:courseId/module/:moduleId/lecture/:lectureId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  getLectureById
);

// Update a specific lecture (teacher and admin)
router.put(
  "/course/:courseId/module/:moduleId/lecture/:lectureId",
  auth,
  checkRole(["teacher", "admin"]),
  updateLecture
);

// Delete a specific lecture (teacher and admin)
router.delete(
  "/course/:courseId/module/:moduleId/lecture/:lectureId",
  auth,
  checkRole(["teacher", "admin"]),
  deleteLecture
);

// Update lecture order within a module (teacher and admin)
router.put(
  "/course/:courseId/module/:moduleId/lectures/reorder",
  auth,
  checkRole(["teacher", "admin"]),
  updateLectureOrder
);

// Backward compatibility routes (if needed)
// These can be removed once frontend is updated

// Legacy route: Get lectures for a course (teacher, student, and admin)
router.get(
  "/:courseId/lectures",
  auth,
  checkRole(["teacher", "student", "admin"]),
  getCourseModulesWithLectures
);

// Legacy route: Get lecture by ID (teacher, student, and admin)
router.get(
  "/:lectureId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  async (req, res) => {
    try {
      // Find the lecture to get its course and module info
      const Lecture = require("../models/Lecture");
      const lecture = await Lecture.findById(req.params.lectureId);

      if (!lecture) {
        return res.status(404).json({ error: "Lecture not found" });
      }

      // Redirect to the new route structure
      return res.redirect(
        `/api/lectures/course/${lecture.course}/module/${lecture.syllabusModule}/lecture/${lecture._id}`
      );
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
);

module.exports = router;

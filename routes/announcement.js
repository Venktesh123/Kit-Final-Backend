const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");
const announcementController = require("../controllers/announcementController");

// Create an announcement for a course (teacher and admin)
router.post(
  "/course/:courseId/announcement",
  auth,
  checkRole(["teacher", "admin"]),
  announcementController.createAnnouncement
);

// Get all announcements for a specific course (teacher, student, and admin)
router.get(
  "/course/:courseId/announcements",
  auth,
  checkRole(["teacher", "student", "admin"]),
  announcementController.getCourseAnnouncements
);

// Get specific announcement by ID (teacher, student, and admin)
router.get(
  "/course/:courseId/announcement/:announcementId",
  auth,
  checkRole(["teacher", "student", "admin"]),
  announcementController.getAnnouncementById
);

// Update an announcement (teacher and admin)
router.put(
  "/course/:courseId/announcement/:announcementId",
  auth,
  checkRole(["teacher", "admin"]),
  announcementController.updateAnnouncement
);

// Delete an announcement (teacher and admin)
router.delete(
  "/course/:courseId/announcement/:announcementId",
  auth,
  checkRole(["teacher", "admin"]),
  announcementController.deleteAnnouncement
);

module.exports = router;

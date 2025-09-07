const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");
const announcementController = require("../controllers/announcementController");

// Create an announcement for a course
router.post(
  "/course/:courseId/announcement",
  auth,
  checkRole(["teacher"]),
  announcementController.createAnnouncement
);

// Get all announcements for a specific course
router.get(
  "/course/:courseId/announcements",
  auth,
  checkRole(["teacher", "student"]),
  announcementController.getCourseAnnouncements
);

// Get specific announcement by ID
router.get(
  "/course/:courseId/announcement/:announcementId",
  auth,
  checkRole(["teacher", "student"]),
  announcementController.getAnnouncementById
);

// Update an announcement
router.put(
  "/course/:courseId/announcement/:announcementId",
  auth,
  checkRole(["teacher"]),
  announcementController.updateAnnouncement
);

// Delete an announcement
router.delete(
  "/course/:courseId/announcement/:announcementId",
  auth,
  checkRole(["teacher"]),
  announcementController.deleteAnnouncement
);

module.exports = router;

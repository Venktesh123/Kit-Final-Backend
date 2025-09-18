const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Import individual controllers
const eventController = require("../controllers/eventController");

// Routes
// Create event (admin only)
router.post("/", auth, checkRole(["admin"]), eventController.createEvent);

// Get all events (teacher, student, and admin)
router.get(
  "/",
  auth,
  checkRole(["teacher", "student", "admin"]),
  eventController.getAllEvents
);

// Get event by ID (teacher, student, and admin)
router.get(
  "/:id",
  auth,
  checkRole(["teacher", "student", "admin"]),
  eventController.getEventById
);

// Update event (admin and authenticated users)
router.put("/:id", auth, checkRole(["admin"]), eventController.updateEvent);

// Delete event (admin and authenticated users)
router.delete("/:id", auth, checkRole(["admin"]), eventController.deleteEvent);

module.exports = router;

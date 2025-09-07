const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { checkRole } = require("../middleware/roleCheck");

// Import individual controllers
const eventController = require("../controllers/eventController");

// Routes
router.post("/", auth, checkRole(["admin"]), eventController.createEvent);
router.get(
  "/",
  auth,
  checkRole(["teacher", "student"]),
  eventController.getAllEvents
);
router.get(
  "/:id",
  auth,
  checkRole(["teacher", "student"]),
  eventController.getEventById
);

router.put("/:id", auth, eventController.updateEvent);
router.delete("/:id", auth, eventController.deleteEvent);

module.exports = router;

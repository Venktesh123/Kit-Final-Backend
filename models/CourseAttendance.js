const mongoose = require("mongoose");

const courseAttendanceSchema = new mongoose.Schema(
  {
    // Using Map to store session date/time as key and array of student IDs as value
    sessions: {
      type: Map,
      of: [String], // Array of student IDs
      default: new Map(),
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CourseAttendance", courseAttendanceSchema);

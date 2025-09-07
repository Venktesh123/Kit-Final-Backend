const mongoose = require("mongoose");

const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    aboutCourse: {
      type: String,
      required: true,
    },
    // NEW: Course code for this specific course
    courseCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    semester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Semester",
      required: true,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },
    // Removed lectures array as lectures are now in syllabus modules

    // References to other models
    outcomes: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CourseOutcome",
    },
    schedule: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CourseSchedule",
    },
    syllabus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CourseSyllabus",
    },
    weeklyPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WeeklyPlan",
    },
    creditPoints: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CreditPoints",
    },
    attendance: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CourseAttendance",
    },
    assignments: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Assignment",
      },
    ],
    // Course status
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Pre-save middleware to ensure course code is uppercase
courseSchema.pre("save", function (next) {
  if (this.isModified("courseCode")) {
    this.courseCode = this.courseCode.toUpperCase().trim();
  }
  next();
});

// Index for efficient queries
courseSchema.index({ teacher: 1, isActive: 1 });
courseSchema.index({ semester: 1, isActive: 1 });
courseSchema.index({ courseCode: 1 });
courseSchema.index({ teacher: 1, courseCode: 1 });

module.exports = mongoose.model("Course", courseSchema);

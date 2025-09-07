const mongoose = require("mongoose");

const classScheduleSchema = new mongoose.Schema({
  day: {
    type: String,
    required: true,
    enum: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ],
  },
  time: {
    type: String,
    required: true,
  },
});

const courseScheduleSchema = new mongoose.Schema(
  {
    classStartDate: {
      type: Date,
      required: true,
    },
    classEndDate: {
      type: Date,
      required: true,
    },
    midSemesterExamDate: {
      type: Date,
      required: true,
    },
    endSemesterExamDate: {
      type: Date,
      required: true,
    },
    classDaysAndTimes: [classScheduleSchema],
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CourseSchedule", courseScheduleSchema);

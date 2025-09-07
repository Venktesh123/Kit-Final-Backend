// models/Assignment.js
const mongoose = require("mongoose");

const submissionSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
  },
  submissionDate: {
    type: Date,
    default: Date.now,
  },
  submissionFile: {
    type: String, // URL or path to the file
    required: true,
  },
  grade: {
    type: Number,
    default: null,
  },
  feedback: {
    type: String,
    default: "",
  },
  status: {
    type: String,
    enum: ["submitted", "graded", "returned"],
    default: "submitted",
  },
});

const activitySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    totalPoints: {
      type: Number,
      required: true,
    },
    attachments: [
      {
        name: String,
        url: String,
      },
    ],
    submissions: [submissionSchema],
    isActive: {
      type: Boolean,
      default: true,
    },
    links: [
      {
        name: String,
        url: String,
      },
    ],
  },

  { timestamps: true }
);

module.exports = mongoose.model("Activity", activitySchema);

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
    type: String, // URL to the file
    required: true,
  },
  submissionFileKey: {
    type: String, // Azure blob key for cleanup
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
  isLate: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

const assignmentSchema = new mongoose.Schema(
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
      default: 100,
    },
    attachments: [
      {
        name: {
          type: String,
          required: true,
        },
        url: {
          type: String,
          required: true,
        },
        key: {
          type: String,
          required: true, // Azure blob key for cleanup
        },
      },
    ],
    submissions: [submissionSchema],
    isActive: {
      type: Boolean,
      default: true,
    },
    allowLateSubmissions: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Virtual for calculating submission statistics
assignmentSchema.virtual('stats').get(function() {
  const turnedIn = this.submissions.length;
  const graded = this.submissions.filter(sub => sub.grade !== null).length;
  
  return {
    turnedIn,
    assigned: 40, // This should be calculated based on enrolled students
    graded
  };
});

// Ensure virtual fields are serialized
assignmentSchema.set('toJSON', { virtuals: true });
assignmentSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model("Assignment", assignmentSchema);
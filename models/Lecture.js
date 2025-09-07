const mongoose = require("mongoose");

const lectureSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    content: {
      type: String,
    },
    videoUrl: {
      type: String,
    },
    videoKey: {
      type: String,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    // New field: reference to the syllabus module
    syllabusModule: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    moduleNumber: {
      type: Number,
      required: true,
    },
    lectureOrder: {
      type: Number,
      default: 1,
    },
    isReviewed: {
      type: Boolean,
      default: false,
    },
    reviewDeadline: {
      type: Date,
      default: function () {
        // Set default review deadline to 7 days from creation
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 7);
        return deadline;
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Middleware to auto-mark as reviewed if deadline has passed
lectureSchema.pre("save", function (next) {
  if (
    !this.isReviewed &&
    this.reviewDeadline &&
    new Date() >= this.reviewDeadline
  ) {
    this.isReviewed = true;
  }
  next();
});

// Index for efficient queries
lectureSchema.index({ course: 1, syllabusModule: 1, lectureOrder: 1 });
lectureSchema.index({ course: 1, moduleNumber: 1, lectureOrder: 1 });

// Static method to update all lectures past their review deadline
lectureSchema.statics.updateReviewStatus = async function () {
  const now = new Date();
  return this.updateMany(
    {
      isReviewed: false,
      reviewDeadline: { $lte: now },
    },
    {
      $set: { isReviewed: true },
    }
  );
};

module.exports = mongoose.model("Lecture", lectureSchema);

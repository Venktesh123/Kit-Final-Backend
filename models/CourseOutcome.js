const mongoose = require("mongoose");

const courseOutcomeSchema = new mongoose.Schema(
  {
    outcomes: [
      {
        type: String,
        required: true,
      },
    ],
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CourseOutcome", courseOutcomeSchema);

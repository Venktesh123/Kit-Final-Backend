const mongoose = require("mongoose");

const creditPointsSchema = new mongoose.Schema(
  {
    lecture: {
      type: Number,
      required: true,
    },
    tutorial: {
      type: Number,
      required: true,
    },
    practical: {
      type: Number,
      required: true,
    },
    project: {
      type: Number,
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CreditPoints", creditPointsSchema);

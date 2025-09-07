const mongoose = require("mongoose");

const weeklyTopicSchema = new mongoose.Schema({
  weekNumber: {
    type: Number,
    required: true,
  },
  topics: [
    {
      type: String,
      required: true,
    },
  ],
});

const weeklyPlanSchema = new mongoose.Schema(
  {
    weeks: [weeklyTopicSchema],
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WeeklyPlan", weeklyPlanSchema);

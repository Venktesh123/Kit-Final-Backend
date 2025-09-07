// models/Article.js
const mongoose = require("mongoose");

const articleSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    author: {
      type: String,
      required: true,
    },
    dateDefault: {
      type: Date,
      default: Date.now,
    },
    date: {
      type: String,
    },
    image: {
      imageUrl: {
        type: String,
        default: "",
      },
      imageKey: {
        type: String,
        default: "",
      },
    },
    chapter: {
      type: mongoose.Schema.Types.ObjectId,
      required: false, // Changed from required: true to required: false
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Index for efficient queries
articleSchema.index({ course: 1, chapter: 1, order: 1 });

module.exports = mongoose.model("Article", articleSchema);

const mongoose = require("mongoose");

// Schema for comments within a discussion
const commentSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      required: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    parentComment: {
      type: mongoose.Schema.Types.ObjectId,
      default: null, // null means it's a top-level comment
    },
    attachments: [
      {
        fileUrl: {
          type: String,
          required: true,
        },
        fileKey: {
          type: String,
          required: true,
        },
        fileName: {
          type: String,
          required: true,
        },
      },
    ],
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Add this to enable referencing replies
commentSchema.add({
  replies: [commentSchema],
});

// Main discussion schema
const discussionSchema = new mongoose.Schema(
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
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
    },
    // Type can be 'teacher' (teacher-only discussions) or 'course' (course discussions with students)
    type: {
      type: String,
      enum: ["teacher", "course"],
      required: true,
    },
    attachments: [
      {
        fileUrl: {
          type: String,
          required: true,
        },
        fileKey: {
          type: String,
          required: true,
        },
        fileName: {
          type: String,
          required: true,
        },
      },
    ],
    comments: [commentSchema],
    isActive: {
      type: Boolean,
      default: true,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Create an index on the title and content fields for searching
discussionSchema.index({ title: "text", content: "text" });

module.exports = mongoose.model("Discussion", discussionSchema);

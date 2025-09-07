const mongoose = require("mongoose");

// Create EContent Schema
const EContentSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    modules: [
      {
        moduleNumber: {
          type: Number,
          required: true,
        },
        moduleTitle: {
          type: String,
          required: true,
        },
        link: {
          type: String,
          default: "",
        },
        files: [
          {
            fileType: {
              type: String,
              enum: ["pdf", "ppt", "pptx", "other"],
              required: true,
            },
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
            uploadDate: {
              type: Date,
              default: Date.now,
            },
          },
        ],
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("EContent", EContentSchema);

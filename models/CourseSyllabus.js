// models/CourseSyllabus.js (Updated)
const mongoose = require("mongoose");

// Content Item Schema for different types of content
const contentItemSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["file", "link", "video", "text"],
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: "",
  },
  // For file type
  fileType: {
    type: String,
    enum: ["pdf", "presentation", "document", "image", "other"],
    required: function () {
      return this.type === "file";
    },
  },
  fileUrl: {
    type: String,
    required: function () {
      return this.type === "file";
    },
  },
  fileKey: {
    type: String,
    required: function () {
      return this.type === "file";
    },
  },
  fileName: {
    type: String,
    required: function () {
      return this.type === "file";
    },
  },
  // For link type
  url: {
    type: String,
    required: function () {
      return this.type === "link";
    },
  },
  // For video type
  videoUrl: {
    type: String,
    required: function () {
      return this.type === "video";
    },
  },
  videoKey: {
    type: String,
  },
  videoProvider: {
    type: String,
    enum: ["youtube", "vimeo", "other"],
    default: "other",
    required: function () {
      return this.type === "video";
    },
  },
  // For text type
  content: {
    type: String,
    required: function () {
      return this.type === "text";
    },
  },
  // Common fields
  order: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Chapter Schema (UPDATED with link field)
const chapterSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  color: {
    type: String,
    default: "bg-blue-500",
  },
  articles: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Article",
    },
  ],
  // NEW: Array of links for the chapter
  link: [{ type: String }],
  isActive: {
    type: Boolean,
    default: true,
  },
  order: {
    type: Number,
    default: 0,
  },
});

const resourceSchema = new mongoose.Schema({
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
});

const moduleSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  active: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    required: true,
  },
  moduleNumber: {
    type: Number,
    required: true,
  },
  moduleTitle: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: "",
  },
  topics: [
    {
      type: String,
    },
  ],
  // Chapters array with updated schema
  chapters: [chapterSchema],

  // For backward compatibility
  link: {
    type: String,
    default: "",
  },
  resources: [resourceSchema],
  contentItems: [contentItemSchema],
  lectures: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lecture",
    },
  ],
  isActive: {
    type: Boolean,
    default: true,
  },
  order: {
    type: Number,
    default: 0,
  },
});

const courseSyllabusSchema = new mongoose.Schema(
  {
    modules: [moduleSchema],
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
  },
  { timestamps: true }
);

// Index for efficient queries
courseSyllabusSchema.index({ course: 1 });

module.exports = mongoose.model("CourseSyllabus", courseSyllabusSchema);

const mongoose = require("mongoose");

// Enhanced content schemas for different types with thumbnails
const videoContentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: "",
  },
  thumbnail: {
    thumbnailUrl: {
      type: String,
      default: "",
    },
    thumbnailKey: {
      type: String,
      default: "",
    },
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
  createDate: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  duration: {
    type: String, // e.g., "10:30" for 10 minutes 30 seconds
    default: "",
  },
  videoSize: {
    type: Number, // File size in bytes
  },
  videoQuality: {
    type: String,
    enum: ["HD", "SD", "4K", "auto"],
    default: "auto",
  },
});

const linkContentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: "",
  },
  thumbnail: {
    thumbnailUrl: {
      type: String,
      default: "",
    },
    thumbnailKey: {
      type: String,
      default: "",
    },
  },
  fileUrl: {
    type: String,
    required: true,
    validate: {
      validator: function (v) {
        return /^https?:\/\/.+/.test(v);
      },
      message: "Link must be a valid URL",
    },
  },
  createDate: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  linkType: {
    type: String,
    enum: ["external", "youtube", "vimeo", "article", "resource", "other"],
    default: "external",
  },
  isExternal: {
    type: Boolean,
    default: true,
  },
});

const pdfContentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: "",
  },
  thumbnail: {
    thumbnailUrl: {
      type: String,
      default: "",
    },
    thumbnailKey: {
      type: String,
      default: "",
    },
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
  createDate: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  fileSize: {
    type: Number, // File size in bytes
  },
  pageCount: {
    type: Number,
    default: 0,
  },
});

const pptContentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: "",
  },
  thumbnail: {
    thumbnailUrl: {
      type: String,
      default: "",
    },
    thumbnailKey: {
      type: String,
      default: "",
    },
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
  createDate: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  fileSize: {
    type: Number, // File size in bytes
  },
  slideCount: {
    type: Number,
    default: 0,
  },
  presentationType: {
    type: String,
    enum: ["ppt", "pptx", "odp"],
    default: "pptx",
  },
});

// Enhanced module schema with separate content arrays
const moduleSchema = new mongoose.Schema({
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
      required: true,
    },
  ],

  // Separate arrays for different content types
  videos: [videoContentSchema],
  links: [linkContentSchema],
  pdfs: [pdfContentSchema],
  ppts: [pptContentSchema],

  // For backward compatibility - keep existing fields but deprecate
  link: {
    type: String,
    default: "",
  },
  resources: [
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

  // Existing content items field for backward compatibility
  contentItems: [
    {
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
      // ... other contentItem fields as before
    },
  ],

  // Lectures for this module
  lectures: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lecture",
    },
  ],

  // Module status and ordering
  isActive: {
    type: Boolean,
    default: true,
  },
  order: {
    type: Number,
    default: 0,
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

// Update the updatedAt field before saving
moduleSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
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

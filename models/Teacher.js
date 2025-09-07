const mongoose = require("mongoose");

const teacherSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    courses: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Course",
      },
    ],
    // Add teacherEmail for direct lookups
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    // NEW: Course codes that this teacher can teach
    courseCodes: [
      {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual populate for students - now filtered by course codes
teacherSchema.virtual("students", {
  ref: "Student",
  localField: "_id",
  foreignField: "teacher",
});

// Pre-save middleware to ensure email matches user email
teacherSchema.pre("save", async function (next) {
  if (this.isNew || this.isModified("user")) {
    const user = await this.model("User").findById(this.user);
    if (user) {
      this.email = user.email.toLowerCase();
    }
  }

  // Ensure course codes are uppercase
  if (this.isModified("courseCodes")) {
    this.courseCodes = this.courseCodes.map((code) =>
      code.toUpperCase().trim()
    );
  }

  next();
});

// Index for efficient lookups
teacherSchema.index({ email: 1 });
teacherSchema.index({ courseCodes: 1 });

module.exports = mongoose.model("Teacher", teacherSchema);

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    // === EXISTING BASIC FIELDS (Keep unchanged) ===
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["admin", "teacher", "student"],
      required: true,
    },

    // === ADDITIONAL FIELDS FROM EXCEL IMAGES ===

    // Applicant Name (already covered by 'name' field above)

    // Contact Information
    mobileNo: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          return !v || /^[+]?[\d\s()-]{10,15}$/.test(v);
        },
        message: "Invalid mobile number format",
      },
    },

    // Email Id (already covered by 'email' field above)

    alternateEmailId: {
      type: String,
      lowercase: true,
      trim: true,
      validate: {
        validator: function (v) {
          return !v || /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(v);
        },
        message: "Invalid email format",
      },
    },

    // Personal Information
    dateOfBirth: {
      type: Date,
    },

    ageAsOn2025: {
      type: Number,
      min: 10,
      max: 100,
    },

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
    },

    nationality: {
      type: String,
      default: "Indian",
      trim: true,
    },

    // Identification
    aadhaarNumber: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          return !v || /^\d{12}$/.test(v);
        },
        message: "Aadhaar number must be 12 digits",
      },
    },

    passportNumber: {
      type: String,
      trim: true,
      uppercase: true,
    },

    // Additional Personal Details
    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    },

    motherTongue: {
      type: String,
      trim: true,
    },

    religion: {
      type: String,
      trim: true,
    },

    category: {
      type: String,
      enum: ["General", "OBC", "SC", "ST", "EWS", "Other"],
    },

    // Disability Information
    areYouPhysicallyChallenged: {
      type: Boolean,
      default: false,
    },

    pleaseSpecifyTheDisability: {
      type: String,
      trim: true,
    },

    // Parent/Guardian Details
    parentGuardianDetails: {
      // This can be expanded based on what specific fields are needed
      // The image shows "Should be as per standard section" but doesn't specify exact fields
      type: String,
      trim: true,
    },

    // Permanent Address
    permanentAddress: {
      address: {
        type: String,
        trim: true,
      },
      country: {
        type: String,
        default: "India",
        trim: true,
      },
      state: {
        type: String,
        trim: true,
      },
      district: {
        type: String,
        trim: true,
      },
      city: {
        type: String,
        trim: true,
      },
      pincode: {
        type: String,
        trim: true,
        validate: {
          validator: function (v) {
            return !v || /^\d{6}$/.test(v);
          },
          message: "Pincode must be 6 digits",
        },
      },
    },

    // Correspondence Address
    correspondenceAddress: {
      address: {
        type: String,
        trim: true,
      },
      country: {
        type: String,
        default: "India",
        trim: true,
      },
      state: {
        type: String,
        trim: true,
      },
      district: {
        type: String,
        trim: true,
      },
      city: {
        type: String,
        trim: true,
      },
      pincode: {
        type: String,
        trim: true,
        validate: {
          validator: function (v) {
            return !v || /^\d{6}$/.test(v);
          },
          message: "Pincode must be 6 digits",
        },
      },
    },

    // Checkbox field from the image
    isYourCorrespondenceAddressSameAsPermanentAddress: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.password;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// === INDEXES ===
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1 });
userSchema.index({ mobileNo: 1 });
userSchema.index({ aadhaarNumber: 1 }, { sparse: true });
userSchema.index({ passportNumber: 1 }, { sparse: true });

// === VIRTUALS ===
userSchema.virtual("fullPermanentAddress").get(function () {
  const addr = this.permanentAddress;
  if (!addr) return "";

  return [
    addr.address,
    addr.city,
    addr.district,
    addr.state,
    addr.country,
    addr.pincode,
  ]
    .filter(Boolean)
    .join(", ");
});

userSchema.virtual("fullCorrespondenceAddress").get(function () {
  const addr = this.correspondenceAddress;
  if (!addr) return "";

  return [
    addr.address,
    addr.city,
    addr.district,
    addr.state,
    addr.country,
    addr.pincode,
  ]
    .filter(Boolean)
    .join(", ");
});

userSchema.virtual("age").get(function () {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(this.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }

  return age;
});

// === MIDDLEWARE ===

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Auto-sync correspondence address if marked as same
userSchema.pre("save", function (next) {
  if (this.isYourCorrespondenceAddressSameAsPermanentAddress) {
    this.correspondenceAddress = {
      address: this.permanentAddress?.address,
      country: this.permanentAddress?.country,
      state: this.permanentAddress?.state,
      district: this.permanentAddress?.district,
      city: this.permanentAddress?.city,
      pincode: this.permanentAddress?.pincode,
    };
  }

  // Auto-calculate age if date of birth is provided
  if (this.dateOfBirth && !this.ageAsOn2025) {
    const birthYear = new Date(this.dateOfBirth).getFullYear();
    this.ageAsOn2025 = 2025 - birthYear;
  }

  next();
});

// === METHODS ===

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);

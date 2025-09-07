const Joi = require("joi");

// Address schema
const addressSchema = Joi.object({
  address: Joi.string().allow(""),
  country: Joi.string().default("India"),
  state: Joi.string().allow(""),
  district: Joi.string().allow(""),
  city: Joi.string().allow(""),
  pincode: Joi.string()
    .pattern(/^\d{6}$/)
    .allow("")
    .messages({
      "string.pattern.base": "Pincode must be 6 digits",
    }),
});

const userSchema = Joi.object({
  // Basic required fields
  name: Joi.string().required().messages({
    "string.empty": "Name is required",
    "any.required": "Name is required",
  }),

  email: Joi.string().email().required().messages({
    "string.email": "Invalid email format",
    "string.empty": "Email is required",
    "any.required": "Email is required",
  }),

  password: Joi.string().min(6).required().messages({
    "string.min": "Password must be at least 6 characters long",
    "string.empty": "Password is required",
    "any.required": "Password is required",
  }),

  role: Joi.string().valid("admin", "teacher", "student").required().messages({
    "any.only": "Role must be admin, teacher, or student",
    "string.empty": "Role is required",
    "any.required": "Role is required",
  }),

  // Contact Information (optional)
  mobileNo: Joi.string()
    .pattern(/^[+]?[\d\s()-]{10,15}$/)
    .allow("")
    .messages({
      "string.pattern.base": "Invalid mobile number format",
    }),

  alternateEmailId: Joi.string().email().allow("").messages({
    "string.email": "Invalid alternate email format",
  }),

  // Personal Information (optional)
  dateOfBirth: Joi.date().allow(null),

  ageAsOn2025: Joi.number().integer().min(10).max(100).allow(null),

  gender: Joi.string().valid("Male", "Female", "Other").allow(""),

  nationality: Joi.string().default("Indian").allow(""),

  // Identification (optional)
  aadhaarNumber: Joi.string()
    .pattern(/^\d{12}$/)
    .allow("")
    .messages({
      "string.pattern.base": "Aadhaar number must be 12 digits",
    }),

  passportNumber: Joi.string().allow(""),

  // Additional Personal Details (optional)
  bloodGroup: Joi.string()
    .valid("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-")
    .allow(""),

  motherTongue: Joi.string().allow(""),

  religion: Joi.string().allow(""),

  category: Joi.string()
    .valid("General", "OBC", "SC", "ST", "EWS", "Other")
    .allow(""),

  // Disability Information (optional)
  areYouPhysicallyChallenged: Joi.boolean().default(false),

  pleaseSpecifyTheDisability: Joi.string().allow(""),

  // Parent/Guardian Details (optional)
  parentGuardianDetails: Joi.string().allow(""),

  // Address Information (optional)
  permanentAddress: addressSchema.allow(null),
  correspondenceAddress: addressSchema.allow(null),

  isYourCorrespondenceAddressSameAsPermanentAddress:
    Joi.boolean().default(false),

  // Course code validation (for Excel uploads)
  courseCode: Joi.string()
    .pattern(/^[A-Za-z0-9]+$/)
    .allow("")
    .messages({
      "string.pattern.base":
        "Course code must contain only letters and numbers",
    }),

  // Teacher email for students
  teacherEmail: Joi.string()
    .email()
    .when("role", {
      is: "student",
      then: Joi.required().messages({
        "string.email": "Invalid teacher email format",
        "string.empty": "Teacher email is required for students",
        "any.required": "Teacher email is required for students",
      }),
      otherwise: Joi.optional().allow("", null),
    }),

  // For Excel parsing - individual address field support
  permanentAddressLine: Joi.string().allow(""),
  permanentCity: Joi.string().allow(""),
  permanentDistrict: Joi.string().allow(""),
  permanentState: Joi.string().allow(""),
  permanentCountry: Joi.string().allow(""),
  permanentPincode: Joi.string().allow(""),

  correspondenceAddressLine: Joi.string().allow(""),
  correspondenceCity: Joi.string().allow(""),
  correspondenceDistrict: Joi.string().allow(""),
  correspondenceState: Joi.string().allow(""),
  correspondenceCountry: Joi.string().allow(""),
  correspondencePincode: Joi.string().allow(""),
});

const validateUserData = async (data) => {
  try {
    const validatedData = await userSchema.validateAsync(data, {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: true, // Allow additional fields that might come from Excel
    });
    return validatedData;
  } catch (error) {
    console.error("Validation error for row:", data);
    console.error("Error details:", error.details);
    return null;
  }
};

// Simplified validation for basic user creation (registration)
const basicUserSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid("admin", "teacher", "student").required(),
  mobileNo: Joi.string()
    .pattern(/^[+]?[\d\s()-]{10,15}$/)
    .allow(""),
  gender: Joi.string().valid("Male", "Female", "Other").allow(""),
  dateOfBirth: Joi.date().allow(null),
  permanentAddress: addressSchema.allow(null),
  correspondenceAddress: addressSchema.allow(null),
});

const validateBasicUserData = async (data) => {
  try {
    const validatedData = await basicUserSchema.validateAsync(data, {
      abortEarly: false,
      stripUnknown: true,
    });
    return validatedData;
  } catch (error) {
    console.error("Basic validation error:", error.details);
    throw new Error(
      `Validation failed: ${error.details
        .map((detail) => detail.message)
        .join(", ")}`
    );
  }
};

module.exports = {
  validateUserData,
  validateBasicUserData,
  userSchema,
  basicUserSchema,
};

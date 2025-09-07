const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const register = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      // Additional contact information
      mobileNo,
      alternateEmailId,
      // Personal information
      dateOfBirth,
      ageAsOn2025,
      gender,
      nationality,
      // Identification
      aadhaarNumber,
      passportNumber,
      // Additional personal details
      bloodGroup,
      motherTongue,
      religion,
      category,
      // Disability information
      areYouPhysicallyChallenged,
      pleaseSpecifyTheDisability,
      // Parent/Guardian details
      parentGuardianDetails,
      // Address information
      permanentAddress,
      correspondenceAddress,
      isYourCorrespondenceAddressSameAsPermanentAddress,
    } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "Email already exists" });
    }

    // Create user object with all available fields
    const userData = {
      name,
      email,
      password,
      role,
    };

    // Add optional fields only if they are provided
    if (mobileNo) userData.mobileNo = mobileNo;
    if (alternateEmailId) userData.alternateEmailId = alternateEmailId;
    if (dateOfBirth) userData.dateOfBirth = dateOfBirth;
    if (ageAsOn2025) userData.ageAsOn2025 = ageAsOn2025;
    if (gender) userData.gender = gender;
    if (nationality) userData.nationality = nationality;
    if (aadhaarNumber) userData.aadhaarNumber = aadhaarNumber;
    if (passportNumber) userData.passportNumber = passportNumber;
    if (bloodGroup) userData.bloodGroup = bloodGroup;
    if (motherTongue) userData.motherTongue = motherTongue;
    if (religion) userData.religion = religion;
    if (category) userData.category = category;
    if (areYouPhysicallyChallenged !== undefined)
      userData.areYouPhysicallyChallenged = areYouPhysicallyChallenged;
    if (pleaseSpecifyTheDisability)
      userData.pleaseSpecifyTheDisability = pleaseSpecifyTheDisability;
    if (parentGuardianDetails)
      userData.parentGuardianDetails = parentGuardianDetails;

    // Handle address information
    if (permanentAddress) {
      userData.permanentAddress = {
        address: permanentAddress.address || "",
        country: permanentAddress.country || "India",
        state: permanentAddress.state || "",
        district: permanentAddress.district || "",
        city: permanentAddress.city || "",
        pincode: permanentAddress.pincode || "",
      };
    }

    if (correspondenceAddress) {
      userData.correspondenceAddress = {
        address: correspondenceAddress.address || "",
        country: correspondenceAddress.country || "India",
        state: correspondenceAddress.state || "",
        district: correspondenceAddress.district || "",
        city: correspondenceAddress.city || "",
        pincode: correspondenceAddress.pincode || "",
      };
    }

    if (isYourCorrespondenceAddressSameAsPermanentAddress !== undefined) {
      userData.isYourCorrespondenceAddressSameAsPermanentAddress =
        isYourCorrespondenceAddressSameAsPermanentAddress;
    }

    // Create the user
    const user = new User(userData);
    await user.save();

    // Generate JWT token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    res.status(201).json({ user, token });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(400).json({ error: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    res.json({ user, token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    // req.user is set by auth middleware
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const userResponse = user.toJSON();
    res.json({
      user: userResponse,
      message: "Profile retrieved successfully",
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
};

// Update user profile
const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const updateData = { ...req.body };

    // Remove fields that shouldn't be updated via this endpoint
    delete updateData.password;
    delete updateData.email;
    delete updateData.role;

    // Find and update user
    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const userResponse = user.toJSON();
    res.json({
      user: userResponse,
      message: "Profile updated successfully",
    });
  } catch (error) {
    console.error("Update profile error:", error);

    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        error: "Validation failed",
        details: errors,
      });
    }

    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
};

// Change password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "Current password and new password are required" });
    }

    // Validate new password length
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "New password must be at least 6 characters long" });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    // Update password (will be hashed by pre-save middleware)
    user.password = newPassword;
    await user.save();

    res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  changePassword,
};

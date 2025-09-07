const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const User = require("../models/User");
const { ErrorHandler } = require("../middleware/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

// Get students for the currently authenticated teacher
exports.getMyStudents = catchAsyncErrors(async (req, res, next) => {
  console.log("getMyStudents: Started");

  // Extract user info from JWT token (set by auth middleware)
  const userId = req.user._id;
  console.log(`Authenticated user ID: ${userId}`);

  // Find the teacher profile for this user
  const teacher = await Teacher.findOne({ user: userId });
  if (!teacher) {
    console.log("Teacher profile not found for authenticated user");
    return next(new ErrorHandler("Teacher profile not found", 404));
  }

  console.log(`Found teacher with ID: ${teacher._id}, Email: ${teacher.email}`);

  // Find all students associated with this teacher and populate enhanced user details
  const students = await Student.find({ teacher: teacher._id }).populate({
    path: "user",
    select: `name email mobileNo alternateEmailId dateOfBirth ageAsOn2025 gender nationality 
             aadhaarNumber passportNumber bloodGroup motherTongue religion category 
             areYouPhysicallyChallenged pleaseSpecifyTheDisability parentGuardianDetails
             permanentAddress correspondenceAddress isYourCorrespondenceAddressSameAsPermanentAddress`,
  });

  if (!students || students.length === 0) {
    console.log("No students found for this teacher");
    return res.status(200).json({
      success: true,
      message: "No students found for this teacher",
      teacherInfo: {
        id: teacher._id,
        email: teacher.email,
        name: req.user.name,
        courseCodes: teacher.courseCodes,
      },
      students: [],
    });
  }

  console.log(`Found ${students.length} students for teacher ${teacher.email}`);

  // Format student data with comprehensive user information
  const formattedStudents = students.map((student) => {
    const user = student.user;
    return {
      id: student._id,
      // Basic Information
      name: user ? user.name : "Unknown",
      email: user ? user.email : "",
      mobileNo: user ? user.mobileNo : "",
      alternateEmailId: user ? user.alternateEmailId : "",

      // Personal Information
      dateOfBirth: user ? user.dateOfBirth : null,
      age: user ? user.ageAsOn2025 : null,
      gender: user ? user.gender : "",
      nationality: user ? user.nationality : "",

      // Identification
      aadhaarNumber: user ? user.aadhaarNumber : "",
      passportNumber: user ? user.passportNumber : "",

      // Additional Details
      bloodGroup: user ? user.bloodGroup : "",
      motherTongue: user ? user.motherTongue : "",
      religion: user ? user.religion : "",
      category: user ? user.category : "",

      // Disability Information
      areYouPhysicallyChallenged: user
        ? user.areYouPhysicallyChallenged
        : false,
      pleaseSpecifyTheDisability: user ? user.pleaseSpecifyTheDisability : "",

      // Family Information
      parentGuardianDetails: user ? user.parentGuardianDetails : "",

      // Address Information
      permanentAddress: user ? user.permanentAddress : {},
      correspondenceAddress: user ? user.correspondenceAddress : {},
      isYourCorrespondenceAddressSameAsPermanentAddress: user
        ? user.isYourCorrespondenceAddressSameAsPermanentAddress
        : false,

      // Virtual fields
      fullPermanentAddress: user ? user.fullPermanentAddress : "",
      fullCorrespondenceAddress: user ? user.fullCorrespondenceAddress : "",
      calculatedAge: user ? user.age : null,

      // Student-specific information
      courseCodes: student.courseCodes,
      program: student.program,
      semester: student.semester,
      teacherEmail: student.teacherEmail,
    };
  });

  res.status(200).json({
    success: true,
    count: students.length,
    teacherInfo: {
      id: teacher._id,
      email: teacher.email,
      name: req.user.name,
      courseCodes: teacher.courseCodes,
    },
    students: formattedStudents,
  });
});

// Admin route to get students for any teacher by teacher ID
exports.getStudentsByTeacherId = catchAsyncErrors(async (req, res, next) => {
  console.log("getStudentsByTeacherId: Started");

  const { teacherId } = req.params;
  console.log(`Getting students for teacher ID: ${teacherId}`);

  // Check if teacher exists
  const teacher = await Teacher.findById(teacherId).populate({
    path: "user",
    select: "name email",
  });

  if (!teacher) {
    console.log("Teacher not found");
    return next(new ErrorHandler("Teacher not found", 404));
  }

  // Find all students associated with this teacher and populate enhanced user details
  const students = await Student.find({ teacher: teacherId }).populate({
    path: "user",
    select: `name email mobileNo alternateEmailId dateOfBirth ageAsOn2025 gender nationality 
             aadhaarNumber passportNumber bloodGroup motherTongue religion category 
             areYouPhysicallyChallenged pleaseSpecifyTheDisability parentGuardianDetails
             permanentAddress correspondenceAddress isYourCorrespondenceAddressSameAsPermanentAddress`,
  });

  if (!students || students.length === 0) {
    console.log("No students found for this teacher");
    return res.status(200).json({
      success: true,
      message: "No students found for this teacher",
      teacherInfo: {
        id: teacher._id,
        email: teacher.email,
        name: teacher.user ? teacher.user.name : "Unknown",
        courseCodes: teacher.courseCodes,
      },
      students: [],
    });
  }

  console.log(`Found ${students.length} students for teacher ${teacher.email}`);

  // Format student data with comprehensive user information
  const formattedStudents = students.map((student) => {
    const user = student.user;
    return {
      id: student._id,
      // Basic Information
      name: user ? user.name : "Unknown",
      email: user ? user.email : "",
      mobileNo: user ? user.mobileNo : "",
      alternateEmailId: user ? user.alternateEmailId : "",

      // Personal Information
      dateOfBirth: user ? user.dateOfBirth : null,
      age: user ? user.ageAsOn2025 : null,
      gender: user ? user.gender : "",
      nationality: user ? user.nationality : "",

      // Identification
      aadhaarNumber: user ? user.aadhaarNumber : "",
      passportNumber: user ? user.passportNumber : "",

      // Additional Details
      bloodGroup: user ? user.bloodGroup : "",
      motherTongue: user ? user.motherTongue : "",
      religion: user ? user.religion : "",
      category: user ? user.category : "",

      // Disability Information
      areYouPhysicallyChallenged: user
        ? user.areYouPhysicallyChallenged
        : false,
      pleaseSpecifyTheDisability: user ? user.pleaseSpecifyTheDisability : "",

      // Family Information
      parentGuardianDetails: user ? user.parentGuardianDetails : "",

      // Address Information
      permanentAddress: user ? user.permanentAddress : {},
      correspondenceAddress: user ? user.correspondenceAddress : {},
      isYourCorrespondenceAddressSameAsPermanentAddress: user
        ? user.isYourCorrespondenceAddressSameAsPermanentAddress
        : false,

      // Virtual fields
      fullPermanentAddress: user ? user.fullPermanentAddress : "",
      fullCorrespondenceAddress: user ? user.fullCorrespondenceAddress : "",
      calculatedAge: user ? user.age : null,

      // Student-specific information
      courseCodes: student.courseCodes,
      program: student.program,
      semester: student.semester,
      teacherEmail: student.teacherEmail,
    };
  });

  res.status(200).json({
    success: true,
    count: students.length,
    teacherInfo: {
      id: teacher._id,
      email: teacher.email,
      name: teacher.user ? teacher.user.name : "Unknown",
      courseCodes: teacher.courseCodes,
    },
    students: formattedStudents,
  });
});

module.exports = exports;

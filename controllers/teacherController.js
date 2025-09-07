const User = require("../models/User");
const Course = require("../models/Course");

exports.getStudents = async (req, res) => {
  try {
    // Find all students assigned to this teacher and populate user details with new fields
    const students = await User.find({
      role: "student",
      teacher: req.user._id,
    }).select(`
      name email mobileNo alternateEmailId dateOfBirth ageAsOn2025 gender nationality 
      aadhaarNumber passportNumber bloodGroup motherTongue religion category 
      areYouPhysicallyChallenged pleaseSpecifyTheDisability parentGuardianDetails
      permanentAddress correspondenceAddress isYourCorrespondenceAddressSameAsPermanentAddress
      createdAt updatedAt
    `);

    // Format the response with comprehensive student information
    const formattedStudents = students.map((student) => ({
      _id: student._id,
      // Basic Information
      name: student.name,
      email: student.email,
      mobileNo: student.mobileNo || "",
      alternateEmailId: student.alternateEmailId || "",

      // Personal Information
      dateOfBirth: student.dateOfBirth,
      age: student.ageAsOn2025,
      calculatedAge: student.age, // Virtual field from schema
      gender: student.gender || "",
      nationality: student.nationality || "",

      // Identification
      aadhaarNumber: student.aadhaarNumber || "",
      passportNumber: student.passportNumber || "",

      // Additional Details
      bloodGroup: student.bloodGroup || "",
      motherTongue: student.motherTongue || "",
      religion: student.religion || "",
      category: student.category || "",

      // Disability Information
      areYouPhysicallyChallenged: student.areYouPhysicallyChallenged || false,
      pleaseSpecifyTheDisability: student.pleaseSpecifyTheDisability || "",

      // Family Information
      parentGuardianDetails: student.parentGuardianDetails || "",

      // Address Information
      permanentAddress: student.permanentAddress || {},
      correspondenceAddress: student.correspondenceAddress || {},
      isYourCorrespondenceAddressSameAsPermanentAddress:
        student.isYourCorrespondenceAddressSameAsPermanentAddress || false,

      // Virtual address fields
      fullPermanentAddress: student.fullPermanentAddress || "",
      fullCorrespondenceAddress: student.fullCorrespondenceAddress || "",

      // System fields
      role: student.role,
      teacher: student.teacher,
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
    }));

    res.json(formattedStudents);
  } catch (error) {
    console.error("Error in getStudents:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.assignStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.studentId);
    if (!student || student.role !== "student") {
      return res.status(404).json({ error: "Student not found" });
    }

    student.teacher = req.user._id;
    await student.save();

    // Return the updated student with comprehensive information
    const updatedStudent = await User.findById(student._id).select(`
      name email mobileNo alternateEmailId dateOfBirth ageAsOn2025 gender nationality 
      aadhaarNumber passportNumber bloodGroup motherTongue religion category 
      areYouPhysicallyChallenged pleaseSpecifyTheDisability parentGuardianDetails
      permanentAddress correspondenceAddress isYourCorrespondenceAddressSameAsPermanentAddress
      role teacher createdAt updatedAt
    `);

    // Format the response
    const formattedStudent = {
      _id: updatedStudent._id,
      // Basic Information
      name: updatedStudent.name,
      email: updatedStudent.email,
      mobileNo: updatedStudent.mobileNo || "",
      alternateEmailId: updatedStudent.alternateEmailId || "",

      // Personal Information
      dateOfBirth: updatedStudent.dateOfBirth,
      age: updatedStudent.ageAsOn2025,
      calculatedAge: updatedStudent.age, // Virtual field
      gender: updatedStudent.gender || "",
      nationality: updatedStudent.nationality || "",

      // Identification
      aadhaarNumber: updatedStudent.aadhaarNumber || "",
      passportNumber: updatedStudent.passportNumber || "",

      // Additional Details
      bloodGroup: updatedStudent.bloodGroup || "",
      motherTongue: updatedStudent.motherTongue || "",
      religion: updatedStudent.religion || "",
      category: updatedStudent.category || "",

      // Disability Information
      areYouPhysicallyChallenged:
        updatedStudent.areYouPhysicallyChallenged || false,
      pleaseSpecifyTheDisability:
        updatedStudent.pleaseSpecifyTheDisability || "",

      // Family Information
      parentGuardianDetails: updatedStudent.parentGuardianDetails || "",

      // Address Information
      permanentAddress: updatedStudent.permanentAddress || {},
      correspondenceAddress: updatedStudent.correspondenceAddress || {},
      isYourCorrespondenceAddressSameAsPermanentAddress:
        updatedStudent.isYourCorrespondenceAddressSameAsPermanentAddress ||
        false,

      // Virtual address fields
      fullPermanentAddress: updatedStudent.fullPermanentAddress || "",
      fullCorrespondenceAddress: updatedStudent.fullCorrespondenceAddress || "",

      // System fields
      role: updatedStudent.role,
      teacher: updatedStudent.teacher,
      createdAt: updatedStudent.createdAt,
      updatedAt: updatedStudent.updatedAt,
    };

    res.json(formattedStudent);
  } catch (error) {
    console.error("Error in assignStudent:", error);
    res.status(400).json({ error: error.message });
  }
};

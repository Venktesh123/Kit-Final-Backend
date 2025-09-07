const User = require("../models/User");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const { ErrorHandler } = require("../middleware/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

// Helper function to parse address data from Excel
const parseAddressData = (addressString) => {
  if (!addressString || typeof addressString !== "string") return {};

  // Simple parsing - in real implementation, you might want more sophisticated parsing
  const parts = addressString.split(",").map((part) => part.trim());
  return {
    address: parts[0] || "",
    city: parts[1] || "",
    district: parts[2] || "",
    state: parts[3] || "",
    country: parts[4] || "India",
    pincode: parts[5] || "",
  };
};

// Helper function to parse date from Excel
const parseDate = (dateValue) => {
  if (!dateValue) return null;

  if (dateValue instanceof Date) return dateValue;

  if (typeof dateValue === "string") {
    const parsed = new Date(dateValue);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof dateValue === "number") {
    // Excel date serial number to JavaScript Date
    const date = new Date((dateValue - 25569) * 86400 * 1000);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
};

// Helper function to create user data object from Excel row
const createUserDataFromExcelRow = (userData) => {
  const userObj = {
    name: userData.name,
    email: userData.email.toLowerCase(),
    password: userData.password,
    role: userData.role,
  };

  // Add optional fields if they exist in the Excel data
  if (userData.mobileNo) userObj.mobileNo = userData.mobileNo.toString();
  if (userData.alternateEmailId)
    userObj.alternateEmailId = userData.alternateEmailId.toLowerCase();

  // Parse and add date of birth
  const parsedDate = parseDate(userData.dateOfBirth);
  if (parsedDate) {
    userObj.dateOfBirth = parsedDate;
  }

  if (userData.ageAsOn2025)
    userObj.ageAsOn2025 = parseInt(userData.ageAsOn2025);
  if (userData.gender) userObj.gender = userData.gender;
  if (userData.nationality) userObj.nationality = userData.nationality;
  if (userData.aadhaarNumber)
    userObj.aadhaarNumber = userData.aadhaarNumber.toString();
  if (userData.passportNumber)
    userObj.passportNumber = userData.passportNumber.toString();
  if (userData.bloodGroup) userObj.bloodGroup = userData.bloodGroup;
  if (userData.motherTongue) userObj.motherTongue = userData.motherTongue;
  if (userData.religion) userObj.religion = userData.religion;
  if (userData.category) userObj.category = userData.category;

  // Handle boolean fields
  if (userData.areYouPhysicallyChallenged !== undefined) {
    userObj.areYouPhysicallyChallenged = Boolean(
      userData.areYouPhysicallyChallenged
    );
  }

  if (userData.pleaseSpecifyTheDisability) {
    userObj.pleaseSpecifyTheDisability = userData.pleaseSpecifyTheDisability;
  }

  if (userData.parentGuardianDetails) {
    userObj.parentGuardianDetails = userData.parentGuardianDetails;
  }

  // Handle address fields
  if (userData.permanentAddress) {
    if (typeof userData.permanentAddress === "string") {
      userObj.permanentAddress = parseAddressData(userData.permanentAddress);
    } else if (typeof userData.permanentAddress === "object") {
      userObj.permanentAddress = userData.permanentAddress;
    }
  } else {
    // Try to construct from individual fields if they exist
    const addressFields = {};
    if (userData.permanentAddressLine)
      addressFields.address = userData.permanentAddressLine;
    if (userData.permanentCity) addressFields.city = userData.permanentCity;
    if (userData.permanentDistrict)
      addressFields.district = userData.permanentDistrict;
    if (userData.permanentState) addressFields.state = userData.permanentState;
    if (userData.permanentCountry)
      addressFields.country = userData.permanentCountry;
    if (userData.permanentPincode)
      addressFields.pincode = userData.permanentPincode.toString();

    if (Object.keys(addressFields).length > 0) {
      userObj.permanentAddress = addressFields;
    }
  }

  if (userData.correspondenceAddress) {
    if (typeof userData.correspondenceAddress === "string") {
      userObj.correspondenceAddress = parseAddressData(
        userData.correspondenceAddress
      );
    } else if (typeof userData.correspondenceAddress === "object") {
      userObj.correspondenceAddress = userData.correspondenceAddress;
    }
  } else {
    // Try to construct from individual fields if they exist
    const addressFields = {};
    if (userData.correspondenceAddressLine)
      addressFields.address = userData.correspondenceAddressLine;
    if (userData.correspondenceCity)
      addressFields.city = userData.correspondenceCity;
    if (userData.correspondenceDistrict)
      addressFields.district = userData.correspondenceDistrict;
    if (userData.correspondenceState)
      addressFields.state = userData.correspondenceState;
    if (userData.correspondenceCountry)
      addressFields.country = userData.correspondenceCountry;
    if (userData.correspondencePincode)
      addressFields.pincode = userData.correspondencePincode.toString();

    if (Object.keys(addressFields).length > 0) {
      userObj.correspondenceAddress = addressFields;
    }
  }

  // Handle correspondence address same as permanent
  if (
    userData.isYourCorrespondenceAddressSameAsPermanentAddress !== undefined
  ) {
    userObj.isYourCorrespondenceAddressSameAsPermanentAddress = Boolean(
      userData.isYourCorrespondenceAddressSameAsPermanentAddress
    );
  }

  return userObj;
};

const uploadUsers = async (req, res) => {
  const session = await User.startSession();
  console.log("Processing user upload from in-memory data");

  try {
    // Get the Excel data that was parsed in the middleware
    if (
      !req.excelData ||
      !Array.isArray(req.excelData) ||
      req.excelData.length === 0
    ) {
      return res.status(400).json({
        error: "No valid data found in the Excel file",
      });
    }

    const users = req.excelData;
    const results = [];
    const teacherMap = new Map(); // Map by email + courseCode combination

    await session.withTransaction(async () => {
      // Process teachers first
      const teacherData = users.filter((user) => user.role === "teacher");

      // Group teachers by email to handle multiple course codes per teacher
      const teachersByEmail = new Map();

      for (const userData of teacherData) {
        const email = userData.email.toLowerCase();
        const courseCode = userData.courseCode
          ? userData.courseCode.toUpperCase()
          : "";

        if (!teachersByEmail.has(email)) {
          teachersByEmail.set(email, {
            userData: userData,
            courseCodes: new Set(),
          });
        }
        if (courseCode) {
          teachersByEmail.get(email).courseCodes.add(courseCode);
        }
      }

      // Process each unique teacher
      for (const [email, teacherInfo] of teachersByEmail) {
        // Check if user already exists
        const existingUser = await User.findOne({ email }).session(session);

        let user;
        let teacher;

        if (existingUser) {
          // Update existing user with new fields from Excel
          const updatedUserData = createUserDataFromExcelRow(
            teacherInfo.userData
          );

          // Remove fields that shouldn't be updated
          delete updatedUserData.email;
          delete updatedUserData.role;
          delete updatedUserData.password; // Don't update password during bulk upload

          Object.assign(existingUser, updatedUserData);
          await existingUser.save({ session });
          user = existingUser;

          // Check if teacher profile exists
          teacher = await Teacher.findOne({ user: existingUser._id }).session(
            session
          );

          if (!teacher) {
            // User exists but no teacher profile, create teacher profile
            teacher = new Teacher({
              user: existingUser._id,
              email: email,
              courseCodes: Array.from(teacherInfo.courseCodes),
              courses: [],
            });
            await teacher.save({ session });
          } else {
            // Teacher exists, update course codes
            const existingCodes = new Set(teacher.courseCodes);
            for (const code of teacherInfo.courseCodes) {
              existingCodes.add(code);
            }
            teacher.courseCodes = Array.from(existingCodes);
            await teacher.save({ session });
          }
        } else {
          // Create new user with all fields
          const newUserData = createUserDataFromExcelRow(teacherInfo.userData);
          newUserData.email = email;

          user = new User(newUserData);
          await user.save({ session });

          // Create teacher document
          teacher = new Teacher({
            user: user._id,
            email: email,
            courseCodes: Array.from(teacherInfo.courseCodes),
            courses: [],
          });
          await teacher.save({ session });
        }

        // Store in map for quick lookup when processing students
        // Create entries for each course code this teacher handles
        for (const courseCode of teacherInfo.courseCodes) {
          teacherMap.set(`${email}-${courseCode}`, teacher);
        }

        // Add to results
        results.push({
          _id: user._id.toString(),
          email: user.email,
          name: user.name,
          role: user.role,
          courseCodes: teacher.courseCodes,
          mobileNo: user.mobileNo,
          gender: user.gender,
          fullPermanentAddress: user.fullPermanentAddress,
          fullCorrespondenceAddress: user.fullCorrespondenceAddress,
          createdAt: user.createdAt,
          action: existingUser ? "updated" : "created",
        });
      }

      // Process students
      const studentData = users.filter((user) => user.role === "student");

      // Group students by email to handle multiple course codes per student
      const studentsByEmail = new Map();

      for (const userData of studentData) {
        const email = userData.email.toLowerCase();
        const courseCode = userData.courseCode
          ? userData.courseCode.toUpperCase()
          : "";
        const teacherEmail = userData.teacherEmail
          ? userData.teacherEmail.toLowerCase()
          : "";

        const key = `${email}-${teacherEmail}`;

        if (!studentsByEmail.has(key)) {
          studentsByEmail.set(key, {
            userData: userData,
            courseCodes: new Set(),
            teacherEmail: teacherEmail,
          });
        }
        if (courseCode) {
          studentsByEmail.get(key).courseCodes.add(courseCode);
        }
      }

      for (const [studentKey, studentInfo] of studentsByEmail) {
        const email = studentInfo.userData.email.toLowerCase();
        const teacherEmail = studentInfo.teacherEmail;

        // Check if user already exists
        const existingUser = await User.findOne({ email }).session(session);

        let user;
        let student;

        if (existingUser) {
          // Update existing user with new fields from Excel
          const updatedUserData = createUserDataFromExcelRow(
            studentInfo.userData
          );

          // Remove fields that shouldn't be updated
          delete updatedUserData.email;
          delete updatedUserData.role;
          delete updatedUserData.password; // Don't update password during bulk upload

          Object.assign(existingUser, updatedUserData);
          await existingUser.save({ session });
          user = existingUser;

          // Check if student profile exists for this teacher
          student = await Student.findOne({
            user: existingUser._id,
            teacherEmail: teacherEmail,
          }).session(session);

          if (!student) {
            // Find the teacher for any of the course codes
            let teacher = null;
            for (const courseCode of studentInfo.courseCodes) {
              const teacherKey = `${teacherEmail}-${courseCode}`;
              if (teacherMap.has(teacherKey)) {
                teacher = teacherMap.get(teacherKey);
                break;
              }
            }

            if (!teacher) {
              // Try to find teacher without course code matching
              teacher = await Teacher.findOne({ email: teacherEmail }).session(
                session
              );
              if (!teacher) {
                throw new Error(
                  `Teacher with email ${teacherEmail} not found for student: ${email}`
                );
              }
            }

            // User exists but no student profile for this teacher, create student profile
            student = new Student({
              user: existingUser._id,
              teacher: teacher._id,
              teacherEmail: teacher.email,
              courseCodes: Array.from(studentInfo.courseCodes),
              courses: [],
            });
            await student.save({ session });
          } else {
            // Student exists, update course codes
            const existingCodes = new Set(student.courseCodes);
            for (const code of studentInfo.courseCodes) {
              existingCodes.add(code);
            }
            student.courseCodes = Array.from(existingCodes);
            await student.save({ session });
          }
        } else {
          // Create new user with all fields
          const newUserData = createUserDataFromExcelRow(studentInfo.userData);
          newUserData.email = email;

          user = new User(newUserData);
          await user.save({ session });

          // Find the teacher for any of the course codes
          let teacher = null;
          for (const courseCode of studentInfo.courseCodes) {
            const teacherKey = `${teacherEmail}-${courseCode}`;
            if (teacherMap.has(teacherKey)) {
              teacher = teacherMap.get(teacherKey);
              break;
            }
          }

          if (!teacher) {
            // Try to find teacher without course code matching
            teacher = await Teacher.findOne({ email: teacherEmail }).session(
              session
            );
            if (!teacher) {
              throw new Error(
                `Teacher with email ${teacherEmail} not found for student: ${email}`
              );
            }
          }

          // Create student document
          student = new Student({
            user: user._id,
            teacher: teacher._id,
            teacherEmail: teacher.email,
            courseCodes: Array.from(studentInfo.courseCodes),
            courses: [],
          });
          await student.save({ session });
        }

        // Add to results
        results.push({
          _id: user._id.toString(),
          email: user.email,
          name: user.name,
          role: user.role,
          courseCodes: student.courseCodes,
          teacherEmail: student.teacherEmail,
          mobileNo: user.mobileNo,
          gender: user.gender,
          fullPermanentAddress: user.fullPermanentAddress,
          fullCorrespondenceAddress: user.fullCorrespondenceAddress,
          createdAt: user.createdAt,
          action: existingUser ? "updated" : "created",
        });
      }
    });

    await session.endSession();

    // Return results as array
    return res.status(201).json(results);
  } catch (error) {
    await session.endSession();
    console.error("Upload error:", error);

    return res.status(400).json({
      error: error.message || "Error processing upload",
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

const getMyStudents = catchAsyncErrors(async (req, res, next) => {
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

  // Find all students associated with this teacher and populate user details
  const students = await Student.find({ teacher: teacher._id })
    .populate({
      path: "user",
      select:
        "name email mobileNo gender ageAsOn2025 bloodGroup fullPermanentAddress fullCorrespondenceAddress",
    })
    .populate({
      path: "enrolledCourses.course",
      select: "title description courseCode",
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

  // Format student data with enhanced user information
  const formattedStudents = students.map((student) => ({
    id: student._id,
    name: student.user ? student.user.name : "Unknown",
    email: student.email,
    mobileNo: student.user ? student.user.mobileNo : "",
    gender: student.user ? student.user.gender : "",
    age: student.user ? student.user.ageAsOn2025 : null,
    bloodGroup: student.user ? student.user.bloodGroup : "",
    permanentAddress: student.user ? student.user.fullPermanentAddress : "",
    correspondenceAddress: student.user
      ? student.user.fullCorrespondenceAddress
      : "",
    courseCodes: student.courseCodes,
    program: student.program,
    semester: student.semester,
    enrolledCourses:
      student.enrolledCourses?.map((course) => ({
        courseId: course.course?._id || course.course,
        courseTitle: course.course?.title || "Unknown Course",
        courseCode: course.course?.courseCode || "N/A",
        status: course.status,
        enrolledOn: course.enrolledOn,
      })) || [],
  }));

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
const getStudentsByTeacherId = catchAsyncErrors(async (req, res, next) => {
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

  // Find all students associated with this teacher and populate user details
  const students = await Student.find({ teacher: teacherId })
    .populate({
      path: "user",
      select:
        "name email mobileNo gender ageAsOn2025 bloodGroup fullPermanentAddress fullCorrespondenceAddress",
    })
    .populate({
      path: "enrolledCourses.course",
      select: "title description courseCode",
    });

  if (!students || students.length === 0) {
    console.log("No students found for this teacher-");
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

  // Format student data with enhanced user information
  const formattedStudents = students.map((student) => ({
    id: student._id,
    name: student.user ? student.user.name : "Unknown",
    email: student.email,
    mobileNo: student.user ? student.user.mobileNo : "",
    gender: student.user ? student.user.gender : "",
    age: student.user ? student.user.ageAsOn2025 : null,
    bloodGroup: student.user ? student.user.bloodGroup : "",
    permanentAddress: student.user ? student.user.fullPermanentAddress : "",
    correspondenceAddress: student.user
      ? student.user.fullCorrespondenceAddress
      : "",
    courseCodes: student.courseCodes,
    program: student.program,
    semester: student.semester,
    enrolledCourses:
      student.enrolledCourses?.map((course) => ({
        courseId: course.course?._id || course.course,
        courseTitle: course.course?.title || "Unknown Course",
        courseCode: course.course?.courseCode || "N/A",
        status: course.status,
        enrolledOn: course.enrolledOn,
      })) || [],
  }));

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

module.exports = {
  uploadUsers,
  getStudentsByTeacherId,
  getMyStudents,
};

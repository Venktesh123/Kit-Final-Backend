const User = require("../models/User");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const Course = require("../models/Course");
const Semester = require("../models/Semester");
const CourseOutcome = require("../models/CourseOutcome");
const CourseSchedule = require("../models/CourseSchedule");
const CourseSyllabus = require("../models/CourseSyllabus");
const WeeklyPlan = require("../models/WeeklyPlan");
const CreditPoints = require("../models/CreditPoints");
const CourseAttendance = require("../models/CourseAttendance");
const Lecture = require("../models/Lecture");
const Assignment = require("../models/Assignment");
const Announcement = require("../models/Announcement");
const Discussion = require("../models/Discussion");
const EContent = require("../models/EContent");
const { ErrorHandler } = require("../middleware/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const mongoose = require("mongoose");
const { deleteFileFromAzure } = require("../utils/azureConfig");

// Helper function to parse address data from Excel
const parseAddressData = (addressString) => {
  if (!addressString || typeof addressString !== "string") return {};

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

  if (userData.mobileNo) userObj.mobileNo = userData.mobileNo.toString();
  if (userData.alternateEmailId)
    userObj.alternateEmailId = userData.alternateEmailId.toLowerCase();

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

  if (userData.permanentAddress) {
    if (typeof userData.permanentAddress === "string") {
      userObj.permanentAddress = parseAddressData(userData.permanentAddress);
    } else if (typeof userData.permanentAddress === "object") {
      userObj.permanentAddress = userData.permanentAddress;
    }
  } else {
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

  if (
    userData.isYourCorrespondenceAddressSameAsPermanentAddress !== undefined
  ) {
    userObj.isYourCorrespondenceAddressSameAsPermanentAddress = Boolean(
      userData.isYourCorrespondenceAddressSameAsPermanentAddress
    );
  }

  return userObj;
};

// EXISTING FUNCTIONS (Keep all existing functions from the original file)
// Modified uploadUsers function in adminController.js
const uploadUsers = async (req, res) => {
  const session = await User.startSession();
  console.log("Processing user upload from in-memory data");

  try {
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
    const teacherMap = new Map();
    const errors = []; // Track validation errors

    await session.withTransaction(async () => {
      const teacherData = users.filter((user) => user.role === "teacher");
      const teachersByEmail = new Map();

      // STEP 1: Collect all teachers and their course codes from Excel
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

      // STEP 2: Check for course code conflicts BEFORE processing any teachers
      console.log("Validating course codes for conflicts...");

      // Get all course codes from Excel upload
      const allUploadCourseCodes = new Set();
      for (const [email, teacherInfo] of teachersByEmail) {
        for (const courseCode of teacherInfo.courseCodes) {
          allUploadCourseCodes.add(courseCode);
        }
      }

      // Check each course code against existing teachers in database
      for (const courseCode of allUploadCourseCodes) {
        // Find existing teachers with this course code
        const existingTeachersWithCode = await Teacher.find({
          courseCodes: courseCode,
        })
          .populate("user", "email name")
          .session(session);

        if (existingTeachersWithCode.length > 0) {
          // Check if any of these existing teachers are NOT in the current upload
          for (const existingTeacher of existingTeachersWithCode) {
            const existingEmail = existingTeacher.user.email.toLowerCase();

            // If this existing teacher is NOT in the current upload, it's a conflict
            if (!teachersByEmail.has(existingEmail)) {
              errors.push(
                `Course code "${courseCode}" is already assigned to teacher: ${existingTeacher.user.name} (${existingTeacher.user.email}). Cannot assign to new teachers in upload.`
              );
            }
          }
        }
      }

      // Check for duplicate course codes within the Excel file itself
      const courseCodeToEmails = new Map();
      for (const [email, teacherInfo] of teachersByEmail) {
        for (const courseCode of teacherInfo.courseCodes) {
          if (!courseCodeToEmails.has(courseCode)) {
            courseCodeToEmails.set(courseCode, []);
          }
          courseCodeToEmails.get(courseCode).push(email);
        }
      }

      // Report any course codes assigned to multiple teachers in the same upload
      for (const [courseCode, emails] of courseCodeToEmails) {
        if (emails.length > 1) {
          errors.push(
            `Course code "${courseCode}" is assigned to multiple teachers in the same upload: ${emails.join(
              ", "
            )}. Each course code can only be assigned to one teacher.`
          );
        }
      }

      // STEP 3: If there are any validation errors, stop processing
      if (errors.length > 0) {
        throw new Error(`Course code validation failed:\n${errors.join("\n")}`);
      }

      // STEP 4: Process teachers (existing logic continues...)
      console.log("Course code validation passed. Processing teachers...");

      for (const [email, teacherInfo] of teachersByEmail) {
        const existingUser = await User.findOne({ email }).session(session);

        let user;
        let teacher;

        if (existingUser) {
          // Update existing user
          const updatedUserData = createUserDataFromExcelRow(
            teacherInfo.userData
          );

          delete updatedUserData.email;
          delete updatedUserData.role;
          delete updatedUserData.password;

          Object.assign(existingUser, updatedUserData);
          await existingUser.save({ session });
          user = existingUser;

          teacher = await Teacher.findOne({ user: existingUser._id }).session(
            session
          );

          if (!teacher) {
            teacher = new Teacher({
              user: existingUser._id,
              email: email,
              courseCodes: Array.from(teacherInfo.courseCodes),
              courses: [],
            });
            await teacher.save({ session });
          } else {
            // For existing teachers, REPLACE course codes (don't merge)
            // This ensures clean assignment based on Excel data
            teacher.courseCodes = Array.from(teacherInfo.courseCodes);
            await teacher.save({ session });
          }
        } else {
          // Create new user and teacher
          const newUserData = createUserDataFromExcelRow(teacherInfo.userData);
          newUserData.email = email;

          user = new User(newUserData);
          await user.save({ session });

          teacher = new Teacher({
            user: user._id,
            email: email,
            courseCodes: Array.from(teacherInfo.courseCodes),
            courses: [],
          });
          await teacher.save({ session });
        }

        // Store teacher mapping for student processing
        for (const courseCode of teacherInfo.courseCodes) {
          teacherMap.set(`${email}-${courseCode}`, teacher);
        }

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

      // STEP 5: Process students (existing logic continues...)
      const studentData = users.filter((user) => user.role === "student");
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

        const existingUser = await User.findOne({ email }).session(session);

        let user;
        let student;

        if (existingUser) {
          const updatedUserData = createUserDataFromExcelRow(
            studentInfo.userData
          );

          delete updatedUserData.email;
          delete updatedUserData.role;
          delete updatedUserData.password;

          Object.assign(existingUser, updatedUserData);
          await existingUser.save({ session });
          user = existingUser;

          student = await Student.findOne({
            user: existingUser._id,
            teacherEmail: teacherEmail,
          }).session(session);

          if (!student) {
            let teacher = null;
            for (const courseCode of studentInfo.courseCodes) {
              const teacherKey = `${teacherEmail}-${courseCode}`;
              if (teacherMap.has(teacherKey)) {
                teacher = teacherMap.get(teacherKey);
                break;
              }
            }

            if (!teacher) {
              teacher = await Teacher.findOne({ email: teacherEmail }).session(
                session
              );
              if (!teacher) {
                throw new Error(
                  `Teacher with email ${teacherEmail} not found for student: ${email}`
                );
              }
            }

            student = new Student({
              user: existingUser._id,
              teacher: teacher._id,
              teacherEmail: teacher.email,
              courseCodes: Array.from(studentInfo.courseCodes),
              courses: [],
            });
            await student.save({ session });
          } else {
            const existingCodes = new Set(student.courseCodes);
            for (const code of studentInfo.courseCodes) {
              existingCodes.add(code);
            }
            student.courseCodes = Array.from(existingCodes);
            await student.save({ session });
          }
        } else {
          const newUserData = createUserDataFromExcelRow(studentInfo.userData);
          newUserData.email = email;

          user = new User(newUserData);
          await user.save({ session });

          let teacher = null;
          for (const courseCode of studentInfo.courseCodes) {
            const teacherKey = `${teacherEmail}-${courseCode}`;
            if (teacherMap.has(teacherKey)) {
              teacher = teacherMap.get(teacherKey);
              break;
            }
          }

          if (!teacher) {
            teacher = await Teacher.findOne({ email: teacherEmail }).session(
              session
            );
            if (!teacher) {
              throw new Error(
                `Teacher with email ${teacherEmail} not found for student: ${email}`
              );
            }
          }

          student = new Student({
            user: user._id,
            teacher: teacher._id,
            teacherEmail: teacher.email,
            courseCodes: Array.from(studentInfo.courseCodes),
            courses: [],
          });
          await student.save({ session });
        }

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
    return res.status(201).json({
      success: true,
      message: "Users uploaded successfully with course code validation",
      results: results,
      totalProcessed: results.length,
    });
  } catch (error) {
    await session.endSession();
    console.error("Upload error:", error);

    return res.status(400).json({
      success: false,
      error: error.message || "Error processing upload",
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

const getMyStudents = catchAsyncErrors(async (req, res, next) => {
  console.log("getMyStudents: Started");

  const userId = req.user._id;
  console.log(`Authenticated user ID: ${userId}`);

  const teacher = await Teacher.findOne({ user: userId });
  if (!teacher) {
    console.log("Teacher profile not found for authenticated user");
    return next(new ErrorHandler("Teacher profile not found", 404));
  }

  console.log(`Found teacher with ID: ${teacher._id}, Email: ${teacher.email}`);

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

const getStudentsByTeacherId = catchAsyncErrors(async (req, res, next) => {
  console.log("getStudentsByTeacherId: Started");

  const { teacherId } = req.params;
  console.log(`Getting students for teacher ID: ${teacherId}`);

  const teacher = await Teacher.findById(teacherId).populate({
    path: "user",
    select: "name email",
  });

  if (!teacher) {
    console.log("Teacher not found");
    return next(new ErrorHandler("Teacher not found", 404));
  }

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

// ===============================
// NEW ADMIN FUNCTIONALITY FOR COURSE CODES AND COURSES
// ===============================

// Get all unique course codes from teachers
const getAllCourseCodes = catchAsyncErrors(async (req, res, next) => {
  console.log("getAllCourseCodes: Started");

  try {
    // Get all unique course codes from teachers
    const teachers = await Teacher.find({}, "courseCodes email");

    // Extract and deduplicate course codes
    const allCourseCodes = new Set();
    const courseCodeDetails = {};

    teachers.forEach((teacher) => {
      teacher.courseCodes.forEach((code) => {
        allCourseCodes.add(code);
        if (!courseCodeDetails[code]) {
          courseCodeDetails[code] = {
            courseCode: code,
            teachers: [],
            teacherCount: 0,
            studentCount: 0,
            courseCount: 0,
          };
        }
        courseCodeDetails[code].teachers.push({
          teacherId: teacher._id,
          email: teacher.email,
        });
        courseCodeDetails[code].teacherCount++;
      });
    });

    // Get student counts for each course code
    for (const courseCode of allCourseCodes) {
      const studentCount = await Student.countDocuments({
        courseCodes: courseCode,
      });
      courseCodeDetails[courseCode].studentCount = studentCount;

      // Get actual course count for this course code
      const courseCount = await Course.countDocuments({
        courseCode: courseCode,
      });
      courseCodeDetails[courseCode].courseCount = courseCount;
    }

    const formattedCourseCodes = Object.values(courseCodeDetails);

    res.status(200).json({
      success: true,
      message: "Course codes retrieved successfully",
      totalCourseCodes: allCourseCodes.size,
      courseCodes: formattedCourseCodes,
    });
  } catch (error) {
    console.error("Error in getAllCourseCodes:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Get courses by course code
const getCoursesByCode = catchAsyncErrors(async (req, res, next) => {
  console.log("getCoursesByCode: Started");

  try {
    const { courseCode } = req.params;
    console.log(`Fetching courses for course code: ${courseCode}`);

    if (!courseCode) {
      return next(new ErrorHandler("Course code is required", 400));
    }

    const normalizedCourseCode = courseCode.toUpperCase().trim();

    // Find all courses with this course code
    const courses = await Course.find({ courseCode: normalizedCourseCode })
      .populate("teacher", "email courseCodes")
      .populate({
        path: "teacher",
        populate: {
          path: "user",
          select: "name email mobileNo",
        },
      })
      .populate("semester", "name startDate endDate")
      .populate("outcomes", "outcomes")
      .populate(
        "schedule",
        "classStartDate classEndDate midSemesterExamDate endSemesterExamDate classDaysAndTimes"
      )
      .populate("syllabus")
      .populate("weeklyPlan", "weeks")
      .populate("creditPoints", "lecture tutorial practical project")
      .populate("attendance", "sessions")
      .sort({ createdAt: -1 });

    if (!courses || courses.length === 0) {
      return res.status(200).json({
        success: true,
        message: `No courses found for course code: ${normalizedCourseCode}`,
        courseCode: normalizedCourseCode,
        courses: [],
      });
    }

    // Get additional statistics for each course
    const coursesWithStats = await Promise.all(
      courses.map(async (course) => {
        // Get lecture count
        const lectureCount = await Lecture.countDocuments({
          course: course._id,
          isActive: true,
        });

        // Get assignment count
        const assignmentCount = await Assignment.countDocuments({
          course: course._id,
          isActive: true,
        });

        // Get enrolled students count
        const enrolledStudentsCount = await Student.countDocuments({
          courses: course._id,
          courseCodes: normalizedCourseCode,
        });

        // Get announcements count
        const announcementCount = await Announcement.countDocuments({
          course: course._id,
          isActive: true,
        });

        return {
          _id: course._id,
          title: course.title,
          aboutCourse: course.aboutCourse,
          courseCode: course.courseCode,
          isActive: course.isActive,

          // Teacher info
          teacher: {
            _id: course.teacher._id,
            name: course.teacher.user?.name || "Unknown",
            email: course.teacher.email,
            mobileNo: course.teacher.user?.mobileNo || "",
            courseCodes: course.teacher.courseCodes,
          },

          // Basic course info
          semester: course.semester
            ? {
                _id: course.semester._id,
                name: course.semester.name,
                startDate: course.semester.startDate,
                endDate: course.semester.endDate,
              }
            : null,

          // Course statistics
          stats: {
            lectureCount,
            assignmentCount,
            enrolledStudentsCount,
            announcementCount,
          },

          // Course components (optional detailed info)
          learningOutcomes: course.outcomes?.outcomes || [],
          weeklyPlan: course.weeklyPlan?.weeks || [],
          creditPoints: course.creditPoints
            ? {
                lecture: course.creditPoints.lecture,
                tutorial: course.creditPoints.tutorial,
                practical: course.creditPoints.practical,
                project: course.creditPoints.project,
              }
            : null,

          schedule: course.schedule
            ? {
                classStartDate: course.schedule.classStartDate,
                classEndDate: course.schedule.classEndDate,
                midSemesterExamDate: course.schedule.midSemesterExamDate,
                endSemesterExamDate: course.schedule.endSemesterExamDate,
                classDaysAndTimes: course.schedule.classDaysAndTimes,
              }
            : null,

          // Timestamps
          createdAt: course.createdAt,
          updatedAt: course.updatedAt,
        };
      })
    );

    res.status(200).json({
      success: true,
      message: `Found ${courses.length} courses for course code: ${normalizedCourseCode}`,
      courseCode: normalizedCourseCode,
      totalCourses: courses.length,
      courses: coursesWithStats,
    });
  } catch (error) {
    console.error("Error in getCoursesByCode:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Get all users (teachers and students) with pagination and filtering
const getAllUsers = catchAsyncErrors(async (req, res, next) => {
  console.log("getAllUsers: Started");

  try {
    const {
      page = 1,
      limit = 10,
      role,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    let query = {};
    if (role && ["admin", "teacher", "student"].includes(role)) {
      query.role = role;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { mobileNo: { $regex: search, $options: "i" } },
      ];
    }

    // Get total count
    const totalUsers = await User.countDocuments(query);

    // Get users with pagination
    const users = await User.find(query)
      .select("-password")
      .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
      .skip(skip)
      .limit(limitNum);

    // Get additional info for teachers and students
    const usersWithDetails = await Promise.all(
      users.map(async (user) => {
        const userObj = user.toObject();

        if (user.role === "teacher") {
          const teacher = await Teacher.findOne({ user: user._id });
          if (teacher) {
            userObj.teacherInfo = {
              _id: teacher._id,
              courseCodes: teacher.courseCodes,
              courseCount: teacher.courses.length,
            };
          }
        } else if (user.role === "student") {
          const student = await Student.findOne({ user: user._id });
          if (student) {
            userObj.studentInfo = {
              _id: student._id,
              courseCodes: student.courseCodes,
              teacherEmail: student.teacherEmail,
              courseCount: student.courses.length,
            };
          }
        }

        return userObj;
      })
    );

    res.status(200).json({
      success: true,
      message: "Users retrieved successfully",
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalUsers / limitNum),
        totalUsers,
        hasNext: pageNum < Math.ceil(totalUsers / limitNum),
        hasPrev: pageNum > 1,
      },
      users: usersWithDetails,
    });
  } catch (error) {
    console.error("Error in getAllUsers:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Delete user and all related data
const deleteUser = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteUser: Started");

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { userId } = req.params;
    console.log(`Deleting user: ${userId}`);

    // Find the user
    const user = await User.findById(userId).session(session);
    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    const userRole = user.role;
    const userEmail = user.email;

    if (userRole === "teacher") {
      // Find teacher profile
      const teacher = await Teacher.findOne({ user: userId }).session(session);
      if (teacher) {
        // Get all courses taught by this teacher
        const courses = await Course.find({ teacher: teacher._id }).session(
          session
        );

        // Delete all course-related data
        for (const course of courses) {
          // Delete lectures and their Azure files
          const lectures = await Lecture.find({ course: course._id }).session(
            session
          );
          for (const lecture of lectures) {
            if (lecture.videoKey) {
              try {
                await deleteFileFromAzure(lecture.videoKey);
              } catch (error) {
                console.error(`Error deleting lecture video: ${error.message}`);
              }
            }
          }
          await Lecture.deleteMany({ course: course._id }).session(session);

          // Delete assignments and their Azure files
          const assignments = await Assignment.find({
            course: course._id,
          }).session(session);
          for (const assignment of assignments) {
            // Delete assignment attachments
            if (assignment.attachments && assignment.attachments.length > 0) {
              for (const attachment of assignment.attachments) {
                try {
                  await deleteFileFromAzure(attachment.key);
                } catch (error) {
                  console.error(
                    `Error deleting assignment attachment: ${error.message}`
                  );
                }
              }
            }
            // Delete submission files
            if (assignment.submissions && assignment.submissions.length > 0) {
              for (const submission of assignment.submissions) {
                if (submission.submissionFileKey) {
                  try {
                    await deleteFileFromAzure(submission.submissionFileKey);
                  } catch (error) {
                    console.error(
                      `Error deleting submission file: ${error.message}`
                    );
                  }
                }
              }
            }
          }
          await Assignment.deleteMany({ course: course._id }).session(session);

          // Delete announcements and their Azure files
          const announcements = await Announcement.find({
            course: course._id,
          }).session(session);
          for (const announcement of announcements) {
            if (announcement.image && announcement.image.imageKey) {
              try {
                await deleteFileFromAzure(announcement.image.imageKey);
              } catch (error) {
                console.error(
                  `Error deleting announcement image: ${error.message}`
                );
              }
            }
          }
          await Announcement.deleteMany({ course: course._id }).session(
            session
          );

          // Delete course syllabus and related files
          const syllabus = await CourseSyllabus.findOne({
            course: course._id,
          }).session(session);
          if (syllabus) {
            // Delete all module files
            for (const module of syllabus.modules) {
              const filesToDelete = [];

              // Collect all file keys
              if (module.videos) {
                module.videos.forEach((video) => {
                  if (video.fileKey) filesToDelete.push(video.fileKey);
                  if (video.thumbnail?.thumbnailKey)
                    filesToDelete.push(video.thumbnail.thumbnailKey);
                });
              }
              if (module.pdfs) {
                module.pdfs.forEach((pdf) => {
                  if (pdf.fileKey) filesToDelete.push(pdf.fileKey);
                  if (pdf.thumbnail?.thumbnailKey)
                    filesToDelete.push(pdf.thumbnail.thumbnailKey);
                });
              }
              if (module.ppts) {
                module.ppts.forEach((ppt) => {
                  if (ppt.fileKey) filesToDelete.push(ppt.fileKey);
                  if (ppt.thumbnail?.thumbnailKey)
                    filesToDelete.push(ppt.thumbnail.thumbnailKey);
                });
              }
              if (module.links) {
                module.links.forEach((link) => {
                  if (link.thumbnail?.thumbnailKey)
                    filesToDelete.push(link.thumbnail.thumbnailKey);
                });
              }

              // Delete files from Azure
              for (const fileKey of filesToDelete) {
                try {
                  await deleteFileFromAzure(fileKey);
                } catch (error) {
                  console.error(
                    `Error deleting syllabus file: ${error.message}`
                  );
                }
              }
            }
          }

          // Delete EContent and files
          const eContent = await EContent.findOne({
            course: course._id,
          }).session(session);
          if (eContent) {
            for (const module of eContent.modules) {
              if (module.files && module.files.length > 0) {
                for (const file of module.files) {
                  try {
                    await deleteFileFromAzure(file.fileKey);
                  } catch (error) {
                    console.error(
                      `Error deleting EContent file: ${error.message}`
                    );
                  }
                }
              }
            }
          }
          await EContent.deleteMany({ course: course._id }).session(session);

          // Delete all course-related collections
          await CourseOutcome.deleteMany({ course: course._id }).session(
            session
          );
          await CourseSchedule.deleteMany({ course: course._id }).session(
            session
          );
          await CourseSyllabus.deleteMany({ course: course._id }).session(
            session
          );
          await WeeklyPlan.deleteMany({ course: course._id }).session(session);
          await CreditPoints.deleteMany({ course: course._id }).session(
            session
          );
          await CourseAttendance.deleteMany({ course: course._id }).session(
            session
          );
          await Discussion.deleteMany({ course: course._id }).session(session);

          // Remove course from students
          await Student.updateMany(
            { courses: course._id },
            { $pull: { courses: course._id } }
          ).session(session);
        }

        // Delete all courses by this teacher
        await Course.deleteMany({ teacher: teacher._id }).session(session);

        // Delete teacher profile
        await Teacher.findByIdAndDelete(teacher._id).session(session);
      }
    } else if (userRole === "student") {
      // Find student profile
      const student = await Student.findOne({ user: userId }).session(session);
      if (student) {
        // Remove student submissions from assignments
        await Assignment.updateMany(
          { "submissions.student": student._id },
          { $pull: { submissions: { student: student._id } } }
        ).session(session);

        // Delete student profile
        await Student.findByIdAndDelete(student._id).session(session);
      }
    }

    // Delete discussions created by this user
    const userDiscussions = await Discussion.find({ author: userId }).session(
      session
    );
    for (const discussion of userDiscussions) {
      // Delete discussion attachments
      if (discussion.attachments && discussion.attachments.length > 0) {
        for (const attachment of discussion.attachments) {
          try {
            await deleteFileFromAzure(attachment.fileKey);
          } catch (error) {
            console.error(
              `Error deleting discussion attachment: ${error.message}`
            );
          }
        }
      }

      // Delete comment attachments
      if (discussion.comments && discussion.comments.length > 0) {
        for (const comment of discussion.comments) {
          if (comment.attachments && comment.attachments.length > 0) {
            for (const attachment of comment.attachments) {
              try {
                await deleteFileFromAzure(attachment.fileKey);
              } catch (error) {
                console.error(
                  `Error deleting comment attachment: ${error.message}`
                );
              }
            }
          }
          // Delete reply attachments
          if (comment.replies && comment.replies.length > 0) {
            for (const reply of comment.replies) {
              if (reply.attachments && reply.attachments.length > 0) {
                for (const attachment of reply.attachments) {
                  try {
                    await deleteFileFromAzure(attachment.fileKey);
                  } catch (error) {
                    console.error(
                      `Error deleting reply attachment: ${error.message}`
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
    await Discussion.deleteMany({ author: userId }).session(session);

    // Finally, delete the user
    await User.findByIdAndDelete(userId).session(session);

    await session.commitTransaction();
    transactionStarted = false;

    console.log(`Successfully deleted user: ${userEmail} (${userRole})`);

    res.status(200).json({
      success: true,
      message: `User ${userEmail} and all related data deleted successfully`,
      deletedUser: {
        _id: userId,
        email: userEmail,
        role: userRole,
      },
    });
  } catch (error) {
    console.error("Error in deleteUser:", error);

    if (transactionStarted) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    await session.endSession();
  }
});

// Get all courses (admin view)
const getAllCourses = catchAsyncErrors(async (req, res, next) => {
  console.log("getAllCourses: Started");

  try {
    const {
      page = 1,
      limit = 10,
      courseCode,
      teacherEmail,
      semester,
      isActive,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    let query = {};

    if (courseCode) {
      query.courseCode = courseCode.toUpperCase();
    }

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { aboutCourse: { $regex: search, $options: "i" } },
        { courseCode: { $regex: search, $options: "i" } },
      ];
    }

    // Handle teacher email filter
    let teacherIds = [];
    if (teacherEmail) {
      const teachers = await Teacher.find({
        email: { $regex: teacherEmail, $options: "i" },
      });
      teacherIds = teachers.map((t) => t._id);
      if (teacherIds.length > 0) {
        query.teacher = { $in: teacherIds };
      } else {
        // No teachers found with that email, return empty result
        return res.status(200).json({
          success: true,
          message: "No courses found",
          pagination: {
            currentPage: pageNum,
            totalPages: 0,
            totalCourses: 0,
            hasNext: false,
            hasPrev: false,
          },
          courses: [],
        });
      }
    }

    // Handle semester filter
    if (semester) {
      const semesters = await Semester.find({
        name: { $regex: semester, $options: "i" },
      });
      const semesterIds = semesters.map((s) => s._id);
      if (semesterIds.length > 0) {
        query.semester = { $in: semesterIds };
      }
    }

    // Get total count
    const totalCourses = await Course.countDocuments(query);

    // Get courses with pagination
    const courses = await Course.find(query)
      .populate("teacher", "email courseCodes")
      .populate({
        path: "teacher",
        populate: {
          path: "user",
          select: "name email mobileNo",
        },
      })
      .populate("semester", "name startDate endDate")
      .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
      .skip(skip)
      .limit(limitNum);

    // Get additional statistics for each course
    const coursesWithStats = await Promise.all(
      courses.map(async (course) => {
        const [
          lectureCount,
          assignmentCount,
          enrolledStudentsCount,
          announcementCount,
        ] = await Promise.all([
          Lecture.countDocuments({ course: course._id, isActive: true }),
          Assignment.countDocuments({ course: course._id, isActive: true }),
          Student.countDocuments({
            courses: course._id,
            courseCodes: course.courseCode,
          }),
          Announcement.countDocuments({ course: course._id, isActive: true }),
        ]);

        return {
          _id: course._id,
          title: course.title,
          aboutCourse: course.aboutCourse,
          courseCode: course.courseCode,
          isActive: course.isActive,

          teacher: {
            _id: course.teacher._id,
            name: course.teacher.user?.name || "Unknown",
            email: course.teacher.email,
            mobileNo: course.teacher.user?.mobileNo || "",
            courseCodes: course.teacher.courseCodes,
          },

          semester: course.semester
            ? {
                _id: course.semester._id,
                name: course.semester.name,
                startDate: course.semester.startDate,
                endDate: course.semester.endDate,
              }
            : null,

          stats: {
            lectureCount,
            assignmentCount,
            enrolledStudentsCount,
            announcementCount,
          },

          createdAt: course.createdAt,
          updatedAt: course.updatedAt,
        };
      })
    );

    res.status(200).json({
      success: true,
      message: "Courses retrieved successfully",
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCourses / limitNum),
        totalCourses,
        hasNext: pageNum < Math.ceil(totalCourses / limitNum),
        hasPrev: pageNum > 1,
      },
      courses: coursesWithStats,
    });
  } catch (error) {
    console.error("Error in getAllCourses:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Delete course (admin version with complete cleanup)
const deleteCourse = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteCourse (Admin): Started");

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { courseId } = req.params;
    console.log(`Admin deleting course: ${courseId}`);

    const course = await Course.findById(courseId).session(session);
    if (!course) {
      return next(new ErrorHandler("Course not found", 404));
    }

    console.log(`Deleting course: ${course.title} (${course.courseCode})`);

    // Delete all related documents
    if (course.outcomes) {
      await CourseOutcome.findByIdAndDelete(course.outcomes).session(session);
    }

    if (course.schedule) {
      await CourseSchedule.findByIdAndDelete(course.schedule).session(session);
    }

    if (course.syllabus) {
      // Delete syllabus content files from Azure
      const syllabus = await CourseSyllabus.findById(course.syllabus).session(
        session
      );
      if (syllabus) {
        const filesToDelete = [];

        syllabus.modules.forEach((module) => {
          if (module.videos) {
            module.videos.forEach((video) => {
              if (video.fileKey) filesToDelete.push(video.fileKey);
              if (video.thumbnail?.thumbnailKey)
                filesToDelete.push(video.thumbnail.thumbnailKey);
            });
          }

          if (module.pdfs) {
            module.pdfs.forEach((pdf) => {
              if (pdf.fileKey) filesToDelete.push(pdf.fileKey);
              if (pdf.thumbnail?.thumbnailKey)
                filesToDelete.push(pdf.thumbnail.thumbnailKey);
            });
          }

          if (module.ppts) {
            module.ppts.forEach((ppt) => {
              if (ppt.fileKey) filesToDelete.push(ppt.fileKey);
              if (ppt.thumbnail?.thumbnailKey)
                filesToDelete.push(ppt.thumbnail.thumbnailKey);
            });
          }

          if (module.links) {
            module.links.forEach((link) => {
              if (link.thumbnail?.thumbnailKey)
                filesToDelete.push(link.thumbnail.thumbnailKey);
            });
          }
        });

        // Delete files from Azure
        if (filesToDelete.length > 0) {
          console.log(`Deleting ${filesToDelete.length} files from Azure`);
          for (const fileKey of filesToDelete) {
            try {
              await deleteFileFromAzure(fileKey);
            } catch (azureError) {
              console.error("Error deleting file from Azure:", azureError);
            }
          }
        }
      }

      await CourseSyllabus.findByIdAndDelete(course.syllabus).session(session);
    }

    if (course.weeklyPlan) {
      await WeeklyPlan.findByIdAndDelete(course.weeklyPlan).session(session);
    }

    if (course.creditPoints) {
      await CreditPoints.findByIdAndDelete(course.creditPoints).session(
        session
      );
    }

    if (course.attendance) {
      await CourseAttendance.findByIdAndDelete(course.attendance).session(
        session
      );
    }

    // Delete all lectures for this course
    const lectures = await Lecture.find({ course: course._id }).session(
      session
    );
    for (const lecture of lectures) {
      if (lecture.videoKey) {
        try {
          await deleteFileFromAzure(lecture.videoKey);
        } catch (deleteError) {
          console.error("Error deleting video file:", deleteError);
        }
      }
    }
    await Lecture.deleteMany({ course: course._id }).session(session);

    // Delete assignments and their files
    const assignments = await Assignment.find({ course: course._id }).session(
      session
    );
    for (const assignment of assignments) {
      // Delete attachment files
      if (assignment.attachments && assignment.attachments.length > 0) {
        for (const attachment of assignment.attachments) {
          try {
            await deleteFileFromAzure(attachment.key);
          } catch (deleteError) {
            console.error("Error deleting assignment attachment:", deleteError);
          }
        }
      }

      // Delete submission files
      if (assignment.submissions && assignment.submissions.length > 0) {
        for (const submission of assignment.submissions) {
          if (submission.submissionFileKey) {
            try {
              await deleteFileFromAzure(submission.submissionFileKey);
            } catch (deleteError) {
              console.error("Error deleting submission file:", deleteError);
            }
          }
        }
      }
    }
    await Assignment.deleteMany({ course: course._id }).session(session);

    // Delete announcements and their images
    const announcements = await Announcement.find({
      course: course._id,
    }).session(session);
    for (const announcement of announcements) {
      if (announcement.image && announcement.image.imageKey) {
        try {
          await deleteFileFromAzure(announcement.image.imageKey);
        } catch (deleteError) {
          console.error("Error deleting announcement image:", deleteError);
        }
      }
    }
    await Announcement.deleteMany({ course: course._id }).session(session);

    // Delete discussions related to this course
    const discussions = await Discussion.find({ course: course._id }).session(
      session
    );
    for (const discussion of discussions) {
      // Delete discussion attachments
      if (discussion.attachments && discussion.attachments.length > 0) {
        for (const attachment of discussion.attachments) {
          try {
            await deleteFileFromAzure(attachment.fileKey);
          } catch (deleteError) {
            console.error("Error deleting discussion attachment:", deleteError);
          }
        }
      }
    }
    await Discussion.deleteMany({ course: course._id }).session(session);

    // Delete EContent
    const eContent = await EContent.findOne({ course: course._id }).session(
      session
    );
    if (eContent) {
      for (const module of eContent.modules) {
        if (module.files && module.files.length > 0) {
          for (const file of module.files) {
            try {
              await deleteFileFromAzure(file.fileKey);
            } catch (deleteError) {
              console.error("Error deleting EContent file:", deleteError);
            }
          }
        }
      }
    }
    await EContent.deleteMany({ course: course._id }).session(session);

    // Remove course from teacher's courses array
    const teacher = await Teacher.findById(course.teacher).session(session);
    if (teacher) {
      teacher.courses = teacher.courses.filter((id) => !id.equals(course._id));
      await teacher.save({ session });
    }

    // Update students who have this course
    const students = await Student.find({ courses: course._id }).session(
      session
    );
    if (students && students.length > 0) {
      const updatePromises = students.map((student) => {
        student.courses = student.courses.filter(
          (id) => !id.equals(course._id)
        );
        return student.save({ session });
      });
      await Promise.all(updatePromises);
    }

    // Delete the course
    await Course.findByIdAndDelete(course._id).session(session);

    await session.commitTransaction();
    transactionStarted = false;

    res.status(200).json({
      success: true,
      message: "Course and all related data deleted successfully",
      deletedCourse: {
        _id: course._id,
        title: course.title,
        courseCode: course.courseCode,
      },
    });
  } catch (error) {
    console.error("Error in deleteCourse (Admin):", error);

    if (transactionStarted) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    await session.endSession();
  }
});

// Get system statistics
const getSystemStats = catchAsyncErrors(async (req, res, next) => {
  console.log("getSystemStats: Started");

  try {
    // Get counts for different entities
    const [
      totalUsers,
      totalTeachers,
      totalStudents,
      totalCourses,
      totalActiveCourses,
      totalCourseCodes,
      totalLectures,
      totalAssignments,
      totalAnnouncements,
      totalDiscussions,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "teacher" }),
      User.countDocuments({ role: "student" }),
      Course.countDocuments(),
      Course.countDocuments({ isActive: true }),
      Teacher.distinct("courseCodes"),
      Lecture.countDocuments({ isActive: true }),
      Assignment.countDocuments({ isActive: true }),
      Announcement.countDocuments({ isActive: true }),
      Discussion.countDocuments({ isActive: true }),
    ]);

    // Get recent activities (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [recentUsers, recentCourses, recentLectures, recentAssignments] =
      await Promise.all([
        User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
        Course.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
        Lecture.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
        Assignment.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      ]);

    // Get top course codes by usage
    const courseCodeStats = await Teacher.aggregate([
      { $unwind: "$courseCodes" },
      {
        $group: {
          _id: "$courseCodes",
          teacherCount: { $sum: 1 },
        },
      },
      { $sort: { teacherCount: -1 } },
      { $limit: 10 },
    ]);

    // Add course and student counts to course code stats
    const enhancedCourseCodeStats = await Promise.all(
      courseCodeStats.map(async (stat) => {
        const [courseCount, studentCount] = await Promise.all([
          Course.countDocuments({ courseCode: stat._id }),
          Student.countDocuments({ courseCodes: stat._id }),
        ]);

        return {
          courseCode: stat._id,
          teacherCount: stat.teacherCount,
          courseCount,
          studentCount,
          totalUsage: stat.teacherCount + courseCount + studentCount,
        };
      })
    );

    res.status(200).json({
      success: true,
      message: "System statistics retrieved successfully",
      stats: {
        overview: {
          totalUsers,
          totalTeachers,
          totalStudents,
          totalCourses,
          totalActiveCourses,
          totalCourseCodes: totalCourseCodes.length,
          totalLectures,
          totalAssignments,
          totalAnnouncements,
          totalDiscussions,
        },
        recentActivity: {
          period: "Last 7 days",
          newUsers: recentUsers,
          newCourses: recentCourses,
          newLectures: recentLectures,
          newAssignments: recentAssignments,
        },
        topCourseCodes: enhancedCourseCodeStats,
      },
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error in getSystemStats:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Create new course code (assign to teachers)
const createCourseCode = catchAsyncErrors(async (req, res, next) => {
  console.log("createCourseCode: Started");

  try {
    const { courseCode, teacherEmails, description } = req.body;

    if (!courseCode || !teacherEmails || !Array.isArray(teacherEmails)) {
      return next(
        new ErrorHandler(
          "Course code and teacher emails array are required",
          400
        )
      );
    }

    const normalizedCourseCode = courseCode.toUpperCase().trim();

    // Validate teacher emails and update their course codes
    const updatedTeachers = [];
    const errors = [];

    for (const email of teacherEmails) {
      try {
        const teacher = await Teacher.findOne({
          email: email.toLowerCase().trim(),
        });

        if (!teacher) {
          errors.push(`Teacher not found: ${email}`);
          continue;
        }

        // Add course code if not already present
        if (!teacher.courseCodes.includes(normalizedCourseCode)) {
          teacher.courseCodes.push(normalizedCourseCode);
          await teacher.save();

          updatedTeachers.push({
            _id: teacher._id,
            email: teacher.email,
            courseCodes: teacher.courseCodes,
          });
        } else {
          errors.push(
            `Course code ${normalizedCourseCode} already assigned to ${email}`
          );
        }
      } catch (error) {
        errors.push(`Error updating teacher ${email}: ${error.message}`);
      }
    }

    res.status(200).json({
      success: true,
      message: `Course code ${normalizedCourseCode} assigned successfully`,
      courseCode: normalizedCourseCode,
      description: description || "",
      updatedTeachers,
      errors: errors.length > 0 ? errors : undefined,
      summary: {
        totalRequested: teacherEmails.length,
        successful: updatedTeachers.length,
        failed: errors.length,
      },
    });
  } catch (error) {
    console.error("Error in createCourseCode:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Update course code assignments
const updateCourseCode = catchAsyncErrors(async (req, res, next) => {
  console.log("updateCourseCode: Started");

  try {
    const { courseCode } = req.params;
    const { newCourseCode, teacherEmails, addTeachers, removeTeachers } =
      req.body;

    const normalizedCourseCode = courseCode.toUpperCase().trim();
    const normalizedNewCourseCode = newCourseCode
      ? newCourseCode.toUpperCase().trim()
      : null;

    // If renaming course code
    if (
      normalizedNewCourseCode &&
      normalizedNewCourseCode !== normalizedCourseCode
    ) {
      // Update all teachers with old course code
      await Teacher.updateMany(
        { courseCodes: normalizedCourseCode },
        {
          $pull: { courseCodes: normalizedCourseCode },
          $addToSet: { courseCodes: normalizedNewCourseCode },
        }
      );

      // Update all students with old course code
      await Student.updateMany(
        { courseCodes: normalizedCourseCode },
        {
          $pull: { courseCodes: normalizedCourseCode },
          $addToSet: { courseCodes: normalizedNewCourseCode },
        }
      );

      // Update all courses with old course code
      await Course.updateMany(
        { courseCode: normalizedCourseCode },
        { courseCode: normalizedNewCourseCode }
      );
    }

    const targetCourseCode = normalizedNewCourseCode || normalizedCourseCode;
    let updatedTeachers = [];
    let errors = [];

    // Add teachers
    if (addTeachers && Array.isArray(addTeachers)) {
      for (const email of addTeachers) {
        try {
          const teacher = await Teacher.findOne({
            email: email.toLowerCase().trim(),
          });

          if (!teacher) {
            errors.push(`Teacher not found: ${email}`);
            continue;
          }

          if (!teacher.courseCodes.includes(targetCourseCode)) {
            teacher.courseCodes.push(targetCourseCode);
            await teacher.save();
            updatedTeachers.push({ email: teacher.email, action: "added" });
          }
        } catch (error) {
          errors.push(`Error adding teacher ${email}: ${error.message}`);
        }
      }
    }

    // Remove teachers
    if (removeTeachers && Array.isArray(removeTeachers)) {
      for (const email of removeTeachers) {
        try {
          const teacher = await Teacher.findOne({
            email: email.toLowerCase().trim(),
          });

          if (!teacher) {
            errors.push(`Teacher not found: ${email}`);
            continue;
          }

          if (teacher.courseCodes.includes(targetCourseCode)) {
            teacher.courseCodes = teacher.courseCodes.filter(
              (code) => code !== targetCourseCode
            );
            await teacher.save();
            updatedTeachers.push({ email: teacher.email, action: "removed" });
          }
        } catch (error) {
          errors.push(`Error removing teacher ${email}: ${error.message}`);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Course code updated successfully`,
      originalCourseCode: normalizedCourseCode,
      newCourseCode: targetCourseCode,
      updatedTeachers,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error in updateCourseCode:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Delete course code and all related data
const deleteCourseCode = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteCourseCode: Started");

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { courseCode } = req.params;
    const normalizedCourseCode = courseCode.toUpperCase().trim();

    console.log(`Admin deleting course code: ${normalizedCourseCode}`);

    // Get all courses with this course code
    const courses = await Course.find({
      courseCode: normalizedCourseCode,
    }).session(session);

    // Delete all courses and their related data (reuse existing logic)
    for (const course of courses) {
      // Delete all related documents for each course
      await CourseOutcome.deleteMany({ course: course._id }).session(session);
      await CourseSchedule.deleteMany({ course: course._id }).session(session);
      await WeeklyPlan.deleteMany({ course: course._id }).session(session);
      await CreditPoints.deleteMany({ course: course._id }).session(session);
      await CourseAttendance.deleteMany({ course: course._id }).session(
        session
      );

      // Delete syllabus and files
      const syllabus = await CourseSyllabus.findOne({
        course: course._id,
      }).session(session);
      if (syllabus) {
        const filesToDelete = [];
        syllabus.modules.forEach((module) => {
          if (module.videos) {
            module.videos.forEach((video) => {
              if (video.fileKey) filesToDelete.push(video.fileKey);
              if (video.thumbnail?.thumbnailKey)
                filesToDelete.push(video.thumbnail.thumbnailKey);
            });
          }
          if (module.pdfs) {
            module.pdfs.forEach((pdf) => {
              if (pdf.fileKey) filesToDelete.push(pdf.fileKey);
              if (pdf.thumbnail?.thumbnailKey)
                filesToDelete.push(pdf.thumbnail.thumbnailKey);
            });
          }
          if (module.ppts) {
            module.ppts.forEach((ppt) => {
              if (ppt.fileKey) filesToDelete.push(ppt.fileKey);
              if (ppt.thumbnail?.thumbnailKey)
                filesToDelete.push(ppt.thumbnail.thumbnailKey);
            });
          }
          if (module.links) {
            module.links.forEach((link) => {
              if (link.thumbnail?.thumbnailKey)
                filesToDelete.push(link.thumbnail.thumbnailKey);
            });
          }
        });

        // Delete files from Azure
        for (const fileKey of filesToDelete) {
          try {
            await deleteFileFromAzure(fileKey);
          } catch (azureError) {
            console.error("Error deleting file from Azure:", azureError);
          }
        }
      }
      await CourseSyllabus.deleteMany({ course: course._id }).session(session);

      // Delete lectures and videos
      const lectures = await Lecture.find({ course: course._id }).session(
        session
      );
      for (const lecture of lectures) {
        if (lecture.videoKey) {
          try {
            await deleteFileFromAzure(lecture.videoKey);
          } catch (deleteError) {
            console.error("Error deleting video file:", deleteError);
          }
        }
      }
      await Lecture.deleteMany({ course: course._id }).session(session);

      // Delete assignments and files
      const assignments = await Assignment.find({ course: course._id }).session(
        session
      );
      for (const assignment of assignments) {
        // Delete attachment files
        if (assignment.attachments && assignment.attachments.length > 0) {
          for (const attachment of assignment.attachments) {
            try {
              await deleteFileFromAzure(attachment.key);
            } catch (deleteError) {
              console.error(
                "Error deleting assignment attachment:",
                deleteError
              );
            }
          }
        }
        // Delete submission files
        if (assignment.submissions && assignment.submissions.length > 0) {
          for (const submission of assignment.submissions) {
            if (submission.submissionFileKey) {
              try {
                await deleteFileFromAzure(submission.submissionFileKey);
              } catch (deleteError) {
                console.error("Error deleting submission file:", deleteError);
              }
            }
          }
        }
      }
      await Assignment.deleteMany({ course: course._id }).session(session);

      // Delete announcements and images
      const announcements = await Announcement.find({
        course: course._id,
      }).session(session);
      for (const announcement of announcements) {
        if (announcement.image && announcement.image.imageKey) {
          try {
            await deleteFileFromAzure(announcement.image.imageKey);
          } catch (deleteError) {
            console.error("Error deleting announcement image:", deleteError);
          }
        }
      }
      await Announcement.deleteMany({ course: course._id }).session(session);

      // Delete discussions
      await Discussion.deleteMany({ course: course._id }).session(session);

      // Delete EContent
      const eContent = await EContent.findOne({ course: course._id }).session(
        session
      );
      if (eContent) {
        for (const module of eContent.modules) {
          if (module.files && module.files.length > 0) {
            for (const file of module.files) {
              try {
                await deleteFileFromAzure(file.fileKey);
              } catch (deleteError) {
                console.error("Error deleting EContent file:", deleteError);
              }
            }
          }
        }
      }
      await EContent.deleteMany({ course: course._id }).session(session);
    }

    // Delete all courses with this course code
    await Course.deleteMany({ courseCode: normalizedCourseCode }).session(
      session
    );

    // Remove course code from all teachers
    await Teacher.updateMany(
      { courseCodes: normalizedCourseCode },
      { $pull: { courseCodes: normalizedCourseCode } }
    ).session(session);

    // Remove course code from all students
    await Student.updateMany(
      { courseCodes: normalizedCourseCode },
      { $pull: { courseCodes: normalizedCourseCode } }
    ).session(session);

    await session.commitTransaction();
    transactionStarted = false;

    res.status(200).json({
      success: true,
      message: `Course code ${normalizedCourseCode} and all related data deleted successfully`,
      deletedCourseCode: normalizedCourseCode,
      deletedCoursesCount: courses.length,
    });
  } catch (error) {
    console.error("Error in deleteCourseCode:", error);

    if (transactionStarted) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    await session.endSession();
  }
});

// Search functionality across all entities
const searchAll = catchAsyncErrors(async (req, res, next) => {
  console.log("searchAll: Started");

  try {
    const { query, type, limit = 10 } = req.query;

    if (!query || query.trim().length < 2) {
      return next(
        new ErrorHandler("Search query must be at least 2 characters long", 400)
      );
    }

    const searchRegex = { $regex: query.trim(), $options: "i" };
    const limitNum = parseInt(limit);

    let results = {};

    // Search users (if type is not specified or is 'users')
    if (!type || type === "users") {
      const users = await User.find({
        $or: [
          { name: searchRegex },
          { email: searchRegex },
          { mobileNo: searchRegex },
        ],
      })
        .select("name email role mobileNo createdAt")
        .limit(limitNum);

      results.users = users;
    }

    // Search courses (if type is not specified or is 'courses')
    if (!type || type === "courses") {
      const courses = await Course.find({
        $or: [
          { title: searchRegex },
          { courseCode: searchRegex },
          { aboutCourse: searchRegex },
        ],
      })
        .populate("teacher", "email")
        .populate("semester", "name")
        .select("title courseCode aboutCourse createdAt")
        .limit(limitNum);

      results.courses = courses;
    }

    // Search course codes (if type is not specified or is 'courseCodes')
    if (!type || type === "courseCodes") {
      const teachers = await Teacher.find({
        courseCodes: searchRegex,
      }).populate("user", "name email");

      const courseCodes = [
        ...new Set(
          teachers.flatMap((teacher) =>
            teacher.courseCodes.filter((code) =>
              code.toLowerCase().includes(query.toLowerCase())
            )
          )
        ),
      ];

      results.courseCodes = courseCodes;
    }

    // Search lectures (if type is not specified or is 'lectures')
    if (!type || type === "lectures") {
      const lectures = await Lecture.find({
        $or: [{ title: searchRegex }, { content: searchRegex }],
        isActive: true,
      })
        .populate("course", "title courseCode")
        .select("title content createdAt")
        .limit(limitNum);

      results.lectures = lectures;
    }

    // Search assignments (if type is not specified or is 'assignments')
    if (!type || type === "assignments") {
      const assignments = await Assignment.find({
        $or: [{ title: searchRegex }, { description: searchRegex }],
        isActive: true,
      })
        .populate("course", "title courseCode")
        .select("title description dueDate createdAt")
        .limit(limitNum);

      results.assignments = assignments;
    }

    res.status(200).json({
      success: true,
      message: "Search completed successfully",
      query: query.trim(),
      results,
    });
  } catch (error) {
    console.error("Error in searchAll:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Get all teachers with filtering
const getAllTeachers = catchAsyncErrors(async (req, res, next) => {
  console.log("getAllTeachers: Started");

  try {
    const {
      page = 1,
      limit = 10,
      courseCode,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let query = {};

    if (courseCode) {
      query.courseCodes = courseCode.toUpperCase();
    }

    if (search) {
      query.$or = [
        { email: { $regex: search, $options: "i" } },
        { courseCodes: { $regex: search, $options: "i" } },
      ];
    }

    const totalTeachers = await Teacher.countDocuments(query);

    const teachers = await Teacher.find(query)
      .populate({
        path: "user",
        select: "name email mobileNo gender ageAsOn2025 createdAt",
      })
      .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
      .skip(skip)
      .limit(limitNum);

    const teachersWithStats = await Promise.all(
      teachers.map(async (teacher) => {
        const studentCount = await Student.countDocuments({
          teacher: teacher._id,
        });

        const courseCount = await Course.countDocuments({
          teacher: teacher._id,
        });

        return {
          _id: teacher._id,
          name: teacher.user?.name,
          email: teacher.email,
          mobileNo: teacher.user?.mobileNo,
          gender: teacher.user?.gender,
          age: teacher.user?.ageAsOn2025,
          courseCodes: teacher.courseCodes,
          stats: {
            studentCount,
            courseCount,
          },
          createdAt: teacher.createdAt,
        };
      })
    );

    res.status(200).json({
      success: true,
      message: "Teachers retrieved successfully",
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalTeachers / limitNum),
        totalTeachers,
        hasNext: pageNum < Math.ceil(totalTeachers / limitNum),
        hasPrev: pageNum > 1,
      },
      teachers: teachersWithStats,
    });
  } catch (error) {
    console.error("Error in getAllTeachers:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Update teacher course codes
const updateTeacherCourseCodes = catchAsyncErrors(async (req, res, next) => {
  console.log("updateTeacherCourseCodes: Started");

  try {
    const { teacherId } = req.params;
    const { courseCodes, action = "replace" } = req.body;

    if (!courseCodes || !Array.isArray(courseCodes)) {
      return next(new ErrorHandler("Course codes array is required", 400));
    }

    const teacher = await Teacher.findById(teacherId);

    if (!teacher) {
      return next(new ErrorHandler("Teacher not found", 404));
    }

    const normalizedCourseCodes = courseCodes.map((code) =>
      code.toUpperCase().trim()
    );

    switch (action) {
      case "add":
        normalizedCourseCodes.forEach((code) => {
          if (!teacher.courseCodes.includes(code)) {
            teacher.courseCodes.push(code);
          }
        });
        break;

      case "remove":
        teacher.courseCodes = teacher.courseCodes.filter(
          (code) => !normalizedCourseCodes.includes(code)
        );
        break;

      case "replace":
      default:
        teacher.courseCodes = normalizedCourseCodes;
        break;
    }

    await teacher.save();

    res.status(200).json({
      success: true,
      message: `Teacher course codes ${action}d successfully`,
      teacher: {
        _id: teacher._id,
        email: teacher.email,
        courseCodes: teacher.courseCodes,
      },
    });
  } catch (error) {
    console.error("Error in updateTeacherCourseCodes:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Get all students with filtering
const getAllStudents = catchAsyncErrors(async (req, res, next) => {
  console.log("getAllStudents: Started");

  try {
    const {
      page = 1,
      limit = 10,
      courseCode,
      teacherEmail,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let query = {};

    if (courseCode) {
      query.courseCodes = courseCode.toUpperCase();
    }

    if (teacherEmail) {
      query.teacherEmail = { $regex: teacherEmail, $options: "i" };
    }

    if (search) {
      const users = await User.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { mobileNo: { $regex: search, $options: "i" } },
        ],
        role: "student",
      }).select("_id");

      const userIds = users.map((u) => u._id);
      query.user = { $in: userIds };
    }

    const totalStudents = await Student.countDocuments(query);

    const students = await Student.find(query)
      .populate({
        path: "user",
        select:
          "name email mobileNo gender ageAsOn2025 bloodGroup fullPermanentAddress createdAt",
      })
      .populate({
        path: "teacher",
        select: "email",
        populate: {
          path: "user",
          select: "name",
        },
      })
      .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
      .skip(skip)
      .limit(limitNum);

    const studentsWithStats = students.map((student) => ({
      _id: student._id,
      name: student.user?.name,
      email: student.user?.email,
      mobileNo: student.user?.mobileNo,
      gender: student.user?.gender,
      age: student.user?.ageAsOn2025,
      bloodGroup: student.user?.bloodGroup,
      address: student.user?.fullPermanentAddress,
      courseCodes: student.courseCodes,
      teacherEmail: student.teacherEmail,
      teacherName: student.teacher?.user?.name,
      enrolledCoursesCount: student.courses.length,
      createdAt: student.createdAt,
    }));

    res.status(200).json({
      success: true,
      message: "Students retrieved successfully",
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalStudents / limitNum),
        totalStudents,
        hasNext: pageNum < Math.ceil(totalStudents / limitNum),
        hasPrev: pageNum > 1,
      },
      students: studentsWithStats,
    });
  } catch (error) {
    console.error("Error in getAllStudents:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Update student course codes
const updateStudentCourseCodes = catchAsyncErrors(async (req, res, next) => {
  console.log("updateStudentCourseCodes: Started");

  try {
    const { studentId } = req.params;
    const { courseCodes, action = "replace" } = req.body;

    if (!courseCodes || !Array.isArray(courseCodes)) {
      return next(new ErrorHandler("Course codes array is required", 400));
    }

    const student = await Student.findById(studentId);

    if (!student) {
      return next(new ErrorHandler("Student not found", 404));
    }

    const normalizedCourseCodes = courseCodes.map((code) =>
      code.toUpperCase().trim()
    );

    switch (action) {
      case "add":
        normalizedCourseCodes.forEach((code) => {
          if (!student.courseCodes.includes(code)) {
            student.courseCodes.push(code);
          }
        });
        break;

      case "remove":
        student.courseCodes = student.courseCodes.filter(
          (code) => !normalizedCourseCodes.includes(code)
        );
        break;

      case "replace":
      default:
        student.courseCodes = normalizedCourseCodes;
        break;
    }

    await student.save();

    res.status(200).json({
      success: true,
      message: `Student course codes ${action}d successfully`,
      student: {
        _id: student._id,
        teacherEmail: student.teacherEmail,
        courseCodes: student.courseCodes,
      },
    });
  } catch (error) {
    console.error("Error in updateStudentCourseCodes:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Bulk delete users
const bulkDeleteUsers = catchAsyncErrors(async (req, res, next) => {
  console.log("bulkDeleteUsers: Started");

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { userIds, confirmDelete } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return next(new ErrorHandler("User IDs array is required", 400));
    }

    if (!confirmDelete) {
      return next(
        new ErrorHandler(
          "Please confirm delete operation by setting confirmDelete to true",
          400
        )
      );
    }

    const deletedUsers = [];
    const errors = [];

    for (const userId of userIds) {
      try {
        const user = await User.findById(userId).session(session);

        if (!user) {
          errors.push(`User not found: ${userId}`);
          continue;
        }

        const userRole = user.role;
        const userEmail = user.email;

        // Basic deletion - for production, implement full cleanup logic like in deleteUser
        if (userRole === "teacher") {
          const teacher = await Teacher.findOne({ user: userId }).session(
            session
          );
          if (teacher) {
            // Remove from courses
            await Course.updateMany(
              { teacher: teacher._id },
              { $unset: { teacher: 1 } }
            ).session(session);

            await Teacher.findByIdAndDelete(teacher._id).session(session);
          }
        } else if (userRole === "student") {
          const student = await Student.findOne({ user: userId }).session(
            session
          );
          if (student) {
            await Student.findByIdAndDelete(student._id).session(session);
          }
        }

        await User.findByIdAndDelete(userId).session(session);

        deletedUsers.push({
          _id: userId,
          email: userEmail,
          role: userRole,
        });
      } catch (error) {
        errors.push(`Error deleting user ${userId}: ${error.message}`);
      }
    }

    await session.commitTransaction();
    transactionStarted = false;

    res.status(200).json({
      success: true,
      message: "Bulk delete operation completed",
      deletedUsers,
      errors: errors.length > 0 ? errors : undefined,
      summary: {
        requested: userIds.length,
        deleted: deletedUsers.length,
        failed: errors.length,
      },
    });
  } catch (error) {
    console.error("Error in bulkDeleteUsers:", error);

    if (transactionStarted) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    await session.endSession();
  }
});

// Bulk update course codes
const bulkUpdateCourseCodes = catchAsyncErrors(async (req, res, next) => {
  console.log("bulkUpdateCourseCodes: Started");

  try {
    const { operations, confirmUpdate } = req.body;

    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      return next(new ErrorHandler("Operations array is required", 400));
    }

    if (!confirmUpdate) {
      return next(
        new ErrorHandler(
          "Please confirm update operation by setting confirmUpdate to true",
          400
        )
      );
    }

    const results = [];
    const errors = [];

    for (const operation of operations) {
      try {
        const { type, emails, courseCodes } = operation;

        if (!["add", "remove", "replace"].includes(type)) {
          errors.push(`Invalid operation type: ${type}`);
          continue;
        }

        if (
          !emails ||
          !Array.isArray(emails) ||
          !courseCodes ||
          !Array.isArray(courseCodes)
        ) {
          errors.push(`Invalid operation data for type: ${type}`);
          continue;
        }

        const normalizedCourseCodes = courseCodes.map((code) =>
          code.toUpperCase().trim()
        );

        for (const email of emails) {
          try {
            const teacher = await Teacher.findOne({
              email: email.toLowerCase().trim(),
            });

            if (!teacher) {
              errors.push(`Teacher not found: ${email}`);
              continue;
            }

            switch (type) {
              case "add":
                normalizedCourseCodes.forEach((code) => {
                  if (!teacher.courseCodes.includes(code)) {
                    teacher.courseCodes.push(code);
                  }
                });
                break;

              case "remove":
                teacher.courseCodes = teacher.courseCodes.filter(
                  (code) => !normalizedCourseCodes.includes(code)
                );
                break;

              case "replace":
                teacher.courseCodes = normalizedCourseCodes;
                break;
            }

            await teacher.save();
            results.push({
              email: teacher.email,
              operation: type,
              courseCodes: teacher.courseCodes,
            });
          } catch (error) {
            errors.push(`Error updating teacher ${email}: ${error.message}`);
          }
        }
      } catch (error) {
        errors.push(`Error processing operation: ${error.message}`);
      }
    }

    res.status(200).json({
      success: true,
      message: "Bulk course code update completed",
      results,
      errors: errors.length > 0 ? errors : undefined,
      summary: {
        operations: operations.length,
        successful: results.length,
        failed: errors.length,
      },
    });
  } catch (error) {
    console.error("Error in bulkUpdateCourseCodes:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

module.exports = {
  // Existing functions
  uploadUsers,
  getStudentsByTeacherId,
  getMyStudents,

  // New admin functions for course codes and courses
  getAllCourseCodes,
  getCoursesByCode,
  createCourseCode,
  updateCourseCode,
  deleteCourseCode,

  // User management
  getAllUsers,
  deleteUser,

  // Course management
  getAllCourses,
  deleteCourse,

  // Teacher management
  getAllTeachers,
  updateTeacherCourseCodes,

  // Student management
  getAllStudents,
  updateStudentCourseCodes,

  // Bulk operations
  bulkDeleteUsers,
  bulkUpdateCourseCodes,

  // System utilities
  getSystemStats,
  searchAll,
};
